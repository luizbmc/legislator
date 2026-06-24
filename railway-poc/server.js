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

  CREATE TABLE IF NOT EXISTS railway_homologacao_normas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norma_origem_id INTEGER NOT NULL UNIQUE,
    epigrafe TEXT NOT NULL,
    conteudo_doc TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
    conteudo_txt TEXT NOT NULL DEFAULT '',
    revisao INTEGER NOT NULL DEFAULT 1,
    criado_por TEXT,
    atualizado_por TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS railway_homologacao_versoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    homologacao_norma_id INTEGER NOT NULL
      REFERENCES railway_homologacao_normas(id) ON DELETE CASCADE,
    revisao INTEGER NOT NULL,
    epigrafe TEXT NOT NULL,
    conteudo_doc TEXT NOT NULL,
    conteudo_txt TEXT NOT NULL,
    salvo_por TEXT,
    criado_em TEXT NOT NULL,
    UNIQUE (homologacao_norma_id, revisao)
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
app.use(express.json({ limit: '50mb' }))
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

function requireNormandoSchema(req, res, next) {
  const required = [
    'normas',
    'publicacoes',
    'publicacao_secoes',
    'publicacao_normas',
    'tags',
    'norma_tags',
  ]
  const missing = required.filter(name => !tableExists(name))
  if (missing.length) {
    return res.status(503).json({
      error: 'A cópia carregada não contém o esquema completo do Normando.',
      missing,
    })
  }
  next()
}

function positiveInteger(value, fallback, max) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6
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

app.use('/api/homologacao', requireNormandoSchema)

app.get('/api/homologacao/resumo', (req, res) => {
  const start = process.hrtime.bigint()
  const normasPorStatus = db.prepare(`
    SELECT COALESCE(status, 'sem status') AS status, COUNT(*) AS total
    FROM normas
    GROUP BY status
    ORDER BY total DESC
  `).all()
  const normasPorTipo = db.prepare(`
    SELECT COALESCE(tipo, 'sem tipo') AS tipo, COUNT(*) AS total
    FROM normas
    GROUP BY tipo
    ORDER BY total DESC, tipo
    LIMIT 20
  `).all()

  res.json({
    somenteLeitura: true,
    normas: countTable('normas'),
    publicacoes: countTable('publicacoes'),
    secoes: countTable('publicacao_secoes'),
    vinculosPublicacao: countTable('publicacao_normas'),
    versoes: countTable('normas_versoes'),
    normasPorStatus,
    normasPorTipo,
    duracaoMs: elapsedMs(start),
  })
})

app.get('/api/homologacao/normas', (req, res) => {
  const start = process.hrtime.bigint()
  const page = positiveInteger(req.query.page, 1, 100000)
  const limit = positiveInteger(req.query.limit, 30, 100)
  const offset = (page - 1) * limit
  const busca = String(req.query.busca || '').trim()
  const tipo = String(req.query.tipo || '').trim()
  const status = String(req.query.status || '').trim()
  const buscarConteudo = req.query.buscarConteudo === 'true'
  const where = []
  const params = []

  if (busca) {
    const like = `%${busca}%`
    if (buscarConteudo) {
      where.push('(n.epigrafe LIKE ? OR n.apelido LIKE ? OR n.ementa LIKE ? OR n.conteudo_txt LIKE ?)')
      params.push(like, like, like, like)
    } else {
      where.push('(n.epigrafe LIKE ? OR n.apelido LIKE ?)')
      params.push(like, like)
    }
  }
  if (tipo) {
    where.push('n.tipo = ?')
    params.push(tipo)
  }
  if (status) {
    where.push('n.status = ?')
    params.push(status)
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM normas n
    ${clause}
  `).get(...params).total)

  const items = db.prepare(`
    SELECT
      n.id, n.tipo, n.epigrafe, n.apelido, n.ementa, n.status,
      n.atualizacao_pendente, n.vigencia, n.atualizado_por,
      n.criado_em, n.atualizado_em,
      length(COALESCE(n.conteudo_doc, '')) AS tamanho_doc,
      length(COALESCE(n.conteudo_txt, '')) AS tamanho_texto,
      (
        SELECT GROUP_CONCAT(t.nome, '|||')
        FROM norma_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.norma_id = n.id
      ) AS tags_str
    FROM normas n
    ${clause}
    ORDER BY n.atualizado_em DESC, n.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(row => {
    const { tags_str, ...norma } = row
    return {
      ...norma,
      tags: tags_str ? tags_str.split('|||') : [],
    }
  })

  res.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    items,
    duracaoMs: elapsedMs(start),
  })
})

