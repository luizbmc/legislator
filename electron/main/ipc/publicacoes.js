import { ipcMain, dialog } from 'electron'
import { mkdirSync, writeFileSync }  from 'fs'
import { join } from 'path'
import { getDb }          from '../db/database.js'

/** Ajustes locais de paginação da publicação (tabela publicacao_ajustes), no formato de ajustesLocais.js. */
function listarAjustes(db, id) {
  return db.prepare('SELECT * FROM publicacao_ajustes WHERE publicacao_id = ? ORDER BY id').all(id).map(r => {
    let dados = {}
    try { dados = JSON.parse(r.dados) } catch {}
    return { ...dados, id: r.id, autor: r.autor, criado_em: r.criado_em, atualizado_em: r.atualizado_em }
  })
}

const SECOES_PADRAO = ['Normas principais', 'Normas correlatas', 'Outras normas']
const EXPORTACOES_VALIDAS = new Set(['ignorar', 'atualizacao', 'completa'])

function exportacaoParaSalvar(norma) {
  if (norma?.status !== 'finalizado' || norma?.atualizacao_pendente) return 'ignorar'
  return EXPORTACOES_VALIDAS.has(norma?.exportacao) ? norma.exportacao : 'completa'
}

function exportacaoEfetiva(norma) {
  return exportacaoParaSalvar(norma)
}

