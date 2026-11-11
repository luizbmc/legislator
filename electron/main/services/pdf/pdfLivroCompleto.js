/**
 * pdfLivroCompleto.js — PDF de revisão do livro completo (ex.: CF): as páginas geradas pelo Normando
 * entre as páginas do PDF do livro (preparar_livro_normando.jsx). Vale para a exportação e para o
 * "Gerar PDF" da tela de paginação.
 *
 * Nas páginas do livro só muda o que o documento novo muda: fólio das partes mantidas, números do
 * sumário e a última emenda da apresentação (fundo branco e texto novo por cima, no mesmo lugar).
 * As novas emendas são compostas à parte: a 1ª página entra recortada embaixo do fim da parte,
 * com linhas em branco no começo para o texto cair onde o livro termina.
 */

import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { gerarLivroCompleto } from '../idml/livroCompleto.js'
import { ascendente, formato } from './mancha.js'

const FOLGA_RECORTE = 4                // pt entre a última linha do livro e o recorte
const CAIXA = 'width: 9.2mm, height: 6mm, stroke: 0.5pt + cmyk(0%, 0%, 0%, 40%), fill: cmyk(0%, 0%, 0%, 0%)'

const peso = e => /bold/i.test(e) ? (/semi/i.test(e) ? 600 : 700) : /light/i.test(e) ? 300 : /medium/i.test(e) ? 500 : 400
const str = t => JSON.stringify(String(t))

/** Fólio refeito sobre a caixa do livro (mesma posição da mestra). */
function folio(n) {
  const c = formato.cabeco?.folio
  if (!c) return `#place(top + left, dx: ${n % 2 ? '156.2mm' : '4.1mm'}, dy: 7.9mm, box(${CAIXA}, align(center + horizon, text(font: "Montserrat", weight: 500, size: 8.5pt, fill: cmyk(0%, 0%, 0%, 60%), top-edge: "cap-height", bottom-edge: "baseline", ${str(n)}))))`
  const q = n % 2 ? c.impar : c.par
  return `#place(top + left, dx: ${q.x}pt, dy: ${q.y}pt, box(width: ${q.w}pt, height: ${q.h}pt, fill: cmyk(0%, 0%, 0%, 0%), align(${q.alinhar} + horizon, text(font: "Montserrat", size: ${c.corpo}pt, fill: cmyk(0%, 0%, 0%, ${c.tinta}%), top-edge: "cap-height", bottom-edge: "baseline", ${str(n)}))))`
}

/** Texto trocado no lugar do antigo: fundo branco e texto novo na mesma linha-base. */
function troca(t, novo, alinhar) {
  const largura = t.x1 - t.x0
  const fonte = `font: ${str(t.fonte.replace(/ \(TT\)$/, ''))}, weight: ${peso(t.estilo)}, size: ${t.corpo}pt, fill: cmyk(0%, 0%, 0%, 100%), top-edge: "baseline", bottom-edge: "baseline"`
  const fundo = `#place(top + left, dx: ${t.x0 - 0.3 - (alinhar === 'direita' ? t.corpo * 0.6 : 0)}pt, dy: ${t.base - t.corpo * 0.8}pt, rect(width: ${largura + 0.6 + (alinhar === 'direita' ? t.corpo * 0.6 : 0)}pt, height: ${t.corpo * 1.05}pt, fill: cmyk(0%, 0%, 0%, 0%), stroke: none))`
  const texto = alinhar === 'direita'
    ? `#place(top + left, dx: ${t.x1 - 60}pt, dy: ${t.base}pt, box(width: 60pt, align(right, text(${fonte}, ${str(novo)}))))`
    : `#place(top + left, dx: ${t.x0}pt, dy: ${t.base}pt, text(${fonte}, ${str(novo)}))`
  return fundo + '\n' + texto
}

/** Linhas em branco que levam o começo das novas emendas ao fim da parte no livro. */
function comBrancos(blocos, fim) {
  const primeira = formato.topo + ascendente('Source Sans 3', formato.corpo ?? 9.5)
  const linhas = Math.max(1, Math.round((fim - primeira) / formato.linha) + 1)
  // linha com texto (espaço sem quebra não ocupa altura): o recorte da página esconde estas linhas
  const branco = { type: 'paragrafLei', content: [{ type: 'text', text: '–' }] }
  return [...Array.from({ length: linhas }, () => branco), ...blocos]
}

/**
 * @param pdfMiolo  páginas geradas (só o miolo, com fólio e cabeço)
 * @returns PDF completo
 */