app.get('/api/homologacao/normas/:id', (req, res) => {
  const start = process.hrtime.bigint()
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido.' })
  }

  const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
  if (!norma) return res.status(404).json({ error: 'Norma não encontrada.' })

  norma.tags = db.prepare(`
    SELECT t.nome
    FROM tags t
    JOIN norma_tags nt ON nt.tag_id = t.id
    WHERE nt.norma_id = ?
    ORDER BY t.nome COLLATE NOCASE
  `).all(id).map(row => row.nome)
  norma.total_versoes = tableExists('normas_versoes')
    ? Number(db.prepare('SELECT COUNT(*) AS total FROM normas_versoes WHERE norma_id = ?').get(id).total)
    : 0

  res.json({
    norma,
    metricas: {
      tamanhoDocBytes: Buffer.byteLength(String(norma.conteudo_doc || ''), 'utf8'),
      tamanhoTextoBytes: Buffer.byteLength(String(norma.conteudo_txt || ''), 'utf8'),
      duracaoMs: elapsedMs(start),
    },
  })
})

app.get('/api/homologacao/publicacoes', (req, res) => {
  const start = process.hrtime.bigint()
  const page = positiveInteger(req.query.page, 1, 100000)
  const limit = positiveInteger(req.query.limit, 30, 100)
  const offset = (page - 1) * limit
  const busca = String(req.query.busca || '').trim()
  const status = String(req.query.status || '').trim()
  const where = []
  const params = []

  if (busca) {
    const like = `%${busca}%`
    where.push('(p.titulo LIKE ? OR p.edicao LIKE ? OR p.organizador LIKE ?)')
    params.push(like, like, like)
  }
  if (status) {
    where.push('p.status = ?')
    params.push(status)
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM publicacoes p
    ${clause}
  `).get(...params).total)
  const items = db.prepare(`
    SELECT
      p.id, p.titulo, p.edicao, p.organizador, p.status,
      p.ultima_edicao, p.cor_capa, p.criado_em, p.atualizado_em,
      COUNT(DISTINCT ps.id) AS total_secoes,
      COUNT(DISTINCT pn.id) AS total_normas
    FROM publicacoes p
    LEFT JOIN publicacao_secoes ps ON ps.publicacao_id = p.id
    LEFT JOIN publicacao_normas pn ON pn.secao_id = ps.id
    ${clause}
    GROUP BY p.id
    ORDER BY p.atualizado_em DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  res.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    items,
    duracaoMs: elapsedMs(start),
  })
})

app.get('/api/homologacao/publicacoes/:id', (req, res) => {
  const start = process.hrtime.bigint()
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido.' })
  }

  const publicacao = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id)
  if (!publicacao) return res.status(404).json({ error: 'Publicação não encontrada.' })

  publicacao.secoes = db.prepare(`
    SELECT id, titulo, ordem
    FROM publicacao_secoes
    WHERE publicacao_id = ?
    ORDER BY ordem, id
  `).all(id).map(secao => ({
    ...secao,
    normas: db.prepare(`
      SELECT
        pn.id AS vinculo_id, pn.ordem, pn.exportacao,
        n.id, n.tipo, n.epigrafe, n.apelido, n.status,
        n.atualizacao_pendente, n.atualizado_em
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem, pn.id
    `).all(secao.id),
  }))

  res.json({
    publicacao,
    metricas: {
      totalSecoes: publicacao.secoes.length,
      totalNormas: publicacao.secoes.reduce((total, secao) => total + secao.normas.length, 0),
      duracaoMs: elapsedMs(start),
    },
  })
})

app.get('/api/homologacao/benchmark', (req, res) => {
  const runs = positiveInteger(req.query.runs, 5, 20)
  const samples = []
  const queries = [
    ['contar_normas', 'SELECT COUNT(*) AS total FROM normas'],
    ['listar_30_normas', `
      SELECT id, epigrafe, apelido, status, atualizado_em
      FROM normas
      ORDER BY atualizado_em DESC, id DESC
      LIMIT 30
    `],
    ['buscar_texto_catalogo', `
      SELECT id, epigrafe
      FROM normas
      WHERE epigrafe LIKE '%Lei%'
      LIMIT 30
    `],
    ['listar_publicacoes', `
      SELECT p.id, p.titulo, COUNT(pn.id) AS total_normas
      FROM publicacoes p
      LEFT JOIN publicacao_secoes ps ON ps.publicacao_id = p.id
      LEFT JOIN publicacao_normas pn ON pn.secao_id = ps.id
      GROUP BY p.id
      ORDER BY p.atualizado_em DESC
      LIMIT 30
    `],
  ]

  for (const [nome, sql] of queries) {
    const durations = []
    const statement = db.prepare(sql)
    for (let i = 0; i < runs; i++) {
      const start = process.hrtime.bigint()
      statement.all()
      durations.push(elapsedMs(start))
    }
    durations.sort((a, b) => a - b)
    samples.push({
      nome,
      runs,
      minimoMs: durations[0],
      medianaMs: durations[Math.floor(durations.length / 2)],
      maximoMs: durations[durations.length - 1],
    })
  }

  res.json({
    somenteLeitura: true,
    databaseSizeBytes: fs.statSync(DATABASE_PATH).size,
    samples,
  })
})

