/**
 * paginacao.js — plano de paginação do miolo do PDF de revisão.
 *
 * A partir da medição de cada parágrafo (linhas, entrelinha, linhas sem hifenização e as versões
 * apertada e solta), escolhe onde termina cada página — com programação dinâmica sobre o livro
 * inteiro, como o diagramador que "volta atrás" para ganhar ou perder linhas — e, em cada página:
 *   • o fator de entrelinha e de espaço entre parágrafos (±10%);
 *   • até 2 parágrafos apertados (perdem uma linha) ou soltos (ganham uma), com tracking e espaço
 *     entre palavras dentro dos limites do ajuste fino.
 * Regras:
 *   • a página termina cheia, ou com buraco pequeno (até ~2 linhas) no meio da norma, desde que o
 *     espelho fique equilibrado: a última linha da página par e a da ímpar não diferem mais que
 *     1,5 linha. Fim de norma, início de epígrafe e abertura de seção podem deixar buraco maior e
 *     desequilibrar o espelho;
 *   • parágrafo dividido: no mínimo 2 linhas em cada página;
 *   • sem quebra entre parágrafos presos (abertura da norma, títulos, parágrafo que termina com ":",
 *     último artigo + data + assinaturas);
 *   • sem hifenização na última linha de página ímpar (parágrafo dividido ali vai sem hifenização).
 * Entre as soluções possíveis, a de menor custo (CUSTO): é o que escolhe, por exemplo, entre
 * soltar as páginas anteriores para levar um capítulo à página seguinte ou apertá-las para trazer
 * as linhas do artigo para a página do capítulo.
 *
 * Modelo (como o quadro do InDesign, mancha.js): a 1ª linha da página ocupa a ascendente do estilo
 * (fixa: não muda com a entrelinha da página); cada linha seguinte, a entrelinha; o espaço antes do
 * parágrafo some no alto da página ("weak" no Typst).
 */

import { alturaMancha, formato, NOTAS } from './mancha.js'

let ALTURA                               // mancha, com folga para arredondamento
const MIN = 0.9, MAX = 1.1               // ±10% de entrelinha e espaço entre parágrafos
let LINHA                                // linha de referência (texto-lei)
// espaço entre o texto e a 1ª nota, um por página; cada nota soma a sua altura e o espaço entre notas
const FILETE_NOTAS = NOTAS.espacador - NOTAS.entre
let ESPELHO                              // diferença máxima entre a última linha da par e a da ímpar
let BURACO_PEQUENO                       // buraco aceitável no meio da norma
const MAX_AJUSTES = 2                    // parágrafos apertados ou soltos por página
const CUSTO = {
  desvio: 1000,             // × (f − 1)²: 5% custa 2,5; 10% custa 10
  ajuste: p => 1 + 0.6 * p, // apertar/soltar um parágrafo, pelo passo (0 = mais leve)
  buracoPequeno: 1.5,       // por linha, até 2 linhas, no meio da norma
  buracoGrande: 30,         // por linha, no meio da norma
  buracoExcecao: 0.3,       // por linha, em fim de norma / início de epígrafe / abertura
  espelho: 60,              // espelho com diferença maior que 1,5 linha
  semHifen: 1,
  paginaBranca: 5,
  // a página começa com o último trecho de um artigo, de uma linha só, e o artigo terminou na página
  // anterior: melhor trazer a linha para trás ou levar 2 linhas do artigo para a frente
  linhaSoltaArtigo: 40,
}

/**
 * @param itens   itens do miolo (itensParaPaginacao)
 * @param medidas { [i]: { h, hn, tr, sp, notas, tabela, menos, mais } } — saída do modo 'medir'
 * @param paridadeInicial 1 = o miolo começa em página ímpar
 * @param opcoes.semHifenImpar false = não desligar a hifenização do parágrafo que cruza o fim de página ímpar
 * @param opcoes.quebrasProibidas Map i → Set de k: o parágrafo i não pode terminar a página depois da
 *        linha k (verificação da composição: hífen no fim de página ímpar)
 */
