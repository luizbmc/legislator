const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const express = require('express')
const helmet = require('helmet')
const Database = require('better-sqlite3')

const PORT = Number(process.env.PORT || 3000)
const DATABASE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || process.env.DATABASE_DIR
  || path.join(__dirname, 'data')
const DATABASE_NAME = process.env.DATABASE_NAME || 'normando-poc.db'
const DATABASE_PATH = path.join(DATABASE_DIR, DATABASE_NAME)
const API_KEY = String(process.env.POC_API_KEY || '')

if (!API_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('Defina POC_API_KEY antes de iniciar a prova de conceito em produção.')
}

fs.mkdirSync(DATABASE_DIR, { recursive: true })

const db = new Database(DATABASE_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS railway_poc_registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    conteudo TEXT NOT NULL DEFAULT '',
    revisao INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS railway_poc_execucoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instancia TEXT NOT NULL,
    iniciado_em TEXT NOT NULL
  );
`)

const instanceId = crypto.randomUUID()
const startedAt = new Date().toISOString()
db.prepare(`
  INSERT INTO railway_poc_execucoes (instancia, iniciado_em)
  VALUES (?, ?)
`).run(instanceId, startedAt)

const app = express()
app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '5mb' }))
app.use(express.static(path.join(__dirname, 'public')))

function safeEqual(received, expected) {
  const a = Buffer.from(String(received || ''))
  const b = Buffer.from(String(expected || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next()
  const received = req.get('x-api-key') || ''
  if (!safeEqual(received, API_KEY)) {
    return res.status(401).json({ error: 'Chave de acesso inválida.' })
  }
  next()
}

function tableExists(name) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(name))
}

function countTable(name) {
  if (!tableExists(name)) return null
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM "${name}"`).get().total)
}

app.get('/health', (req, res) => {
  const check = db.prepare('SELECT 1 AS ok').get()
  res.json({
    ok: check.ok === 1,
    instanceId,
    startedAt,
    databaseFile: DATABASE_NAME,
    volumeMounted: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),
  })
})

app.use('/api', requireApiKey)

app.get('/api/info', (req, res) => {
  const stat = fs.statSync(DATABASE_PATH)
  res.json({
    databasePath: DATABASE_PATH,
    databaseSizeBytes: stat.size,
    journalMode: db.pragma('journal_mode', { simple: true }),
    registros: countTable('railway_poc_registros'),
    execucoes: countTable('railway_poc_execucoes'),
    normas: countTable('normas'),
    publicacoes: countTable('publicacoes'),
  })
})

app.get('/api/registros', (req, res) => {
  const rows = db.prepare(`
    SELECT id, titulo, conteudo, revisao, criado_em, atualizado_em
    FROM railway_poc_registros
    ORDER BY id DESC
  `).all()
  res.json(rows)
})

app.post('/api/registros', (req, res) => {
  const titulo = String(req.body?.titulo || '').trim()
  const conteudo = String(req.body?.conteudo || '')
  if (!titulo) return res.status(400).json({ error: 'Informe o título.' })

  const agora = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO railway_poc_registros
      (titulo, conteudo, revisao, criado_em, atualizado_em)
    VALUES (?, ?, 1, ?, ?)
  `).run(titulo, conteudo, agora, agora)

  res.status(201).json(
    db.prepare('SELECT * FROM railway_poc_registros WHERE id = ?').get(result.lastInsertRowid),
  )
})

app.put('/api/registros/:id', (req, res) => {
  const id = Number(req.params.id)
  const revisao = Number(req.body?.revisao)
  const titulo = String(req.body?.titulo || '').trim()
  const conteudo = String(req.body?.conteudo || '')
  if (!Number.isInteger(id) || !Number.isInteger(revisao) || !titulo) {
    return res.status(400).json({ error: 'Dados inválidos.' })
  }

  const agora = new Date().toISOString()
  const result = db.prepare(`
    UPDATE railway_poc_registros
    SET titulo = ?, conteudo = ?, revisao = revisao + 1, atualizado_em = ?
    WHERE id = ? AND revisao = ?
  `).run(titulo, conteudo, agora, id, revisao)

  if (!result.changes) {
    const atual = db.prepare('SELECT * FROM railway_poc_registros WHERE id = ?').get(id)
    if (!atual) return res.status(404).json({ error: 'Registro não encontrado.' })
    return res.status(409).json({
      error: 'O registro foi alterado por outro usuário.',
      atual,
    })
  }

  res.json(db.prepare('SELECT * FROM railway_poc_registros WHERE id = ?').get(id))
})

app.post('/api/teste-transacao', (req, res) => {
  const quantidade = Math.max(1, Math.min(500, Number(req.body?.quantidade || 10)))
  const inserir = db.prepare(`
    INSERT INTO railway_poc_registros
      (titulo, conteudo, revisao, criado_em, atualizado_em)
    VALUES (?, ?, 1, ?, ?)
  `)
  const agora = new Date().toISOString()

  const executar = db.transaction(() => {
    for (let i = 1; i <= quantidade; i++) {
      inserir.run(`Teste ${i}`, `Registro criado em transação: ${i}`, agora, agora)
    }
  })

  const inicio = Date.now()
  executar()
  res.json({ ok: true, quantidade, duracaoMs: Date.now() - inicio })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno da prova de conceito.' })
})

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Normando Railway PoC em http://0.0.0.0:${PORT}`)
  console.log(`Banco: ${DATABASE_PATH}`)
  console.log(`Volume Railway: ${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'não detectado'}`)
})

function shutdown(signal) {
  console.log(`${signal}: encerrando...`)
  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    } finally {
      process.exit(0)
    }
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

module.exports = { app, db, server }
