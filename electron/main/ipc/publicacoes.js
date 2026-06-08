import { ipcMain, dialog } from 'electron'
import { mkdirSync, writeFileSync }  from 'fs'
import { join } from 'path'
import { getDb }          from '../db/database.js'

const SECOES_PADRAO = ['Normas principais', 'Normas correlatas', 'Outras normas']
const EXPORTACOES_VALIDAS = new Set(['ignorar', 'atualizacao', 'completa'])

function exportacaoParaSalvar(norma) {
  if (norma?.status !== 'finalizado' || norma?.atualizacao_pendente) return 'ignorar'
  return EXPORTACOES_VALIDAS.has(norma?.exportacao) ? norma.exportacao : 'completa'
}

function exportacaoEfetiva(norma) {
  return exportacaoParaSalvar(norma)
}

function nomeArquivoSeguro(texto, fallback = 'arquivo') {
  const nome = String(texto || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  return nome || fallback
}

function escXml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function xmlVazio(norma) {
  const attrs = [
    'xmlns="http://legislator.app/schema/1.0"',
    norma?.tipo ? `tipo="${escXml(norma.tipo)}"` : null,
    norma?.epigrafe ? `epigrafe="${escXml(norma.epigrafe)}"` : null,
  ].filter(Boolean).join(' ')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Norma ${attrs}>`,
    '</Norma>',
  ].join('\n')
}

async function escolherPastaExportacao(titulo) {
  const result = await dialog.showOpenDialog({
    title: titulo,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  return result.filePaths[0]
}

function normaCompleta(db, id) {
  return db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
}

function normasComAtualizacaoPendente(pub) {
  return (pub?.secoes ?? [])
    .flatMap(secao => secao.normas ?? [])
    .filter(norma => Boolean(norma?.atualizacao_pendente))
}

function assertPublicacaoExportavel(pub) {
  const pendentes = normasComAtualizacaoPendente(pub)
  if (pendentes.length) {
    const nomes = pendentes.slice(0, 5).map(norma => norma.epigrafe || 'Norma sem epígrafe').join('\n- ')
    const sufixo = pendentes.length > 5 ? `\n... e mais ${pendentes.length - 5}` : ''
    throw new Error(`Exportação bloqueada: a publicação contém norma(s) com Atualização pendente:\n- ${nomes}${sufixo}`)
  }
}

// ── Helper: lê publicação completa (com seções e normas) ──────────
function buscarCompleto(db, id) {
  const pub = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id)
  if (!pub) return null

  const secoes = db.prepare(`
    SELECT * FROM publicacao_secoes WHERE publicacao_id = ? ORDER BY ordem
  `).all(id)

  for (const s of secoes) {
    s.normas = db.prepare(`
      SELECT pn.id AS pn_id, pn.norma_id, pn.ordem, pn.exportacao,
             n.tipo, n.epigrafe, n.apelido, n.status, n.atualizacao_pendente
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem
    `).all(s.id)
  }

  pub.secoes = secoes
  return pub
}

// ── Helper: salva seções + normas dentro de uma transação ─────────
function salvarSecoes(db, publicacaoId, secoes) {
  db.prepare('DELETE FROM publicacao_secoes WHERE publicacao_id = ?').run(publicacaoId)

  for (let i = 0; i < secoes.length; i++) {
    const s = secoes[i]
    const res = db.prepare(`
      INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem) VALUES (?, ?, ?)
    `).run(publicacaoId, s.titulo, i)

    const secaoId = res.lastInsertRowid
    const normas  = s.normas ?? []
    for (let j = 0; j < normas.length; j++) {
      const exportacao = exportacaoParaSalvar(normas[j])
      db.prepare(`
        INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao) VALUES (?, ?, ?, ?)
      `).run(secaoId, normas[j].norma_id, j, exportacao)
    }
  }
}

export function registerPublicacoesHandlers() {

  // ── Listar ───────────────────────────────────────────────────────
  ipcMain.handle('publicacoes:listar', (_, filtros = {}) => {
    const db = getDb()
    const { busca, status, ultimaEdicao } = filtros
    const params = []
    let where = 'WHERE 1=1'

    if (busca && busca.trim()) {
      const term = '%' + busca.trim() + '%'
      where += ` AND (
        p.titulo LIKE ? OR p.edicao LIKE ? OR p.organizador LIKE ? OR p.descricao LIKE ? OR
        EXISTS (
          SELECT 1
          FROM publicacao_secoes ps2
          JOIN publicacao_normas pn2 ON pn2.secao_id = ps2.id
          JOIN normas n2 ON n2.id = pn2.norma_id
          WHERE ps2.publicacao_id = p.id
            AND (n2.epigrafe LIKE ? OR n2.apelido LIKE ? OR n2.ementa LIKE ?)
        )
      )`
      params.push(term, term, term, term, term, term, term)
    }
    if (status) {
      where += ' AND p.status = ?'
      params.push(status)
    }
    if (ultimaEdicao) {
      where += ' AND COALESCE(p.ultima_edicao, 0) = 1'
    }

    return db.prepare(`
      SELECT p.id, p.titulo, p.edicao, p.organizador, p.lancado_em, p.status, p.cor_capa, p.ultima_edicao,
             p.criado_em, p.atualizado_em,
             COUNT(DISTINCT ps.id)  AS total_secoes,
             COUNT(DISTINCT pn.id)  AS total_normas
      FROM publicacoes p
      LEFT JOIN publicacao_secoes  ps ON ps.publicacao_id = p.id
      LEFT JOIN publicacao_normas  pn ON pn.secao_id = ps.id
      ${where}
      GROUP BY p.id
      ORDER BY p.atualizado_em DESC
    `).all(...params)
  })

  // ── Buscar (completo) ────────────────────────────────────────────
  ipcMain.handle('publicacoes:buscar', (_, id) => {
    return buscarCompleto(getDb(), id)
  })

  // ── Criar ────────────────────────────────────────────────────────
  ipcMain.handle('publicacoes:criar', (_, { titulo, edicao, organizador, lancado_em, descricao, status, cor_capa, ultima_edicao }) => {
    const db  = getDb()
    const res = db.prepare(`
      INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, status, cor_capa, ultima_edicao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(titulo, edicao || null, organizador || null, lancado_em || null, descricao || null, status || 'previsto', cor_capa || null, ultima_edicao ? 1 : 0)

    const id = res.lastInsertRowid
    const criarSecoes = db.transaction(() => {
      salvarSecoes(db, id, SECOES_PADRAO.map(t => ({ titulo: t, normas: [] })))
    })
    criarSecoes()

    return buscarCompleto(db, id)
  })

  // ── Salvar (metadata + seções) ───────────────────────────────────
  ipcMain.handle('publicacoes:salvar', (_, id, { titulo, edicao, organizador, lancado_em, descricao, status, cor_capa, ultima_edicao, secoes }) => {
    const db = getDb()

    const salvar = db.transaction(() => {
      db.prepare(`
        UPDATE publicacoes SET
          titulo        = ?,
          edicao        = ?,
          organizador   = ?,
          lancado_em    = ?,
          descricao     = ?,
          status        = ?,
          cor_capa      = ?,
          ultima_edicao = ?,
          atualizado_em = datetime('now')
        WHERE id = ?
      `).run(titulo, edicao || null, organizador || null, lancado_em || null, descricao || null, status || 'previsto', cor_capa || null, ultima_edicao ? 1 : 0, id)

      salvarSecoes(db, id, secoes ?? [])
    })
    salvar()

    return buscarCompleto(db, id)
  })

  // ── Excluir ──────────────────────────────────────────────────────
  ipcMain.handle('publicacoes:excluir', (_, id) => {
    getDb().prepare('DELETE FROM publicacoes WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── Duplicar ─────────────────────────────────────────────────────
  ipcMain.handle('publicacoes:duplicar', (_, id) => {
    const db  = getDb()
    const ori = buscarCompleto(db, id)
    if (!ori) throw new Error('Publicação não encontrada')

    const duplicar = db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, status, cor_capa, ultima_edicao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `Cópia de ${ori.titulo}`,
        ori.edicao, ori.organizador, ori.lancado_em, ori.descricao, ori.status || 'previsto', ori.cor_capa || null, ori.ultima_edicao ? 1 : 0
      )
      salvarSecoes(db, res.lastInsertRowid, ori.secoes)
      return res.lastInsertRowid
    })

    const novoId = duplicar()
    return buscarCompleto(db, novoId)
  })

  // ── Exportar DOCX ────────────────────────────────────────────────
  ipcMain.handle('exportar:publicacao:docx', async (_, id) => {
    const db  = getDb()
    const pub = buscarCompleto(db, id)
    if (!pub) throw new Error('Publicação não encontrada')
    assertPublicacaoExportavel(pub)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar publicação — DOCX',
      defaultPath: `${pub.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    })
    if (!filePath) return { cancelado: true }

    const { gerarDocxPublicacao } = await import('../services/exportDocx.js')
    const buffer = await gerarDocxPublicacao(pub, db)
    writeFileSync(filePath, buffer)
    return { ok: true, filePath }
  })

  // ── Exportar HTML ────────────────────────────────────────────────
  ipcMain.handle('exportar:publicacao:html', async (_, id) => {
    const db  = getDb()
    const pub = buscarCompleto(db, id)
    if (!pub) throw new Error('Publicação não encontrada')
    assertPublicacaoExportavel(pub)

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar publicação — HTML',
      defaultPath: `${pub.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!filePath) return { cancelado: true }

    const { gerarHtmlPublicacao } = await import('../services/exportHtml.js')
    const html = gerarHtmlPublicacao(pub, db)
    writeFileSync(filePath, html, 'utf-8')
    return { ok: true, filePath }
  })

  ipcMain.handle('exportar:publicacao:word-pasta', async (_, id) => {
    const db = getDb()
    const pub = buscarCompleto(db, id)
    if (!pub) throw new Error('Publicacao nao encontrada')
    assertPublicacaoExportavel(pub)

    const pastaBase = await escolherPastaExportacao('Selecionar pasta para exportar Word')
    if (!pastaBase) return { cancelado: true }

    const { gerarDocx } = await import('../services/exportDocx.js')
    let contador = 1
    let gerados = 0

    for (const secao of pub.secoes ?? []) {
      const pastaSecao = join(pastaBase, nomeArquivoSeguro(secao.titulo, 'secao'))
      mkdirSync(pastaSecao, { recursive: true })

      for (const item of secao.normas ?? []) {
        const numero = String(contador++).padStart(3, '0')
        if (exportacaoEfetiva(item) === 'ignorar') continue

        const norma = normaCompleta(db, item.norma_id)
        if (!norma) continue
        const nome = `${numero}_${nomeArquivoSeguro(norma.epigrafe, 'norma')}.docx`
        const buffer = await gerarDocx(norma)
        writeFileSync(join(pastaSecao, nome), buffer)
        gerados++
      }
    }

    return { ok: true, pasta: pastaBase, gerados }
  })

  ipcMain.handle('exportar:publicacao:indesign', async (_, id) => {
    const db = getDb()
    const pub = buscarCompleto(db, id)
    if (!pub) throw new Error('Publicacao nao encontrada')
    assertPublicacaoExportavel(pub)

    const itens = (pub.secoes ?? []).flatMap(secao => secao.normas ?? [])
    if (!itens.some(item => exportacaoEfetiva(item) !== 'ignorar')) {
      return { ok: false, semExportacao: true }
    }

    const pastaBase = await escolherPastaExportacao('Selecionar pasta para exportar InDesign')
    if (!pastaBase) return { cancelado: true }

    const { tiptapParaXml } = await import('../../../src/services/exportarXml.js')
    let contador = 1
    let gerados = 0

    for (const secao of pub.secoes ?? []) {
      const pastaSecao = join(pastaBase, nomeArquivoSeguro(secao.titulo, 'secao'))
      mkdirSync(pastaSecao, { recursive: true })

      for (const item of secao.normas ?? []) {
        const numero = String(contador++).padStart(3, '0')
        const norma = normaCompleta(db, item.norma_id)
        if (!norma) continue

        const exportacao = exportacaoEfetiva(item)
        const pular = exportacao === 'ignorar'
        const nome = `${numero}_${pular ? 'PULAR_' : ''}${nomeArquivoSeguro(norma.epigrafe, 'norma')}.xml`
        let xml = ''

        if (pular) {
          xml = xmlVazio(norma)
        } else {
          let doc
          try { doc = JSON.parse(norma.conteudo_doc) }
          catch { doc = { type: 'doc', content: [] } }
          xml = tiptapParaXml(
            doc,
            { tipo: norma.tipo, epigrafe: norma.epigrafe },
            exportacao === 'atualizacao' ? { modo: 'atualizacao' } : {},
          )
        }

        writeFileSync(join(pastaSecao, nome), xml, 'utf-8')
        gerados++
      }
    }

    return { ok: true, pasta: pastaBase, gerados }
  })
}
