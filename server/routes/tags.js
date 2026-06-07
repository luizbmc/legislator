const express = require('express')
const router = express.Router()
const db = require('../db')

// GET / — listar todas as tags
router.get('/', (req, res) => {
  try {
    const tags = db.prepare(`SELECT nome FROM tags ORDER BY nome ASC`).all()
    res.json(tags.map(t => t.nome))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
