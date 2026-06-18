const express = require('express')
const router = express.Router()
const db = require('../db')

const SECOES_PADRAO = ['Normas principais', 'Normas correlatas', 'Outras normas']
const EXPORTACOES_VALIDAS = new Set(['ignorar', 'atualizacao', 'completa'])

function exportacaoParaSalvar(norma) {
  if (norma?.status !== 'finalizado' || norma?.atualizacao_pendente) return 'ignorar'
  return EXPORTACOES_VALIDAS.has(norma?.exportacao) ? norma.exportacao : 'completa'
}

function buscarCompleto(id) {
  const pub = db.prepare(`SELECT * FROM publicacoes WHERE id = ?`).get(id)
  if (!pub) return null

  const secoes = db.prepare(`
    SELECT * FROM publicacao_secoes WHERE publicacao_id = ? ORDER BY ordem ASC
  `).all(id)

  for (const secao of secoes) {
    secao.normas = db.prepare(`
      SELECT pn.id AS pn_id, pn.norma_id, pn.ordem, pn.exportacao,
             n.*
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem ASC
    `).all(secao.id)
  }

  pub.secoes = secoes
  return pub
}

function idNumerico(valor) {
  const numero = Number(valor)
  return Number.isInteger(numero) && numero > 0 ? numero : null
}

function normaIdPublicacao(norma) {
  return idNumerico(norma?.norma_id ?? norma?.normaId ?? norma?.id)
}

function valoresDiferentes(a, b) {
  return String(a ?? '') !== String(b ?? '')
}

function salvarSecoes(publicacaoId, secoes) {
  const secoesAtuais = db.prepare(`
    SELECT id, titulo, ordem FROM publicacao_secoes WHERE publicacao_id = ?
  `).all(publicacaoId)
  const secoesPorId = new Map(secoesAtuais.map(secao => [Number(secao.id), secao]))
  const secoesMantidas = new Set()

  for (let i = 0; i < secoes.length; i++) {
    const secao = secoes[i]
    let secaoId = idNumerico(secao.id)
    const secaoAtual = secaoId ? secoesPorId.get(secaoId) : null

    if (secaoAtual) {
      secoesMantidas.add(secaoId)
      if (valoresDiferentes(secaoAtual.titulo, secao.titulo) || Number(secaoAtual.ordem) !== i) {
        db.prepare(`
          UPDATE publicacao_secoes SET titulo = ?, ordem = ? WHERE id = ? AND publicacao_id = ?
        `).run(secao.titulo, i, secaoId, publicacaoId)
      }
    } else {
      const result = db.prepare(`
        INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem) VALUES (?, ?, ?)
      `).run(publicacaoId, secao.titulo, i)
      secaoId = result.lastInsertRowid
      secoesMantidas.add(secaoId)
    }

    const normasAtuais = db.prepare(`
      SELECT id, norma_id, ordem, exportacao FROM publicacao_normas WHERE secao_id = ?
    `).all(secaoId)
    const normasPorPnId = new Map(normasAtuais.map(norma => [Number(norma.id), norma]))
    const normasMantidas = new Set()

    for (let j = 0; j < (secao.normas || []).length; j++) {
      const norma = secao.normas[j]
      const normaId = normaIdPublicacao(norma)
      if (!normaId) continue

      const exportacao = exportacaoParaSalvar(norma)
      const pnId = idNumerico(norma.pn_id)
      const normaAtual = pnId ? normasPorPnId.get(pnId) : null

      if (normaAtual) {
        normasMantidas.add(pnId)
        if (
          Number(normaAtual.norma_id) !== normaId ||
          Number(normaAtual.ordem) !== j ||
          valoresDiferentes(normaAtual.exportacao, exportacao)
        ) {
          db.prepare(`
            UPDATE publicacao_normas
            SET norma_id = ?, ordem = ?, exportacao = ?
            WHERE id = ? AND secao_id = ?
          `).run(normaId, j, exportacao, pnId, secaoId)
        }
      } else {
        const result = db.prepare(`
          INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao) VALUES (?, ?, ?, ?)
        `).run(secaoId, normaId, j, exportacao)
        normasMantidas.add(result.lastInsertRowid)
      }
    }

    for (const atual of normasAtuais) {
      if (!normasMantidas.has(Number(atual.id))) {
        db.prepare('DELETE FROM publicacao_normas WHERE id = ? AND secao_id = ?').run(atual.id, secaoId)
      }
    }
  }

  for (const atual of secoesAtuais) {
    if (!secoesMantidas.has(Number(atual.id))) {
      db.prepare('DELETE FROM publicacao_secoes WHERE id = ? AND publicacao_id = ?').run(atual.id, publicacaoId)
    }
  }
}

