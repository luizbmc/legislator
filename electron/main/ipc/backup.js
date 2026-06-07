import { app, dialog, ipcMain } from 'electron'
import { basename, dirname, extname, join, resolve } from 'path'
import { copyFile, readFile } from 'fs/promises'
import { getDatabasePath, flushDatabase } from '../db/database.js'

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function defaultBackupName() {
  return `legislator-backup-${timestamp()}.db`
}

async function assertSqliteFile(filePath) {
  const header = await readFile(filePath)
  const signature = header.subarray(0, 16).toString('binary')
  if (signature !== 'SQLite format 3\u0000') {
    throw new Error('O arquivo selecionado não parece ser um banco SQLite válido.')
  }
}

export function registerBackupHandlers() {
  ipcMain.handle('backup:exportar-banco', async () => {
    flushDatabase()
    const dbPath = getDatabasePath()
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exportar backup do banco',
      defaultPath: defaultBackupName(),
      filters: [
        { name: 'Banco SQLite', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    })

    if (canceled || !filePath) return { canceled: true }

    await copyFile(dbPath, filePath)
    return { canceled: false, filePath }
  })

  ipcMain.handle('backup:importar-banco', async () => {
    const dbPath = getDatabasePath()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importar backup do banco',
      properties: ['openFile'],
      filters: [
        { name: 'Banco SQLite', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    })

    if (canceled || !filePaths?.[0]) return { canceled: true }

    const origem = filePaths[0]
    if (resolve(origem) === resolve(dbPath)) {
      return {
        canceled: false,
        unchanged: true,
        filePath: dbPath,
        message: 'O arquivo selecionado já é o banco em uso.',
      }
    }

    await assertSqliteFile(origem)
    flushDatabase()

    const nome = basename(dbPath, extname(dbPath))
    const backupAnterior = join(dirname(dbPath), `${nome}.antes-importacao-${timestamp()}.db`)
    await copyFile(dbPath, backupAnterior)
    await copyFile(origem, dbPath)

    return {
      canceled: false,
      imported: true,
      filePath: dbPath,
      backupAnterior,
      needsRestart: true,
    }
  })

  ipcMain.handle('backup:reiniciar-app', async () => {
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })
}