function publicacaoUsaVadeMecum(pub) {
  return String(pub?.titulo || '').trimStart().toLocaleLowerCase('pt-BR').startsWith('vade')
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

function nomePastaSecao(secao, index, total) {
  const largura = Math.max(2, String(total || 0).length)
  const numero = String(index + 1).padStart(largura, '0')
  return `${numero}_${nomeArquivoSeguro(secao?.titulo, 'secao')}`
}

function removerDeclaracaoXml(xml) {
  return String(xml || '').replace(/^\s*<\?xml[^>]*>\s*/i, '').trim()
}

function xmlPublicacaoCompleta(pub, normasXml = []) {
  const atributos = [
    'xmlns="http://legislator.app/schema/1.0"',
    pub?.titulo ? `titulo="${escXml(pub.titulo)}"` : null,
    pub?.edicao ? `edicao="${escXml(pub.edicao)}"` : null,
  ].filter(Boolean).join(' ')
  const corpo = normasXml
    .map(xml => removerDeclaracaoXml(xml))
    .filter(Boolean)
    .map(xml => xml.split('\n').map(linha => `  ${linha}`).join('\n'))
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Publicacao ${atributos}>`,
    corpo,
    '</Publicacao>',
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
function idNumerico(valor) {
  const numero = Number(valor)
  return Number.isInteger(numero) && numero > 0 ? numero : null
}

function normaIdPublicacao(norma) {
  return idNumerico(norma?.norma_id ?? norma?.normaId ?? norma?.id)
}

function valoresDiferentes(a, b) {
  return String(a ?? '') !== String(b ?? '')
}

function salvarSecoes(db, publicacaoId, secoes) {
  const secoesAtuais = db.prepare(`
    SELECT id, titulo, ordem FROM publicacao_secoes WHERE publicacao_id = ?
  `).all(publicacaoId)
  const secoesPorId = new Map(secoesAtuais.map(secao => [Number(secao.id), secao]))
  const secoesMantidas = new Set()

  for (let i = 0; i < secoes.length; i++) {
    const s = secoes[i]
    let secaoId = idNumerico(s.id)
    const secaoAtual = secaoId ? secoesPorId.get(secaoId) : null

    if (secaoAtual) {
      secoesMantidas.add(secaoId)
      if (valoresDiferentes(secaoAtual.titulo, s.titulo) || Number(secaoAtual.ordem) !== i) {
        db.prepare(`
          UPDATE publicacao_secoes SET titulo = ?, ordem = ? WHERE id = ? AND publicacao_id = ?
        `).run(s.titulo, i, secaoId, publicacaoId)
      }
    } else {
      const res = db.prepare(`
        INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem) VALUES (?, ?, ?)
      `).run(publicacaoId, s.titulo, i)
      secaoId = res.lastInsertRowid
      secoesMantidas.add(secaoId)
    }

    const normas  = s.normas ?? []
    const normasAtuais = db.prepare(`
      SELECT id, norma_id, ordem, exportacao FROM publicacao_normas WHERE secao_id = ?
    `).all(secaoId)
    const normasPorPnId = new Map(normasAtuais.map(norma => [Number(norma.id), norma]))
    const normasMantidas = new Set()

    for (let j = 0; j < normas.length; j++) {
      const normaId = normaIdPublicacao(normas[j])
      if (!normaId) continue

      const exportacao = exportacaoParaSalvar(normas[j])
      const pnId = idNumerico(normas[j].pn_id)
      const normaAtual = pnId ? normasPorPnId.get(pnId) : null

      if (normaAtual) {
        normasMantidas.add(pnId)
        if (
          Number(normaAtual.norma_id) !== normaId ||
          Number(normaAtual.ordem) !== j ||
          valoresDiferentes(normaAtual.exportacao, exportacao)
        ) {
          db.prepare(`
            UPDATE publicacao_normas
            SET norma_id = ?, ordem = ?, exportacao = ?
            WHERE id = ? AND secao_id = ?
          `).run(normaId, j, exportacao, pnId, secaoId)
        }
      } else {
        const res = db.prepare(`
          INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao) VALUES (?, ?, ?, ?)
        `).run(secaoId, normaId, j, exportacao)
        normasMantidas.add(res.lastInsertRowid)
      }
    }

    for (const atual of normasAtuais) {
      if (!normasMantidas.has(Number(atual.id))) {
        db.prepare('DELETE FROM publicacao_normas WHERE id = ? AND secao_id = ?').run(atual.id, secaoId)
      }
    }
  }

  for (const atual of secoesAtuais) {
    if (!secoesMantidas.has(Number(atual.id))) {
      db.prepare('DELETE FROM publicacao_secoes WHERE id = ? AND publicacao_id = ?').run(atual.id, publicacaoId)
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
        p.titulo LIKE ? OR p.edicao LIKE ? OR p.organizador LIKE ? OR p.descricao LIKE ? OR p.caminho_rede LIKE ? OR
        EXISTS (
          SELECT 1
          FROM publicacao_secoes ps2
          JOIN publicacao_normas pn2 ON pn2.secao_id = ps2.id
          JOIN normas n2 ON n2.id = pn2.norma_id
          WHERE ps2.publicacao_id = p.id
            AND (n2.epigrafe LIKE ? OR n2.apelido LIKE ? OR n2.ementa LIKE ?)
        )
      )`
      params.push(term, term, term, term, term, term, term, term)
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
             p.caminho_rede, p.formato,
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
  ipcMain.handle('publicacoes:criar', (_, { titulo, edicao, organizador, lancado_em, descricao, caminho_rede, formato, status, cor_capa, ultima_edicao }) => {
    const db  = getDb()
    const res = db.prepare(`
      INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, caminho_rede, formato, status, cor_capa, ultima_edicao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(titulo, edicao || null, organizador || null, lancado_em || null, descricao || null, caminho_rede || null, formato || null, status || 'previsto', cor_capa || null, ultima_edicao ? 1 : 0)

    const id = res.lastInsertRowid
    const criarSecoes = db.transaction(() => {
      salvarSecoes(db, id, SECOES_PADRAO.map(t => ({ titulo: t, normas: [] })))
    })
    criarSecoes()

    return buscarCompleto(db, id)
  })

  // ── Salvar (metadata + seções) ───────────────────────────────────
  ipcMain.handle('publicacoes:salvar', (_, id, { titulo, edicao, organizador, lancado_em, descricao, caminho_rede, formato, status, cor_capa, ultima_edicao, pretextuais, secoes }) => {
    const db = getDb()

    const salvar = db.transaction(() => {
      db.prepare(`
        UPDATE publicacoes SET
          titulo        = ?,
          edicao        = ?,
          organizador   = ?,
          lancado_em    = ?,
          descricao     = ?,
          caminho_rede  = ?,
          status        = ?,
          cor_capa      = ?,
          ultima_edicao = ?,
          atualizado_em = datetime('now')
        WHERE id = ?
      `).run(titulo, edicao || null, organizador || null, lancado_em || null, descricao || null, caminho_rede || null, status || 'previsto', cor_capa || null, ultima_edicao ? 1 : 0, id)
      if (formato !== undefined) db.prepare('UPDATE publicacoes SET formato = ? WHERE id = ?').run(formato || null, id)
      if (pretextuais !== undefined) {
        db.prepare('UPDATE publicacoes SET pretextuais = ? WHERE id = ?')
          .run(pretextuais == null || pretextuais === '' ? null : (typeof pretextuais === 'string' ? pretextuais : JSON.stringify(pretextuais)), id)
      }

      if (Array.isArray(secoes)) {
        salvarSecoes(db, id, secoes)
      }
    })
    salvar()

    return buscarCompleto(db, id)
  })

  // ── Configurações compartilhadas (ex.: "institucional") ──────────
  ipcMain.handle('configuracoes:buscar', (_, chave) => {
    const linha = getDb().prepare('SELECT chave, valor, atualizado_em FROM configuracoes WHERE chave = ?').get(chave)
    let valor = null
    try { valor = linha?.valor ? JSON.parse(linha.valor) : null } catch { valor = null }
    return { chave, valor, atualizado_em: linha?.atualizado_em ?? null }
  })
  ipcMain.handle('configuracoes:salvar', (_, chave, valor) => {
    const agora = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em
    `).run(chave, valor == null ? null : JSON.stringify(valor), agora)
    return { chave, valor, atualizado_em: agora }
  })

  // ── Excluir ──────────────────────────────────────────────────────
  // ── Ajustes locais de paginação ──────────────────────────────────
  ipcMain.handle('publicacoes:ajustes:listar', (_, id) => listarAjustes(getDb(), id))
  ipcMain.handle('publicacoes:ajustes:criar', (_, id, { ajuste, autor } = {}) => {
    const db = getDb()
    const agora = new Date().toISOString()
    const { id: _id, autor: _a, criado_em, atualizado_em, ...dados } = ajuste || {}
    const r = db.prepare('INSERT INTO publicacao_ajustes (publicacao_id, dados, autor, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
      .run(id, JSON.stringify(dados), autor || null, agora, agora)
    return listarAjustes(db, id).find(a => a.id === Number(r.lastInsertRowid))
  })
  ipcMain.handle('publicacoes:ajustes:atualizar', (_, id, ajusteId, { ajuste, autor } = {}) => {
    const db = getDb()
    const { id: _id, autor: _a, criado_em, atualizado_em, ...dados } = ajuste || {}
    db.prepare('UPDATE publicacao_ajustes SET dados = ?, autor = COALESCE(?, autor), atualizado_em = ? WHERE id = ? AND publicacao_id = ?')
      .run(JSON.stringify(dados), autor || null, new Date().toISOString(), ajusteId, id)
    return listarAjustes(db, id).find(a => a.id === Number(ajusteId)) || null
  })
  ipcMain.handle('publicacoes:ajustes:excluir', (_, id, ajusteId) => {
    getDb().prepare('DELETE FROM publicacao_ajustes WHERE id = ? AND publicacao_id = ?').run(ajusteId, id)
    return { ok: true }
  })

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
        INSERT INTO publicacoes (titulo, edicao, organizador, lancado_em, descricao, caminho_rede, formato, status, cor_capa, ultima_edicao, pretextuais)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `Cópia de ${ori.titulo}`,
        ori.edicao, ori.organizador, ori.lancado_em, ori.descricao, ori.caminho_rede || null, ori.formato || null, ori.status || 'previsto', ori.cor_capa || null, ori.ultima_edicao ? 1 : 0, ori.pretextuais ?? null
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
    const { aplicarEstiloVadeMecumDoc } = await import('../../../src/services/estiloVadeMecum.js')
    const forcarVadeMecum = publicacaoUsaVadeMecum(pub)
    let contador = 1
    let gerados = 0

    const secoes = pub.secoes ?? []
    for (let secaoIndex = 0; secaoIndex < secoes.length; secaoIndex++) {
      const secao = secoes[secaoIndex]
      const pastaSecao = join(pastaBase, nomePastaSecao(secao, secaoIndex, secoes.length))
      mkdirSync(pastaSecao, { recursive: true })

      for (const item of secao.normas ?? []) {
        const numero = String(contador++).padStart(3, '0')
        if (exportacaoEfetiva(item) === 'ignorar') continue

        const norma = normaCompleta(db, item.norma_id)
        if (!norma) continue
        const nome = `${numero}_${nomeArquivoSeguro(norma.epigrafe, 'norma')}.docx`
        let normaExport = norma
        if (forcarVadeMecum) {
          let doc
          try { doc = JSON.parse(norma.conteudo_doc) }
          catch { doc = { type: 'doc', content: [] } }
          normaExport = {
            ...norma,
            conteudo_doc: JSON.stringify(aplicarEstiloVadeMecumDoc(doc, true).doc),
            modoVadeMecum: true,
          }
        }
        const buffer = await gerarDocx(normaExport)
        writeFileSync(join(pastaSecao, nome), buffer)
        gerados++
      }
    }

    return { ok: true, pasta: pastaBase, gerados }
  })

  // exceções de hifenização do usuário (Configurações → Hifenização), antes de cada geração
  async function carregarExcecoes(origem = 'local') {
    const { definirExcecoes } = await import('../services/pdf/hifenizacaoExcecoes.js')
    try {
      if (origem === 'railway') {
        const { getRailwayClient } = await import('./railway.js')
        definirExcecoes((await getRailwayClient().requisitar('GET', '/api/configuracoes/hifenizacao'))?.valor || {})
      } else {
        definirExcecoes(JSON.parse(getDb().prepare("SELECT valor FROM configuracoes WHERE chave = 'hifenizacao'").get()?.valor || '{}'))
      }
    } catch { definirExcecoes({}) }
  }

  /** Publicação no mesmo formato da API Railway (norma completa em cada item) + cadastro institucional. */
  function publicacaoParaLivro(id) {
    const db = getDb()
    const pub = buscarCompleto(db, id)
    if (!pub) throw new Error('Publicacao nao encontrada')
    assertPublicacaoExportavel(pub)
    const publicacao = {
      ...pub,
      secoes: (pub.secoes ?? []).map(secao => ({
        ...secao,
        normas: (secao.normas ?? []).map(item => {
          const norma = normaCompleta(db, item.norma_id)
          return norma ? { ...norma, ...item, conteudo_doc: norma.conteudo_doc, exportacao: exportacaoEfetiva(item) } : { ...item, exportacao: 'ignorar' }
        }),
      })),
    }
    let institucional = {}
    try { institucional = JSON.parse(db.prepare("SELECT valor FROM configuracoes WHERE chave = 'institucional'").get()?.valor || '{}') } catch { institucional = {} }
    return { publicacao, institucional }
  }

  ipcMain.handle('exportar:publicacao:idml', async (_, id, opcoes = {}) => {
    await carregarExcecoes('local')
    const { publicacao, institucional } = publicacaoParaLivro(id)
    const { exportarIdmlComDialogo } = await import('../services/idml/salvarIdml.js')
    return exportarIdmlComDialogo(publicacao, { institucional, ...opcoes })
  })

  ipcMain.handle('exportar:publicacao:idml-atualizar', async (_, id, opcoes = {}) => {
    const { publicacao } = publicacaoParaLivro(id)
    const { exportarAtualizacaoComDialogo } = await import('../services/idml/salvarIdml.js')
    return exportarAtualizacaoComDialogo(publicacao, opcoes)
  })

  // ── Tela de paginação (sessaoPaginacao.js) ───────────────────────
  // chave da sessão: "local:<id>" ou "railway:<id>" (a origem dos dados)
  ipcMain.handle('paginacao:aplicar', async (_, chave, itens) => {
    const { sessaoAberta } = await import('../services/pdf/sessaoPaginacao.js')
    const s = sessaoAberta(chave)
    if (!s) throw new Error('A paginação desta publicação não está aberta.')
    return s.aplicar(itens || [])
  })
  ipcMain.handle('paginacao:alternativas', async (_, chave, i) => {
    const { sessaoAberta } = await import('../services/pdf/sessaoPaginacao.js')
    return sessaoAberta(chave)?.alternativas(i) || []
  })
  // PDF exatamente com a paginação da tela (sem as rodadas de verificação; ~15 s)
  // Mesa, rosto e folha técnica podem ter mudado depois de abrir a tela: a exportação usa os atuais
  async function atualizarPretextuais(s, chave) {
    try {
      const [origem, id] = String(chave).split(':')
      let campos, institucional
      if (origem === 'local') {
        const db = getDb()
        campos = db.prepare('SELECT descricao, edicao, lancado_em, pretextuais FROM publicacoes WHERE id = ?').get(id)
        institucional = JSON.parse(db.prepare("SELECT valor FROM configuracoes WHERE chave = 'institucional'").get()?.valor || '{}')
      } else {
        const { getRailwayClient } = await import('./railway.js')
        const c = getRailwayClient()
        const pub = await c.requisitar('GET', `/api/publicacoes/${id}`)
        campos = { descricao: pub?.descricao, edicao: pub?.edicao, lancado_em: pub?.lancado_em, pretextuais: pub?.pretextuais }
        institucional = await c.requisitar('GET', '/api/configuracoes/institucional').then(r => r?.valor || {}).catch(() => s.opcoes?.institucional || {})
      }
      if (campos && s.opcoes?.livro) s.opcoes.livro.publicacao = { ...s.opcoes.livro.publicacao, ...campos }
      if (s.opcoes) s.opcoes.institucional = institucional
    } catch (e) {
      console.warn('Pré-textuais: ficam os dados da abertura da tela.', e?.message || e)
    }
  }

  ipcMain.handle('paginacao:pdf', async (evento, chave, extra = {}) => {
    await carregarExcecoes(String(chave).split(':')[0])
    const { sessaoAberta } = await import('../services/pdf/sessaoPaginacao.js')
    const s = sessaoAberta(chave)
    if (!s) throw new Error('A paginação desta publicação não está aberta.')
    await atualizarPretextuais(s, chave)
    const { exportarPdfComDialogo } = await import('../services/pdf/salvarPdf.js')
    return exportarPdfComDialogo(s.publicacao, { ...s.opcoes, sessao: s, grafica: !!extra?.grafica, progresso: p => { if (!evento.sender.isDestroyed()) evento.sender.send('pdf:progresso', p) } })
  })
  ipcMain.handle('paginacao:idml', async (_, chave) => {
    await carregarExcecoes(String(chave).split(':')[0])
    const { sessaoAberta } = await import('../services/pdf/sessaoPaginacao.js')
    const s = sessaoAberta(chave)
    if (!s) throw new Error('A paginação desta publicação não está aberta.')
    await atualizarPretextuais(s, chave)
    const { exportarIdmlComDialogo } = await import('../services/idml/salvarIdml.js')
    return exportarIdmlComDialogo(s.publicacao, { institucional: s.opcoes?.institucional, sessao: s })
  })
  ipcMain.handle('publicacoes:livro:pasta', async (_, id) => {
    const { pastaDoLivro } = await import('../services/idml/livroBase.js')
    return pastaDoLivro(id)
  })
  // valores atuais das páginas pré-textuais do livro (formulários de folha técnica e Mesa)
  ipcMain.handle('publicacoes:livro:pretextuais', async (_, id) => {
    const { pretextuaisDaPasta } = await import('../services/idml/livroBase.js')
    return pretextuaisDaPasta(id)
  })
  // sem pasta do livro: as páginas como o modelo do Normando sai para a publicação (dados do formulário)
  ipcMain.handle('publicacoes:pretextuais:modelo', async (_, publicacao, institucional) => {
    const { pastaModeloNormando } = await import('../services/idml/salvarIdml.js')
    const { pretextuaisDoModelo } = await import('../services/idml/exportIdml.js')
    return pretextuaisDoModelo(publicacao || {}, institucional || {}, pastaModeloNormando())
  })
  ipcMain.handle('livros:mesa', async () => {
    const { mesaDosLivros } = await import('../services/idml/livroBase.js')
    return mesaDosLivros()
  })
  ipcMain.handle('publicacoes:livro:escolher', async (_, id, opcoes) => {
    const { escolherPastaDoLivro } = await import('../services/idml/livroBase.js')
    return escolherPastaDoLivro(id, opcoes)
  })
  ipcMain.handle('paginacao:fechar', async (_, chave) => {
    const { fecharSessao } = await import('../services/pdf/sessaoPaginacao.js')
    fecharSessao(chave)
    return { ok: true }
  })
  ipcMain.handle('paginacao:abrir', async (_, id) => {
    await carregarExcecoes('local')
    const { publicacao, institucional } = publicacaoParaLivro(id)
    const { abrirSessao } = await import('../services/pdf/sessaoPaginacao.js')
    const { pastaModeloNormando } = await import('../services/idml/salvarIdml.js')
    const { executavelTypst } = await import('../services/pdf/salvarPdf.js')
    const itens = listarAjustes(getDb(), id)
    const { opcoesDoLivro } = await import('../services/idml/livroBase.js')
    const doLivro = await opcoesDoLivro(publicacao, pastaModeloNormando())
    const s = await abrirSessao(`local:${id}`, doLivro?.publicacaoPlano ?? publicacao, { ...doLivro?.opcoes, institucional, pastaModelo: doLivro?.opcoes.pastaModelo ?? pastaModeloNormando(), typst: executavelTypst() })
    // ajustes salvos valem para o formato normal: fora dele, as páginas são outras
    return s.aplicar(doLivro?.opcoes.formato?.cabeco ? [] : itens)
  })

  ipcMain.handle('exportar:publicacao:pdf', async (evento, id, opcoes = {}) => {
    await carregarExcecoes('local')
    const { publicacao, institucional } = publicacaoParaLivro(id)
    const { exportarPdfComDialogo } = await import('../services/pdf/salvarPdf.js')
    const ajustes = { versao: 1, itens: listarAjustes(getDb(), id) }
    return exportarPdfComDialogo(publicacao, { institucional, ajustes, ...opcoes, progresso: p => { if (!evento.sender.isDestroyed()) evento.sender.send('pdf:progresso', p) } })
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
    const { aplicarEstiloVadeMecumDoc } = await import('../../../src/services/estiloVadeMecum.js')
    const forcarVadeMecum = publicacaoUsaVadeMecum(pub)
    let contador = 1
    let gerados = 0
    const xmlsCompletos = []

    const secoes = pub.secoes ?? []
    for (let secaoIndex = 0; secaoIndex < secoes.length; secaoIndex++) {
      const secao = secoes[secaoIndex]
      const pastaSecao = join(pastaBase, nomePastaSecao(secao, secaoIndex, secoes.length))
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
          if (forcarVadeMecum) doc = aplicarEstiloVadeMecumDoc(doc, true).doc
          const xmlCompleto = tiptapParaXml(
            doc,
            { tipo: norma.tipo, epigrafe: norma.epigrafe },
            { modoVadeMecum: forcarVadeMecum },
          )
          xmlsCompletos.push(xmlCompleto)
          xml = tiptapParaXml(
            doc,
            { tipo: norma.tipo, epigrafe: norma.epigrafe },
            {
              ...(exportacao === 'atualizacao' ? { modo: 'atualizacao' } : {}),
              modoVadeMecum: forcarVadeMecum,
            },
          )
        }

        writeFileSync(join(pastaSecao, nome), xml, 'utf-8')
        gerados++
      }
    }

    if (xmlsCompletos.length) {
      const nomePublicacao = `000_${nomeArquivoSeguro(pub.titulo, 'publicacao')}_completo.xml`
      writeFileSync(join(pastaBase, nomePublicacao), xmlPublicacaoCompleta(pub, xmlsCompletos), 'utf-8')
    }

    return { ok: true, pasta: pastaBase, gerados }
  })
}
