/**
 * conferencia.js — marcações de conferência no PDF de revisão, com a justificativa de cada uma:
 * - linha com espaçamento aberto demais (o que foi tentado e por que a palavra que desceu não pôde
 *   ser dividida);
 * - palavras empilhadas que ficaram (por que as tentativas foram recusadas);
 * - hifenizações problemáticas (palavra composta ou com prefixo dividida fora do ponto preferido).
 *
 * As marcas vão no PDF pronto como comentários (anotações de realce com a justificativa), sem
 * mexer na composição.
 */

import { prefixoDe, trechosProtegidos } from '../idml/translineacao.js'
import { semConferencia } from './mancha.js'
import { pontoBomComposta } from './composicaoLivro.js'

const semConferenciaDe = inf => semConferencia(inf?.fn?.estilo)

const LETRA = /\p{L}/u
const COMPOSTA = /\p{L}[-‐]\p{L}/u
const NBSP = String.fromCharCode(0xa0)
const pct = r => `${Math.round(r * 100)}%`

// espaçamento aberto: só vira comentário a partir desta abertura (a correção começa antes, em ABERTA)
export const RELATAR_ABERTA = 1.8

/**
 * Numeração das linhas de cada página (texto, sem notas nem tabelas): (página, y) → { linha, total }.
 * @param trechos [[i, página, y]] começo de cada trecho do miolo; linhasNaoMarcadas i → nº de linhas
 */
export function numeracaoDeLinhas(linhasPorPar, trechos, linhasNaoMarcadas) {
  const porPagina = new Map()
  const incluir = (p, y) => {
    if (!porPagina.has(p)) porPagina.set(p, [])
    porPagina.get(p).push(y)
  }
  for (const { linhas } of linhasPorPar.values()) for (const l of linhas) incluir(l.pagina, l.y)
  for (const [i, pagina, y] of trechos) {
    if (linhasPorPar.has(i)) continue
    for (let m = 0; m < linhasNaoMarcadas(i); m++) incluir(pagina, y + 0.5 + m * 0.01)
  }
  for (const ys of porPagina.values()) ys.sort((a, b) => a - b)
  return (pagina, y) => {
    const ys = porPagina.get(pagina) || []
    return { linha: ys.findIndex(v => Math.abs(v - y) < 0.005) + 1, total: ys.length }
  }
}

/**
 * Palavras que desceram inteiras depois de uma linha aberta demais, para testar se têm ponto de
 * divisão permitido (documentoLarguras com `divisivel`): { pedidos: Map chave → pedido, casos: [{ i, k, chave }] }.
 */
export function palavrasParaTestar(ultima, restricoes) {
  const { linhasPorPar, linhas: info, plano, abert } = ultima
  const pedidos = new Map()
  const casos = []
  for (const [i, a] of abert || []) {
    if (!a.detalhes?.length || !linhasPorPar.has(i)) continue
    const { linhas } = linhasPorPar.get(i)
    const { marcas, runs, fn } = info.get(i)
    const rs = restricoes.get(i) || {}
    for (const { n } of a.detalhes) {
      const prox = linhas[n + 1]
      if (!prox?.inteira) continue
      const k = prox.ks.find(x => marcas[x] && !marcas[x].fim)
      if (k == null) continue
      const pedido = {
        estilo: fn.estilo, tr: plano[i]?.tr ?? 0, run: runs[marcas[k].run], palavra: marcas[k].palavra,
        divisivel: true, prefixoPreferido: !(rs.compostasLivres || []).includes(k), minLetras: (rs.seisLetras || []).includes(k) ? 6 : undefined,
      }
      const chave = JSON.stringify(['divisivel', pedido.estilo, pedido.tr, pedido.run?.char || '', pedido.palavra, pedido.prefixoPreferido, pedido.minLetras || 7])
      pedidos.set(chave, pedido)
      // o menor pedaço que as regras deixam ficar na linha (com o hífen): o primeiro ponto fora dos
      // trechos protegidos (os padrões de hifenização podem ainda exigir um ponto mais adiante)
      const w = pedido.palavra
      const prot = trechosProtegidos(w, { vogais: true, regras: true, prefixoPreferido: pedido.prefixoPreferido, ...(pedido.minLetras ? { minLetras: 6 } : {}) })
      let p0 = null
      for (let p = 2; p <= w.length - 2 && p0 == null; p++) {
        if (!LETRA.test(w[p - 1]) || !LETRA.test(w[p])) continue
        if (!prot.some(([a, b, h]) => a < p && p < b && !h?.includes(p))) p0 = p
      }
      let chavePedaco = null
      if (p0 != null) {
        const pedaco = { estilo: fn.estilo, tr: pedido.tr, run: pedido.run, palavra: w.slice(0, p0) + '-' }
        chavePedaco = JSON.stringify(['pedaco', pedaco.estilo, pedaco.tr, pedaco.run?.char || '', pedaco.palavra])
        pedidos.set(chavePedaco, pedaco)
      }
      casos.push({ i, k, chave, chavePedaco, pedaco: p0 != null ? w.slice(0, p0) + '-' : null })
    }
  }
  return { pedidos, casos }
}

