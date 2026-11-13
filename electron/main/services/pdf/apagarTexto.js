/**
 * apagarTexto.js — tira de uma página de PDF o texto que cai dentro de regiões (quadros de texto do
 * livro que o Normando recompõe), sem mexer no resto: linhas, imagens e o texto fora das regiões
 * ficam. Só os operadores que desenham texto (Tj, TJ, ', ") saem; o estado (fonte, cor,
 * espaçamento) continua, porque os blocos seguintes do PDF do InDesign dependem dele.
 *
 * Regiões em pt, a partir do canto superior esquerdo da página: { x0, y0, x1, y1 }.
 */

const BRANCO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIM = new Set([...'()<>[]{}/%'].map(c => c.charCodeAt(0)))

/** Tokens do fluxo de conteúdo: { t: 'num'|'nome'|'str'|'arr'|'dict'|'op', v, ini, fim }. */
function* tokens(s) {
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s.charCodeAt(i)
    if (BRANCO.has(c)) { i++; continue }
    if (c === 0x25) { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue } // comentário
    const ini = i
    if (c === 0x28) { // (string) com parênteses aninhados e escapes
      let nivel = 0
      for (; i < n; i++) {
        const ch = s[i]
        if (ch === '\\') { i++; continue }
        if (ch === '(') nivel++
        else if (ch === ')' && --nivel === 0) { i++; break }
      }
      yield { t: 'str', ini, fim: i }
      continue
    }
    if (c === 0x3c && s[i + 1] === '<') { // << dicionário >> (aninhado)
      let nivel = 0
      while (i < n) {
        if (s[i] === '<' && s[i + 1] === '<') { nivel++; i += 2; continue }
        if (s[i] === '>' && s[i + 1] === '>') { nivel--; i += 2; if (!nivel) break; continue }
        if (s[i] === '(') { for (const x of tokens(s.slice(i))) { i += x.fim; break } continue }
        i++
      }
      yield { t: 'dict', ini, fim: i }
      continue
    }
    if (c === 0x3c) { while (i < n && s[i] !== '>') i++; i++; yield { t: 'str', ini, fim: i }; continue }
    if (c === 0x5b) { // [array]
      let nivel = 0
      while (i < n) {
        const ch = s[i]
        if (ch === '(') { const sub = tokens(s.slice(i)).next().value; i += sub.fim; continue }
        if (ch === '[') nivel++
        else if (ch === ']' && --nivel === 0) { i++; break }
        i++
      }
      yield { t: 'arr', ini, fim: i }
      continue
    }
    if (c === 0x2f) { i++; while (i < n && !BRANCO.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++; yield { t: 'nome', ini, fim: i }; continue }
    while (i < n && !BRANCO.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++
    if (i === ini) { i++; continue }
    const v = s.slice(ini, i)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) yield { t: 'num', v: Number(v), ini, fim: i }
    else {
      yield { t: 'op', v, ini, fim: i }
      // imagem embutida: pula os dados binários até EI
      if (v === 'ID') { const e = s.indexOf('EI', i); i = e < 0 ? n : e }
    }
  }
}

const mult = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]

/**
 * Fluxo de conteúdo (texto latin1) → fluxo sem o texto nas regiões. `altura`: altura da página
 * (as regiões vêm de cima para baixo). Devolve { conteudo, apagados }.
 */
