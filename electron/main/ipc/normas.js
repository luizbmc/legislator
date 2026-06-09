import { ipcMain } from 'electron'
import { getDb } from '../db/database.js'

export function registerNormasHandlers() {
  // ── Listar / buscar ───────────────────────────────────────────
  ipcMain.handle('normas:listar', (_, filtros = {}) => {
    const db = getDb()
    const { busca, tipo, status, buscarConteudo } = filtros

    let sql = `
      SELECT n.id, n.tipo, n.epigrafe, n.apelido, n.ementa, n.status,
             n.dados_publicacao, n.data_ultima_alteracao, n.vigencia,
             n.atualizacao_pendente, n.link_acesso, n.anexo, n.observacoes,
             n.criado_em, n.atualizado_em,
             GROUP_CONCAT(t.nome, '|||') AS tags_str
      FROM normas n
      LEFT JOIN norma_tags nt ON nt.norma_id = n.id
      LEFT JOIN tags t ON t.id = nt.tag_id
      WHERE 1=1`
    const params = []

    if (busca && busca.trim()) {
      const term = '%' + busca.trim() + '%'
      if (buscarConteudo) {
        sql += ` AND (
          n.epigrafe LIKE ? OR n.apelido LIKE ? OR n.ementa LIKE ? OR n.conteudo_txt LIKE ? OR
          n.dados_publicacao LIKE ? OR n.vigencia LIKE ? OR n.link_acesso LIKE ? OR
          n.anexo LIKE ? OR n.observacoes LIKE ?
        )`
        params.push(term, term, term, term, term, term, term, term, term)
      } else {
        sql += ' AND (n.epigrafe LIKE ? OR n.apelido LIKE ?)'
        params.push(term, term)
      }
    }
    if (tipo)   { sql += ' AND n.tipo = ?';   params.push(tipo) }
    if (status) { sql += ' AND n.status = ?'; params.push(status) }
    sql += ' GROUP BY n.id ORDER BY n.atualizado_em DESC'

    return db.prepare(sql).all(...params).map(n => ({
      ...n,
      tags: n.tags_str ? n.tags_str.split('|||').sort() : [],
      tags_str: undefined,
    }))
  })

  ipcMain.handle('normas:buscar', (_, id) => {
    const db = getDb()
    const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
    if (!norma) return null
    norma.tags = db.prepare(`
      SELECT t.nome FROM tags t
      JOIN norma_tags nt ON nt.tag_id = t.id
      WHERE nt.norma_id = ?
      ORDER BY t.nome
    `).all(id).map(r => r.nome)
    return norma
  })

  ipcMain.handle('tags:listar', () => {
    return getDb().prepare('SELECT nome FROM tags ORDER BY nome').all().map(r => r.nome)
  })

  // ── Criar ─────────────────────────────────────────────────────
  ipcMain.handle('normas:criar', (_, dados) => {
    const db = getDb()
    const {
      tipo,
      epigrafe,
      apelido,
      ementa,
      dados_publicacao,
      data_ultima_alteracao,
      atualizacao_pendente,
      vigencia = 'Vigente',
      link_acesso,
      anexo,
      observacoes,
      tags = [],
    } = dados
    const result = db.prepare(`
      INSERT INTO normas (
        tipo, epigrafe, apelido, ementa, dados_publicacao,
        data_ultima_alteracao, atualizacao_pendente, vigencia, link_acesso, anexo, observacoes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tipo,
      epigrafe,
      apelido || null,
      ementa || null,
      dados_publicacao || null,
      data_ultima_alteracao || null,
      atualizacao_pendente ? 1 : 0,
      vigencia || 'Vigente',
      link_acesso || null,
      anexo || null,
      observacoes || null,
    )
    const id = result.lastInsertRowid

    const salvarTags = db.transaction(nomes => {
      for (const nome of nomes) {
        const nomeTrim = nome.trim()
        if (!nomeTrim) continue
        db.prepare('INSERT OR IGNORE INTO tags (nome) VALUES (?)').run(nomeTrim)
        const tag = db.prepare('SELECT id FROM tags WHERE nome = ? COLLATE NOCASE').get(nomeTrim)
        db.prepare('INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)').run(id, tag.id)
      }
    })
    salvarTags(tags)

    return db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
  })

  // ── Salvar (cria versão automática) ───────────────────────────
  ipcMain.handle('normas:salvar', (_, id, { conteudo_doc, conteudo_txt, status, data_atualizacao }) => {
    const db = getDb()

    // Guarda versão anterior antes de sobrescrever
    const atual = db.prepare(`
      SELECT conteudo_doc FROM normas WHERE id = ?
    `).get(id)

    db.transaction(() => {
      if (atual?.conteudo_doc && atual.conteudo_doc !== '{"type":"doc","content":[]}') {
        const { versao } = db.prepare(`
          SELECT COALESCE(MAX(versao), 0) AS versao FROM normas_versoes WHERE norma_id = ?
        `).get(id)
        db.prepare(`
          INSERT INTO normas_versoes (norma_id, versao, doc_json)
          VALUES (?, ?, ?)
        `).run(id, versao + 1, atual.conteudo_doc)
      }

      db.prepare(`
        UPDATE normas SET
          conteudo_doc      = ?,
          conteudo_txt      = ?,
          status            = COALESCE(?, status),
          data_atualizacao  = COALESCE(?, data_atualizacao),
          atualizado_em     = datetime('now')
        WHERE id = ?
      `).run(conteudo_doc, conteudo_txt ?? '', status ?? null, data_atualizacao ?? null, id)
    })()

    return db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
  })

  // ── Atualizar metadados (tipo, epígrafe, apelido, ementa, tags) ─
  ipcMain.handle('normas:atualizar-meta', (_, id, {
    tipo,
    epigrafe,
    apelido,
    ementa,
    dados_publicacao,
    data_ultima_alteracao,
    atualizacao_pendente,
    vigencia = 'Vigente',
    link_acesso,
    anexo,
    observacoes,
    tags = [],
  }) => {
    const db = getDb()

    db.prepare(`
      UPDATE normas SET
        tipo          = ?,
        epigrafe      = ?,
        apelido       = ?,
        ementa        = ?,
        dados_publicacao = ?,
        data_ultima_alteracao = ?,
        atualizacao_pendente = ?,
        vigencia      = ?,
        link_acesso   = ?,
        anexo         = ?,
        observacoes   = ?,
        atualizado_em = datetime('now')
      WHERE id = ?
    `).run(
      tipo,
      epigrafe,
      apelido || null,
      ementa || null,
      dados_publicacao || null,
      data_ultima_alteracao || null,
      atualizacao_pendente ? 1 : 0,
      vigencia || 'Vigente',
      link_acesso || null,
      anexo || null,
      observacoes || null,
      id,
    )

    // Garante que cada tag existe; obtém seu id
    const salvarTags = db.transaction(nomes => {
      db.prepare('DELETE FROM norma_tags WHERE norma_id = ?').run(id)
      for (const nome of nomes) {
        const nomeTrim = nome.trim()
        if (!nomeTrim) continue
        db.prepare('INSERT OR IGNORE INTO tags (nome) VALUES (?)').run(nomeTrim)
        const tag = db.prepare('SELECT id FROM tags WHERE nome = ? COLLATE NOCASE').get(nomeTrim)
        db.prepare('INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)').run(id, tag.id)
      }
    })
    salvarTags(tags)

    const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
    norma.tags  = db.prepare(`
      SELECT t.nome FROM tags t
      JOIN norma_tags nt ON nt.tag_id = t.id
      WHERE nt.norma_id = ?
      ORDER BY t.nome
    `).all(id).map(r => r.nome)
    return norma
  })

  // ── Excluir ───────────────────────────────────────────────────
  ipcMain.handle('normas:excluir', (_, id) => {
    getDb().prepare('DELETE FROM normas WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── Versões ───────────────────────────────────────────────────
  ipcMain.handle('normas:versoes', (_, id) => {
    return getDb().prepare(`
      SELECT id, norma_id, versao, criado_em
      FROM normas_versoes WHERE norma_id = ?
      ORDER BY versao DESC
    `).all(id)
  })

  ipcMain.handle('normas:restaurar', (_, normaId, versaoId) => {
    const db = getDb()
    const versao = db.prepare('SELECT doc_json FROM normas_versoes WHERE id = ?').get(versaoId)
    if (!versao) throw new Error('Versão não encontrada')
    db.prepare(`
      UPDATE normas SET conteudo_doc = ?, atualizado_em = datetime('now') WHERE id = ?
    `).run(versao.doc_json, normaId)
    return db.prepare('SELECT * FROM normas WHERE id = ?').get(normaId)
  })

  // ── Exceções ──────────────────────────────────────────────────
  ipcMain.handle('excecoes:salvar', (_, normaId, excecoes) => {
    const db = getDb()
    // Usa transação para gravar no disco apenas uma vez ao final
    db.transaction((lista) => {
      db.prepare('DELETE FROM excecoes WHERE norma_id = ?').run(normaId)
      for (const e of lista) {
        db.prepare(`
          INSERT INTO excecoes (norma_id, tipo, descricao, linha, node_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(normaId, e.tipo, e.descricao, e.linha ?? null, e.nodeId ?? null)
      }
    })(excecoes)
    return { ok: true }
  })

  ipcMain.handle('excecoes:resolver', (_, id) => {
    getDb().prepare('UPDATE excecoes SET resolvida = 1 WHERE id = ?').run(id)
    return { ok: true }
  })
}
