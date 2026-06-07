import { dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'

function safeTxtName(name = 'relatorio.txt') {
  const cleaned = String(name || 'relatorio.txt')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return /\.txt$/i.test(cleaned) ? cleaned : `${cleaned || 'relatorio'}.txt`
}

export function registerArquivosHandlers() {
  ipcMain.handle('arquivos:salvar-txt', async (_event, { filename, conteudo } = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Salvar relatório',
      defaultPath: safeTxtName(filename),
      filters: [{ name: 'Texto', extensions: ['txt'] }],
    })

    if (canceled || !filePath) return { canceled: true }

    await writeFile(filePath, String(conteudo || ''), 'utf8')
    return { canceled: false, filePath }
  })
}
