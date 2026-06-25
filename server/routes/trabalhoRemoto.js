const express = require('express')
const db = require('../db')
const {
  aplicarDevolucao,
  criarDevolucao,
  criarRetirada,
  importarRetirada,
  listarNormasNovasCandidatas,
  listarPacotes,
} = require('../../shared/trabalhoRemoto.cjs')

const router = express.Router()

router.get('/pacotes', (req, res) => {
  try {
    res.json(listarPacotes(db))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/retirada', (req, res) => {
  try {
    res.json(criarRetirada(
      db,
      req.body?.normaIds,
      req.body?.criadoPor,
      req.body?.publicacaoIds,
    ))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/retirada/importar', (req, res) => {
  try {
    res.json(importarRetirada(db, req.body?.pacote, req.body?.atualizadoPor))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/devolucao/:id', (req, res) => {
  try {
    res.json(criarDevolucao(
      db,
      req.params.id,
      req.body?.criadoPor,
      req.body?.novaNormaIds,
    ))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get('/pacotes/:id/normas-novas', (req, res) => {
  try {
    res.json(listarNormasNovasCandidatas(db, req.params.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/devolucao/importar', (req, res) => {
  try {
    res.json(aplicarDevolucao(db, req.body?.pacote, req.body?.atualizadoPor))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

module.exports = router