function edicaoHomologacao(id) {
  return db.prepare(`
    SELECT
      h.*,
      n.tipo,
      n.apelido,
      n.status AS status_origem,
      n.atualizado_em AS origem_atualizado_em,
      (
        SELECT COUNT(*)
        FROM railway_homologacao_versoes v
        WHERE v.homologacao_norma_id = h.id
      ) AS total_versoes
    FROM railway_homologacao_normas h
    JOIN normas n ON n.id = h.norma_origem_id
    WHERE h.id = ?
  `).get(id)
}

app.get('/api/homologacao/edicoes', (req, res) => {
  const items = db.prepare(`
    SELECT
      h.id, h.norma_origem_id, h.epigrafe, h.revisao,
      h.criado_por, h.atualizado_por, h.criado_em, h.atualizado_em,
      length(h.conteudo_doc) AS tamanho_doc,
      length(h.conteudo_txt) AS tamanho_texto,
      n.tipo,
      (
        SELECT COUNT(*)
        FROM railway_homologacao_versoes v
        WHERE v.homologacao_norma_id = h.id
      ) AS total_versoes
    FROM railway_homologacao_normas h
    JOIN normas n ON n.id = h.norma_origem_id
    ORDER BY h.atualizado_em DESC, h.id DESC
  `).all()
  res.json({ items })
})

app.post('/api/homologacao/edicoes', (req, res) => {
  const normaId = Number(req.body?.normaId)
  const usuario = String(req.body?.usuario || 'Homologação').trim().slice(0, 120)
  if (!Number.isInteger(normaId) || normaId < 1) {
    return res.status(400).json({ error: 'Informe uma norma válida.' })
  }

  const existente = db.prepare(`
    SELECT id
    FROM railway_homologacao_normas
    WHERE norma_origem_id = ?
  `).get(normaId)
  if (existente) {
    return res.json({ criada: false, edicao: edicaoHomologacao(existente.id) })
  }

  const norma = db.prepare(`
    SELECT id, epigrafe, conteudo_doc, conteudo_txt
    FROM normas
    WHERE id = ?
  `).get(normaId)
  if (!norma) return res.status(404).json({ error: 'Norma de origem não encontrada.' })

  const agora = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO railway_homologacao_normas (
      norma_origem_id, epigrafe, conteudo_doc, conteudo_txt,
      revisao, criado_por, atualizado_por, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    norma.id,
    norma.epigrafe || '',
    norma.conteudo_doc || '{"type":"doc","content":[]}',
    norma.conteudo_txt || '',
    usuario,
    usuario,
    agora,
    agora,
  )

  res.status(201).json({
    criada: true,
    edicao: edicaoHomologacao(result.lastInsertRowid),
  })
})

app.get('/api/homologacao/edicoes/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido.' })
  }
  const edicao = edicaoHomologacao(id)
  if (!edicao) return res.status(404).json({ error: 'Cópia de homologação não encontrada.' })
  res.json({ edicao })
})

