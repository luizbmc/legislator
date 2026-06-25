import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database.js'

function listar() {
  return getDb().prepare(`
    SELECT id, nome, cor, ativo, criado_em, atualizado_em
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome COLLATE NOCASE
  `).all().map(item => ({ ...item, ativo: Boolean(item.ativo) }))
}

export function registerUsuariosHandlers() {
  ipcMain.handle('usuarios:listar', () => listar())
  ipcMain.handle('usuarios:criar', (_, dados = {}) => {
    const nome = String(dados.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do usuário.')
    const id = String(dados.id || '').trim() || randomUUID()
    getDb().prepare(`
      INSERT INTO usuarios (id, nome, cor, ativo)
      VALUES (?, ?, ?, 1)
    `).run(id, nome, dados.cor || '#2563eb')
    return getDb().prepare('SELECT * FROM usuarios WHERE id = ?').get(id)
  })
  ipcMain.handle('usuarios:salvar', (_, id, dados = {}) => {
    getDb().prepare(`
      UPDATE usuarios
      SET nome = ?, cor = ?, atualizado_em = datetime('now')
      WHERE id = ?
    `).run(String(dados.nome || '').trim(), dados.cor || '#2563eb', id)
    return getDb().prepare('SELECT * FROM usuarios WHERE id = ?').get(id)
  })
  ipcMain.handle('usuarios:excluir', (_, id) => {
    getDb().prepare(`
      UPDATE usuarios SET ativo = 0, atualizado_em = datetime('now') WHERE id = ?
    `).run(id)
    return { ok: true }
  })
}
