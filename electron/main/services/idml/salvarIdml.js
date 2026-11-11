/**
 * salvarIdml.js — diálogo "Salvar como", cópia de Links/Document fonts e gravação do .idml.
 * Usado pelas duas origens de dados (Railway e banco local).
 */

import { app, dialog } from 'electron'
import { writeFileSync, readFileSync, existsSync, cpSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { gerarIdmlPublicacao, copiarArquivosDeApoio } from './exportIdml.js'
import { atualizarEdicaoIdml } from './atualizarEdicao.js'
import { gerarLivroCompleto } from './livroCompleto.js'

/** Pasta do modelo: em produção vai em resources/ (extraResources); em dev, em build/. */
export function pastaModeloNormando() {
  return app.isPackaged
    ? join(process.resourcesPath, 'modelo-normando')
    : join(app.getAppPath(), 'build', 'modelo-normando')
}

function nomeSeguro(texto, fallback = 'publicacao') {
  return String(texto || fallback)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '') || fallback
}

/**
 * @param publicacao  publicação com secoes[].normas[] e conteudo_doc de cada norma
 * @param opcoes      { cabecalho: 'secao' | 'norma', sessao (IDML ajustado: decisões da paginação) }
 */
export async function exportarIdmlComDialogo(publicacao, opcoes = {}) {
  const sugestao = `${nomeSeguro(publicacao.titulo)}${publicacao.edicao ? '_' + nomeSeguro(publicacao.edicao, '') : ''}${opcoes.sessao ? '_ajustado' : ''}.idml`
  const r = await dialog.showSaveDialog({
    title: 'Exportar publicação — IDML',
    defaultPath: sugestao,
    filters: [{ name: 'InDesign Markup (IDML)', extensions: ['idml'] }],
  })
  if (!r.filePath) return { cancelado: true }

  // tela de paginação de uma publicação com a pasta do livro: documento completo
  const livro = opcoes.sessao?.opcoes?.livro
  if (livro) {
    const { idml, relatorio, paginacao } = await gerarLivroCompleto(livro.base, livro.publicacao, { sessao: opcoes.sessao, paginasPartes: livro.dados.partes, institucional: opcoes.institucional ?? opcoes.sessao?.opcoes?.institucional })
    writeFileSync(r.filePath, idml)
    const conferencia = r.filePath.replace(/\.idml$/i, '') + '.paginacao.json'
    writeFileSync(conferencia, JSON.stringify(paginacao))
    return { ok: true, filePath: r.filePath, conferencia, relatorio }
  }

  const pastaModelo = pastaModeloNormando()
  const pastaSaida = dirname(r.filePath)
  // Links e Document fonts ao lado do .idml: o InDesign acha as imagens e as fontes do livro
  const falhasApoio = copiarArquivosDeApoio(pastaModelo, pastaSaida)

  const { idml, relatorio } = await gerarIdmlPublicacao(publicacao, { ...opcoes, pastaModelo, pastaSaida })
  writeFileSync(r.filePath, idml)
  // IDML ajustado: página e nº de linhas previstos de cada parágrafo, para o script de conferência
  // do InDesign (scripts/indesign/conferir_paginacao_normando.jsx), ao lado do .idml
  let conferencia = null
  if (relatorio.ajustado) {
    conferencia = r.filePath.replace(/\.idml$/i, '') + '.paginacao.json'
    writeFileSync(conferencia, JSON.stringify({ primeiraPagina: relatorio.paginasPreTextuais + 1, paginas: relatorio.ajustado.paginas, paragrafos: relatorio.ajustado.esperado }))
    delete relatorio.ajustado.esperado
  }
  return { ok: true, filePath: r.filePath, conferencia, relatorio: { ...relatorio, falhasApoio } }
}

/**
 * Nova edição a partir do IDML da anterior (atualizarEdicao.js): pede o .idml anterior e onde
 * salvar o novo. Links e Document fonts da pasta anterior vão junto, se a pasta for outra.
 */
export async function exportarAtualizacaoComDialogo(publicacao, opcoes = {}) {
  const a = await dialog.showOpenDialog({
    title: 'IDML da edição anterior',
    filters: [{ name: 'InDesign Markup (IDML)', extensions: ['idml'] }],
    properties: ['openFile'],
  })
  if (a.canceled || !a.filePaths?.[0]) return { cancelado: true }
  const base = a.filePaths[0]
  const sugestao = `${nomeSeguro(publicacao.titulo)}${publicacao.edicao ? '_' + nomeSeguro(publicacao.edicao, '') : ''}.idml`
  const r = await dialog.showSaveDialog({
    title: 'Salvar a nova edição — IDML',
    defaultPath: join(dirname(base), sugestao),
    filters: [{ name: 'InDesign Markup (IDML)', extensions: ['idml'] }],
  })
  if (!r.filePath) return { cancelado: true }
  if (resolve(r.filePath) === resolve(base)) throw new Error('Escolha outro nome: o IDML da edição anterior não pode ser sobrescrito.')

  const { idml, relatorio } = await atualizarEdicaoIdml(readFileSync(base), publicacao, opcoes)
  writeFileSync(r.filePath, idml)
  // Links e Document fonts da edição anterior, se a nova vai para outra pasta
  const falhasApoio = []
  if (resolve(dirname(base)) !== resolve(dirname(r.filePath))) {
    for (const sub of ['Links', 'Document fonts']) {
      const de = join(dirname(base), sub)
      if (!existsSync(de)) continue
      try { cpSync(de, join(dirname(r.filePath), sub), { recursive: true, force: false, errorOnExist: false }) } catch (e) { falhasApoio.push(`${sub}: ${e.code || e.message}`) }
    }
  }
  return { ok: true, filePath: r.filePath, base, relatorio: { ...relatorio, falhasApoio } }
}
