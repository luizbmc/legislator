/**
 * pdfGrafica.js — PDF pronto para a gráfica, nas configurações dos PDFs que a Edições Câmara mandou
 * para impressão (pasta "PDF gráfica": CF 70ª ed., RICD 31ª ed., CF de bolso 69ª ed., todos do
 * InDesign):
 *   • página = formato + 27 pt de cada lado (MediaBox/CropBox); TrimBox no formato; BleedBox com 5 mm
 *     de sangria;
 *   • marcas de corte em cor de registro (aqui CMYK 100/100/100/100): traço de 15 pt a 12 pt da linha
 *     de corte, 0,125 pt sobre um fio branco de 0,625 pt (como o InDesign);
 *   • informação da página embaixo, corpo 6: "<arquivo>   <página>" a 37 pt da esquerda e
 *     "dd/mm/aaaa   hh:mm:ss" a 90 pt da direita, 6 pt acima da borda;
 *   • sem anotações (comentários da conferência, links) e sem marcadores.
 * As páginas que vêm do livro (pasta do livro) recebem a sangria do livro-sangria.pdf: o que passa
 * da linha de corte (arte do rosto da CF) entra numa moldura em volta da página, recortada fora do
 * corte — dentro dele continua a página montada (com os textos trocados).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PDFDocument, PDFName, pushGraphicsState, popGraphicsState, rectangle, clipEvenOdd, endPath } from 'pdf-lib'

export const MARGEM = 27                      // pt em volta da linha de corte
export const SANGRIA = 5 * 72 / 25.4          // 5 mm
const TRACO = 15, AFASTAMENTO = 12, SOBREPOR = 1

const dois = n => String(n).padStart(2, '0')
const dataHora = d => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}   ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`
const pt = v => `${Math.round(v * 1000) / 1000}pt`

/** Typst das marcas de corte e da informação de cada página (uma página por tamanho/folha). */
function typstDasMarcas(tamanhos, nome, quando) {
  const linhas = []
  // registro (todas as chapas) e branco em CMYK: nada de cinza/RGB com perfil ICC no PDF da gráfica
  linhas.push(`#let reg = cmyk(100%, 100%, 100%, 100%)`)
  linhas.push(`#let branco = cmyk(0%, 0%, 0%, 0%)`)
  linhas.push(`#let marcas(W, H, n) = {`)
  linhas.push(`  let m = ${pt(MARGEM)}; let t = ${pt(TRACO)}; let a = ${pt(AFASTAMENTO)}`)
  // horizontais nas alturas do corte; verticais nas larguras do corte
  linhas.push(`  let segs = (((0pt, m), (t, m)), ((W - t, m), (W, m)), ((0pt, H - m), (t, H - m)), ((W - t, H - m), (W, H - m)),`)
  linhas.push(`    ((m, 0pt), (m, t)), ((W - m, 0pt), (W - m, t)), ((m, H - t), (m, H)), ((W - m, H - t), (W - m, H)))`)
  linhas.push(`  for s in segs { place(top + left, line(start: s.at(0), end: s.at(1), stroke: 0.625pt + branco)) }`)
  linhas.push(`  for s in segs { place(top + left, line(start: s.at(0), end: s.at(1), stroke: 0.125pt + reg)) }`)
  // linha de base 6 pt acima da borda; fio branco em volta das letras e o texto por cima
  linhas.push(`  let info(dx, s) = place(top + left, dx: dx, dy: H - 16pt, box(height: 10pt, {`)
  linhas.push(`    let t(..a) = text(size: 6pt, bottom-edge: "baseline", font: "Source Sans 3", ..a, s)`)
  linhas.push(`    place(bottom + left, t(fill: branco, stroke: 0.4pt + branco))`)
  linhas.push(`    place(bottom + left, t(fill: reg))`)
  linhas.push(`  }))`)
  linhas.push(`  info(37pt, ${JSON.stringify(nome + '   ')} + str(n))`)
  linhas.push(`  info(W - 90pt, ${JSON.stringify(quando)})`)
  linhas.push(`}`)
  tamanhos.forEach(({ W, H }, i) => linhas.push(`#page(width: ${pt(W)}, height: ${pt(H)}, margin: 0pt, marcas(${pt(W)}, ${pt(H)}, ${i + 1}))`))
  return linhas.join('\n') + '\n'
}

/**
 * @param pdf       Buffer do PDF montado (páginas no formato, sem sangria)
 * @param opcoes    { nome: nome do arquivo (informação da página), compilar(typ, pdf), pasta (temporária),
 *                    origem: [nº da página do livro | null] por página, sangria: caminho do livro-sangria.pdf,
 *                    titulo, avisos: [] }
 */
