const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normando-railway-poc-'))
const databasePath = path.join(tempDir, 'normando-poc.db')
const port = 3199
const apiKey = 'teste-local-seguro'

const fixture = new Database(databasePath)
fixture.exec(`
  CREATE TABLE normas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT, epigrafe TEXT, apelido TEXT, ementa TEXT,
    conteudo_doc TEXT, conteudo_txt TEXT, status TEXT,
    atualizacao_pendente INTEGER DEFAULT 0, vigencia TEXT,
    atualizado_por TEXT, criado_em TEXT, atualizado_em TEXT
  );
  CREATE TABLE normas_versoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norma_id INTEGER, versao INTEGER, doc_json TEXT, criado_em TEXT
  );
  CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT);
  CREATE TABLE norma_tags (norma_id INTEGER, tag_id INTEGER);
  CREATE TABLE publicacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT, edicao TEXT, organizador TEXT, status TEXT,
    ultima_edicao INTEGER DEFAULT 0, cor_capa TEXT,
    criado_em TEXT, atualizado_em TEXT
  );
  CREATE TABLE publicacao_secoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicacao_id INTEGER, titulo TEXT, ordem INTEGER
  );
  CREATE TABLE publicacao_normas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    secao_id INTEGER, norma_id INTEGER, ordem INTEGER, exportacao TEXT
  );

  INSERT INTO normas (
    tipo, epigrafe, apelido, ementa, conteudo_doc, conteudo_txt, status,
    vigencia, atualizado_por, criado_em, atualizado_em
  ) VALUES (
    'Lei Ordinária', 'LEI Nº 1, DE 2026', 'Lei de teste', 'Ementa de teste',
    '{"type":"doc","content":[]}', 'Conteúdo da norma para homologação.',
    'finalizado', 'Vigente', 'Teste', '2026-01-01', '2026-01-02'
  );
  INSERT INTO normas_versoes (norma_id, versao, doc_json, criado_em)
  VALUES (1, 1, '{"type":"doc","content":[]}', '2026-01-01');
  INSERT INTO tags (nome) VALUES ('vm');
  INSERT INTO norma_tags (norma_id, tag_id) VALUES (1, 1);
  INSERT INTO publicacoes (
    titulo, edicao, organizador, status, ultima_edicao, criado_em, atualizado_em
  ) VALUES (
    'Publicação de teste', '1ª edição', 'Editora', 'em andamento', 1,
    '2026-01-01', '2026-01-02'
  );
  INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem)
  VALUES (1, 'Normas principais', 0);
  INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao)
  VALUES (1, 1, 0, 'completa');
`)
fixture.close()

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_DIR: tempDir,
    POC_API_KEY: apiKey,
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  let body
  try { body = JSON.parse(raw) }
  catch { body = { raw } }
  return { response, body }
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Servidor de teste não iniciou.')
}

async function run() {
  try {
    await waitForServer()

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/info`)
    assert.equal(unauthorized.status, 401)

    const created = await request('/api/registros', {
      method: 'POST',
      body: JSON.stringify({ titulo: 'Norma de teste', conteudo: 'Versão inicial' }),
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.body.revisao, 1)

    const updated = await request(`/api/registros/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        titulo: 'Norma de teste',
        conteudo: 'Versão atualizada',
        revisao: created.body.revisao,
      }),
    })
    assert.equal(updated.response.status, 200)
    assert.equal(updated.body.revisao, 2)

    const conflict = await request(`/api/registros/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        titulo: 'Norma de teste',
        conteudo: 'Sobrescrita antiga',
        revisao: created.body.revisao,
      }),
    })
    assert.equal(conflict.response.status, 409)

    const transaction = await request('/api/teste-transacao', {
      method: 'POST',
      body: JSON.stringify({ quantidade: 25 }),
    })
    assert.equal(transaction.response.status, 200)
    assert.equal(transaction.body.quantidade, 25)

    const info = await request('/api/info')
    assert.equal(info.response.status, 200)
    assert.equal(info.body.journalMode, 'wal')
    assert.equal(info.body.registros, 26)

    const summary = await request('/api/homologacao/resumo')
    assert.equal(summary.response.status, 200)
    assert.equal(summary.body.somenteLeitura, true)
    assert.equal(summary.body.normas, 1)
    assert.equal(summary.body.publicacoes, 1)

    const normas = await request('/api/homologacao/normas?busca=Lei&page=1&limit=30')
    assert.equal(normas.response.status, 200)
    assert.equal(normas.body.total, 1)
    assert.equal(normas.body.items[0].tags[0], 'vm')
    assert.equal(normas.body.items[0].conteudo_doc, undefined)

    const norma = await request('/api/homologacao/normas/1')
    assert.equal(norma.response.status, 200)
    assert.equal(norma.body.norma.epigrafe, 'LEI Nº 1, DE 2026')
    assert.equal(norma.body.norma.total_versoes, 1)

    const publicacoes = await request('/api/homologacao/publicacoes')
    assert.equal(publicacoes.response.status, 200)
    assert.equal(publicacoes.body.items[0].total_normas, 1)

    const publicacao = await request('/api/homologacao/publicacoes/1')
    assert.equal(publicacao.response.status, 200)
    assert.equal(publicacao.body.publicacao.secoes[0].normas[0].id, 1)

    const benchmark = await request('/api/homologacao/benchmark?runs=2')
    assert.equal(benchmark.response.status, 200)
    assert.equal(benchmark.body.somenteLeitura, true)
    assert.equal(benchmark.body.samples.length, 4)

    const forbiddenWrite = await request('/api/homologacao/normas/1', {
      method: 'PUT',
      body: JSON.stringify({ epigrafe: 'Não deve salvar' }),
    })
    assert.equal(forbiddenWrite.response.status, 404)

    console.log('PoC validada: persistência, concorrência e homologação somente leitura.')
  } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
