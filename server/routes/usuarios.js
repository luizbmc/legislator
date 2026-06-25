const express = require('express')
const { randomUUID } = require('crypto')
const db = require('../db')

const router = express.Router()

router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT id, nome, cor, ativo, criado_em, atualizado_em
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome COLLATE NOCASE
  `).all().map(item => ({ ...item, ativo: Boolean(item.ativo) })))
})

router.post('/', (req, res) => {
  const nome = String(req.body?.nome || '').trim()
  if (!nome) return res.status(400).json({ error: 'Informe o nome do usuário.' })
  const agora = new Date().toISOString()
  const id = String(req.body?.id || '').trim() || randomUUID()
  db.prepare(`
    INSERT INTO usuarios (id, nome, cor, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, nome, req.body?.cor || '#2563eb', agora, agora)
  res.status(201).json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id))
})

router.put('/:id', (req, res) => {
  db.prepare(`
    UPDATE usuarios SET nome = ?, cor = ?, atualizado_em = ? WHERE id = ?
  `).run(
    String(req.body?.nome || '').trim(),
    req.body?.cor || '#2563eb',
    new Date().toISOString(),
    req.params.id,
  )
  res.json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare(`
    UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?
  `).run(new Date().toISOString(), req.params.id)
  res.json({ ok: true })
})

module.exports = router
