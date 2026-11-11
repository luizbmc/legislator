/**
 * salvarPdf.js — diálogo "Salvar como" e geração do PDF de revisão.
 * Usado pelas duas origens de dados (Railway e banco local).
 */

import { app, dialog, shell } from 'electron'
import { writeFileSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { gerarPdfPublicacao } from './exportPdf.js'
import { pastaModeloNormando } from '../idml/salvarIdml.js'

/** typst.exe: em produção vai em resources/typst (extraResources); em dev, em build/typst. */
export function executavelTypst() {
  const exe = app.isPackaged
    ? join(process.resourcesPath, 'typst', 'typst.exe')
    : join(app.getAppPath(), 'build', 'typst', 'typst.exe')
  if (!existsSync(exe)) throw new Error(`Compositor do PDF não encontrado em ${exe}.`)
  return exe
}

function nomeSeguro(texto, fallback = 'publicacao') {
  return String(texto || fallback)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '') || fallback
}

/**
 * @param publicacao  publicação com secoes[].normas[] e conteudo_doc de cada norma
 * @param opcoes      { institucional, cabecalho }
 */
export async function exportarPdfComDialogo(publicacao, opcoes = {}) {
  // PDF para a gráfica (pdfGrafica.js): sangria, marcas de corte e sem os comentários da conferência
  const grafica = !!opcoes.grafica
  const sugestao = `${nomeSeguro(publicacao.titulo)}${publicacao.edicao ? '_' + nomeSeguro(publicacao.edicao, '') : ''}_${grafica ? 'grafica' : 'revisao'}.pdf`
  const r = await dialog.showSaveDialog({
    title: grafica ? 'Exportar publicação — PDF para a gráfica' : 'Exportar publicação — PDF de revisão',
    defaultPath: sugestao,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!r.filePath) return { cancelado: true }
  // barra de progresso: a paginação do formato (se houver) e a geração, cada uma num trecho
  const avisar = p => { try { opcoes.progresso?.(p) } catch { /* janela fechada */ } }
  const faixa = (de, ate, prefixo = '') => p => avisar({ texto: prefixo + p.texto, fracao: de + (ate - de) * p.fracao })
  avisar({ texto: 'Preparando', fracao: 0 })
  // publicação com a pasta do livro: PDF completo (a tela de paginação já traz isso nas opções)
  const { opcoesDoLivro } = await import('../idml/livroBase.js')
  const doLivro = opcoes.sessao ? null : await opcoesDoLivro(publicacao, pastaModeloNormando())
  // formato que solta espaço sem quebra: a composição passa pela sessão, que decide isso
  let sessao = opcoes.sessao
  if (doLivro?.opcoes.formato?.soltarNbsp) {
    const { abrirSessao, fecharSessao } = await import('./sessaoPaginacao.js')
    sessao = await abrirSessao('revisao', doLivro.publicacaoPlano, { ...opcoes, ...doLivro.opcoes, ajustes: null, typst: executavelTypst(), progresso: faixa(0, 0.6, 'Paginação: ') })
    fecharSessao('revisao')
  }
  const { pdf, relatorio, hifenizacoes } = await gerarPdfPublicacao(doLivro?.publicacaoPlano ?? publicacao, {
    ...opcoes,
    sessao,
    pastaModelo: opcoes.pastaModelo ?? pastaModeloNormando(),
    typst: executavelTypst(),
    ...doLivro?.opcoes,
    // ajustes salvos valem para o formato normal: fora dele, as páginas são outras
    ...(doLivro?.opcoes.formato?.cabeco ? { ajustes: null } : {}),
    progresso: sessao && sessao !== opcoes.sessao ? faixa(0.6, 1) : faixa(0, 1),
    ...(grafica ? { conferencia: false, grafica: { nome: basename(r.filePath) } } : {}),
  })
  writeFileSync(r.filePath, pdf)
  // ao lado do PDF: lista das palavras hifenizadas, com fólio e linha da página (UTF-8 com BOM,
  // para o Bloco de Notas abrir com os acentos certos)
  let arquivoHifenizacoes = null
  if (hifenizacoes != null && !grafica) {
    arquivoHifenizacoes = r.filePath.replace(/\.pdf$/i, '') + '_hifenizacoes.txt'
    writeFileSync(arquivoHifenizacoes, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(hifenizacoes, 'utf8')]))
  }
  avisar({ texto: 'Concluído', fracao: 1, fim: true })
  shell.openPath(r.filePath)
  return { ok: true, filePath: r.filePath, arquivoHifenizacoes, relatorio }
}
