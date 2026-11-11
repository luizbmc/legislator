/**
 * pilhas.js — palavras iguais empilhadas no começo ou no fim de linhas seguidas do mesmo parágrafo
 * ("de / de", "Lei / Lei"), como o script de conferência usado no InDesign.
 *
 * Conta como pilha quando as duas pontas têm:
 * - o mesmo texto (sem diferença de maiúsculas, mas com a pontuação: "(Lei" não empilha com "Lei");
 * - o mesmo estilo de caractere ("Art." em negrito não empilha com "art.");
 * - posição horizontal sobreposta (uma de fato sobre a outra);
 * contando o trecho hifenizado: "constituí-" no fim de uma linha, "dos" no começo da seguinte.
 *
 * Usa as linhas montadas por linhas.js (marcas de palavra) e o ponto de cada divisão (linhas.js,
 * pedidosDePrefixos).
 */

const TEM_PALAVRA = /[\p{L}\d]/u
const normal = t => String(t || '').replace(/­/g, '').toLocaleLowerCase('pt-BR')

/**
 * Ponto da divisão de cada linha hifenizada: Map "i:n" → nº de caracteres que ficaram na linha.
 * @param casos de pedidosDePrefixos; larguras dos começos
 */
export function divisoes(casos, larguras) {
  const out = new Map()
  for (const c of casos) {
    let p = c.opcoes.length ? c.opcoes[0].p : null
    for (const o of c.opcoes) if ((larguras.get(o.chave) ?? Infinity) <= c.comeco + 0.3) p = o.p
    if (p != null) out.set(`${c.i}:${c.n}`, p)
  }
  return out
}

/** Pontas (começo e fim) de cada linha do parágrafo: { texto, estilo, x0, x1? } ou null. */
function pontasDoParagrafo(i, { linhas, x }, { marcas, runs, fn }, div) {
  const reais = l => l.ks.filter(k => marcas[k] && !marcas[k].fim)
  const estilo = k => runs[marcas[k].run]?.char || ''
  const g = fn.geo
  return linhas.map((l, n) => {
    const ks = reais(l)
    let ini = null, fim = null
    if (n > 0 && !l.inteira) {
      // começa com o resto da palavra dividida na linha anterior
      const ant = reais(linhas[n - 1])
      const kh = ant[ant.length - 1]
      const p = div.get(`${i}:${n - 1}`)
      if (kh != null && p != null) ini = { texto: marcas[kh].palavra.slice(p), estilo: estilo(kh), x0: l.direita - g.direitaCol + g.esquerda }
    } else if (ks.length) {
      ini = { texto: marcas[ks[0]].palavra, estilo: estilo(ks[0]), x0: x.get(ks[0]), k: ks[0] }
    }
    if (ks.length) {
      const kf = ks[ks.length - 1]
      const p = div.get(`${i}:${n}`)
      if (p != null) fim = { texto: marcas[kf].palavra.slice(0, p), estilo: estilo(kf), x0: x.get(kf), x1: l.direita, k: kf }
      else if (n === linhas.length - 1 || linhas[n + 1].inteira) fim = { texto: marcas[kf].palavra, estilo: estilo(kf), x0: x.get(kf), k: kf }
    }
    return { ini, fim }
  })
}

// estilos de assinatura e data (corpo-legis:ass-nome, ass-nome-espaco-ant, ass-cf, ass-data;
// artigos:ass-autor, ass-autor-final, ass-cargo)
const ASSINATURA = /:ass-/

/**
 * Pares de linhas seguidas com o mesmo texto e estilo numa ponta (falta conferir a posição, com
 * as larguras): { pares: [{ i, n, ponta, a, b }], pedidos: Map chave → { estilo, tr, run, palavra } }.
 */
export function candidatosPilha(linhasPorPar, info, div, plano) {
  const pares = []
  const pedidos = new Map()
  const pedir = (fn, tr, estilo, palavra) => {
    const run = estilo ? { char: estilo } : null
    const chave = JSON.stringify([fn.estilo, tr, estilo || '', palavra])
    if (!pedidos.has(chave)) pedidos.set(chave, { estilo: fn.estilo, tr, run, palavra })
    return chave
  }
  for (const [i, lp] of linhasPorPar) {
    const inf = info.get(i)
    if (!inf) continue
    // assinaturas e datas ficam fora da checagem (usuário): nomes repetidos são da lista, não da composição
    if (ASSINATURA.test(inf.fn.estilo || '')) continue
    const tr = plano[i]?.tr ?? 0
    const pontas = pontasDoParagrafo(i, lp, inf, div)
    for (let n = 0; n + 1 < pontas.length; n++) {
      for (const ponta of ['ini', 'fim']) {
        const a = pontas[n][ponta], b = pontas[n + 1][ponta]
        if (!a || !b || !TEM_PALAVRA.test(a.texto)) continue
        if (normal(a.texto) !== normal(b.texto) || a.estilo !== b.estilo) continue
        a.chave = pedir(inf.fn, tr, a.estilo, a.texto)
        b.chave = pedir(inf.fn, tr, b.estilo, b.texto)
        pares.push({ i, n, ponta, a, b })
      }
    }
  }
  return { pares, pedidos }
}

/**
 * Pilhas confirmadas (sobreposição horizontal): Map i → [{ ponta, linhas: [n…], texto, ks }].
 * Duas pontas empilham quando a parte comum passa de 1/4 da menor delas.
 */
export function pilhasConfirmadas(pares, larguras) {
  const ok = pares.filter(({ a, b }) => {
    const wa = a.x1 != null ? a.x1 - a.x0 : larguras.get(a.chave) ?? 0
    const wb = b.x1 != null ? b.x1 - b.x0 : larguras.get(b.chave) ?? 0
    if (!(wa > 0 && wb > 0) || a.x0 == null || b.x0 == null) return false
    const comum = Math.min(a.x0 + wa, b.x0 + wb) - Math.max(a.x0, b.x0)
    return comum > 0.25 * Math.min(wa, wb)
  })
  const out = new Map()
  for (const p of ok) {
    if (!out.has(p.i)) out.set(p.i, [])
    const lista = out.get(p.i)
    const u = lista.find(s => s.ponta === p.ponta && s.linhas[s.linhas.length - 1] === p.n)
    if (u) { u.linhas.push(p.n + 1); if (p.b.k != null) u.ks.push(p.b.k) }
    else lista.push({ ponta: p.ponta, linhas: [p.n, p.n + 1], texto: p.a.texto, ks: [p.a.k, p.b.k].filter(k => k != null) })
  }
  return out
}
