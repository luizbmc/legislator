const express = require('express')
const router = express.Router()
const db = require('../db')

// PATCH /:id/resolver — marcar exceção como resolvida
router.patch('/:id/resolver', (req, res) => {
  try {
    db.prepare(`UPDATE excecoes SET resolvida = 1 WHERE id = ?`).run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