export function planejarPaginas(itens, medidas, paridadeInicial = 1, { semHifenImpar = true, quebrasProibidas = null, manual = null, inicio = null, alvo = null } = {}) {
  ALTURA = alturaMancha() - 0.4
  LINHA = formato.linha
  ESPELHO = 1.5 * LINHA
  BURACO_PEQUENO = 2 * LINHA
  // ajustes locais (ajustesLocais.js): fins de página forçados e proibidos (Map i → Set linha; linha
  // 0 = antes do parágrafo) e entrelinha da página que começa num ponto (Map 'i|linha' → fator)
  const finsManuais = manual?.fins || new Map(), proibidosManuais = manual?.proibidos || new Map()
  const entrelinhasManuais = manual?.entrelinhas || new Map()
  // ── unidades ──────────────────────────────────────────────────
  const U = itens.map(it => {
    const m = medidas[it.i] || {}
    if (it.tipo === 'tabela' || m.tabela) return { it, tabela: true, h: m.h || 0, n: [1, 1], L: m.h || 1, resto: [0, 0], espaco: 0, notas: 0 }
    const L = it.L
    const linhas = h => Math.max(1, Math.round((h + 0.01) / L - 0.05))
    const n0 = linhas(m.h ?? L), n1 = linhas(m.hn ?? m.h ?? L)
    const resto = [Math.max(0, (m.h ?? L) - n0 * L), Math.max(0, (m.hn ?? m.h ?? L) - n1 * L)]
    // altura das notas (sem o filete, que conta uma vez por página: FILETE_NOTAS)
    const notas = (m.notas || []).reduce((s, x) => s + x + NOTAS.entre, 0)
    // linha da chamada de cada nota (parágrafos do compositor): dividido o parágrafo, cada nota vai
    // para a página da sua linha, como no Typst; sem ela, as notas contam na primeira página
    const notasL = m.notas?.length && m.notasLinha?.length === m.notas.length ? m.notas.map((x, q) => ({ h: x + NOTAS.entre, l: m.notasLinha[q] })) : null
    const variante = (v, d) => v && linhas(v.h) === n0 + d ? { tr: v.tr, sp: v.sp, custo: CUSTO.ajuste(v.passo) } : null
    return {
      it, L, asc: it.fn?.asc ?? L, n: [n0, n1], resto, espaco: it.espaco || 0, notas, notasL, tr: m.tr ?? 0, sp: m.sp ?? 1,
      menos: variante(m.menos, -1), mais: variante(m.mais, +1),
      proibidas: new Set([...(quebrasProibidas?.get(it.i) || []), ...(proibidosManuais.get(it.i) || [])]),
      fins: finsManuais.get(it.i) || null,
    }
  })
  U.forEach(u => { u.sticky = !!u.it.sticky || (u.it.manter2 && u.n[0] < 2) })
  // altura das notas do parágrafo cujas chamadas estão nas linhas [a, b) (sem o filete)
  const notasEntre = (u, a, b) => {
    if (!u.notasL) return a === 0 ? u.notas : 0
    return u.notasL.filter(x => x.l >= a && x.l < b).reduce((s, x) => s + x.h, 0)
  }
  const N = U.length
  let fimPlano = N
  for (let j = 0; j < N; j++) if (U[j].tabela && U[j].h > ALTURA) { fimPlano = j; break }

  // ── programação dinâmica ──────────────────────────────────────
  // estado = início de página: (j, k) item/linha, v e phi do item dividido, paridade e, numa página
  // ímpar, o buraco da página par do mesmo espelho (esq; 'x' = sem regra de espelho)
  const estados = new Map()
  const chave = (j, k, v, phi, par, esq) => `${j}|${k}|${v}|${Math.round(phi * 400)}|${par}|${esq === 'x' ? 'x' : Math.round(esq / (LINHA / 4))}`
  const fila = [], porPosicao = new Map()
  const inserir = pk => {
    let a = 0, b = fila.length
    while (a < b) { const m = (a + b) >> 1; if (fila[m] < pk) a = m + 1; else b = m }
    fila.splice(a, 0, pk)
  }
  const registrar = (st) => {
    const c = chave(st.j, st.k, st.v, st.phi, st.par, st.esq)
    const atual = estados.get(c)
    if (atual && atual.custo <= st.custo) return
    estados.set(c, st)
    const pk = st.j * 100000 + st.k
    if (!porPosicao.has(pk)) { porPosicao.set(pk, new Set()); inserir(pk) }
    porPosicao.get(pk).add(c)
  }
  // inicio: replanejar a partir de uma página (tela de paginação), com as anteriores fixas —
  // { j, k, v, phi, par, esq } do começo dessa página no plano anterior
  registrar(inicio ? { ...inicio, custo: 0, de: null, pagina: null }
    : { j: 0, k: 0, v: 0, phi: 1, par: paridadeInicial, esq: 'x', custo: 0, de: null, pagina: null })

  let melhorFim = null
  while (fila.length) {
    const pk = fila.shift()
    for (const c of porPosicao.get(pk)) {
      const s = estados.get(c)
      // alvo (janela da tela de paginação): a solução tem de chegar exatamente ao começo de página
      // { j, k, par } do plano anterior; posições além dele não interessam
      if (alvo) {
        if (s.j === alvo.j && s.k === alvo.k) { if (s.par === alvo.par && (!melhorFim || s.custo < melhorFim.custo)) melhorFim = s; continue }
        if (s.j > alvo.j || (s.j === alvo.j && s.k > alvo.k)) continue
      }
      if (s.j >= fimPlano) { if (!melhorFim || s.custo < melhorFim.custo) melhorFim = s; continue }
      expandir(s)
    }
  }

  function expandir(s) {
    let { j, k, v, phi, par, esq } = s
    let extra = 0
    // entrelinha fixada pelo usuário para a página que começa aqui
    const fManual = j < N ? entrelinhasManuais.get(`${U[j].it.i}|${k}`) ?? null : null
    if (k === 0 && U[j].it.quebra === 'odd' && par === 0) { par = 1; esq = 'x'; extra = CUSTO.paginaBranca }
    let fixo = 0, variavel = 0
    let primeiro = true
    // notas de rodapé: o filete conta uma vez por página (filete: a página já tem nota)
    let filete = false
    const comFilete = h => h > 0 && !filete ? h + FILETE_NOTAS : h
    const somarNotas = h => { if (h > 0) { fixo += comFilete(h); filete = true } }
    // os 2 parágrafos mais baratos de apertar e de soltar entre os inteiros desta página
    const apertos = [], solturas = []
    const guardar = (lista, x) => {
      lista.push(x); lista.sort((a, b) => a.custo - b.custo)
      if (lista.length > MAX_AJUSTES) lista.length = MAX_AJUSTES
    }

    // a página seguinte começaria (no começo do item j2) com o último trecho de um artigo, de uma
    // linha, logo depois de o artigo terminar nesta página
    const linhaSoltaArtigo = j2 => {
      const u = U[j2], antes = U[j2 - 1], depois = U[j2 + 1]
      if (!u || !antes || u.tabela || antes.tabela || !u.it.trechoArtigo || u.n[0] !== 1) return false
      if (!(antes.it.artigo || antes.it.trechoArtigo)) return false
      return !depois || depois.tabela || !depois.it.trechoArtigo
    }
    // usuario: fim de página pedido na tela (pode deixar buraco, sem custo)
    const fim = (j2, k2, v2, forcado, usuario = false) => {
      const sobra = ALTURA - fixo
      if (sobra < -0.01) return false
      const meio = k2 > 0
      const excecao = forcado || j2 >= N || (!meio && U[j2]?.it.inicioNorma)
      // opções: sem ajuste; apertar 1–2; soltar 1–2 (cada um muda a página em uma linha)
      const opcoes = [{ d: 0, custo: 0, quais: [] }]
      let acc = 0, ca = 0
      apertos.forEach((a, n) => { acc += a.ganho; ca += a.custo; opcoes.push({ d: -acc, custo: ca, quais: apertos.slice(0, n + 1).map(x => [x.j, 'menos']) }) })
      acc = 0; ca = 0
      solturas.forEach((a, n) => { acc += a.ganho; ca += a.custo; opcoes.push({ d: acc, custo: ca, quais: solturas.slice(0, n + 1).map(x => [x.j, 'mais']) }) })

      let melhor = null
      for (const op of opcoes) {
        const V = variavel + op.d
        if (V <= 0 && sobra > 0.5 && meio) continue
        const ideal = V > 0 ? sobra / V : Infinity
        const tentar = (f, buraco, custoBuraco) => {
          let custo = CUSTO.desvio * (f - 1) ** 2 + op.custo + custoBuraco
          // espelho: página ímpar comparada com a par do mesmo espelho
          if (par === 1 && esq !== 'x' && !excecao && Math.abs(buraco - esq) > ESPELHO) custo += CUSTO.espelho
          if (!melhor || custo < melhor.custo) melhor = { f, buraco, custo, op }
        }
        if (fManual != null) {
          // entrelinha do usuário: a página fica com ela, cheia ou com o buraco que sobrar
          const b = sobra - V * fManual
          if (b >= -0.5) tentar(fManual, Math.max(0, b), excecao || b < LINHA / 2 ? 0 : CUSTO.buracoGrande * b / LINHA)
          continue
        }
        if (ideal >= MIN && ideal <= MAX) tentar(ideal, 0, 0)                 // página cheia
        // fim pedido pelo usuário antes de um parágrafo: vale também com buraco, com o custo de um
        // buraco comum — a página prefere encher com a entrelinha, como o diagramador faria (no meio do
        // parágrafo a página tem de encher: o Typst não quebra a página dentro do parágrafo)
        if (usuario && !meio && V <= sobra + 0.01) { const b = Math.max(0, sobra - V); tentar(1, b, (b <= BURACO_PEQUENO + 0.5 ? CUSTO.buracoPequeno : CUSTO.buracoGrande) * b / LINHA) }
        if (meio) continue                                                    // dividido: tem de encher
        if (V <= sobra + 0.01) {
          // termina com buraco (só entre parágrafos): com 100% e, se o buraco for grande, esticada
          const custoDe = b => excecao ? CUSTO.buracoExcecao * b / LINHA
            : b <= BURACO_PEQUENO + 0.5 ? CUSTO.buracoPequeno * b / LINHA : CUSTO.buracoGrande * b / LINHA
          const b1 = sobra - V
          if (b1 > 0.5) tentar(1, b1, custoDe(b1))
          if (ideal > MAX) { const b2 = sobra - V * MAX; tentar(MAX, b2, custoDe(b2)) }
        } else if (forcado && ideal >= MIN && ideal < 1) {
          tentar(ideal, 0, 0)
        }
      }
      if (!melhor) return false
      let custo = s.custo + extra + melhor.custo + (meio && v2 === 1 ? CUSTO.semHifen : 0) +
        (k2 === 0 && linhaSoltaArtigo(j2) ? CUSTO.linhaSoltaArtigo : 0)
      const pagina = { de: [j, k], ate: [j2, k2], f: melhor.f, phi, v, v2, par, branca: extra > 0,
        buraco: melhor.buraco, forcado: !!forcado, excecao: !!excecao, ajustes: melhor.op.quais }
      // próxima página: se esta é par, a ímpar seguinte compara com o buraco desta
      const esqProx = par === 0 ? (excecao ? 'x' : melhor.buraco) : 'x'
      registrar({ j: j2, k: k2, v: v2, phi: meio ? melhor.f : 1, par: 1 - par, esq: esqProx, custo, de: s, pagina })
      return true
    }

    let m = j
    if (k > 0) {
      const u = U[j]
      const nTotal = u.n[v]
      const resta = nTotal - k
      // 1ª linha no alto da página: a ascendente; as outras, a entrelinha
      const topo = u.asc - u.L * phi
      const cabe = Math.floor((ALTURA - topo + 0.01) / (u.L * phi))
      // fim de página pedido pelo usuário no resto do parágrafo
      const kf = Math.min(...[...(u.fins || [])].filter(x => x > k && x < nTotal), Infinity)
      if (kf !== Infinity && kf - k <= cabe) {
        const salvo = fixo
        fixo += topo + (kf - k) * u.L * phi + comFilete(notasEntre(u, k, kf))
        if (fim(j, kf, v, false, true)) return
        fixo = salvo
      }
      if (resta > cabe) {
        const k2 = k + cabe
        if (nTotal - k2 >= 2) registrar({ j, k: k2, v, phi, par: 1 - par, esq: 'x', custo: s.custo + extra, de: s,
          pagina: { de: [j, k], ate: [j, k2], f: phi, phi, v, v2: v, par, buraco: 0, ajustes: [] } })
        return
      }
      fixo += topo + resta * u.L * phi
      somarNotas(notasEntre(u, k, Infinity))
      primeiro = false
      m = j + 1
    }

    for (; m <= Math.min(N, fimPlano); m++) {
      if (m === fimPlano || m === N) { fim(m, 0, 0, true); return }
      const u = U[m]
      // fim de página pedido pelo usuário antes deste parágrafo
      if (!primeiro && u.fins?.has(0) && fim(m, 0, 0, false, true)) return
      if (!primeiro && u.it.quebra) { fim(m, 0, 0, true); return }
      // bolso: a epígrafe só começa na página se sobra pelo menos metade da mancha; senão, vai para a
      // próxima (regra do usuário, 2026-11-11) — o espaço que sobra conta com a entrelinha normal
      if (!primeiro && formato.epigrafeMetade && u.it.inicioNorma && ALTURA - (fixo + variavel) < ALTURA / 2) { fim(m, 0, 0, true); return }
      if (!primeiro && !U[m - 1].sticky && !u.proibidas?.has(0)) fim(m, 0, 0, false)
      const esp = primeiro ? 0 : u.espaco
      if (primeiro && !u.tabela) { variavel -= u.L; fixo += u.asc }
      if (u.tabela) {
        if (fixo + variavel * MIN + u.h > ALTURA) return
        fixo += u.h
      } else {
        // fim de página pedido pelo usuário dentro deste parágrafo (depois da linha kf)
        const kf = Math.min(...[...(u.fins || [])].filter(x => x > 0 && x < u.n[0]), Infinity)
        if (kf !== Infinity && fixo + (variavel + esp + kf * u.L) * MIN <= ALTURA + 0.01) {
          const salvos = [variavel, fixo]
          variavel += esp + kf * u.L
          fixo += comFilete(notasEntre(u, 0, kf))
          if (fim(m, kf, 0, false, true)) return
          ;[variavel, fixo] = salvos
        }
        if (!u.it.inteiro) {
          // página ímpar: parágrafo dividido sem hifenização — a menos que a verificação da
          // composição (linhas.js) cuide da regra, protegendo só a palavra do fim da página
          for (const v2 of par === 1 && semHifenImpar ? [1] : [0]) {
            const nT = u.n[v2]
            for (let k2 = 2; k2 <= nT - 2; k2++) {
              const alt = esp + k2 * u.L + u.resto[v2]
              if (fixo + (variavel + alt) * MIN > ALTURA) break
              if (u.proibidas?.has(k2)) continue
              const salva = variavel
              variavel += alt
              const nk = comFilete(notasEntre(u, 0, k2))
              fixo += nk
              fim(m, k2, v2, false)
              fixo -= nk
              variavel = salva
            }
          }
        }
        variavel += esp + u.n[0] * u.L + u.resto[0]
        somarNotas(u.notas)
        // fim de página pedido pelo usuário logo depois deste parágrafo (linha = nº de linhas ou mais)
        const kFim = [...(u.fins || [])].find(x => x >= u.n[0])
        if (kFim != null && fim(m + 1, 0, 0, false, true)) return
        if (u.menos) guardar(apertos, { j: m, ganho: u.L, custo: u.menos.custo })
        if (u.mais) guardar(solturas, { j: m, ganho: u.L, custo: u.mais.custo })
      }
      primeiro = false
      // com 2 parágrafos apertados a página ainda cabe mais
      const folga = apertos.reduce((a, x) => a + x.ganho, 0)
      if (fixo + (variavel - folga) * MIN > ALTURA) return
    }
  }

  // ── reconstrução ──────────────────────────────────────────────
  const paginas = []
  for (let s = melhorFim; s && s.pagina; s = s.de) paginas.unshift(s.pagina)
  const plano = {}
  for (const u of U) plano[u.it.i] = { tr: u.tr, sp: Math.round(u.sp * 1000) / 10, lf: 1, cola: u.sticky && !u.it.estiloSticky ? true : u.it.cola }
  let apertados = 0, soltos = 0
  for (const pg of paginas) {
    const [j0, k0] = pg.de, [j1, k1] = pg.ate
    for (let j = k0 > 0 ? j0 + 1 : j0; j < Math.min(j1 + (k1 > 0 ? 1 : 0), N); j++) {
      const p = plano[U[j].it.i]
      p.lf = Math.round(pg.f * 10000) / 10000
      p.fatorEspaco = p.lf
    }
    for (const [j, tipo] of pg.ajustes || []) {
      const var_ = U[j][tipo]
      Object.assign(plano[U[j].it.i], { tr: var_.tr, sp: Math.round(var_.sp * 1000) / 10 })
      if (tipo === 'menos') apertados++; else soltos++
    }
    if (k1 === 0 && j1 < N && !U[j1].it.quebra) plano[U[j1].it.i].quebraAntes = true
    if (k1 > 0 && pg.v2 === 1) plano[U[j1].it.i].hy = false
  }

  // ajustes do usuário cumpridos na solução: fins de página pedidos que viraram fim de página
  const fimEm = new Set(paginas.map(pg => { const [j1, k1] = pg.ate; return j1 < N ? `${U[j1].it.i}|${k1}` : 'fim' }))
  const manuais = []
  U.forEach((u, j) => {
    for (const k of u.fins || []) {
      const alvo = k > 0 && k >= u.n[0] ? (j + 1 < N ? `${U[j + 1].it.i}|0` : 'fim') : `${u.it.i}|${k}`
      manuais.push({ i: u.it.i, linha: k, cumprido: fimEm.has(alvo) })
    }
  })

  const fatores = paginas.map(p => p.f)
  return {
    plano,
    paginas,
    finsManuais: manuais,
    resumo: {
      paginas: paginas.length,
      custo: melhorFim ? Math.round(melhorFim.custo * 10) / 10 : null,
      entrelinhaAjustada: fatores.filter(f => Math.abs(f - 1) > 0.001).length,
      maiorReducao: Math.round((1 - Math.min(1, ...fatores)) * 1000) / 10,
      maiorAmpliacao: Math.round((Math.max(1, ...fatores) - 1) * 1000) / 10,
      paragrafosApertados: apertados,
      paragrafosSoltos: soltos,
      buracos: paginas.filter(p => p.buraco > LINHA / 2).length,
      semHifenizacao: Object.values(plano).filter(p => p.hy === false).length,
      // páginas que ainda começam com a última linha de um artigo sozinha (sem saída melhor)
      linhasSoltasArtigo: paginas.filter(pg => {
        const [j, k] = pg.de
        const u = U[j], antes = U[j - 1], depois = U[j + 1]
        return k === 0 && u && antes && !u.tabela && !antes.tabela && u.it.trechoArtigo && u.n[0] === 1 &&
          (antes.it.artigo || antes.it.trechoArtigo) && (!depois || depois.tabela || !depois.it.trechoArtigo)
      }).length,
      foraDoPlano: N - fimPlano,
      finsPedidos: manuais.length,
      finsCumpridos: manuais.filter(x => x.cumprido).length,
    },
  }
}
