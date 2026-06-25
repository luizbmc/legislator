import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

let inicializado = false
let estado = {
  disponivelNoApp: app.isPackaged && process.platform === 'win32',
  status: 'ocioso',
  versaoAtual: app.getVersion(),
  novaVersao: null,
  progresso: 0,
  mensagem: '',
}

function publicar(parcial = {}) {
  estado = { ...estado, ...parcial }
  for (const janela of BrowserWindow.getAllWindows()) {
    janela.webContents.send('atualizacoes:estado', estado)
  }
  return estado
}

async function verificar() {
  if (!estado.disponivelNoApp) {
    return publicar({
      status: 'indisponivel',
      mensagem: 'As atualizações automáticas funcionam somente no aplicativo instalado.',
    })
  }

  publicar({ status: 'verificando', mensagem: '', progresso: 0 })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publicar({
      status: 'erro',
      mensagem: error?.message || 'Não foi possível verificar atualizações.',
    })
  }
  return estado
}

async function baixar() {
  if (estado.status !== 'disponivel') {
    throw new Error('Não há atualização disponível para baixar.')
  }
  publicar({ status: 'baixando', progresso: 0, mensagem: '' })
  await autoUpdater.downloadUpdate()
  return estado
}

export function registerAtualizacoesHandlers() {
  ipcMain.handle('atualizacoes:estado', () => estado)
  ipcMain.handle('atualizacoes:verificar', () => verificar())
  ipcMain.handle('atualizacoes:baixar', () => baixar())
  ipcMain.handle('atualizacoes:instalar', () => {
    if (estado.status !== 'baixada') {
      throw new Error('A atualização ainda não foi baixada.')
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { ok: true }
  })
}

export function inicializarAtualizacoes() {
  if (inicializado) return
  inicializado = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    publicar({ status: 'verificando', mensagem: '', progresso: 0 })
  })
  autoUpdater.on('update-available', info => {
    publicar({
      status: 'disponivel',
      novaVersao: info.version,
      mensagem: `A versão ${info.version} está disponível.`,
      progresso: 0,
    })
  })
  autoUpdater.on('update-not-available', () => {
    publicar({
      status: 'atualizado',
      novaVersao: null,
      mensagem: 'Você já está usando a versão mais recente.',
      progresso: 0,
    })
  })
  autoUpdater.on('download-progress', info => {
    publicar({
      status: 'baixando',
      progresso: Math.max(0, Math.min(100, Number(info.percent || 0))),
      mensagem: 'Baixando atualização...',
    })
  })
  autoUpdater.on('update-downloaded', info => {
    publicar({
      status: 'baixada',
      novaVersao: info.version,
      progresso: 100,
      mensagem: 'Atualização pronta para instalar.',
    })
  })
  autoUpdater.on('error', error => {
    publicar({
      status: 'erro',
      mensagem: error?.message || 'Falha no processo de atualização.',
    })
  })

  if (estado.disponivelNoApp) {
    setTimeout(() => verificar(), 10000)
  }
}
