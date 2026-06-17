/**
 * server/db.js — sql.js (WebAssembly SQLite, sem compilação nativa)
 *
 * API compatível com better-sqlite3: prepare().get() / .all() / .run()
 * e db.transaction().
 *
 * Persistência: lê o .db do disco ao iniciar; após cada escrita
 * serializa e grava novamente (igual ao padrão do Electron).
 */

const path = require('path')
const fs   = require('fs')

const dbDir  = process.env.DB_DIR || path.join(__dirname, '..', 'server-data')
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const dbPath = path.join(dbDir, 'legislator.db')

let _sqlDb = null
let _inTx  = false

// ── Schema ────────────────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS normas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT,
  epigrafe      TEXT,
  apelido       TEXT,
  ementa        TEXT,
  dados_publicacao TEXT,
  data_ultima_alteracao TEXT,
  atualizacao_pendente INTEGER DEFAULT 0,
  vigencia      TEXT DEFAULT 'Vigente',
  link_acesso   TEXT,
  anexo         TEXT,
  observacoes   TEXT,
  caminho_rede  TEXT,
  conteudo_raw  TEXT,
  conteudo_doc  TEXT DEFAULT '{"type":"doc","content":[]}',
  conteudo_txt  TEXT DEFAULT '',
  status        TEXT DEFAULT 'rascunho',
  data_atualizacao TEXT,
  atualizado_por TEXT,
  criado_em     TEXT,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS normas_versoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  norma_id  INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  versao    INTEGER,
  doc_json  TEXT,
  diff_json TEXT,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS excecoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  norma_id  INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  tipo      TEXT,
  descricao TEXT,
  linha     INTEGER,
  node_id   TEXT,
  resolvida INTEGER DEFAULT 0,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS norma_tags (
  norma_id INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (norma_id, tag_id)
);

CREATE TABLE IF NOT EXISTS publicacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo        TEXT,
  edicao        TEXT,
  organizador   TEXT,
  lancado_em    TEXT,
  descricao     TEXT,
  caminho_rede  TEXT,
  cor_capa      TEXT,
  status        TEXT DEFAULT 'previsto',
  ultima_edicao INTEGER DEFAULT 0,
  criado_em     TEXT,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS publicacao_secoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  titulo        TEXT,
  ordem         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS publicacao_normas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  secao_id INTEGER NOT NULL REFERENCES publicacao_secoes(id) ON DELETE CASCADE,
  norma_id INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  ordem    INTEGER DEFAULT 0,
  exportacao TEXT DEFAULT 'completa'
);

