import { app, BrowserWindow, Menu, shell, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase } from './db/database.js'
import { registerNormasHandlers }      from './ipc/normas.js'
import { registerExportarHandlers }    from './ipc/exportar.js'
import { registerPublicacoesHandlers } from './ipc/publicacoes.js'
import { registerOrtografiaHandlers }  from './ipc/ortografia.js'
import { registerArquivosHandlers }    from './ipc/arquivos.js'
import { registerBackupHandlers }      from './ipc/backup.js'
import { registerTrabalhoRemotoHandlers } from './ipc/trabalhoRemoto.js'
import { registerRailwayHandlers } from './ipc/railway.js'
import { registerUsuariosHandlers } from './ipc/usuarios.js'
import { registerRailwayExportarHandlers } from './ipc/railwayExportar.js'
import {
  inicializarAtualizacoes,
  registerAtualizacoesHandlers,
} from './ipc/atualizacoes.js'

function configureSpellChecker(session) {
  try {
    const available = session.availableSpellCheckerLanguages || []
    const preferred = ['pt-BR', 'pt']
    const selected = preferred.find(lang => available.includes(lang))
    if (selected) session.setSpellCheckerLanguages([selected])
  } catch (err) {
    console.warn('[spellcheck] nao foi possivel configurar idioma:', err.message)
  }
}

function registerContextMenu(win) {
  win.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable && !params.misspelledWord) return

    const template = []
    const suggestions = params.dictionarySuggestions || []

    if (params.misspelledWord) {
      if (suggestions.length) {
        suggestions.slice(0, 8).forEach(suggestion => {
          template.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          })
        })
      } else {
        template.push({ label: 'Sem sugestoes', enabled: false })
      }

      template.push({ type: 'separator' })
      template.push({
        label: `Adicionar "${params.misspelledWord}" ao dicionario`,
        click: () => {
          try {
            win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          } catch (err) {
            console.warn('[spellcheck] nao foi possivel adicionar palavra:', err.message)
          }
        },
      })
      template.push({ type: 'separator' })
    }

    if (params.isEditable) {
      template.push(
        { label: 'Recortar', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Selecionar tudo', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      )
    }

    if (!template.length) return
    event.preventDefault()
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function restoreWindowFocus(win) {
  const target = win && !win.isDestroyed()
    ? win
    : BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  if (!target) return

  setTimeout(() => {
    if (target.isDestroyed()) return
    if (target.isMinimized()) target.restore()
    target.focus()
    target.webContents.focus()
    target.webContents.send('normando:restore-renderer-focus')
  }, 30)
}

function dialogOwnerFromArgs(args) {
  const first = args?.[0]
  if (first && typeof first.isDestroyed === 'function' && typeof first.webContents === 'object') return first
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
}

function installNativeDialogFocusGuard() {
  const methods = ['showOpenDialog', 'showSaveDialog', 'showMessageBox']
  methods.forEach(method => {
    const original = dialog[method]?.bind(dialog)
    if (!original || original.__normandoFocusGuard) return

    const guarded = async (...args) => {
      const owner = dialogOwnerFromArgs(args)
      try {
        return await original(...args)
      } finally {
        restoreWindowFocus(owner)
      }
    }
    guarded.__normandoFocusGuard = true
    dialog[method] = guarded
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: true,
    },
  })

  configureSpellChecker(win.webContents.session)
  registerContextMenu(win)

  win.on('ready-to-show', () => win.show())

  // Links externos abrem no browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'bottom' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  installNativeDialogFocusGuard()
  await initDatabase()
  registerNormasHandlers()
  registerExportarHandlers()
  registerPublicacoesHandlers()
  registerOrtografiaHandlers()
  registerArquivosHandlers()
  registerBackupHandlers()
  registerTrabalhoRemotoHandlers()
  registerRailwayHandlers()
  registerUsuariosHandlers()
  registerRailwayExportarHandlers()
  registerAtualizacoesHandlers()
  createWindow()
  inicializarAtualizacoes()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
