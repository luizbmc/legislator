const express = require('express')
const router = express.Router()
const db = require('../db')

function buscarPublicacaoCompleta(id) {
  const pub = db.prepare(`SELECT * FROM publicacoes WHERE id = ?`).get(id)
  if (!pub) return null

  const secoes = db.prepare(`
    SELECT * FROM publicacao_secoes WHERE publicacao_id = ? ORDER BY ordem ASC
  `).all(id)

  for (const secao of secoes) {
    secao.normas = db.prepare(`
      SELECT pn.id AS pn_id, pn.norma_id, pn.ordem,
             n.tipo, n.epigrafe, n.apelido
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

// GET /norma/docx/:id
router.get('/norma/docx/:id', async (req, res) => {
  try {
    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada' })

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
    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada' })

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
    const pub = buscarPublicacaoCompleta(req.params.id)
    if (!pub) return res.status(404).json({ error: 'Publicação não encontrada' })

    const { gerarDocxPublicacao } = await import('../../electron/main/services/exportDocx.js')
    const buffer = await gerarDocxPublicacao(pub, db)

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
    const pub = buscarPublicacaoCompleta(req.params.id)
    if (!pub) return res.status(404).json({ error: 'Publicação não encontrada' })

    const { gerarHtmlPublicacao } = await import('../../electron/main/services/exportHtml.js')
    const html = await gerarHtmlPublicacao(pub, db)

    const filename = encodeURIComponent(`${pub.titulo || 'publicacao'}.html`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send(html)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