/**
 * Itens da conferência: [{ tipo: 'aberta'|'pilha'|'hifen', pagina, y, marcas: [{ pagina, x0, x1, y0, y1 }], texto }].
 * @param ultima dados da última rodada (exportPdf): linhasPorPar, hif, linhas (info), plano, folio, abert, pilhas
 * @param div ponto da divisão de cada linha hifenizada (pilhas.js, divisoes)
 * @param italico run → true se o estilo de caractere é itálico
 */
export function itensConferencia({ ultima, restricoes, div, numerar, italico, base, grave, ajustes, divisivel, pedacoMinimo, relatar = RELATAR_ABERTA, espacoMinimo = null, linhasDe = null }) {
  const { linhasPorPar, hif, linhas: info, plano, folio, abert, pilhas } = ultima
  const itens = []
  const reais = (marcas, l) => l.ks.filter(k => marcas[k] && !marcas[k].fim)
  const caixa = (i, n) => {
    const l = linhasPorPar.get(i).linhas[n]
    const { fn } = info.get(i)
    const g = fn.geo
    const esq = l.direita - g.direitaCol
    return { pagina: l.pagina, x0: esq + (n === 0 ? g.recuo1 : g.esquerda), x1: l.direita, y0: l.y - fn.corpo * 1.05, y1: l.y + fn.corpo * 0.35 }
  }
  const onde = (i, n) => {
    const l = linhasPorPar.get(i).linhas[n]
    const { linha, total } = numerar(l.pagina, l.y)
    return `p. ${folio(l.pagina)}, linha ${linha}/${total}`
  }
  const dividida = (i, n, palavra) => {
    const p = div.get(`${i}:${n}`)
    return p == null ? palavra : `${palavra.slice(0, p)}-${palavra.slice(p)}`
  }
  const novo = (tipo, i, ns, titulo, justificativa) => {
    const l = linhasPorPar.get(i).linhas[ns[0]]
    itens.push({ tipo, pagina: l.pagina, y: l.y, marcas: ns.map(n => caixa(i, n)), titulo, texto: `${onde(i, ns[0])} — ${titulo}. ${justificativa}` })
  }

  // a palavra que desceu inteira para a linha seguinte: por que não foi dividida no fim da linha
  const motivoPalavra = (i, k, sobra) => {
    const { marcas, runs } = info.get(i)
    const rs = restricoes.get(i) || {}
    const w = marcas[k].palavra
    const livre = (rs.compostasLivres || []).includes(k)
    const letras = w.replace(/[^\p{L}]/gu, '')
    const nao = m => `A palavra que desceu para a linha seguinte não pôde ser dividida: ${m}`
    if (w.includes(NBSP)) return nao(`“${w.replace(new RegExp(NBSP, 'g'), ' ')}” é um bloco unido por espaço sem quebra e não pode ser separado`)
    if ((w.match(/\p{Lu}/gu) || []).length >= 2) return nao(`“${w}” é sigla (não se hifeniza)`)
    if ((marcas[k].italico ?? italico(runs[marcas[k].run])) && !livre) return nao(`“${w}” está em itálico de estilo de caractere (não se hifeniza)`)
    if ((rs.semHifen || []).includes(k)) return nao(`“${w}” foi protegida: hifenizada, cairia no fim de página ímpar`)
    if (COMPOSTA.test(w) && !livre) return nao(`“${w}” é palavra composta e só se divide no hífen próprio ou com 4 letras ou mais entre a divisão e o hífen, o que não cabia na linha`)
    if (prefixoDe(w) && !livre) return nao(`“${w}” só quebra logo depois do prefixo, que não cabia na linha`)
    const minimo = (rs.seisLetras || []).includes(k) ? 6 : 7
    if (letras.length < minimo) return nao(`“${w}” tem menos de ${minimo} letras (não se hifeniza${minimo === 6 ? ', nem com a exceção do espaçamento acima de 190%' : ''})`)
    // sem motivo de regra: testado (divisivel) se a palavra tem ponto de divisão permitido; e se o
    // menor pedaço que as regras permitem cabia no que sobrava da linha
    const pedaco = pedacoMinimo?.(i, k)
    if (divisivel?.(i, k) === true && pedaco?.largura > sobra) {
      const regras = []
      const pre = prefixoDe(w)
      if (pre) regras.push(`não se divide dentro do prefixo “${pre}”`)
      if (/[aeiouáéíóúâêôãõà][aeiouáéíóúâêôãõà]/i.test(pedaco.texto.slice(0, -1) + w.slice(pedaco.texto.length - 1, pedaco.texto.length + 1))) regras.push('não se separam vogais')
      return `A palavra que desceu para a linha seguinte, “${w}”, só podia ser dividida a partir de “${pedaco.texto}”` +
        `${regras.length ? ` (${regras.join('; ')})` : ''}: esse pedaço tem ${Math.round(pedaco.largura)} pt e sobravam ${Math.round(sobra)} pt na linha`
    }
    if (divisivel?.(i, k) === true) {
      return `A palavra que desceu para a linha seguinte, “${w}”, pode ser dividida e sobravam ${Math.round(sobra)} pt na linha, ` +
        `mas o compositor a levou inteira: com o custo de hifenização do parágrafo em ${rs.hc ?? base}%, preferiu a linha aberta à divisão`
    }
    return nao(`“${w}” não tem ponto de divisão permitido (vogais seguidas, fragmentos proibidos, sílabas)`)
  }
  const tentativas = i => {
    const rs = restricoes.get(i) || {}
    const pl = plano[i] || {}
    const t = []
    const tr = Math.round((pl.tr ?? 0) * 1000), sp = pl.sp ?? 100
    if (tr || sp !== 100) t.push(`o parágrafo está ${tr < 0 || sp < 100 ? 'apertado' : 'aberto'} (tracking ${tr}, espaço entre palavras ${sp}%)`)
    if (rs.restaurado) t.push(`as correções seguintes (aperto, abertura, hifenização) deixaram o parágrafo pior (até ${pct(rs.restaurado.depois)}); ficou a composição da rodada ${rs.restaurado.rodada}, a melhor`)
    if (rs.semAperto) t.push(`apertar até o limite (tracking ${Math.round(ajustes[ajustes.length - 1][0] * 1000)}, espaço ${ajustes[ajustes.length - 1][1]}%) não resolveu`)
    if (rs.hc && rs.hc < base) t.push(`a hifenização foi facilitada no parágrafo (custo ${rs.hc}%, padrão ${base}%)`)
    if (rs.naoBaixar) t.push(`facilitar mais a hifenização criava 3 hífens seguidos, por isso o custo ficou em ${rs.hc ?? base}%`)
    if ((rs.compostasLivres || []).length) t.push('palavras compostas ou com prefixo foram liberadas para hifenizar')
    return t
  }

  // 1. linhas abertas demais
  for (const [i, a] of abert || []) {
    if (!a.detalhes?.length || !linhasPorPar.has(i)) continue
    const { linhas } = linhasPorPar.get(i)
    const { marcas } = info.get(i)
    for (const { n, razao, sobra } of a.detalhes) {
      // a correção começa em `grave`; o comentário, só a partir de `relatar` (usuário: abaixo de 180% não precisa)
      if (razao < relatar) continue
      const partes = [`O espaço entre palavras ficou em ${pct(razao)} do normal (a correção começa em ${pct(grave)})`]
      const prox = linhas[n + 1]
      if (prox?.inteira) {
        const k = reais(marcas, prox)[0]
        if (k != null) partes.push(motivoPalavra(i, k, sobra || 0))
      } else if (prox) {
        partes.push('A linha seguinte começa com o resto de uma palavra hifenizada: não havia ponto de divisão melhor')
      }
      const t = tentativas(i)
      partes.push(t.length ? `Tentativas: ${t.join('; ')}` : 'Não houve tentativa possível sem passar dos limites de espaçamento')
      novo('aberta', i, [n], 'Espaçamento aberto', partes.join('. ') + '.')
    }
  }

  // 2. palavras empilhadas que ficaram
  for (const [i, lista] of pilhas || []) {
    if (!linhasPorPar.has(i)) continue
    const rs = restricoes.get(i) || {}
    for (const p of lista) {
      const motivo = rs.pilhaMotivo
        || (rs.pilha ? 'a solução aplicada não desfez a pilha'
          : 'a pilha apareceu depois das tentativas (outras correções mudaram o parágrafo nas últimas rodadas)')
      const ponta = p.ponta === 'ini' ? 'no começo' : 'no fim'
      novo('pilha', i, p.linhas, `Palavras empilhadas: “${p.texto}” ${ponta} de ${p.linhas.length} linhas`, `Não resolvida: ${motivo}.`)
    }
  }

  // 3. hifenizações problemáticas
  for (const [i, h] of hif) {
    if (!linhasPorPar.has(i)) continue
    const { linhas } = linhasPorPar.get(i)
    const { marcas } = info.get(i)
    const rs = restricoes.get(i) || {}
    h.hifens.forEach((sim, n) => {
      if (!sim) return
      const k = reais(marcas, linhas[n]).at(-1)
      if (k == null) return
      const w = marcas[k].palavra
      if ((rs.compostasLivres || []).includes(k)) {
        // composta dividida com 4 letras ou mais até o hífen próprio: divisão comum, sem comentário
        const pd = div.get(`${i}:${n}`)
        if (COMPOSTA.test(w) && pd != null && pontoBomComposta(w, pd)) return
        const tipo = COMPOSTA.test(w) ? 'palavra composta dividida fora do hífen próprio' : 'palavra com prefixo dividida fora do ponto depois do prefixo'
        novo('hifen', i, [n], `Hifenização: “${dividida(i, n, w)}”`,
          `É ${tipo}: inteira, ela deixava a linha anterior com espaçamento aberto demais, e apertar o parágrafo até o limite não resolveu.`)
      }
    })
  }

  // 4. linhas com o espaço entre palavras no mínimo permitido (usuário, 2026-11-07: para conferir se
  // o limite está bem configurado) — um comentário por parágrafo, com todas as linhas dele
  if (espacoMinimo && linhasDe) {
    for (const [i, { linhas }] of linhasPorPar) {
      const ls = linhasDe(i)
      if (!ls || ls.length !== linhas.length || semConferenciaDe(info.get(i))) continue
      // o piso do parágrafo: o mínimo do estilo, nunca abaixo do absoluto (ESPACO_MINIMO)
      const piso = Math.max(espacoMinimo, (info.get(i)?.fn?.geo?.espMin ?? 0) / 100)
      const ns = []
      ls.forEach((l, n) => { if (l.justificada && l.espaco <= piso + 0.005) ns.push(n) })
      if (!ns.length) continue
      const pl = plano[i] || {}
      const tr = Math.round((pl.tr ?? 0) * 1000), sp = pl.sp ?? 100
      const desc = ns.map(n => `linha ${n + 1}: ${pct(ls[n].espaco)}`).join('; ')
      novo('minimo', i, ns, `Espaço mínimo (${pct(piso)})`,
        `${ns.length === 1 ? 'Linha' : 'Linhas'} no espaço mínimo entre palavras — ${desc}. Parágrafo com tracking ${tr} e espaço ${sp}%.`)
    }
  }

  itens.sort((a, b) => a.pagina - b.pagina || a.y - b.y)
  itens.forEach((it, n) => { it.n = n + 1 })
  return itens
}

