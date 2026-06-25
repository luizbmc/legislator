import { ipcMain, app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import railwayRemoto from '../../../shared/railwayRemoto.cjs'

const {
  configuracaoPublica,
  criarClienteRailway,
  normalizarConfiguracao,
} = railwayRemoto

function caminhoConfiguracao() {
  return join(app.getPath('userData'), 'railway-remoto.json')
}

function caminhoConfiguracaoPadrao() {
  return app.isPackaged
    ? join(process.resourcesPath, 'railway-default.json')
    : join(app.getAppPath(), 'build', 'railway-default.json')
}

function lerArquivoConfiguracao(arquivo) {
  if (!existsSync(arquivo)) return null
  try {
    const config = JSON.parse(readFileSync(arquivo, 'utf8'))
    if (!config.url || !config.chave) return null
    return {
      url: String(config.url).trim(),
      chave: String(config.chave).trim(),
      modo: config.modo === 'local' ? 'local' : 'railway',
    }
  } catch {
    return null
  }
}

function lerConfiguracao() {
  return lerArquivoConfiguracao(caminhoConfiguracao())
    || lerArquivoConfiguracao(caminhoConfiguracaoPadrao())
    || { url: '', chave: '', modo: 'local' }
}

async function salvarConfiguracao(dados = {}) {
  const atual = lerConfiguracao()
  const config = normalizarConfiguracao({
    url: dados.url,
    chave: String(dados.chave || '').trim() || atual.chave,
    modo: dados.modo ?? atual.modo,
  })
  if (config.modo === 'railway') {
    await criarClienteRailway(config).testar()
  }
  writeFileSync(caminhoConfiguracao(), JSON.stringify(config, null, 2), 'utf8')
  return configuracaoPublica(config)
}

export function getRailwayClient() {
  const config = lerConfiguracao()
  if (!config.url || !config.chave) {
    throw new Error('Configure a conexão Railway em Configurações.')
  }
  return criarClienteRailway(config)
}

export function railwayAtivo() {
  return lerConfiguracao().modo === 'railway'
}

function respostaSegura(fn) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        status: error.status || 500,
        payload: error.payload || null,
      }
    }
  }
}

export function registerRailwayHandlers() {
  ipcMain.handle('railway:configuracao', () => configuracaoPublica(lerConfiguracao()))
  ipcMain.handle('railway:modo', () => lerConfiguracao().modo === 'railway' ? 'railway' : 'local')
  ipcMain.handle('railway:salvar-configuracao', respostaSegura(salvarConfiguracao))
  ipcMain.handle('railway:testar', respostaSegura(() => getRailwayClient().testar()))
  ipcMain.handle('railway:listar-normas', respostaSegura(filtros => getRailwayClient().listarNormas(filtros)))
  ipcMain.handle('railway:listar-edicoes', respostaSegura(() => getRailwayClient().listarEdicoes()))
  ipcMain.handle('railway:criar-edicao', respostaSegura((normaId, usuario) => (
    getRailwayClient().criarEdicao(normaId, usuario)
  )))
  ipcMain.handle('railway:buscar-edicao', respostaSegura(id => getRailwayClient().buscarEdicao(id)))
  ipcMain.handle('railway:salvar-edicao', respostaSegura((id, dados) => (
    getRailwayClient().salvarEdicao(id, dados)
  )))
  ipcMain.handle('railway:listar-versoes', respostaSegura(id => getRailwayClient().listarVersoes(id)))
  ipcMain.handle('railway:restaurar-versao', respostaSegura((id, versaoId, dados) => (
    getRailwayClient().restaurarVersao(id, versaoId, dados)
  )))
  ipcMain.handle('railway:request', respostaSegura((method, caminho, body) => (
    getRailwayClient().requisitar(method, caminho, body)
  )))
}