export function apagarTextoDoConteudo(conteudo, regioes, altura) {
  const cortes = []
  let ops = [], ctm = [1, 0, 0, 1, 0, 0], pilha = [], tm = null, tlm = null, lead = 0
  // conteúdo marcado: texto de imagem colocada (logotipo) não é texto do quadro
  const marcas = []
  const deImagem = () => marcas.some(m => /^\/(Figure|PlacedPDF|PlacedGraphic)$/.test(m))
  // caminho em construção: fio horizontal de parágrafo (fio acima/abaixo do InDesign) sai também
  let caminho = null
  const ponto = (x, y) => { const m = mult([1, 0, 0, 1, x, y], ctm); return [m[4], m[5]] }
  const dentro = (x, y) => regioes.some(r => x >= r.x0 && x <= r.x1 && altura - y >= r.y0 && altura - y <= r.y1)
  const posicao = () => { const m = mult(tm, ctm); return [m[4], m[5]] }
  for (const tk of tokens(conteudo)) {
    if (tk.t !== 'op') { ops.push(tk); continue }
    const v = tk.v, num = k => ops[ops.length - k]?.v
    switch (v) {
      case 'BDC': case 'BMC': marcas.push(ops[0] ? conteudo.slice(ops[0].ini, ops[0].fim) : ''); break
      case 'EMC': marcas.pop(); break
      case 'm': case 'l': {
        if (!caminho) caminho = { ini: ops.length ? ops[0].ini : tk.ini, pts: [], curva: false }
        caminho.pts.push(ponto(num(2), num(1)))
        break
      }
      case 're': case 'c': case 'v': case 'y': case 'h':
        if (!caminho) caminho = { ini: ops.length ? ops[0].ini : tk.ini, pts: [], curva: false }
        caminho.curva = true
        break
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n': {
        if (caminho && (v === 'S' || v === 's') && !caminho.curva && caminho.pts.length && !deImagem()) {
          const ys = caminho.pts.map(p => p[1])
          if (Math.max(...ys) - Math.min(...ys) < 0.5 && caminho.pts.every(p => dentro(...p))) cortes.push([caminho.ini, tk.fim])
        }
        caminho = null
        break
      }
      case 'q': pilha.push(ctm); break
      case 'Q': ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]; break
      case 'cm': if (ops.length >= 6) ctm = mult(ops.slice(-6).map(o => o.v), ctm); break
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break
      case 'Tm': tm = tlm = ops.slice(-6).map(o => o.v); break
      case 'Td': case 'TD': {
        const tx = num(2), ty = num(1)
        if (v === 'TD') lead = -ty
        tlm = mult([1, 0, 0, 1, tx, ty], tlm); tm = tlm
        break
      }
      case 'TL': lead = num(1); break
      case 'T*': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm; break
      case "'": case '"': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm // segue
      // falls through
      case 'Tj': case 'TJ': {
        if (tm && !deImagem() && dentro(...posicao())) cortes.push([ops.length ? ops[0].ini : tk.ini, tk.fim])
        break
      }
    }
    ops = []
  }
  if (!cortes.length) return { conteudo, apagados: 0 }
  let out = '', pos = 0
  for (const [a, b] of cortes) { out += conteudo.slice(pos, a); pos = b }
  return { conteudo: out + conteudo.slice(pos), apagados: cortes.length }
}

/**
 * Apaga o texto das regiões nas páginas indicadas de um PDF (pdf-lib). paginas: Map nº (1…) → regiões.
 * Devolve o nº de trechos de texto apagados.
 */
export async function apagarTextoNasPaginas(doc, paginas) {
  const { PDFArray, PDFName, decodePDFRawStream, PDFRawStream } = await import('pdf-lib')
  let total = 0
  for (const [n, regioes] of paginas) {
    const pagina = doc.getPages()[n - 1]
    if (!pagina || !regioes.length) continue
    const c = pagina.node.Contents()
    const lista = c instanceof PDFArray ? c.asArray().map(x => doc.context.lookup(x)) : [c]
    const texto = lista.map(s => s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '').join('\n')
    const { conteudo, apagados } = apagarTextoDoConteudo(texto, regioes, pagina.getHeight())
    total += apagados
    if (!apagados) continue
    const novo = doc.context.flateStream(Buffer.from(conteudo, 'latin1'))
    pagina.node.set(PDFName.of('Contents'), doc.context.register(novo))
  }
  return total
}

/**
 * Linhas de texto de cada MCID (conteúdo marcado) da página: Map mcid → [{ x, y (linha de base, de
 * cima para baixo), corpo }]. Para achar no PDF do livro a faixa de cada parágrafo.
 */
