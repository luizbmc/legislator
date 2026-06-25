import { ipcMain } from 'electron'
import { getDb } from '../db/database.js'
import trabalhoRemoto from '../../../shared/trabalhoRemoto.cjs'

const {
  aplicarDevolucao,
  criarDevolucao,
  criarRetirada,
  importarRetirada,
  listarNormasNovasCandidatas,
  listarPacotes,
} = trabalhoRemoto

export function registerTrabalhoRemotoHandlers() {
  ipcMain.handle('trabalho-remoto:listar', () => listarPacotes(getDb()))
  ipcMain.handle('trabalho-remoto:criar-retirada', (_, normaIds, criadoPor, publicacaoIds) => (
    criarRetirada(getDb(), normaIds, criadoPor, publicacaoIds)
  ))
  ipcMain.handle('trabalho-remoto:importar-retirada', (_, pacote, atualizadoPor) => (
    importarRetirada(getDb(), pacote, atualizadoPor)
  ))
  ipcMain.handle('trabalho-remoto:criar-devolucao', (_, pacoteId, criadoPor, novaNormaIds) => (
    criarDevolucao(getDb(), pacoteId, criadoPor, novaNormaIds)
  ))
  ipcMain.handle('trabalho-remoto:listar-normas-novas', (_, pacoteId) => (
    listarNormasNovasCandidatas(getDb(), pacoteId)
  ))
  ipcMain.handle('trabalho-remoto:importar-devolucao', (_, pacote, atualizadoPor) => (
    aplicarDevolucao(getDb(), pacote, atualizadoPor)
  ))
}