export async function pdfParaGrafica(pdf, { nome, compilar, pasta, origem = [], sangria = null, titulo = null, avisos = [] }) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const paginas = doc.getPages()

  // marcas e informação: um PDF do Typst com as páginas já no tamanho final (fonte embutida uma vez)
  const tamanhos = paginas.map(p => { const { width, height } = p.getSize(); return { w: width, h: height, W: width + 2 * MARGEM, H: height + 2 * MARGEM } })
  writeFileSync(join(pasta, 'marcas.typ'), typstDasMarcas(tamanhos, nome, dataHora(new Date())), 'utf8')
  await compilar(join(pasta, 'marcas.typ'), join(pasta, 'marcas.pdf'))
  const marcas = await doc.embedPdf(readFileSync(join(pasta, 'marcas.pdf')), paginas.map((_, i) => i))

  // sangria das páginas do livro
  let molduras = new Map()
  const doLivro = origem.map((n, i) => [i, n]).filter(([, n]) => n)
  if (doLivro.length) {
    if (sangria && existsSync(sangria)) {
      const fonte = await PDFDocument.load(readFileSync(sangria), { updateMetadata: false })
      const usados = [...new Set(doLivro.map(([, n]) => n))].filter(n => n <= fonte.getPageCount())
      const embutidas = await doc.embedPages(usados.map(n => fonte.getPage(n - 1)))
      usados.forEach((n, k) => {
        const p = fonte.getPage(n - 1), corte = p.getTrimBox(), caixa = p.getMediaBox()
        molduras.set(n, { emb: embutidas[k], dx: caixa.x - corte.x, dy: caixa.y - corte.y, w: caixa.width, h: caixa.height })
      })
    } else avisos.push('A pasta do livro não tem o livro-sangria.pdf (rode de novo o preparar_livro_normando.jsx): as páginas do livro saíram sem sangria.')
  }

  // cada página vira um Form XObject desenhado dentro da folha maior. Não basta deslocar o conteúdo
  // com "cm": os padrões (Pattern) do InDesign ficam presos ao espaço da página e saíam desencontrados
  // (trama do falso rosto); no Form eles acompanham o deslocamento. Embute já, antes de esvaziar a página.
  const formas = await doc.embedPages(paginas)
  for (const f of formas) await f.embed()
  paginas.forEach((p, i) => {
    const { w, h, W, H } = tamanhos[i]
    p.node.set(PDFName.of('Contents'), doc.context.obj([]))
    p.node.set(PDFName.of('Resources'), doc.context.obj({ Font: {}, XObject: {}, ExtGState: {} }))
    p.node.delete(PDFName.of('Annots'))
    p.setMediaBox(0, 0, W, H)
    p.setCropBox(0, 0, W, H)
    p.setBleedBox(MARGEM - SANGRIA, MARGEM - SANGRIA, w + 2 * SANGRIA, h + 2 * SANGRIA)
    p.setTrimBox(MARGEM, MARGEM, w, h)
    p.node.delete(PDFName.of('ArtBox'))
    p.drawPage(formas[i], { x: MARGEM, y: MARGEM, width: w, height: h })
    // sangria do livro: só a moldura entre o corte e o fim da sangria; ela entra 1 pt para dentro do
    // corte (ali o conteúdo é o mesmo da página) para não ficar um fio claro na emenda
    const m = molduras.get(origem[i])
    if (m) {
      const S = SOBREPOR
      p.pushOperators(pushGraphicsState(),
        rectangle(MARGEM - SANGRIA, MARGEM - SANGRIA, w + 2 * SANGRIA, h + 2 * SANGRIA),
        rectangle(MARGEM + S, MARGEM + S, w - 2 * S, h - 2 * S), clipEvenOdd(), endPath())
      p.drawPage(m.emb, { x: MARGEM + m.dx, y: MARGEM + m.dy, width: m.w, height: m.h })
      p.pushOperators(popGraphicsState())
    }
    p.drawPage(marcas[i], { x: 0, y: 0, width: W, height: H })
  })

  // documento novo só com as páginas: fica de fora o que não é mais usado (conteúdos antigos, as
  // páginas copiadas para embutir, marcadores, links, árvore de estrutura) — sem isso o PDF triplicava
  const saida = await PDFDocument.create({ updateMetadata: false })
  for (const c of await saida.copyPages(doc, paginas.map((_, i) => i))) saida.addPage(c)
  if (titulo) saida.setTitle(titulo)
  saida.setProducer('Normando')
  saida.setCreator('Normando')
  saida.setCreationDate(new Date())
  saida.setModificationDate(new Date())
  const info = saida.context.lookup(saida.context.trailerInfo.Info)
  info?.set?.(PDFName.of('Trapped'), PDFName.of('False'))
  return Buffer.from(await saida.save({ useObjectStreams: false }))
}

export const _teste = { typstDasMarcas }
