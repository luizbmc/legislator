import { ipcMain, dialog } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getRailwayClient } from './railway.js'

function nomeSeguro(texto, fallback = 'arquivo') {
  return String(texto || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '') || fallback
}

function assertNormaExportavel(norma) {
  if (norma?.atualizacao_pendente) {
    throw new Error(`Exportação bloqueada: a norma "${norma.epigrafe}" está com Atualização pendente.`)
  }
}

function assertPublicacaoExportavel(publicacao) {
  const pendentes = (publicacao?.secoes || [])
    .flatMap(secao => secao.normas || [])
    .filter(norma => Boolean(norma.atualizacao_pendente))
  if (pendentes.length) {
    throw new Error(
      `Exportação bloqueada: a publicação contém norma(s) com Atualização pendente: ${pendentes.map(n => n.epigrafe).join('; ')}`,
    )
  }
}

function publicacaoUsaVadeMecum(publicacao) {
  return String(publicacao?.titulo || '')
    .trimStart()
    .toLocaleLowerCase('pt-BR')
    .startsWith('vade')
}

function escXml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function xmlVazio(norma) {
  const atributos = [
    'xmlns="http://legislator.app/schema/1.0"',
    norma?.tipo ? `tipo="${escXml(norma.tipo)}"` : null,
    norma?.epigrafe ? `epigrafe="${escXml(norma.epigrafe)}"` : null,
  ].filter(Boolean).join(' ')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Norma ${atributos}>`,
    '</Norma>',
  ].join('\n')
}

function dbVirtual(publicacao) {
  const normas = new Map(
    (publicacao.secoes || [])
      .flatMap(secao => secao.normas || [])
      .map(norma => [Number(norma.norma_id || norma.id), norma]),
  )
  return {
    prepare() {
      return {
        get(id) {
          return normas.get(Number(id))
        },
      }
    },
  }
}

async function buscarNorma(id) {
  return getRailwayClient().requisitar('GET', `/api/normas/${id}`)
}

async function buscarPublicacao(id) {
  return getRailwayClient().requisitar('GET', `/api/publicacoes/${id}?incluirConteudo=true`)
}

async function salvarArquivo({ titulo, defaultPath, filters, conteudo, encoding }) {
  const resultado = await dialog.showSaveDialog({ title: titulo, defaultPath, filters })
  if (!resultado.filePath) return { cancelado: true }
  writeFileSync(resultado.filePath, conteudo, encoding)
  return { ok: true, filePath: resultado.filePath }
}

async function escolherPasta(titulo) {
  const resultado = await dialog.showOpenDialog({
    title: titulo,
    properties: ['openDirectory', 'createDirectory'],
  })
  return resultado.canceled ? null : resultado.filePaths?.[0]
}

export function registerRailwayExportarHandlers() {
  ipcMain.handle('railway:backup:exportar', async () => {
    const buffer = await getRailwayClient().baixar('/api/banco/backup')
    return salvarArquivo({
      titulo: 'Exportar backup do banco Railway',
      defaultPath: `normando-railway-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'Banco SQLite', extensions: ['db'] }],
      conteudo: buffer,
    })
  })

  ipcMain.handle('railway:exportar:docx', async (_, id) => {
    const norma = await buscarNorma(id)
    assertNormaExportavel(norma)
    const { gerarDocx } = await import('../services/exportDocx.js')
    return salvarArquivo({
      titulo: 'Exportar DOCX do Railway',
      defaultPath: `${nomeSeguro(norma.epigrafe, 'norma')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
      conteudo: await gerarDocx(norma),
    })
  })

  ipcMain.handle('railway:exportar:html', async (_, id) => {
    const norma = await buscarNorma(id)
    assertNormaExportavel(norma)
    const { gerarHtml } = await import('../services/exportHtml.js')
    return salvarArquivo({
      titulo: 'Exportar HTML do Railway',
      defaultPath: `${nomeSeguro(norma.epigrafe, 'norma')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
      conteudo: gerarHtml(norma),
      encoding: 'utf8',
    })
  })

  ipcMain.handle('railway:exportar:docx-selecao', async (_, payload) => {
    const { gerarDocx } = await import('../services/exportDocx.js')
    return salvarArquivo({
      titulo: 'Exportar seleção — DOCX',
      defaultPath: `${nomeSeguro(payload?.nomeBase, 'selecao')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
      conteudo: await gerarDocx({
        epigrafe: payload?.epigrafe || 'Seleção',
        conteudo_doc: typeof payload?.conteudo_doc === 'string'
          ? payload.conteudo_doc
          : JSON.stringify(payload?.conteudo_doc || { type: 'doc', content: [] }),
      }),
    })
  })

  ipcMain.handle('railway:exportar:html-selecao', async (_, payload) => {
    const { gerarHtml } = await import('../services/exportHtml.js')
    return salvarArquivo({
      titulo: 'Exportar seleção — HTML',
      defaultPath: `${nomeSeguro(payload?.nomeBase, 'selecao')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
      conteudo: gerarHtml({
        epigrafe: payload?.epigrafe || 'Seleção',
        conteudo_doc: typeof payload?.conteudo_doc === 'string'
          ? payload.conteudo_doc
          : JSON.stringify(payload?.conteudo_doc || { type: 'doc', content: [] }),
      }),
      encoding: 'utf8',
    })
  })

  ipcMain.handle('railway:exportar:publicacao:docx', async (_, id) => {
    const publicacao = await buscarPublicacao(id)
    assertPublicacaoExportavel(publicacao)
    const { gerarDocxPublicacao } = await import('../services/exportDocx.js')
    return salvarArquivo({
      titulo: 'Exportar publicação Railway — DOCX',
      defaultPath: `${nomeSeguro(publicacao.titulo, 'publicacao')}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
      conteudo: await gerarDocxPublicacao(publicacao, dbVirtual(publicacao)),
    })
  })

  ipcMain.handle('railway:exportar:publicacao:html', async (_, id) => {
    const publicacao = await buscarPublicacao(id)
    assertPublicacaoExportavel(publicacao)
    const { gerarHtmlPublicacao } = await import('../services/exportHtml.js')
    return salvarArquivo({
      titulo: 'Exportar publicação Railway — HTML',
      defaultPath: `${nomeSeguro(publicacao.titulo, 'publicacao')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
      conteudo: gerarHtmlPublicacao(publicacao, dbVirtual(publicacao)),
      encoding: 'utf8',
    })
  })

  ipcMain.handle('railway:exportar:publicacao:word-pasta', async (_, id) => {
    const publicacao = await buscarPublicacao(id)
    assertPublicacaoExportavel(publicacao)
    const pastaBase = await escolherPasta('Selecionar pasta para exportar Word')
    if (!pastaBase) return { cancelado: true }
    const { gerarDocx } = await import('../services/exportDocx.js')
    const { aplicarEstiloVadeMecumDoc } = await import('../../../src/services/estiloVadeMecum.js')
    const forcarVadeMecum = publicacaoUsaVadeMecum(publicacao)
    let contador = 1
    let gerados = 0
    for (const secao of publicacao.secoes || []) {
      const pasta = join(pastaBase, nomeSeguro(secao.titulo, 'secao'))
      mkdirSync(pasta, { recursive: true })
      for (const norma of secao.normas || []) {
        const numero = String(contador++).padStart(3, '0')
        if (norma.exportacao === 'ignorar') continue
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
        writeFileSync(
          join(pasta, `${numero}_${nomeSeguro(norma.epigrafe, 'norma')}.docx`),
          await gerarDocx(normaExport),
        )
        gerados++
      }
    }
    return { ok: true, pasta: pastaBase, gerados }
  })

  ipcMain.handle('railway:exportar:publicacao:indesign', async (_, id) => {
    const publicacao = await buscarPublicacao(id)
    assertPublicacaoExportavel(publicacao)
    const pastaBase = await escolherPasta('Selecionar pasta para exportar InDesign')
    if (!pastaBase) return { cancelado: true }
    const { tiptapParaXml } = await import('../../../src/services/exportarXml.js')
    const { aplicarEstiloVadeMecumDoc } = await import('../../../src/services/estiloVadeMecum.js')
    const forcarVadeMecum = publicacaoUsaVadeMecum(publicacao)
    let contador = 1
    let gerados = 0
    for (const secao of publicacao.secoes || []) {
      const pasta = join(pastaBase, nomeSeguro(secao.titulo, 'secao'))
      mkdirSync(pasta, { recursive: true })
      for (const norma of secao.normas || []) {
        const numero = String(contador++).padStart(3, '0')
        const pular = norma.exportacao === 'ignorar'
        let xml
        if (pular) {
          xml = xmlVazio(norma)
        } else {
          let doc
          try { doc = JSON.parse(norma.conteudo_doc) }
          catch { doc = { type: 'doc', content: [] } }
          if (forcarVadeMecum) doc = aplicarEstiloVadeMecumDoc(doc, true).doc
          xml = tiptapParaXml(
            doc,
            { tipo: norma.tipo, epigrafe: norma.epigrafe },
            {
              ...(norma.exportacao === 'atualizacao' ? { modo: 'atualizacao' } : {}),
              modoVadeMecum: forcarVadeMecum,
            },
          )
        }
        writeFileSync(
          join(pasta, `${numero}_${pular ? 'PULAR_' : ''}${nomeSeguro(norma.epigrafe, 'norma')}.xml`),
          xml,
          'utf8',
        )
        gerados++
      }
    }
    return { ok: true, pasta: pastaBase, gerados }
  })
}
