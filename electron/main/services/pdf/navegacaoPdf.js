/**
 * navegacaoPdf.js — sumário clicável e marcadores (bookmarks) no PDF do livro completo.
 *
 * O sumário do livro entra como imagem da página do PDF do InDesign (pdfLivroCompleto.js), sem os
 * links de lá; e os marcadores das páginas geradas se perdem quando as páginas são juntadas. Aqui:
 *   • cada linha do sumário com número de página vira um link para a página nova (a posição do número
 *     vem do livro.json do preparar_livro_normando.jsx; a página, do sumário renumerado);
 *   • os marcadores do PDF repetem o sumário, com a hierarquia dos estilos dele (epígrafe/separador,
 *     nível 1, nível 2…). Entrada sem número (separador) aponta para a página da entrada seguinte.
 */

import { PDFName, PDFNull, PDFNumber, PDFHexString, PDFArray } from 'pdf-lib'

/** Nível do marcador pelo estilo de parágrafo do sumário; null = não entra (título, ementa). */
export function nivelDaEntrada(estilo) {
  const e = String(estilo || '')
  if (/sum-titulo|sum-ementa|sum-apelido|\[No paragraph style\]|NormalParagraphStyle/.test(e)) return null
  if (/sum-(epigrafe|separador)|abertura/.test(e)) return 1
  const n = e.match(/sum-nivel(\d)/)
  if (n) return Number(n[1]) + 1
  return 2
}

const destino = (doc, indice, topo = null) => {
  const pagina = doc.getPage(Math.max(0, Math.min(doc.getPageCount() - 1, indice)))
  return doc.context.obj([pagina.ref, PDFName.of('XYZ'), PDFNull, topo == null ? PDFNull : PDFNumber.of(topo), PDFNull])
}

/**
 * Links nas linhas do sumário.
 * @param posicoes  livro.dados.sumario: [{ pagina, x0, x1, base, corpo }] na ordem das entradas numeradas
 * @param numeros   páginas novas, na mesma ordem (mapa.sumario)
 * @param margens   { dentro, fora } da mancha (pt) e altura da página
 */
export function linksNoSumario(doc, posicoes, numeros, { dentro, fora, altura }) {
  if (!posicoes?.length || posicoes.length !== numeros?.length) return 0
  let feitos = 0
  posicoes.forEach((t, k) => {
    const alvo = Number(numeros[k])
    if (!alvo || t.pagina < 1 || t.pagina > doc.getPageCount()) return
    const pagina = doc.getPage(t.pagina - 1)
    const esquerda = t.pagina % 2 ? dentro : fora
    const linha = t.corpo * 1.32
    // título em mais de uma linha: da linha de baixo da entrada anterior (mesma página) até esta
    const ant = posicoes[k - 1]
    const acima = ant && ant.pagina === t.pagina && t.base - ant.base > linha * 1.5 && t.base - ant.base < linha * 4.5
      ? ant.base + t.corpo * 0.35 : t.base - t.corpo * 0.85
    const rect = [esquerda, altura - (t.base + t.corpo * 0.3), t.x1 + 1, altura - acima]
    const link = doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
      Dest: destino(doc, alvo - 1),
    })
    const ref = doc.context.register(link)
    const annots = pagina.node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) annots.push(ref)
    else pagina.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
    feitos++
  })
  return feitos
}

/**
 * Marcadores do PDF.
 * @param itens [{ titulo, nivel, pagina }] em ordem (página = fólio = índice + 1)
 */
export function marcadores(doc, itens) {
  const lista = itens.filter(x => x.titulo && x.nivel && x.pagina)
  if (!lista.length) return 0
  const ctx = doc.context
  const raiz = { filhos: [], dict: ctx.obj({ Type: 'Outlines' }) }
  raiz.ref = ctx.register(raiz.dict)
  // árvore pelos níveis (um nível que pula vira filho do último disponível)
  const pilha = [{ nivel: 0, no: raiz }]
  for (const x of lista) {
    while (pilha.length > 1 && pilha.at(-1).nivel >= x.nivel) pilha.pop()
    const pai = pilha.at(-1).no
    const dict = ctx.obj({ Title: PDFHexString.fromText(x.titulo), Parent: pai.ref, Dest: destino(doc, x.pagina - 1) })
    const no = { filhos: [], dict, ref: ctx.register(dict) }
    pai.filhos.push(no)
    pilha.push({ nivel: x.nivel, no })
  }
  // ligações: First/Last/Prev/Next/Count (só o 1º nível aberto)
  const ligar = no => {
    const f = no.filhos
    if (!f.length) return 0
    no.dict.set(PDFName.of('First'), f[0].ref)
    no.dict.set(PDFName.of('Last'), f.at(-1).ref)
    f.forEach((c, i) => {
      if (i > 0) c.dict.set(PDFName.of('Prev'), f[i - 1].ref)
      if (i < f.length - 1) c.dict.set(PDFName.of('Next'), f[i + 1].ref)
      // Count negativo = fechado: o leitor abre mostrando só o 1º nível
      const n = ligar(c)
      if (n) c.dict.set(PDFName.of('Count'), PDFNumber.of(-n))
    })
    return f.length
  }
  raiz.dict.set(PDFName.of('Count'), PDFNumber.of(ligar(raiz)))
  doc.catalog.set(PDFName.of('Outlines'), raiz.ref)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  return lista.length
}

/**
 * Sumário clicável + marcadores no PDF do livro completo.
 * @param entradas  mapa.entradasSumario: [{ titulo, estilo, numerada, pagina }]
 */
export function navegacaoDoLivro(doc, { entradas, posicoes, numeros, formato, paginaSumario }) {
  // entrada sem página (separador): a página da entrada seguinte que tem
  const itens = (entradas || []).map(e => ({ titulo: e.titulo, nivel: nivelDaEntrada(e.estilo), pagina: e.pagina }))
  for (let i = itens.length - 2; i >= 0; i--) if (!itens[i].pagina) itens[i].pagina = itens[i + 1].pagina
  if (paginaSumario) itens.unshift({ titulo: 'Sumário', nivel: 1, pagina: paginaSumario })
  const links = linksNoSumario(doc, posicoes, numeros, { dentro: formato.dentro, fora: formato.fora, altura: formato.altura })
  const n = marcadores(doc, itens)
  return { links, marcadores: n }
}
