import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { getDb } from '../db/database.js'

function safeFileName(text, fallback) {
  const name = String(text || fallback || 'norma').replace(/[/\\?%*:|"<>]/g, '-')
  return name || fallback || 'norma'
}

function selectionNormaPayload(payload = {}) {
  return {
    epigrafe: payload.epigrafe || 'seleção',
    conteudo_doc: typeof payload.conteudo_doc === 'string'
      ? payload.conteudo_doc
      : JSON.stringify(payload.conteudo_doc || { type: 'doc', content: [] }),
  }
}

function assertNormaExportavel(norma) {
  if (norma?.atualizacao_pendente) {
    throw new Error(`Exportação bloqueada: a norma "${norma.epigrafe || 'sem epígrafe'}" está com Atualização pendente.`)
  }
}

function assertPayloadExportavel(db, payload = {}) {
  const normaId = payload.norma_id || payload.id
  if (!normaId) return
  const norma = db.prepare('SELECT id, epigrafe, atualizacao_pendente FROM normas WHERE id = ?').get(normaId)
  if (norma) assertNormaExportavel(norma)
}

export function registerExportarHandlers() {
  ipcMain.handle('exportar:docx', async (event, id) => {
    const db = getDb()
    const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
    if (!norma) throw new Error('Norma não encontrada')
    assertNormaExportavel(norma)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar DOCX',
      defaultPath: `${safeFileName(norma.epigrafe, 'norma')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    })
    if (!filePath) return { cancelado: true }

    // Importação dinâmica do docx (evita bundling desnecessário)
    const { gerarDocx } = await import('../services/exportDocx.js')
    const buffer = await gerarDocx(norma)
    writeFileSync(filePath, buffer)
    return { ok: true, filePath }
  })

  ipcMain.handle('exportar:html', async (event, id) => {
    const db = getDb()
    const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
    if (!norma) throw new Error('Norma não encontrada')
    assertNormaExportavel(norma)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar HTML',
      defaultPath: `${safeFileName(norma.epigrafe, 'norma')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!filePath) return { cancelado: true }

    const { gerarHtml } = await import('../services/exportHtml.js')
    const html = gerarHtml(norma)
    writeFileSync(filePath, html, 'utf-8')
    return { ok: true, filePath }
  })

  ipcMain.handle('exportar:docx-selecao', async (event, payload) => {
    assertPayloadExportavel(getDb(), payload)
    const norma = selectionNormaPayload(payload)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar seleção — DOCX',
      defaultPath: `${safeFileName(payload?.nomeBase, 'selecao')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    })
    if (!filePath) return { cancelado: true }

    const { gerarDocx } = await import('../services/exportDocx.js')
    const buffer = await gerarDocx(norma)
    writeFileSync(filePath, buffer)
    return { ok: true, filePath }
  })

  ipcMain.handle('exportar:html-selecao', async (event, payload) => {
    assertPayloadExportavel(getDb(), payload)
    const norma = selectionNormaPayload(payload)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar seleção — HTML',
      defaultPath: `${safeFileName(payload?.nomeBase, 'selecao')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!filePath) return { cancelado: true }

    const { gerarHtml } = await import('../services/exportHtml.js')
    const html = gerarHtml(norma)
    writeFileSync(filePath, html, 'utf-8')
    return { ok: true, filePath }
  })
}
