const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normando-railway-poc-'))
const port = 3199
const apiKey = 'teste-local-seguro'

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
  const body = await response.json()
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

    console.log('PoC validada: autenticação, WAL, transação e conflito otimista.')
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
