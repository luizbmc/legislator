const express = require('express')
const router = express.Router()
const db = require('../db')

// GET / — listar normas
router.get('/', (req, res) => {
  try {
    const { busca, tipo, status, buscarConteudo } = req.query
    let where = []
    let params = []

    if (busca) {
      const like = `%${busca}%`
      if (buscarConteudo === 'true' || buscarConteudo === true) {
        where.push(`(
          n.epigrafe LIKE ? OR n.apelido LIKE ? OR n.ementa LIKE ? OR n.conteudo_txt LIKE ? OR
          n.dados_publicacao LIKE ? OR n.vigencia LIKE ? OR n.link_acesso LIKE ? OR
          n.anexo LIKE ? OR n.observacoes LIKE ?
        )`)
        params.push(like, like, like, like, like, like, like, like, like)
      } else {
        where.push(`(n.epigrafe LIKE ? OR n.apelido LIKE ?)`)
        params.push(like, like)
      }
    }
    if (tipo) {
      where.push(`n.tipo = ?`)
      params.push(tipo)
    }
    if (status) {
      where.push(`n.status = ?`)
      params.push(status)
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `
      SELECT n.*, GROUP_CONCAT(t.nome, '|||') AS tags_str
      FROM normas n
      LEFT JOIN norma_tags nt ON nt.norma_id = n.id
      LEFT JOIN tags t ON t.id = nt.tag_id
      ${whereClause}
      GROUP BY n.id
      ORDER BY n.atualizado_em DESC
    `

    const rows = db.prepare(sql).all(...params)
    const normas = rows.map(row => {
      const { tags_str, ...rest } = row
      return {
        ...rest,
        tags: tags_str ? tags_str.split('|||') : []
      }
    })

    res.json(normas)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /:id — buscar norma
router.get('/:id', (req, res) => {
  try {
    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada' })

    const tagRows = db.prepare(`
      SELECT t.nome FROM tags t
      JOIN norma_tags nt ON nt.tag_id = t.id
      WHERE nt.norma_id = ?
    `).all(req.params.id)

    norma.tags = tagRows.map(r => r.nome)
    res.json(norma)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST / — criar norma
router.post('/', (req, res) => {
  try {
    const {
      tipo,
      epigrafe,
      apelido,
      ementa,
      dados_publicacao,
      data_ultima_alteracao,
      atualizacao_pendente,
      vigencia = 'Vigente',
      link_acesso,
      anexo,
      observacoes,
      tags = [],
    } = req.body
    const agora = new Date().toISOString()

    const result = db.prepare(`
      INSERT INTO normas (
        tipo, epigrafe, apelido, ementa, dados_publicacao,
        data_ultima_alteracao, atualizacao_pendente, vigencia, link_acesso, anexo, observacoes,
        criado_em, atualizado_em
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tipo,
      epigrafe,
      apelido || null,
      ementa || null,
      dados_publicacao || null,
      data_ultima_alteracao || null,
      atualizacao_pendente ? 1 : 0,
      vigencia || 'Vigente',
      link_acesso || null,
      anexo || null,
      observacoes || null,
      agora,
      agora,
    )

    const normaId = result.lastInsertRowid

    for (const nome of tags) {
      db.prepare(`INSERT OR IGNORE INTO tags (nome) VALUES (?)`).run(nome)
      const tag = db.prepare(`SELECT id FROM tags WHERE nome = ?`).get(nome)
      db.prepare(`INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)`).run(normaId, tag.id)
    }

    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(normaId)
    norma.tags = tags

    res.status(201).json(norma)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — salvar conteúdo
router.put('/:id', (req, res) => {
  try {
    const { conteudo_doc, conteudo_txt, status, data_atualizacao } = req.body
    const id = req.params.id

    const atual = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(id)
    if (!atual) return res.status(404).json({ error: 'Norma não encontrada' })

    // Salvar versão anterior
    if (atual.conteudo_doc && atual.conteudo_doc !== '{"type":"doc","content":[]}') {
      const ultimaVersao = db.prepare(`
        SELECT versao FROM normas_versoes WHERE norma_id = ? ORDER BY versao DESC LIMIT 1
      `).get(id)
      const proximaVersao = ultimaVersao ? ultimaVersao.versao + 1 : 1

      db.prepare(`
        INSERT INTO normas_versoes (norma_id, versao, doc_json, criado_em)
        VALUES (?, ?, ?, ?)
      `).run(id, proximaVersao, atual.conteudo_doc, new Date().toISOString())
    }

    const agora = new Date().toISOString()
    db.prepare(`
      UPDATE normas
      SET conteudo_doc = ?, conteudo_txt = ?, status = ?, data_atualizacao = ?, atualizado_em = ?
      WHERE id = ?
    `).run(conteudo_doc, conteudo_txt, status, data_atualizacao, agora, id)

    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(id)
    const tagRows = db.prepare(`
      SELECT t.nome FROM tags t JOIN norma_tags nt ON nt.tag_id = t.id WHERE nt.norma_id = ?
    `).all(id)
    norma.tags = tagRows.map(r => r.nome)

    res.json(norma)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /:id/meta — atualizar meta
router.patch('/:id/meta', (req, res) => {
  try {
    const {
      tipo,
      epigrafe,
      apelido,
      ementa,
      dados_publicacao,
      data_ultima_alteracao,
      atualizacao_pendente,
      vigencia = 'Vigente',
      link_acesso,
      anexo,
      observacoes,
      tags = [],
    } = req.body
    const id = req.params.id
    const agora = new Date().toISOString()

    db.prepare(`
      UPDATE normas SET
        tipo = ?,
        epigrafe = ?,
        apelido = ?,
        ementa = ?,
        dados_publicacao = ?,
        data_ultima_alteracao = ?,
        atualizacao_pendente = ?,
        vigencia = ?,
        link_acesso = ?,
        anexo = ?,
        observacoes = ?,
        atualizado_em = ?
      WHERE id = ?
    `).run(
      tipo,
      epigrafe,
      apelido || null,
      ementa || null,
      dados_publicacao || null,
      data_ultima_alteracao || null,
      atualizacao_pendente ? 1 : 0,
      vigencia || 'Vigente',
      link_acesso || null,
      anexo || null,
      observacoes || null,
      agora,
      id,
    )

    db.prepare(`DELETE FROM norma_tags WHERE norma_id = ?`).run(id)

    for (const nome of tags) {
      db.prepare(`INSERT OR IGNORE INTO tags (nome) VALUES (?)`).run(nome)
      const tag = db.prepare(`SELECT id FROM tags WHERE nome = ?`).get(nome)
      db.prepare(`INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)`).run(id, tag.id)
    }

    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(id)
    norma.tags = tags

    res.json(norma)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — excluir norma
router.delete('/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM normas WHERE id = ?`).run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /:id/versoes — listar versões
router.get('/:id/versoes', (req, res) => {
  try {
    const versoes = db.prepare(`
      SELECT id, norma_id, versao, diff_json, criado_em
      FROM normas_versoes
      WHERE norma_id = ?
      ORDER BY versao DESC
    `).all(req.params.id)
    res.json(versoes)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /:normaId/restaurar/:versaoId — restaurar versão
router.post('/:normaId/restaurar/:versaoId', (req, res) => {
  try {
    const { normaId, versaoId } = req.params
    const versao = db.prepare(`SELECT * FROM normas_versoes WHERE id = ? AND norma_id = ?`).get(versaoId, normaId)
    if (!versao) return res.status(404).json({ error: 'Versão não encontrada' })

    const agora = new Date().toISOString()
    db.prepare(`
      UPDATE normas SET conteudo_doc = ?, atualizado_em = ? WHERE id = ?
    `).run(versao.doc_json, agora, normaId)

    const norma = db.prepare(`SELECT * FROM normas WHERE id = ?`).get(normaId)
    const tagRows = db.prepare(`
      SELECT t.nome FROM tags t JOIN norma_tags nt ON nt.tag_id = t.id WHERE nt.norma_id = ?
    `).all(normaId)
    norma.tags = tagRows.map(r => r.nome)

    res.json(norma)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id/excecoes — salvar exceções
router.put('/:id/excecoes', (req, res) => {
  try {
    const id = req.params.id
    const lista = req.body
    const agora = new Date().toISOString()

    db.prepare(`DELETE FROM excecoes WHERE norma_id = ?`).run(id)

    for (const exc of lista) {
      db.prepare(`
        INSERT INTO excecoes (norma_id, tipo, descricao, linha, node_id, resolvida, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, exc.tipo, exc.descricao, exc.linha, exc.node_id, exc.resolvida || 0, agora)
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