CREATE TABLE IF NOT EXISTS coletaneas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS coletaneas_normas (
  coletanea_id INTEGER NOT NULL REFERENCES coletaneas(id) ON DELETE CASCADE,
  norma_id     INTEGER NOT NULL REFERENCES normas(id)     ON DELETE CASCADE,
  ordem        INTEGER,
  PRIMARY KEY (coletanea_id, norma_id)
);
`

// ── Persistência ──────────────────────────────────────────────────
function flush() {
  if (_inTx) return
  fs.writeFileSync(dbPath, Buffer.from(_sqlDb.export()))
}

// ── Wrapper de statement ──────────────────────────────────────────
function wrapStmt(sql) {
  return {
    get(...params) {
      const stmt = _sqlDb.prepare(sql)
      if (params.length) stmt.bind(params)
      const ok  = stmt.step()
      const row = ok ? stmt.getAsObject() : undefined
      stmt.free()
      return row
    },

    all(...params) {
      const stmt = _sqlDb.prepare(sql)
      if (params.length) stmt.bind(params)
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows
    },

    run(...params) {
      _sqlDb.run(sql, params.length ? params : undefined)
      const lastId  = _sqlDb.exec('SELECT last_insert_rowid()')[0]?.values?.[0]?.[0] ?? 0
      const changes = _sqlDb.getRowsModified()
      flush()
      return { lastInsertRowid: lastId, changes }
    },
  }
}

// ── API pública (compatível com better-sqlite3) ───────────────────
const db = {
  prepare: (sql) => wrapStmt(sql),

  exec(sql) {
    _sqlDb.exec(sql)
    flush()
  },

  transaction(fn) {
    return (...args) => {
      _sqlDb.run('BEGIN')
      _inTx = true
      try {
        const result = fn(...args)
        _sqlDb.run('COMMIT')
        _inTx = false
        flush()
        return result
      } catch (err) {
        _inTx = false
        try { _sqlDb.run('ROLLBACK') } catch (_) {}
        throw err
      }
    }
  },

  pragma() {},  // sem efeito — pragmas aplicados na init
}

// ── Inicialização assíncrona ──────────────────────────────────────
async function init() {
  const initSqlJs = require('sql.js')
  const sqlJsMain = require.resolve('sql.js')
  const sqlJsDir  = path.dirname(sqlJsMain)

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(sqlJsDir, file),
  })

  const fileData = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null
  _sqlDb = fileData ? new SQL.Database(fileData) : new SQL.Database()

  _sqlDb.run('PRAGMA foreign_keys = ON')
  _sqlDb.exec(SCHEMA)

  // ── Migrações incrementais ────────────────────────────────────
  const colsNormas = (_sqlDb.exec('PRAGMA table_info(normas)')[0]?.values ?? []).map(v => v[1])
  if (!colsNormas.includes('data_atualizacao')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN data_atualizacao TEXT')
    console.log('Migration: coluna data_atualizacao adicionada')
  }
  if (!colsNormas.includes('dados_publicacao')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN dados_publicacao TEXT')
    console.log('Migration: coluna dados_publicacao adicionada')
  }
  if (!colsNormas.includes('data_ultima_alteracao')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN data_ultima_alteracao TEXT')
    console.log('Migration: coluna data_ultima_alteracao adicionada')
  }
  if (!colsNormas.includes('atualizacao_pendente')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN atualizacao_pendente INTEGER DEFAULT 0')
    console.log('Migration: coluna atualizacao_pendente adicionada')
  }
  if (!colsNormas.includes('vigencia')) {
    _sqlDb.exec("ALTER TABLE normas ADD COLUMN vigencia TEXT DEFAULT 'Vigente'")
    console.log('Migration: coluna vigencia adicionada')
  }
  if (!colsNormas.includes('link_acesso')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN link_acesso TEXT')
    console.log('Migration: coluna link_acesso adicionada')
  }
  if (!colsNormas.includes('anexo')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN anexo TEXT')
    console.log('Migration: coluna anexo adicionada')
  }
  if (!colsNormas.includes('observacoes')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN observacoes TEXT')
    console.log('Migration: coluna observacoes adicionada')
  }
  if (!colsNormas.includes('caminho_rede')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN caminho_rede TEXT')
    console.log('Migration: coluna caminho_rede adicionada')
  }
  if (!colsNormas.includes('atualizado_por')) {
    _sqlDb.exec('ALTER TABLE normas ADD COLUMN atualizado_por TEXT')
    console.log('Migration: coluna atualizado_por adicionada')
  }
  _sqlDb.exec("UPDATE normas SET vigencia = 'Vigente' WHERE vigencia IS NULL OR trim(vigencia) = ''")
  _sqlDb.exec("UPDATE normas SET tipo = 'Lei Ordinária' WHERE tipo = 'Lei'")

  const colsPub = (_sqlDb.exec('PRAGMA table_info(publicacoes)')[0]?.values ?? []).map(v => v[1])
  if (!colsPub.includes('status')) {
    _sqlDb.exec("ALTER TABLE publicacoes ADD COLUMN status TEXT DEFAULT 'previsto'")
    console.log('Migration: coluna status adicionada a publicacoes')
  }
  if (!colsPub.includes('ultima_edicao')) {
    _sqlDb.exec('ALTER TABLE publicacoes ADD COLUMN ultima_edicao INTEGER DEFAULT 0')
    console.log('Migration: coluna ultima_edicao adicionada a publicacoes')
  }
  if (!colsPub.includes('cor_capa')) {
    _sqlDb.exec('ALTER TABLE publicacoes ADD COLUMN cor_capa TEXT')
    console.log('Migration: coluna cor_capa adicionada a publicacoes')
  }
  if (!colsPub.includes('caminho_rede')) {
    _sqlDb.exec('ALTER TABLE publicacoes ADD COLUMN caminho_rede TEXT')
    console.log('Migration: coluna caminho_rede adicionada a publicacoes')
  }

  const colsPubNormas = (_sqlDb.exec('PRAGMA table_info(publicacao_normas)')[0]?.values ?? []).map(v => v[1])
  if (!colsPubNormas.includes('exportacao')) {
    _sqlDb.exec("ALTER TABLE publicacao_normas ADD COLUMN exportacao TEXT DEFAULT 'completa'")
    console.log('Migration: coluna exportacao adicionada a publicacao_normas')
  }

  flush()
  console.log('Banco iniciado em:', dbPath)
}

db.init    = init
db.dbPath  = dbPath

module.exports = db