export async function montarPdfLivro(pdfMiolo, { livro, sessao, opcoes, rel, compilar }) {
  const { PDFDocument } = await import('pdf-lib')
  const { gerarPdfPublicacao } = await import('./exportPdf.js')
  const { mapa } = await gerarLivroCompleto(livro.base, livro.publicacao, { sessao, paginasPartes: livro.dados.partes, institucional: opcoes.institucional })
  const { primeira, primeiraMantida, paginasPlano, paginasGeradas, ultimaTexto, acrescimo, paginaNova } = mapa

  // novas emendas: composição própria, a partir da página onde a parte termina
  let emendas = null, paginasEmendas = 0
  if (acrescimo?.blocos?.length) {
    const inicio = paginaNova(acrescimo.apos)
    const norma = { ...acrescimo.norma, conteudo_doc: JSON.stringify({ type: 'doc', content: comBrancos(acrescimo.blocos, acrescimo.fim) }), exportacao: 'completa' }
    const r = await gerarPdfPublicacao({ ...livro.publicacao, secoes: [{ titulo: '', normas: [norma] }] }, {
      ...opcoes, livro: null, sessao: null, ajustes: null, somenteMiolo: true, primeiraPaginaMiolo: inicio,
      // barra de progresso: as emendas ficam no trecho final, sem voltar ao começo
      progresso: opcoes.progresso && (p => opcoes.progresso({ texto: `Novas emendas: ${p.texto.charAt(0).toLowerCase()}${p.texto.slice(1)}`, fracao: 0.88 + 0.08 * p.fracao })),
      cabecalhoImpar: acrescimo.titulo, cabecalhoPar: livro.cabecalhoPar,
    })
    emendas = r.pdf
    paginasEmendas = (await PDFDocument.load(emendas, { updateMetadata: false })).getPageCount()
    rel.livro = { emendas: paginasEmendas }
    if (paginasEmendas - 1 > acrescimo.paginas) rel.avisos?.push?.('As novas emendas ocuparam mais páginas do que o previsto no IDML.')
  }

  // páginas do livro com textos trocados (Mesa, rosto, folha técnica, colofão, última emenda): o
  // texto dos quadros sai do PDF do livro e o novo é composto por cima (pretextuaisPdf.js)
  const { pretextuaisNasPaginas } = await import('./pretextuaisPdf.js')
  const { default: JSZip } = await import('jszip')
  const pdfOriginal = mapa.pretextuais?.length ? await PDFDocument.load(readFileSync(join(livro.pasta, 'livro.pdf')), { updateMetadata: false }) : null
  const pre = await pretextuaisNasPaginas(mapa.zip, mapa.pretextuais, n => n < primeira || n >= primeiraMantida,
    { zip: await JSZip.loadAsync(livro.base), pdf: pdfOriginal, arquivo: 'livro-original.pdf' })
  const recomposto = (n, t) => (pre.get(n)?.regioes || []).some(r => t.x0 >= r.x0 && t.x0 <= r.x1 && t.base >= r.y0 && t.base <= r.y1)

  // ordem final: { de: 'moldura' | 'miolo' | 'emendas', pagina }
  const moldura = []     // conteúdo Typst de cada página tirada do livro
  const ordem = []
  const doLivro = (n, extras = []) => {
    moldura.push(`#place(top + left, image("livro.pdf", page: ${n}, width: ${formato.largura}pt, height: ${formato.altura}pt))\n${[...extras, ...(pre.get(n)?.typst || [])].join('\n')}`)
    ordem.push({ de: 'moldura', pagina: moldura.length - 1, livro: n, extras: extras.length + (pre.get(n)?.typst?.length || 0) })
  }
  const branca = () => { moldura.push(''); ordem.push({ de: 'moldura', pagina: moldura.length - 1, branca: true }) }

  const sumario = livro.dados.sumario, trocas = livro.dados.trocas || []
  for (let n = 1; n < primeira; n++) {
    const extras = sumario.flatMap((t, k) => t.pagina === n && mapa.sumario[k] != null && mapa.sumario[k] !== t.numero ? [troca(t, mapa.sumario[k], 'direita')] : [])
    if (mapa.ultimaEmenda) for (const t of trocas) if (t.pagina === n && !recomposto(n, t)) extras.push(troca(t, mapa.ultimaEmenda))
    doLivro(n, extras)
  }
  for (let k = 0; k < paginasGeradas; k++) ordem.push({ de: 'miolo', pagina: k })
  for (let k = paginasGeradas; k < paginasPlano; k++) branca()
  for (let n = primeiraMantida; n <= livro.dados.paginas; n++) {
    const extras = ultimaTexto == null || n <= ultimaTexto ? [folio(paginaNova(n))] : []
    if (acrescimo && n === acrescimo.apos && emendas) {
      const y = acrescimo.fim + FOLGA_RECORTE
      extras.push(`#place(top + left, dy: ${y}pt, box(width: ${formato.largura}pt, height: ${formato.altura - y}pt, clip: true, move(dy: ${-y}pt, image("emendas.pdf", page: 1, width: ${formato.largura}pt, height: ${formato.altura}pt))))`)
      doLivro(n, extras)
      for (let k = 1; k < paginasEmendas; k++) ordem.push({ de: 'emendas', pagina: k })
      for (let k = paginasEmendas - 1; k < acrescimo.paginas; k++) branca()
      continue
    }
    doLivro(n, extras)
  }

  // total múltiplo de 4 (cadernos da gráfica): o colofão (última página do livro) fica no fim e as
  // páginas em branco antes dele são refeitas — as do livro saem e entram as que faltam
  {
    const { paginaVazia } = await import('./apagarTexto.js')
    const docLivro = pdfOriginal || await PDFDocument.load(readFileSync(join(livro.pasta, 'livro.pdf')), { updateMetadata: false })
    const colofao = ordem.pop()
    while (ordem.length) {
      const o = ordem.at(-1)
      if (o.de !== 'moldura' || !(o.branca || (o.livro && !o.extras && await paginaVazia(docLivro, o.livro)))) break
      ordem.pop()
    }
    while ((ordem.length + 1) % 4) branca()
    ordem.push(colofao)
  }

  const pasta = mkdtempSync(join(tmpdir(), 'normando-livro-'))
  try {
    if (pre.size) {
      const { apagarTextoNasPaginas } = await import('./apagarTexto.js')
      const doc = await PDFDocument.load(readFileSync(join(livro.pasta, 'livro.pdf')), { updateMetadata: false })
      await apagarTextoNasPaginas(doc, new Map([...pre].map(([n, p]) => [n, p.regioes])))
      writeFileSync(join(pasta, 'livro.pdf'), await doc.save())
      // faixas dos parágrafos que não mudaram: do PDF original, com o texto
      copyFileSync(join(livro.pasta, 'livro.pdf'), join(pasta, 'livro-original.pdf'))
    } else copyFileSync(join(livro.pasta, 'livro.pdf'), join(pasta, 'livro.pdf'))
    if (emendas) writeFileSync(join(pasta, 'emendas.pdf'), emendas)
    const typ = `#set page(width: ${formato.largura}pt, height: ${formato.altura}pt, margin: 0pt)\n` + moldura.join('\n#pagebreak()\n') + '\n'
    writeFileSync(join(pasta, 'moldura.typ'), typ, 'utf8')
    await compilar(join(pasta, 'moldura.typ'), join(pasta, 'moldura.pdf'), pasta)

    const fontes = {
      moldura: await PDFDocument.load(readFileSync(join(pasta, 'moldura.pdf')), { updateMetadata: false }),
      miolo: await PDFDocument.load(pdfMiolo, { updateMetadata: false }),
      emendas: emendas ? await PDFDocument.load(emendas, { updateMetadata: false }) : null,
    }
    const saida = await PDFDocument.create()
    for (const nome of Object.keys(fontes)) {
      if (!fontes[nome]) continue
      const lista = ordem.filter(o => o.de === nome)
      const copias = await saida.copyPages(fontes[nome], lista.map(o => o.pagina))
      lista.forEach((o, i) => { o.copia = copias[i] })
    }
    for (const o of ordem) saida.addPage(o.copia)
    if (rel.livro) rel.livro.paginas = ordem.length
    else rel.livro = { paginas: ordem.length }
    // página do livro de cada página do PDF (o PDF para a gráfica tira a sangria delas do livro-sangria.pdf)
    rel.livro.origem = ordem.map(o => o.livro || null)
    // sumário clicável e marcadores do PDF com as entradas do sumário (navegacaoPdf.js); não no da gráfica
    if (!opcoes.grafica) try {
      const { navegacaoDoLivro } = await import('./navegacaoPdf.js')
      const nav = navegacaoDoLivro(saida, {
        entradas: mapa.entradasSumario, posicoes: sumario, numeros: mapa.sumario, formato,
        paginaSumario: sumario.length ? Math.min(...sumario.map(t => t.pagina)) : null,
      })
      rel.livro.navegacao = nav
      if (sumario.length && nav.links !== sumario.length) rel.avisos?.push?.(`Sumário clicável: ${nav.links} de ${sumario.length} entradas com link (o sumário do livro e o do IDML não bateram).`)
    } catch (e) {
      rel.avisos?.push?.(`Não foi possível pôr links e marcadores no PDF: ${e.message}`)
    }
    return Buffer.from(await saida.save())
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}
