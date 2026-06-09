const express = require('express')
const router = express.Router()
const db = require('../db')

const SECOES_PADRAO = ['Normas principais', 'Normas correlatas', 'Outras normas']

function buscarCompleto(id) {
  const pub = db.prepare(`SELECT * FROM publicacoes WHERE id = ?`).get(id)
  if (!pub) return null

  const secoes = db.prepare(`
    SELECT * FROM publicacao_secoes WHERE publicacao_id = ? ORDER BY ordem ASC
  `).all(id)

  for (const secao of secoes) {
    secao.normas = db.prepare(`
      SELECT pn.id, pn.ordem, n.*
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem ASC
    `).all(secao.id)
  }

  pub.secoes = secoes
  return pub
}

function salvarSecoes(publicacaoId, secoes) {
  db.prepare(`DELETE FROM publicacao_secoes WHERE publicacao_id = ?`).run(publicacaoId)

  for (let i = 0; i < secoes.length; i++) {
    const secao = secoes[i]
    const result = db.prepare(`
      INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem) VALUES (?, ?, ?)
    `).run(publicacaoId, secao.titulo, i)

    const secaoId = result.lastInsertRowid

    if (secao.normas && secao.normas.length) {
      for (let j = 0; j < secao.normas.length; j++) {
        const norma = secao.normas[j]
        const normaId = norma.norma_id || norma.id
        db.prepare(`
          INSERT INTO publicacao_normas (secao_id, norma_id, ordem) VALUES (?, ?, ?)
        `).run(secaoId, normaId, j)
      }
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

    db.prepare(`
      UPDATE publicacoes
      SET titulo = ?, edicao = ?, organizador = ?, lancado_em = ?, descricao = ?, caminho_rede = ?, cor_capa = ?, status = ?, ultima_edicao = ?, atualizado_em = ?
      WHERE id = ?
    `).run(titulo, edicao, organizador, lancado_em, descricao, caminho_rede || null, cor_capa || null, status, ultima_edicao ? 1 : 0, agora, id)

    if (secoes) {
      salvarSecoes(id, secoes)
    }

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