app.put('/api/homologacao/edicoes/:id', (req, res) => {
  const id = Number(req.params.id)
  const revisao = Number(req.body?.revisao)
  const epigrafe = String(req.body?.epigrafe || '').trim()
  const conteudoDoc = String(req.body?.conteudo_doc || '')
  const conteudoTxt = String(req.body?.conteudo_txt || '')
  const usuario = String(req.body?.usuario || 'Homologação').trim().slice(0, 120)
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(revisao) || revisao < 1 || !epigrafe) {
    return res.status(400).json({ error: 'Dados de edição inválidos.' })
  }
  if (!conteudoDoc) {
    return res.status(400).json({ error: 'O documento estruturado não pode ficar vazio.' })
  }

  const salvar = db.transaction(() => {
    const atual = db.prepare(`
      SELECT *
      FROM railway_homologacao_normas
      WHERE id = ?
    `).get(id)
    if (!atual) return { status: 404 }
    if (Number(atual.revisao) !== revisao) return { status: 409, atual: edicaoHomologacao(id) }

    const agora = new Date().toISOString()
    db.prepare(`
      INSERT INTO railway_homologacao_versoes (
        homologacao_norma_id, revisao, epigrafe,
        conteudo_doc, conteudo_txt, salvo_por, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      atual.revisao,
      atual.epigrafe,
      atual.conteudo_doc,
      atual.conteudo_txt,
      atual.atualizado_por,
      agora,
    )

    const result = db.prepare(`
      UPDATE railway_homologacao_normas
      SET
        epigrafe = ?,
        conteudo_doc = ?,
        conteudo_txt = ?,
        revisao = revisao + 1,
        atualizado_por = ?,
        atualizado_em = ?
      WHERE id = ? AND revisao = ?
    `).run(epigrafe, conteudoDoc, conteudoTxt, usuario, agora, id, revisao)

    if (!result.changes) return { status: 409, atual: edicaoHomologacao(id) }
    return { status: 200, edicao: edicaoHomologacao(id) }
  })

  const result = salvar()
  if (result.status === 404) return res.status(404).json({ error: 'Cópia não encontrada.' })
  if (result.status === 409) {
    return res.status(409).json({
      error: 'Esta cópia foi salva por outra sessão. Recarregue antes de tentar novamente.',
      atual: result.atual,
    })
  }
  res.json(result)
})

app.get('/api/homologacao/edicoes/:id/versoes', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido.' })
  }
  const items = db.prepare(`
    SELECT
      id, homologacao_norma_id, revisao, epigrafe,
      length(conteudo_doc) AS tamanho_doc,
      length(conteudo_txt) AS tamanho_texto,
      salvo_por, criado_em
    FROM railway_homologacao_versoes
    WHERE homologacao_norma_id = ?
    ORDER BY revisao DESC
  `).all(id)
  res.json({ items })
})

app.post('/api/homologacao/edicoes/:id/restaurar/:versaoId', (req, res) => {
  const id = Number(req.params.id)
  const versaoId = Number(req.params.versaoId)
  const revisaoAtual = Number(req.body?.revisao)
  const usuario = String(req.body?.usuario || 'Homologação').trim().slice(0, 120)
  if (
    !Number.isInteger(id) || id < 1
    || !Number.isInteger(versaoId) || versaoId < 1
    || !Number.isInteger(revisaoAtual) || revisaoAtual < 1
  ) {
    return res.status(400).json({ error: 'Dados de restauração inválidos.' })
  }

  const restaurar = db.transaction(() => {
    const corrente = db.prepare('SELECT * FROM railway_homologacao_normas WHERE id = ?').get(id)
    if (!corrente) return { status: 404, tipo: 'edicao' }
    if (Number(corrente.revisao) !== revisaoAtual) {
      return { status: 409, atual: edicaoHomologacao(id) }
    }

    const versao = db.prepare(`
      SELECT *
      FROM railway_homologacao_versoes
      WHERE id = ? AND homologacao_norma_id = ?
    `).get(versaoId, id)
    if (!versao) return { status: 404, tipo: 'versao' }

    const agora = new Date().toISOString()
    db.prepare(`
      INSERT INTO railway_homologacao_versoes (
        homologacao_norma_id, revisao, epigrafe,
        conteudo_doc, conteudo_txt, salvo_por, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      corrente.revisao,
      corrente.epigrafe,
      corrente.conteudo_doc,
      corrente.conteudo_txt,
      corrente.atualizado_por,
      agora,
    )
    db.prepare(`
      UPDATE railway_homologacao_normas
      SET epigrafe = ?, conteudo_doc = ?, conteudo_txt = ?,
          revisao = revisao + 1, atualizado_por = ?, atualizado_em = ?
      WHERE id = ? AND revisao = ?
    `).run(
      versao.epigrafe,
      versao.conteudo_doc,
      versao.conteudo_txt,
      usuario,
      agora,
      id,
      revisaoAtual,
    )
    return { status: 200, edicao: edicaoHomologacao(id) }
  })

  const result = restaurar()
  if (result.status === 404) {
    const mensagem = result.tipo === 'versao'
      ? 'Versão não encontrada.'
      : 'Cópia não encontrada.'
    return res.status(404).json({ error: mensagem })
  }
  if (result.status === 409) {
    return res.status(409).json({
      error: 'Esta cópia foi salva por outra sessão. Recarregue antes de restaurar.',
      atual: result.atual,
    })
  }
  res.json(result)
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