// cores das anotações (RGB 0–1): amarelo = espaçamento aberto, laranja = palavras empilhadas,
// azul = hifenização, verde = espaço mínimo
const CORES = { aberta: [1, 0.84, 0], pilha: [1, 0.54, 0], hifen: [0.31, 0.64, 1], minimo: [0.35, 0.85, 0.45] }

/**
 * Grava a conferência no PDF como comentários: uma anotação de realce por item (todas as linhas
 * dele), com a justificativa no texto do comentário — aparece no painel de comentários do leitor.
 * @param pdf Buffer do PDF composto pelo Typst; itens de itensConferencia (posições em pt, a partir
 *        do canto superior esquerdo da página)
 */
export async function anotarPdf(pdf, itens) {
  const { PDFDocument, PDFName, PDFHexString, PDFArray } = await import('pdf-lib')
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const paginas = doc.getPages()
  const agora = new Date()
  const data = `D:${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}`
  for (const it of itens) {
    const porPagina = new Map()
    for (const m of it.marcas) {
      if (!porPagina.has(m.pagina)) porPagina.set(m.pagina, [])
      porPagina.get(m.pagina).push(m)
    }
    for (const [p, marcas] of porPagina) {
      const pagina = paginas[p - 1]
      if (!pagina) continue
      const h = pagina.getHeight()
      // coordenadas do PDF: origem embaixo
      const quads = []
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const m of marcas) {
        const a = h - m.y0, b = h - m.y1
        quads.push(m.x0, a, m.x1, a, m.x0, b, m.x1, b)
        x0 = Math.min(x0, m.x0); x1 = Math.max(x1, m.x1); y0 = Math.min(y0, b); y1 = Math.max(y1, a)
      }
      const anot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Highlight',
        Rect: [x0, y0, x1, y1],
        QuadPoints: quads,
        C: CORES[it.tipo] || [1, 1, 0],
        CA: 0.6,
        F: 4,
        T: PDFHexString.fromText('Normando – conferência'),
        Subj: PDFHexString.fromText(it.titulo),
        Contents: PDFHexString.fromText(it.texto),
        M: PDFHexString.fromText(data),
      })
      const ref = doc.context.register(anot)
      const lista = pagina.node.lookup(PDFName.of('Annots'))
      if (lista instanceof PDFArray) lista.push(ref)
      else pagina.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }))
}