export function textoPorMcid(conteudo, altura) {
  const out = new Map()
  let ops = [], ctm = [1, 0, 0, 1, 0, 0], pilha = [], tm = null, tlm = null, lead = 0, tf = 1
  const marcas = []
  const atual = () => { for (let k = marcas.length - 1; k >= 0; k--) if (marcas[k] != null) return marcas[k]; return null }
  for (const tk of tokens(conteudo)) {
    if (tk.t !== 'op') { ops.push(tk); continue }
    const v = tk.v, num = k => ops[ops.length - k]?.v
    switch (v) {
      case 'BDC': { const d = ops[1] ? conteudo.slice(ops[1].ini, ops[1].fim) : ''; const m = d.match(/\/MCID\s+(\d+)/); marcas.push(m ? Number(m[1]) : null); break }
      case 'BMC': marcas.push(null); break
      case 'EMC': marcas.pop(); break
      case 'q': pilha.push(ctm); break
      case 'Q': ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]; break
      case 'cm': if (ops.length >= 6) ctm = mult(ops.slice(-6).map(o => o.v), ctm); break
      case 'Tf': tf = num(1) ?? tf; break
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break
      case 'Tm': tm = tlm = ops.slice(-6).map(o => o.v); break
      case 'Td': case 'TD': { const tx = num(2), ty = num(1); if (v === 'TD') lead = -ty; tlm = mult([1, 0, 0, 1, tx, ty], tlm); tm = tlm; break }
      case 'TL': lead = num(1); break
      case 'T*': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm; break
      case "'": case '"': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm
      // falls through
      case 'Tj': case 'TJ': {
        const id = atual()
        if (tm && id != null) {
          const m = mult(tm, ctm)
          if (!out.has(id)) out.set(id, [])
          out.get(id).push({ x: m[4], y: altura - m[5], corpo: Math.abs(m[3] || m[0]) * tf })
        }
        break
      }
    }
    ops = []
  }
  return out
}

/** Linhas de base (de cima para baixo, em pt, sem repetição e em ordem) do texto da página n. */
export async function linhasDeBase(doc, n) {
  const conteudo = await conteudoDaPagina(doc, n)
  const altura = doc.getPages()[n - 1].getHeight()
  const ys = new Set()
  let ops = [], ctm = [1, 0, 0, 1, 0, 0], pilha = [], tm = null, tlm = null, lead = 0
  for (const tk of tokens(conteudo)) {
    if (tk.t !== 'op') { ops.push(tk); continue }
    const v = tk.v, num = k => ops[ops.length - k]?.v
    switch (v) {
      case 'q': pilha.push(ctm); break
      case 'Q': ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]; break
      case 'cm': if (ops.length >= 6) ctm = mult(ops.slice(-6).map(o => o.v), ctm); break
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break
      case 'Tm': tm = tlm = ops.slice(-6).map(o => o.v); break
      case 'Td': case 'TD': { const tx = num(2), ty = num(1); if (v === 'TD') lead = -ty; tlm = mult([1, 0, 0, 1, tx, ty], tlm); tm = tlm; break }
      case 'TL': lead = num(1); break
      case 'T*': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm; break
      case "'": case '"': tlm = mult([1, 0, 0, 1, 0, -lead], tlm); tm = tlm
      // falls through
      case 'Tj': case 'TJ': if (tm) ys.add(Math.round((altura - mult(tm, ctm)[5]) * 100) / 100); break
    }
    ops = []
  }
  // linhas a menos de 0,5 pt uma da outra são a mesma (trechos da mesma linha)
  const out = []
  for (const y of [...ys].sort((a, b) => a - b)) if (!out.length || y - out.at(-1) > 0.5) out.push(y)
  return out
}

/** Conteúdo (latin1) da página n (1…) de um PDF do pdf-lib. */
export async function conteudoDaPagina(doc, n) {
  const { PDFArray, decodePDFRawStream, PDFRawStream } = await import('pdf-lib')
  const pagina = doc.getPages()[n - 1]
  const c = pagina.node.Contents()
  const lista = c instanceof PDFArray ? c.asArray().map(x => doc.context.lookup(x)) : [c]
  return lista.map(s => s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '').join('\n')
}

/**
 * Elementos de estrutura (parágrafos) com conteúdo na página n: [{ estilo (nome do papel, sem "/"),
 * mcids }], na ordem da árvore. Os Span ficam dentro do parágrafo que os contém.
 */