// GET / — listar publicações
router.get('/', (req, res) => {
  try {
    const { busca, status, ultimaEdicao } = req.query
    const params = []
    let where = 'WHERE 1=1'

    if (busca && busca.trim()) {
      const term = `%${busca.trim()}%`
      where += ` AND (
        p.titulo LIKE ? OR p.edicao LIKE ? OR p.organizador LIKE ? OR p.descricao LIKE ? OR p.caminho_rede LIKE ? OR
        EXISTS (
          SELECT 1
          FROM publicacao_secoes ps2
          JOIN publicacao_normas pn2 ON pn2.secao_id = ps2.id
          JOIN normas n2 ON n2.id = pn2.norma_id
          WHERE ps2.publicacao_id = p.id
            AND (n2.epigrafe LIKE ? OR n2.apelido LIKE ? OR n2.ementa LIKE ?)
        )
      )`
      params.push(term, term, term, term, term, term, term, term)
    }
    if (status) {
      where += ' AND p.status = ?'
      params.push(status)
    }
    if (ultimaEdicao === 'true' || ultimaEdicao === '1') {
      where += ' AND COALESCE(p.ultima_edicao, 0) = 1'
    }

    const pubs = db.prepare(`
      SELECT p.*, COUNT(DISTINCT pn.id) AS total_normas
      FROM publicacoes p
      LEFT JOIN publicacao_secoes ps ON ps.publicacao_id = p.id
      LEFT JOIN publicacao_normas pn ON pn.secao_id = ps.id
      ${where}
      GROUP BY p.id
      ORDER BY p.atualizado_em DESC
    `).all(...params)
    res.json(pubs)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /:id — buscar publicação completa
router.get('/:id', (req, res) => {
  try {
    const pub = buscarCompleto(req.params.id)
    if (!pub) return res.status(404).json({ error: 'Publicação não encontrada' })
    res.json(pub)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST / — criar publicação
router.post('/', (req, res) => {
  try {
    const { titulo, edicao, organizador, lancado_em, descricao, caminho_rede, cor_capa, status, ultima_edicao } = req.body
    const agora = new Date().toISOString()

    const result = db.prepare(`
      INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, caminho_rede, cor_capa, status, ultima_edicao, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(titulo, edicao, organizador, lancado_em, descricao, caminho_rede || null, cor_capa || null, status || 'previsto', ultima_edicao ? 1 : 0, agora, agora)

    const pubId = result.lastInsertRowid

    for (let i = 0; i < SECOES_PADRAO.length; i++) {
      db.prepare(`
        INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem) VALUES (?, ?, ?)
      `).run(pubId, SECOES_PADRAO[i], i)
    }

    const pub = buscarCompleto(pubId)
    res.status(201).json(pub)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — salvar publicação
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id
    const { titulo, edicao, organizador, lancado_em, descricao, caminho_rede, cor_capa, status, ultima_edicao, secoes } = req.body
    const agora = new Date().toISOString()

    const salvar = db.transaction(() => {
      db.prepare(`
        UPDATE publicacoes
        SET titulo = ?, edicao = ?, organizador = ?, lancado_em = ?, descricao = ?, caminho_rede = ?, cor_capa = ?, status = ?, ultima_edicao = ?, atualizado_em = ?
        WHERE id = ?
      `).run(titulo, edicao, organizador, lancado_em, descricao, caminho_rede || null, cor_capa || null, status, ultima_edicao ? 1 : 0, agora, id)

      if (Array.isArray(secoes)) {
        salvarSecoes(id, secoes)
      }
    })
    salvar()

    const pub = buscarCompleto(id)
    res.json(pub)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — excluir publicação
router.delete('/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM publicacoes WHERE id = ?`).run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /:id/duplicar — duplicar publicação
router.post('/:id/duplicar', (req, res) => {
  try {
    const original = buscarCompleto(req.params.id)
    if (!original) return res.status(404).json({ error: 'Publicação não encontrada' })

    const agora = new Date().toISOString()

    const result = db.prepare(`
      INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, caminho_rede, cor_capa, status, ultima_edicao, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `Cópia de ${original.titulo}`,
      original.edicao,
      original.organizador,
      original.lancado_em,
      original.descricao,
      original.caminho_rede || null,
      original.cor_capa || null,
      original.status,
      original.ultima_edicao ? 1 : 0,
      agora,
      agora
    )

    const novaPubId = result.lastInsertRowid

    if (original.secoes) {
      salvarSecoes(novaPubId, original.secoes)
    }

    const pub = buscarCompleto(novaPubId)
    res.status(201).json(pub)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
