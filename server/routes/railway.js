const express = require('express')
const fs = require('fs')
const path = require('path')
const {
  configuracaoPublica,
  criarClienteRailway,
  normalizarConfiguracao,
} = require('../../shared/railwayRemoto.cjs')

const router = express.Router()
const configDir = process.env.DB_DIR || path.join(__dirname, '..', '..', 'server-data')
const configPath = path.join(configDir, 'railway-remoto.json')

function lerConfiguracao() {
  if (!fs.existsSync(configPath)) return { url: '', chave: '', modo: 'local' }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return { url: '', chave: '', modo: 'local' }
  }
}

function cliente() {
  const config = lerConfiguracao()
  if (!config.url || !config.chave) {
    const error = new Error('Configure a conexão Railway em Configurações.')
    error.status = 400
    throw error
  }
  return criarClienteRailway(config)
}

function rota(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req))
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message,
        ...(error.payload ? { remoto: error.payload } : {}),
      })
    }
  }
}

router.get('/configuracao', (req, res) => {
  res.json(configuracaoPublica(lerConfiguracao()))
})

router.put('/configuracao', rota(async req => {
  const atual = lerConfiguracao()
  const config = normalizarConfiguracao({
    url: req.body?.url,
    chave: String(req.body?.chave || '').trim() || atual.chave,
    modo: req.body?.modo ?? atual.modo,
  })
  if (config.modo === 'railway') {
    await criarClienteRailway(config).testar()
  }
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configuracaoPublica(config)
}))

router.get('/testar', rota(() => cliente().testar()))
router.get('/normas', rota(req => cliente().listarNormas(req.query)))
router.get('/edicoes', rota(() => cliente().listarEdicoes()))
router.post('/edicoes', rota(req => (
  cliente().criarEdicao(req.body?.normaId, req.body?.usuario)
)))
router.get('/edicoes/:id', rota(req => cliente().buscarEdicao(req.params.id)))
router.put('/edicoes/:id', rota(req => cliente().salvarEdicao(req.params.id, req.body)))
router.get('/edicoes/:id/versoes', rota(req => cliente().listarVersoes(req.params.id)))
router.post('/edicoes/:id/restaurar/:versaoId', rota(req => (
  cliente().restaurarVersao(req.params.id, req.params.versaoId, req.body)
)))

router.all('/dados/*', rota(req => {
  const caminho = `/api/${req.params[0] || ''}${req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''}`
  return cliente().requisitar(
    req.method,
    caminho,
    ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  )
}))

module.exports = router