export async function paragrafosDaEstrutura(doc, n) {
  const { PDFName, PDFArray, PDFDict, PDFNumber, PDFRef } = await import('pdf-lib')
  const pagRef = doc.getPages()[n - 1].ref
  const raiz = doc.catalog.lookup(PDFName.of('StructTreeRoot'))
  if (!raiz) return []
  const out = []
  const mesmo = (a, b) => a && b && a.objectNumber === b.objectNumber
  // mcids de um elemento e dos descendentes (na página)
  const coletar = (el, pg, lista) => {
    const P = el.get(PDFName.of('Pg')) || pg
    const K = el.lookup(PDFName.of('K'))
    for (const k of K instanceof PDFArray ? K.asArray() : K ? [K] : []) {
      const v = k instanceof PDFRef ? doc.context.lookup(k) : k
      if (v instanceof PDFNumber) { if (mesmo(P, pagRef)) lista.push(v.asNumber()) }
      else if (v instanceof PDFDict) {
        if (v.lookup(PDFName.of('Type'))?.toString() === '/MCR') { if (mesmo(v.get(PDFName.of('Pg')) || P, pagRef)) lista.push(v.lookup(PDFName.of('MCID')).asNumber()) }
        else if (v.lookup(PDFName.of('Type'))?.toString() !== '/OBJR') coletar(v, P, lista)
      }
    }
  }
  const visita = (el, pg) => {
    if (!(el instanceof PDFDict)) return
    // nome do PDF com bytes em #XX ("/colof#C3#A3o" → "colofão")
    const bruto = el.lookup(PDFName.of('S'))?.toString()?.replace(/^\//, '')
    const S = bruto && Buffer.from(bruto.replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
    const P = el.get(PDFName.of('Pg')) || pg
    const K = el.lookup(PDFName.of('K'))
    const filhos = (K instanceof PDFArray ? K.asArray() : K ? [K] : []).map(k => (k instanceof PDFRef ? doc.context.lookup(k) : k))
    const tipo = v => v.lookup(PDFName.of('Type'))?.toString()
    const temConteudo = filhos.some(v => v instanceof PDFNumber || (v instanceof PDFDict && tipo(v) === '/MCR'))
    const elementos = filhos.filter(v => v instanceof PDFDict && tipo(v) !== '/MCR' && tipo(v) !== '/OBJR')
    const soSpans = elementos.length && elementos.every(v => v.lookup(PDFName.of('S'))?.toString() === '/Span')
    if ((temConteudo || soSpans) && S !== 'Span') {
      const mcids = []
      coletar(el, pg, mcids)
      if (mcids.length) out.push({ estilo: S, mcids })
      return
    }
    for (const v of filhos) if (v instanceof PDFDict) visita(v, P)
  }
  visita(raiz, null)
  return out
}

/**
 * Página sem texto nem imagem dentro da região (a mancha): só os elementos da mestra (cabeço,
 * fólio). Página que sobrou depois do fim do texto do livro. regiao: { x0, x1, y0, y1 }, de cima
 * para baixo.
 */
export async function paginaSemTexto(doc, n, regiao) {
  const { PDFName, PDFRawStream, decodePDFRawStream } = await import('pdf-lib')
  const pagina = doc.getPages()[n - 1], altura = pagina.getHeight()
  const conteudo = await conteudoDaPagina(doc, n)
  const xobjetos = pagina.node.Resources()?.lookup(PDFName.of('XObject'))
  let ops = [], transformado = false
  for (const tk of tokens(conteudo)) {
    if (tk.t !== 'op') { ops.push(tk); continue }
    if (tk.v === 'cm') transformado = true
    if (/^(sh|EI)$/.test(tk.v)) return false
    if (tk.v === 'Do') {
      // formulário (o InDesign põe o cabeço da página par num): olha o texto dele; imagem conta
      const nome = ops.at(-1) ? conteudo.slice(ops.at(-1).ini, ops.at(-1).fim).replace(/^\//, '') : ''
      const x = xobjetos?.lookup(PDFName.of(nome))
      if (transformado || !(x instanceof PDFRawStream) || x.dict.lookup(PDFName.of('Subtype'))?.toString() !== '/Form') return false
      const matriz = x.dict.lookup(PDFName.of('Matrix'))
      if (matriz && matriz.toString().replace(/\s+/g, ' ').trim() !== '[ 1 0 0 1 0 0 ]') return false
      const sub = Buffer.from(decodePDFRawStream(x).decode()).toString('latin1')
      if ([...tokens(sub)].some(t => t.t === 'op' && /^(Do|sh|EI)$/.test(t.v))) return false
      if (apagarTextoDoConteudo(sub, [regiao], altura).apagados) return false
    }
    ops = []
  }
  return apagarTextoDoConteudo(conteudo, [regiao], altura).apagados === 0
}

/** Página sem nada desenhado (texto, imagem ou traço): página em branco do livro. */
export async function paginaVazia(doc, n) {
  const conteudo = await conteudoDaPagina(doc, n)
  for (const tk of tokens(conteudo)) {
    if (tk.t === 'op' && /^(Tj|TJ|'|"|Do|S|s|f|F|f\*|B|B\*|b|b\*|sh|EI)$/.test(tk.v)) return false
  }
  return true
}
