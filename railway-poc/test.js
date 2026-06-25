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
    dados_publicacao TEXT, data_ultima_alteracao TEXT,
    conteudo_raw TEXT, conteudo_doc TEXT, conteudo_txt TEXT, status TEXT,
    atualizacao_pendente INTEGER DEFAULT 0, vigencia TEXT,
    link_acesso TEXT, anexo TEXT, observacoes TEXT, caminho_rede TEXT,
    data_atualizacao TEXT, atualizado_por TEXT, criado_em TEXT, atualizado_em TEXT
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
    lancado_em TEXT, descricao TEXT, caminho_rede TEXT,
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

    const officialUser = await request('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify({ id: 'usuario-teste', nome: 'Usuário teste', cor: '#2563eb' }),
    })
    assert.equal(officialUser.response.status, 201)
    assert.equal(officialUser.body.id, 'usuario-teste')

    const officialUsers = await request('/api/usuarios')
    assert.equal(officialUsers.response.status, 200)
    assert.equal(officialUsers.body.length, 1)

    const officialNorm = await request('/api/normas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'Lei Ordinária',
        epigrafe: 'LEI REMOTA DE TESTE',
        conteudo_doc: '{"type":"doc","content":[]}',
        conteudo_txt: 'Texto inicial remoto.',
        status: 'rascunho',
        tags: ['vm'],
      }),
    })
    assert.equal(officialNorm.response.status, 201)
    assert.equal(officialNorm.body.revisao, 1)
    assert.deepEqual(officialNorm.body.tags, ['vm'])

    const lockA = await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'POST',
      body: JSON.stringify({
        usuarioId: 'usuario-teste',
        usuarioNome: 'Usuário teste',
        clienteId: 'computador-a',
      }),
    })
    assert.equal(lockA.response.status, 200)
    assert.equal(lockA.body.bloqueio.cliente_id, 'computador-a')

    const lockConflict = await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'POST',
      body: JSON.stringify({
        usuarioId: 'usuario-b',
        usuarioNome: 'Usuário B',
        clienteId: 'computador-b',
      }),
    })
    assert.equal(lockConflict.response.status, 423)
    assert.equal(lockConflict.body.bloqueio.usuario_nome, 'Usuário teste')

    const renewedLock = await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'PUT',
      body: JSON.stringify({
        usuarioId: 'usuario-teste',
        usuarioNome: 'Usuário teste',
        clienteId: 'computador-a',
      }),
    })
    assert.equal(renewedLock.response.status, 200)

    const releasedLock = await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'DELETE',
      body: JSON.stringify({ clienteId: 'computador-a' }),
    })
    assert.equal(releasedLock.response.status, 200)

    const lockB = await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'POST',
      body: JSON.stringify({
        usuarioId: 'usuario-b',
        usuarioNome: 'Usuário B',
        clienteId: 'computador-b',
      }),
    })
    assert.equal(lockB.response.status, 200)

    const saveWithoutLock = await request(`/api/normas/${officialNorm.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 1,
        conteudo_doc: '{"type":"doc","content":[]}',
        conteudo_txt: 'Não deve sobrescrever o bloqueio.',
      }),
    })
    assert.equal(saveWithoutLock.response.status, 423)

    await request(`/api/normas/${officialNorm.body.id}/bloqueio`, {
      method: 'DELETE',
      body: JSON.stringify({ clienteId: 'computador-b' }),
    })

    const officialNormList = await request('/api/normas')
    assert.equal(officialNormList.response.status, 200)
    assert.equal(officialNormList.body.some(item => item.id === officialNorm.body.id), true)
    assert.equal(officialNormList.body[0].conteudo_doc, undefined)

    const officialSaved = await request(`/api/normas/${officialNorm.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 1,
        conteudo_doc: '{"type":"doc","content":[]}',
        conteudo_txt: 'Texto remoto salvo.',
        status: 'finalizado',
        atualizado_por: 'Usuário teste',
      }),
    })
    assert.equal(officialSaved.response.status, 200)
    assert.equal(officialSaved.body.revisao, 2)
    assert.equal(officialSaved.body.conteudo_txt, 'Texto remoto salvo.')

    const officialConflict = await request(`/api/normas/${officialNorm.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 1,
        conteudo_doc: '{"type":"doc","content":[]}',
        conteudo_txt: 'Texto antigo.',
      }),
    })
    assert.equal(officialConflict.response.status, 409)
    assert.equal(officialConflict.body.atual.revisao, 2)

    const officialPublication = await request('/api/publicacoes', {
      method: 'POST',
      body: JSON.stringify({ titulo: 'Publicação remota', status: 'previsto' }),
    })
    assert.equal(officialPublication.response.status, 201)
    assert.equal(officialPublication.body.revisao, 1)
    assert.equal(officialPublication.body.secoes.length, 3)

    const officialPublicationLight = await request(
      `/api/publicacoes/${officialPublication.body.id}`,
    )
    assert.equal(officialPublicationLight.response.status, 200)
    assert.equal(
      officialPublicationLight.body.secoes
        .flatMap(secao => secao.normas)
        .some(item => item.conteudo_doc !== undefined),
      false,
    )

    const officialPublicationSaved = await request(
      `/api/publicacoes/${officialPublication.body.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          ...officialPublication.body,
          titulo: 'PublicaÃ§Ã£o remota atualizada',
          revisao: 1,
        }),
      },
    )
    assert.equal(officialPublicationSaved.response.status, 200)
    assert.equal(officialPublicationSaved.body.revisao, 2)

    const officialPublicationConflict = await request(
      `/api/publicacoes/${officialPublication.body.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          ...officialPublication.body,
          titulo: 'Sobrescrita antiga',
          revisao: 1,
        }),
      },
    )
    assert.equal(officialPublicationConflict.response.status, 409)

    const officialPublicationFull = await request(
      `/api/publicacoes/${officialPublication.body.id}?incluirConteudo=true`,
    )
    assert.equal(officialPublicationFull.response.status, 200)

    const cloned = await request('/api/homologacao/edicoes', {
      method: 'POST',
      body: JSON.stringify({ normaId: 1, usuario: 'Teste A' }),
    })
    assert.equal(cloned.response.status, 201)
    assert.equal(cloned.body.criada, true)
    assert.equal(cloned.body.edicao.revisao, 1)
    assert.equal(cloned.body.edicao.conteudo_txt, 'Conteúdo da norma para homologação.')

    const cloneAgain = await request('/api/homologacao/edicoes', {
      method: 'POST',
      body: JSON.stringify({ normaId: 1, usuario: 'Teste B' }),
    })
    assert.equal(cloneAgain.response.status, 200)
    assert.equal(cloneAgain.body.criada, false)
    assert.equal(cloneAgain.body.edicao.id, cloned.body.edicao.id)

    const firstSave = await request(`/api/homologacao/edicoes/${cloned.body.edicao.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 1,
        epigrafe: 'LEI Nº 1, DE 2026 - CÓPIA',
        conteudo_doc: cloned.body.edicao.conteudo_doc,
        conteudo_txt: 'Primeira alteração controlada.',
        usuario: 'Teste A',
      }),
    })
    assert.equal(firstSave.response.status, 200)
    assert.equal(firstSave.body.edicao.revisao, 2)
    assert.equal(firstSave.body.edicao.conteudo_txt, 'Primeira alteração controlada.')

    const staleSave = await request(`/api/homologacao/edicoes/${cloned.body.edicao.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 1,
        epigrafe: 'Sobrescrita antiga',
        conteudo_doc: cloned.body.edicao.conteudo_doc,
        conteudo_txt: 'Não deve ser salvo.',
        usuario: 'Teste B',
      }),
    })
    assert.equal(staleSave.response.status, 409)
    assert.equal(staleSave.body.atual.revisao, 2)

    const secondSave = await request(`/api/homologacao/edicoes/${cloned.body.edicao.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revisao: 2,
        epigrafe: 'LEI Nº 1, DE 2026 - CÓPIA',
        conteudo_doc: cloned.body.edicao.conteudo_doc,
        conteudo_txt: 'Segunda alteração controlada.',
        usuario: 'Teste B',
      }),
    })
    assert.equal(secondSave.response.status, 200)
    assert.equal(secondSave.body.edicao.revisao, 3)

    const versions = await request(
      `/api/homologacao/edicoes/${cloned.body.edicao.id}/versoes`,
    )
    assert.equal(versions.response.status, 200)
    assert.deepEqual(versions.body.items.map(item => item.revisao), [2, 1])

    const versionOne = versions.body.items.find(item => item.revisao === 1)
    const restored = await request(
      `/api/homologacao/edicoes/${cloned.body.edicao.id}/restaurar/${versionOne.id}`,
      {
        method: 'POST',
        body: JSON.stringify({ revisao: 3, usuario: 'Teste restauração' }),
      },
    )
    assert.equal(restored.response.status, 200)
    assert.equal(restored.body.edicao.revisao, 4)
    assert.equal(restored.body.edicao.epigrafe, 'LEI Nº 1, DE 2026')
    assert.equal(restored.body.edicao.conteudo_txt, 'Conteúdo da norma para homologação.')

    const staleRestore = await request(
      `/api/homologacao/edicoes/${cloned.body.edicao.id}/restaurar/${versionOne.id}`,
      {
        method: 'POST',
        body: JSON.stringify({ revisao: 3, usuario: 'Teste B' }),
      },
    )
    assert.equal(staleRestore.response.status, 409)
    assert.equal(staleRestore.body.atual.revisao, 4)

    const controlledEdits = await request('/api/homologacao/edicoes')
    assert.equal(controlledEdits.response.status, 200)
    assert.equal(controlledEdits.body.items.length, 1)
    assert.equal(controlledEdits.body.items[0].total_versoes, 3)

    const unchangedOriginal = await request('/api/homologacao/normas/1')
    assert.equal(unchangedOriginal.response.status, 200)
    assert.equal(unchangedOriginal.body.norma.epigrafe, 'LEI Nº 1, DE 2026')
    assert.equal(
      unchangedOriginal.body.norma.conteudo_txt,
      'Conteúdo da norma para homologação.',
    )

    console.log(
      'PoC validada: persistência, concorrência, leitura real e escrita isolada com histórico.',
    )
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
