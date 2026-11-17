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
  const grafica = !!opcoes.grafica && !opcoes.somentePretextuais
  // só as folhas técnicas (páginas 1 a 4): sem compor o miolo
  const pretextuais = !!opcoes.somentePretextuais
  const sufixo = pretextuais ? 'folhas_tecnicas' : grafica ? 'grafica' : 'revisao'
  const sugestao = `${nomeSeguro(publicacao.titulo)}${publicacao.edicao ? '_' + nomeSeguro(publicacao.edicao, '') : ''}_${sufixo}.pdf`
  const r = await dialog.showSaveDialog({
    title: pretextuais ? 'Exportar publicação — PDF das folhas técnicas' : grafica ? 'Exportar publicação — PDF para a gráfica' : 'Exportar publicação — PDF de revisão',
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
  if (pretextuais) {
    const pdf = await pdfDasFolhasTecnicas(publicacao, doLivro, opcoes, faixa(0, 1))
    writeFileSync(r.filePath, pdf)
    avisar({ texto: 'Concluído', fracao: 1, fim: true })
    shell.openPath(r.filePath)
    return { ok: true, filePath: r.filePath, relatorio: { puladas: [], avisos: [] } }
  }
  // formato que solta espaço sem quebra: a composição passa pela sessão, que decide isso
  let sessao = opcoes.sessao
  // estilos de parágrafo escolhidos na tela (ajustes 'estilo'): valem em todo formato, como na tela
  const { ajustesDeEstilo } = await import('./ajustesLocais.js')
  const estilosParagrafo = ajustesDeEstilo(opcoes.ajustes?.itens)
  if (doLivro?.opcoes.formato?.soltarNbsp) {
    const { abrirSessao, fecharSessao } = await import('./sessaoPaginacao.js')
    sessao = await abrirSessao('revisao', doLivro.publicacaoPlano, { ...opcoes, ...doLivro.opcoes, ajustes: null, estilosParagrafo, typst: executavelTypst(), progresso: faixa(0, 0.6, 'Paginação: ') })
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
    estilosParagrafo,
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

const PAGINAS_FOLHAS_TECNICAS = [1, 2, 3, 4]

/**
 * PDF só das páginas 1 a 4 (Mesa, rosto, folha técnica). Com a pasta do livro: as páginas do
 * livro com os textos da publicação (pdfLivroCompleto.js); sem ela: as pré-textuais do modelo do
 * Normando, compostas sem as normas.
 */
async function pdfDasFolhasTecnicas(publicacao, doLivro, opcoes, progresso) {
  const { typst } = await import('./exportPdf.js')
  const exe = executavelTypst()
  if (doLivro) {
    progresso({ texto: 'Compondo as folhas técnicas', fracao: 0.3 })
    const { pdfPretextuaisDoLivro } = await import('./pdfLivroCompleto.js')
    const fontes = join(doLivro.opcoes.pastaModelo, 'Document fonts')
    return pdfPretextuaisDoLivro(doLivro.opcoes.livro, {
      institucional: opcoes.institucional, paginas: PAGINAS_FOLHAS_TECNICAS,
      compilar: (a, b, raiz) => typst(exe, ['compile', '--root', raiz, '--font-path', fontes, a, b]),
    })
  }
  const { PDFDocument } = await import('pdf-lib')
  const { pdf } = await gerarPdfPublicacao({ ...publicacao, secoes: [] }, {
    ...opcoes, ajustes: null, conferencia: false, typst: exe,
    pastaModelo: opcoes.pastaModelo ?? pastaModeloNormando(), progresso,
  })
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const saida = await PDFDocument.create()
  const ns = PAGINAS_FOLHAS_TECNICAS.map(n => n - 1).filter(i => i < doc.getPageCount())
  for (const p of await saida.copyPages(doc, ns)) saida.addPage(p)
  return Buffer.from(await saida.save())
}
