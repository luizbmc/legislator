const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const db = require('../db')
const { criarClienteRailway } = require('../../shared/railwayRemoto.cjs')

function configuracaoRailway() {
  const dir = process.env.DB_DIR || path.join(__dirname, '..', '..', 'server-data')
  const arquivo = path.join(dir, 'railway-remoto.json')
  if (!fs.existsSync(arquivo)) return null
  try {
    const config = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    return config.modo === 'railway' ? config : null
  } catch {
    return null
  }
}

async function buscarNormaFonte(id) {
  const config = configuracaoRailway()
  if (config) return criarClienteRailway(config).requisitar('GET', `/api/normas/${id}`)
  return db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
}

async function buscarPublicacaoFonte(id) {
  const config = configuracaoRailway()
  if (config) {
    return criarClienteRailway(config).requisitar(
      'GET',
      `/api/publicacoes/${id}?incluirConteudo=true`,
    )
  }
  return buscarPublicacaoCompleta(id)
}

function dbPublicacao(publicacao) {
  const normas = new Map(
    (publicacao.secoes || [])
      .flatMap(secao => secao.normas || [])
      .map(norma => [Number(norma.norma_id || norma.id), norma]),
  )
  return {
    prepare() {
      return { get: id => normas.get(Number(id)) }
    },
  }
}

function buscarPublicacaoCompleta(id) {
  const pub = db.prepare(`SELECT * FROM publicacoes WHERE id = ?`).get(id)
  if (!pub) return null

  const secoes = db.prepare(`
    SELECT * FROM publicacao_secoes WHERE publicacao_id = ? ORDER BY ordem ASC
  `).all(id)

  for (const secao of secoes) {
    secao.normas = db.prepare(`
      SELECT pn.id AS pn_id, pn.norma_id, pn.ordem,
             n.tipo, n.epigrafe, n.apelido, n.atualizacao_pendente
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem ASC
    `).all(secao.id)
  }

  pub.secoes = secoes
  return pub
}

function selectionNormaPayload(payload = {}) {
  return {
    epigrafe: payload.epigrafe || 'seleção',
    conteudo_doc: typeof payload.conteudo_doc === 'string'
      ? payload.conteudo_doc
      : JSON.stringify(payload.conteudo_doc || { type: 'doc', content: [] }),
  }
}

function safeDownloadName(text, fallback) {
  return encodeURIComponent(String(text || fallback || 'selecao').replace(/[/\\?%*:|"<>]/g, '-'))
}

function normaExportavel(norma, res) {
  if (!norma?.atualizacao_pendente) return true
  res.status(409).json({
    error: `Exportação bloqueada: a norma "${norma.epigrafe || 'sem epígrafe'}" está com Atualização pendente.`,
  })
  return false
}

function publicacaoExportavel(pub, res) {
  const pendentes = (pub?.secoes || [])
    .flatMap(secao => secao.normas || [])
    .filter(norma => Boolean(norma?.atualizacao_pendente))
  if (!pendentes.length) return true
  res.status(409).json({
    error: `Exportação bloqueada: a publicação contém norma(s) com Atualização pendente: ${pendentes.map(n => n.epigrafe || 'Norma sem epígrafe').join('; ')}`,
  })
  return false
}

async function payloadExportavel(payload = {}, res) {
  const normaId = payload.norma_id || payload.id
  if (!normaId) return true
  const norma = await buscarNormaFonte(normaId)
  return norma ? normaExportavel(norma, res) : true
}

// GET /norma/docx/:id
router.get('/norma/docx/:id', async (req, res) => {
  try {
    const norma = await buscarNormaFonte(req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada' })
    if (!normaExportavel(norma, res)) return

    const { gerarDocx } = await import('../../electron/main/services/exportDocx.js')
    const buffer = await gerarDocx(norma)

    const filename = encodeURIComponent(`${norma.epigrafe || 'norma'}.docx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /norma/html/:id
router.get('/norma/html/:id', async (req, res) => {
  try {
    const norma = await buscarNormaFonte(req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada' })
    if (!normaExportavel(norma, res)) return

    const { gerarHtml } = await import('../../electron/main/services/exportHtml.js')
    const html = await gerarHtml(norma)

    const filename = encodeURIComponent(`${norma.epigrafe || 'norma'}.html`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(html)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /norma/docx-selecao
router.post('/norma/docx-selecao', async (req, res) => {
  try {
    if (!await payloadExportavel(req.body, res)) return
    const norma = selectionNormaPayload(req.body)
    const { gerarDocx } = await import('../../electron/main/services/exportDocx.js')
    const buffer = await gerarDocx(norma)

    const filename = safeDownloadName(req.body?.nomeBase, 'selecao') + '.docx'
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /norma/html-selecao
router.post('/norma/html-selecao', async (req, res) => {
  try {
    if (!await payloadExportavel(req.body, res)) return
    const norma = selectionNormaPayload(req.body)
    const { gerarHtml } = await import('../../electron/main/services/exportHtml.js')
    const html = await gerarHtml(norma)

    const filename = safeDownloadName(req.body?.nomeBase, 'selecao') + '.html'
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(html)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /publicacao/docx/:id
router.get('/publicacao/docx/:id', async (req, res) => {
  try {
    const pub = await buscarPublicacaoFonte(req.params.id)
    if (!pub) return res.status(404).json({ error: 'Publicação não encontrada' })
    if (!publicacaoExportavel(pub, res)) return

    const { gerarDocxPublicacao } = await import('../../electron/main/services/exportDocx.js')
    const buffer = await gerarDocxPublicacao(pub, configuracaoRailway() ? dbPublicacao(pub) : db)

    const filename = encodeURIComponent(`${pub.titulo || 'publicacao'}.docx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /publicacao/html/:id
router.get('/publicacao/html/:id', async (req, res) => {
  try {
    const pub = await buscarPublicacaoFonte(req.params.id)
    if (!pub) return res.status(404).json({ error: 'Publicação não encontrada' })
    if (!publicacaoExportavel(pub, res)) return

    const { gerarHtmlPublicacao } = await import('../../electron/main/services/exportHtml.js')
    const html = await gerarHtmlPublicacao(pub, configuracaoRailway() ? dbPublicacao(pub) : db)

    const filename = encodeURIComponent(`${pub.titulo || 'publicacao'}.html`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(html)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
