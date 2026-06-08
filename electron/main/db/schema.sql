-- ─────────────────────────────────────────────
-- Normas legislativas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS normas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT NOT NULL,
  epigrafe      TEXT NOT NULL,
  apelido       TEXT,
  ementa        TEXT,
  dados_publicacao TEXT,
  data_ultima_alteracao TEXT,
  atualizacao_pendente INTEGER NOT NULL DEFAULT 0,
  vigencia      TEXT NOT NULL DEFAULT 'Vigente',
  link_acesso   TEXT,
  anexo         TEXT,
  observacoes   TEXT,
  caminho_rede  TEXT,
  conteudo_raw  TEXT,
  conteudo_doc  TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  conteudo_txt  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'rascunho',
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- Busca full-text (FTS5)
-- ─────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS normas_fts USING fts5(
  epigrafe, apelido, ementa, conteudo_txt,
  content='normas', content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS normas_fts_insert AFTER INSERT ON normas BEGIN
  INSERT INTO normas_fts(rowid, epigrafe, apelido, ementa, conteudo_txt)
  VALUES (new.id, new.epigrafe, new.apelido, new.ementa, new.conteudo_txt);
END;

CREATE TRIGGER IF NOT EXISTS normas_fts_update AFTER UPDATE ON normas BEGIN
  INSERT INTO normas_fts(normas_fts, rowid, epigrafe, apelido, ementa, conteudo_txt)
  VALUES ('delete', old.id, old.epigrafe, old.apelido, old.ementa, old.conteudo_txt);
  INSERT INTO normas_fts(rowid, epigrafe, apelido, ementa, conteudo_txt)
  VALUES (new.id, new.epigrafe, new.apelido, new.ementa, new.conteudo_txt);
END;

CREATE TRIGGER IF NOT EXISTS normas_fts_delete AFTER DELETE ON normas BEGIN
  INSERT INTO normas_fts(normas_fts, rowid, epigrafe, apelido, ementa, conteudo_txt)
  VALUES ('delete', old.id, old.epigrafe, old.apelido, old.ementa, old.conteudo_txt);
END;

-- ─────────────────────────────────────────────
-- Versões (histórico de edições)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS normas_versoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  norma_id  INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  versao    INTEGER NOT NULL,
  doc_json  TEXT    NOT NULL,
  diff_json TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- Exceções detectadas pela pipeline
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS excecoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  norma_id  INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL,
  descricao TEXT NOT NULL,
  linha     INTEGER,
  node_id   TEXT,
  resolvida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- Tags
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS norma_tags (
  norma_id INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (norma_id, tag_id)
);

-- ─────────────────────────────────────────────
-- Publicações
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publicacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo        TEXT NOT NULL,
  edicao        TEXT,
  organizador   TEXT,
  lancado_em    TEXT,
  descricao     TEXT,
  status        TEXT NOT NULL DEFAULT 'previsto',
  cor_capa      TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publicacao_secoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  ordem         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS publicacao_normas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  secao_id INTEGER NOT NULL REFERENCES publicacao_secoes(id) ON DELETE CASCADE,
  norma_id INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  ordem    INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- Coletâneas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coletaneas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo    TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coletaneas_normas (
  coletanea_id INTEGER NOT NULL REFERENCES coletaneas(id) ON DELETE CASCADE,
  norma_id     INTEGER NOT NULL REFERENCES normas(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL,
  PRIMARY KEY (coletanea_id, norma_id)
);
