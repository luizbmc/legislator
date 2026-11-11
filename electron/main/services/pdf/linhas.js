/**
 * linhas.js — verificação da composição do PDF de revisão.
 *
 * O Typst não informa onde quebrou as linhas nem quanto esticou cada uma. typstLivro.js põe uma
 * marca invisível no começo de cada palavra; daqui, com a posição final das marcas:
 *
 * - as linhas de cada parágrafo. A marca da 1ª palavra de uma linha fica no fim da linha anterior,
 *   na margem direita (a quebra acontece depois dela), e passa para a linha seguinte;
 * - as palavras divididas entre duas linhas: a linha que não herda essa marca da margem direita e
 *   não começa na margem esquerda começa com o resto de uma palavra — hífen na linha anterior;
 * - a abertura de cada linha (menos a última): largura disponível menos a largura natural das
 *   palavras (medida pelo Typst; a palavra dividida por hífen entra pela parte que ficou na linha)
 *   dividida pelos espaços, em relação ao espaço normal,
 *   comparada com o limite do estilo (espaço máximo × espaço do ajuste + tracking máximo).
 *
 * Com isso exportPdf.js corrige e compõe de novo: no máximo 2 hífens seguidos (como no InDesign),
 * nenhum passo de ajuste que abra uma linha além do limite e, nas linhas abertas pela própria
 * justificação do Typst, custo de hifenização menor no parágrafo.
 */

import { AJUSTES, ABRIR, HIFENIZACAO } from './typstLivro.js'
import { prefixoDe } from '../idml/translineacao.js'
import { semConferencia } from './mancha.js'

// linha aberta demais (espaço entre palavras em relação ao normal): abaixo disso, como no InDesign,
// prefere-se a linha um pouco aberta a hifenizar
export const ABERTA = 1.7

const TOL = 1 // pt

/** Agrupa as posições ([i, k, página, x, y]) por parágrafo, em ordem de marca. */
function porParagrafo(posicoes) {
  const mapa = new Map()
  for (const [i, k, pagina, x, y] of posicoes) {
    if (!mapa.has(i)) mapa.set(i, [])
    mapa.get(i).push({ k, pagina, x, y })
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.k - b.k)
  return mapa
}

/** O parágrafo começa pela 1ª palavra marcada (sem nota ou trecho sem marca antes)? */
function comecaComMarca({ marcas, runs }) {
  if (!marcas.length) return false
  const primeiroTexto = runs.findIndex(r => !r.nota && r.texto !== undefined && r.texto.trim())
  return marcas[0].run === primeiroTexto && !runs.slice(0, primeiroTexto).some(r => r.nota)
}

/**
 * Margem esquerda da coluna em cada página, pela 1ª marca de cada parágrafo (o começo do parágrafo
 * nunca muda de linha) menos o recuo da 1ª linha; mediana. Página sem começo de parágrafo: a das
 * outras páginas de mesma paridade.
 */
function margensDasPaginas(porPar, info) {
  const xs = new Map()
  for (const [i, lista] of porPar) {
    const inf = info.get(i)
    if (!inf || !lista.length || lista[0].k !== 0 || !comecaComMarca(inf)) continue
    const m0 = lista[0]
    if (!xs.has(m0.pagina)) xs.set(m0.pagina, [])
    xs.get(m0.pagina).push(m0.x - inf.fn.geo.recuo1)
  }
  const mediana = l => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const margens = new Map()
  const paridade = [[], []]
  for (const [p, l] of xs) {
    const m = mediana(l)
    margens.set(p, m)
    paridade[p % 2].push(m)
  }
  const reserva = paridade.map(l => (l.length ? mediana(l) : null))
  return p => margens.get(p) ?? reserva[p % 2] ?? reserva[1 - (p % 2)]
}

/**
 * Linhas de um parágrafo: { linhas: [{ pagina, ks (marcas das palavras que começam na linha),
 * inteira (começa com palavra inteira), direita (x da margem direita) }], x: Map marca → x }.
 */
function linhasDoParagrafo(lista, { fn, marcas }, margem) {
  const g = fn.geo
  const grupos = []
  for (const m of lista) {
    const u = grupos[grupos.length - 1]
    if (u && u.pagina === m.pagina && Math.abs(u.y - m.y) < 0.5) u.ms.push(m)
    else grupos.push({ pagina: m.pagina, y: m.y, ms: [m] })
  }
  const linhas = []
  const x = new Map()
  let herdadas = []
  for (const gr of grupos) {
    const esq = margem(gr.pagina)
    const direita = esq + g.direitaCol
    // a marca do fim do parágrafo nunca passa para a linha seguinte (não há seguinte)
    const herda = m => m.x >= direita - TOL && !marcas[m.k]?.fim
    const proximas = gr.ms.filter(herda)
    const proprias = gr.ms.filter(m => !herda(m))
    for (const m of proprias) x.set(m.k, m.x)
    // a palavra herdada começa na margem esquerda desta linha
    const recuo = linhas.length ? g.esquerda : g.recuo1
    for (const m of herdadas) x.set(m.k, esq + recuo)
    const inteira = linhas.length === 0 || herdadas.length > 0 ||
      (proprias.length > 0 && proprias[0].x <= esq + recuo + TOL)
    linhas.push({ pagina: gr.pagina, y: gr.y, ks: [...herdadas, ...proprias].map(m => m.k), inteira, direita })
    herdadas = proximas
  }
  if (herdadas.length) {
    const p = herdadas[0].pagina
    // linha só com a palavra herdada: logo abaixo da anterior (para a ordem das linhas da página)
    linhas.push({ pagina: p, y: linhas[linhas.length - 1].y + 0.001, ks: herdadas.map(m => m.k), inteira: true, direita: margem(p) + g.direitaCol })
  }
  return { linhas, x }
}

/**
 * @param posicoes [[i, k, página, x, y]] (consulta <wpos>)
 * @param info Map i → { marcas: [{ palavra, run, espaco }], runs, fn }
 * @returns Map i → { linhas, x }
 */
export function montarLinhas(posicoes, info) {
  const porPar = porParagrafo(posicoes)
  const margem = margensDasPaginas(porPar, info)
  const linhasPorPar = new Map()
  for (const [i, lista] of porPar) {
    if (info.has(i)) linhasPorPar.set(i, linhasDoParagrafo(lista, info.get(i), margem))
  }
  return linhasPorPar
}

const HIFEN_PROPRIO = /[-‐–—/]/
// palavra composta (hífen entre letras): typstLivro.js a quebra de preferência no hífen
const COMPOSTA = /\p{L}[-‐]\p{L}/u
const ultimaMarca = l => l.ks[l.ks.length - 1]
const chaveLargura = ({ estilo, tr, run, palavra }) => JSON.stringify([estilo, tr, run?.char || '', palavra])

/**
 * Palavras com hífen próprio ("nomeando-as", "pós-graduação") divididas no fim de uma linha: a
 * largura do começo até cada hífen próprio, para saber se a quebra foi nele ou se houve
 * hifenização em outro ponto ("no-meando-as").
 */
export function pedidosHifenProprio(linhasPorPar, info, plano) {
  const pedidos = new Map()
  for (const [i, { linhas }] of linhasPorPar) {
    const { marcas, runs, fn } = info.get(i)
    const tr = plano[i]?.tr ?? 0
    for (let n = 1; n < linhas.length; n++) {
      if (linhas[n].inteira) continue
      const k = ultimaMarca(linhas[n - 1])
      const palavra = marcas[k]?.palavra || ''
      for (let h = 0; h < palavra.length; h++) {
        if (!HIFEN_PROPRIO.test(palavra[h])) continue
        const pedido = { estilo: fn.estilo, tr, run: runs[marcas[k].run], palavra: palavra.slice(0, h + 1) }
        pedidos.set(chaveLargura(pedido), pedido)
      }
    }
  }
  return pedidos
}

/**
 * Hífens no fim de cada linha e as linhas a medir (todas, menos a última e as que terminam em
 * quebra forçada). Linha com hífen nas pontas também é medida: o começo da palavra dividida pela
 * posição real dela, o resto pela largura da palavra inteira menos esse começo.
 * Também a regra do fim de página ímpar: hífen na última linha de página de fólio ímpar (fimImpar:
 * { k: marca da palavra dividida, n: linha }).
 * @param folio página física → fólio
 * @returns Map i → { hifens: [bool por linha], escada, fimImpar: [k], medir: [{ ks, inteiras, primeira, resto, hifen }], linhas }
 */
export function hifenizacao(linhasPorPar, info, folio = p => p, largurasProprio = null, plano = {}) {
  const out = new Map()
  for (const [i, { linhas, x }] of linhasPorPar) {
    const { marcas } = info.get(i)
    const hifens = linhas.map(() => false)
    const ultima = l => l.ks[l.ks.length - 1]
    for (let n = 1; n < linhas.length; n++) {
      if (linhas[n].inteira) continue
      const k = ultima(linhas[n - 1])
      const palavra = marcas[k]?.palavra || ''
      if (!HIFEN_PROPRIO.test(palavra)) { hifens[n - 1] = true; continue }
      // palavra com hífen próprio: quebra nele se o pedaço da linha tem a largura do começo até ele
      // (sem as larguras, considera que sim)
      if (!largurasProprio) continue
      const { runs, fn } = info.get(i)
      const comeco = linhas[n - 1].direita - x.get(k)
      let noProprio = false
      for (let h = 0; h < palavra.length && !noProprio; h++) {
        if (!HIFEN_PROPRIO.test(palavra[h])) continue
        const w = largurasProprio.get(chaveLargura({ estilo: fn.estilo, tr: plano[i]?.tr ?? 0, run: runs[marcas[k].run], palavra: palavra.slice(0, h + 1) }))
        if (w != null && comeco <= w + 1 && comeco >= w - 3) noProprio = true
      }
      if (!noProprio) hifens[n - 1] = true
    }
    let escada = 0, seguidos = 0
    for (const h of hifens) { seguidos = h ? seguidos + 1 : 0; escada = Math.max(escada, seguidos) }
    const fimImpar = []
    for (let n = 0; n < linhas.length - 1; n++) {
      // qualquer hífen no fim da linha (hifenização ou o hífen próprio da palavra, "CG-|IBS"): a linha
      // seguinte começa no meio da palavra
      if (!linhas[n + 1].inteira && linhas[n + 1].pagina !== linhas[n].pagina && folio(linhas[n].pagina) % 2 === 1) fimImpar.push({ k: ultima(linhas[n]), n })
    }
    const medir = []
    for (let n = 0; n < linhas.length - 1; n++) {
      const l = linhas[n], prox = linhas[n + 1]
      if (!l.ks.length) continue
      const fimDividido = !prox.inteira
      // termina em quebra forçada (a 1ª marca da seguinte não vem depois de espaço comum)
      if (!fimDividido && !marcas[prox.ks[0]]?.espaco) continue
      const kFim = ultima(l)
      medir.push({
        n,
        ks: l.ks,
        // palavras inteiras na linha (a dividida no fim fica de fora)
        inteiras: fimDividido ? l.ks.slice(0, -1) : l.ks,
        primeira: n === 0,
        // começa com o resto da palavra dividida na linha anterior
        // (quebra no hífen da própria palavra, como "destina-se": o hífen já está na palavra)
        resto: l.inteira ? null : { k: ultima(linhas[n - 1]), comeco: linhas[n - 1].direita - x.get(ultima(linhas[n - 1])), hifenizada: hifens[n - 1] },
        // termina com o começo de uma palavra dividida (largura real, até a margem)
        hifen: fimDividido ? { k: kFim, comeco: l.direita - x.get(kFim) } : null,
      })
    }
    // palavra composta que abre a linha seguinte (desceu inteira): marca dela, por linha
    const compostaSeguinte = linhas.map((l, n) => {
      const prox = linhas[n + 1]
      if (!prox?.inteira) return null
      const k = prox.ks[0]
      // (ou palavra com prefixo, que também quebra de preferência num ponto só)
      return COMPOSTA.test(marcas[k]?.palavra || '') || prefixoDe(marcas[k]?.palavra) ? k : null
    })
    // 1ª palavra de cada linha (a que desce quando a linha anterior fica aberta)
    const primeiras = linhas.map(l => l.ks[0] ?? null)
    out.set(i, { hifens, escada, fimImpar, medir, compostaSeguinte, primeiras, linhas: linhas.length })
  }
  return out
}

/**
 * Pedidos de largura natural para as linhas medidas: cada palavra (no estilo do parágrafo e do
 * run, com o tracking do ajuste), o hífen e o espaço normal do estilo. Chave → { estilo, tr, run, palavra }.
 */
export function pedidosDeLargura(hif, info, plano) {
  const pedidos = new Map()
  const pedir = (estilo, tr, run, palavra) => {
    const chave = JSON.stringify([estilo, tr, run?.char || '', palavra])
    if (!pedidos.has(chave)) pedidos.set(chave, { estilo, tr, run, palavra })
    return chave
  }
  for (const [i, h] of hif) {
    if (!h.medir.length) continue
    const { marcas, runs, fn } = info.get(i)
    const tr = plano[i]?.tr ?? 0
    const palavra = k => pedir(fn.estilo, tr, runs[marcas[k].run], marcas[k].palavra)
    h.chaveEspaco = [pedir(fn.estilo, 0, null, 'x x'), pedir(fn.estilo, 0, null, 'xx')]
    h.chaveHifen = pedir(fn.estilo, tr, null, '-')
    for (const linha of h.medir) {
      linha.chaves = linha.inteiras.map(palavra)
      if (linha.resto) linha.resto.chave = palavra(linha.resto.k)
    }
  }
  return pedidos
}

/**
 * Abertura das linhas medidas, com as larguras naturais.
 * @returns Map i → { pior: razão da linha mais aberta, limite, abertas: nº de linhas além do limite }
 */
export function aberturas(hif, info, plano, larguras, { folga = 0.05, grave = ABERTA } = {}) {
  const out = new Map()
  for (const [i, h] of hif) {
    if (!h.medir.length) continue
    const { marcas, fn } = info.get(i)
    if (semConferencia(fn.estilo)) continue
    const g = fn.geo
    const sp = (plano[i]?.sp ?? 100) / 100
    const espaco = larguras.get(h.chaveEspaco[0]) - larguras.get(h.chaveEspaco[1])
    if (!(espaco > 0)) continue
    const hifen = larguras.get(h.chaveHifen) || 0
    let pior = 0, limitePior = 0, abertas = 0
    const quais = []
    const detalhes = []
    for (const linha of h.medir) {
      // espaços da linha: antes de cada palavra que começa nela, menos a 1ª (o espaço dela ficou
      // na quebra) — se a linha começa com resto de palavra, o espaço depois do resto conta
      const ks = linha.resto ? linha.ks : linha.ks.slice(1)
      const espacos = ks.filter(k => marcas[k].espaco).length
      if (espacos < 2) continue
      let natural = linha.chaves.reduce((s, c) => s + (larguras.get(c) || 0), 0)
      if (linha.hifen) natural += linha.hifen.comeco
      // o resto começa com o hífen: o da hifenização ou, na quebra no hífen próprio, o repetido
      if (linha.resto) natural += Math.max(0, (larguras.get(linha.resto.chave) || 0) + hifen - linha.resto.comeco)
      const disponivel = g.largura - (linha.primeira ? g.primeira : g.pendente)
      const razao = (disponivel - natural) / (espacos * espaco)
      // limite: espaço máximo do estilo sobre o espaço do ajuste, mais o tracking máximo da
      // justificação distribuído pelos espaços
      const letras = linha.ks.reduce((s, k) => s + marcas[k].palavra.length, 0)
      const limite = (g.espMax / 100) * sp + (g.letraMax * fn.corpo * letras) / (espacos * espaco)
      // só conta a linha aberta demais: acima do limite do estilo e da abertura grave
      if (razao > Math.max(limite + folga, grave)) { abertas++; quais.push(linha.n); detalhes.push({ n: linha.n, razao, sobra: (razao - 1) * espacos * espaco, ks: linha.ks }) }
      if (razao - limite > pior - limitePior || pior === 0) { pior = razao; limitePior = limite }
    }
    out.set(i, { pior, limite: limitePior, abertas, quais, detalhes })
  }
  return out
}

// custo de hifenização (%) do parágrafo, em níveis: o do documento é 100; linha aberta pela própria
// justificação desce um nível; mais de 2 hífens seguidos sobe um nível (e não desce mais)
const NIVEIS = [30, 50, 100, 200, 400, 800]

// tentativas de mudar a quebra de página antes de proteger a palavra (fim de página ímpar)
const QUEBRAS = 2
const nivelAcima = hc => NIVEIS.find(x => x > hc)
const nivelAbaixo = hc => [...NIVEIS].reverse().find(x => x < hc)

// aperto de parágrafo com linha aberta: índices em AJUSTES, do mais leve ao limite (−5/97%, −12/97%)
const apertos = () => [...new Set([2, 5, AJUSTES.length - 1])]

/** O passo e os maiores na mesma direção (abrir mais / apertar mais). */
function passosAPartirDe(tr, sp) {
  const lista = tr > 0 || sp > 100 ? ABRIR : AJUSTES
  const k = lista.findIndex(([t, s]) => Math.abs(t - tr) < 1e-6 && Math.abs(s - sp) < 1e-6)
  return k < 0 ? [[tr, sp]] : lista.slice(k)
}

/**
 * Decide as restrições para a próxima rodada (muda `restricoes`: Map i → { hc, proibidos, naoBaixar }).
 * - mais de 2 hífens seguidos: custo de hifenização maior no parágrafo;
 * - linha além do limite num parágrafo com ajuste de tracking/espaço: esse passo, e os maiores na
 *   mesma direção, ficam proibidos;
 * - linha além do limite sem ajuste (a própria justificação do Typst): aperta o parágrafo, como o
 *   diagramador (APERTOS); se nem o aperto máximo resolve, desiste dele.
 * Toda correção de linha aberta também baixa um nível o custo de hifenização do parágrafo.
 * - hífen no fim de página ímpar: a página não pode terminar naquela linha (até QUEBRAS vezes);
 *   depois, só aquela palavra fica sem hifenização no parágrafo.
 * Com `soEscada`, só as regras de hífen (rodadas finais: mudam pouco e convergem).
 * @returns resumo da rodada; `alterados` = parágrafos com restrição nova (a medir de novo)
 */
// acima desta abertura, as palavras da linha e a que desceu dela podem ser hifenizadas com 6 letras
// (o normal é 7 ou mais)
export const SEIS_LETRAS = 1.9

export function revisar(hif, abert, plano, restricoes, { soEscada = false, base = HIFENIZACAO } = {}) {
  const r = { linhas: 0, hifens: 0, escadas: 0, fimImpar: 0, linhasAbertas: 0, abertasAjuste: 0, apertos: 0, abertasJustificacao: 0 }
  const alterados = []
  for (const [i, h] of hif) {
    r.linhas += h.linhas
    r.hifens += h.hifens.filter(Boolean).length
    const rs = restricoes.get(i) || {}
    const pl = plano[i] || {}
    const a = abert.get(i)
    if (a) r.linhasAbertas += a.abertas
    // hífen no fim de página ímpar (proibido): como o diagramador, muda a quebra de página — a página
    // não pode terminar depois dessa linha, a paginação leva a linha para baixo ou traz a seguinte;
    // depois de QUEBRAS tentativas, a palavra dividida ali deixa de ser hifenizável
    if (h.fimImpar.length) {
      r.fimImpar++
      for (const { k, n } of h.fimImpar) {
        if ((rs.quebrasProibidas || []).length < QUEBRAS) rs.quebrasProibidas = [...new Set([...(rs.quebrasProibidas || []), n + 1])]
        else rs.semHifen = [...new Set([...(rs.semHifen || []), k])]
      }
      restricoes.set(i, rs)
      alterados.push(i)
      continue
    }
    if (h.escada > 2) {
      r.escadas++
      const acima = nivelAcima(rs.hc ?? base)
      if (!acima) continue
      rs.hc = acima
      rs.naoBaixar = true
      restricoes.set(i, rs)
      alterados.push(i)
      continue
    }
    if (soEscada || !a?.abertas) continue
    // palavra composta ou com prefixo que desceu inteira e deixou a linha aberta demais: último
    // recurso (depois do aperto), ela pode ser hifenizada em qualquer ponto — a preferência é a quebra
    // no hífen próprio ou logo depois do prefixo
    const compostas = a.quais.map(n => h.compostaSeguinte[n]).filter(k => k != null && !(rs.compostasLivres || []).includes(k))
    const liberarCompostas = () => {
      if (!compostas.length) return false
      r.compostas = (r.compostas || 0) + 1
      rs.compostasLivres = [...(rs.compostasLivres || []), ...compostas]
      return true
    }
    const tr = pl.tr ?? 0, sp = pl.sp ?? 100
    const antes = JSON.stringify(rs)
    // espaçamento acima de 190%: as palavras de 6 letras da linha e a que desceu para a seguinte
    // também podem ser hifenizadas
    for (const d of a.detalhes || []) {
      if (d.razao <= SEIS_LETRAS) continue
      const ks = [...(d.ks || []), h.primeiras?.[d.n + 1]].filter(k => k != null)
      rs.seisLetras = [...new Set([...(rs.seisLetras || []), ...ks])]
    }
    // cada correção de linha aberta também baixa um nível o custo de hifenização (a palavra que
    // resolve a linha muitas vezes só cabe hifenizada, como "com-põem"); assim converge em menos rodadas
    // (minimo: já vai ao custo mais baixo — quando nem o aperto máximo resolveu)
    const hifenizarMais = (minimo = false) => {
      const abaixo = minimo ? NIVEIS[0] : nivelAbaixo(rs.hc ?? base)
      if (pl.hy !== false && !rs.naoBaixar && abaixo && abaixo < (rs.hc ?? base)) rs.hc = abaixo
    }
    if (rs.aperto != null) {
      // o aperto não resolveu: aperta mais; no último passo, desiste do aperto (apertado, o resto do
      // parágrafo joga ainda mais folga na linha aberta) e facilita a hifenização ao máximo
      r.apertos++
      const prox = apertos().find(k => k > rs.aperto)
      if (prox != null) { rs.aperto = prox; hifenizarMais() }
      else { delete rs.aperto; rs.semAperto = true; liberarCompostas(); hifenizarMais(true) }
    } else if (tr !== 0 || sp !== 100) {
      // o passo do ajuste fino abriu a linha: fica proibido; se era de abrir, já tenta apertar
      r.abertasAjuste++
      rs.proibidos = [...(rs.proibidos || []), ...passosAPartirDe(tr, sp)]
      if ((tr > 0 || sp > 100) && !rs.semAperto) rs.aperto = apertos()[0]
      hifenizarMais()
    } else if (!rs.semAperto) {
      // como o diagramador: aperta o parágrafo (tracking e espaço, dentro dos limites do ajuste)
      r.apertos++
      rs.aperto = apertos()[0]
      hifenizarMais()
    } else if (!liberarCompostas()) {
      r.abertasJustificacao++
      hifenizarMais(true)
    }
    if (JSON.stringify(rs) !== antes) {
      restricoes.set(i, rs)
      alterados.push(i)
    }
  }
  return { ...r, alterados }
}

// ── lista de hifenizações (acompanha o PDF) ──────────────────────

const LETRA = /\p{L}/u

/**
 * Para cada palavra hifenizada, os começos possíveis (sem o hífen), para achar o ponto da divisão
 * pela largura do pedaço que ficou na linha.
 * @returns { pedidos: Map chave → { estilo, tr, run, palavra }, casos: [{ i, n, pagina, y, palavra, comeco, opcoes }] }
 */
export function pedidosDePrefixos(linhasPorPar, hif, info, plano) {
  const pedidos = new Map()
  const casos = []
  for (const [i, h] of hif) {
    const { linhas, x } = linhasPorPar.get(i)
    const { marcas, runs, fn } = info.get(i)
    const tr = plano[i]?.tr ?? 0
    h.hifens.forEach((hifenizada, n) => {
      if (!hifenizada) return
      const l = linhas[n]
      const k = l.ks[l.ks.length - 1]
      const palavra = marcas[k].palavra
      const run = runs[marcas[k].run]
      const opcoes = []
      for (let p = 1; p < palavra.length; p++) {
        if (!LETRA.test(palavra[p - 1]) || !LETRA.test(palavra[p])) continue
        const pedido = { estilo: fn.estilo, tr, run, palavra: palavra.slice(0, p) }
        const chave = JSON.stringify([fn.estilo, tr, run?.char || '', pedido.palavra])
        pedidos.set(chave, pedido)
        opcoes.push({ p, chave })
      }
      casos.push({ i, n, pagina: l.pagina, y: l.y, palavra, comeco: l.direita - x.get(k), opcoes })
    })
  }
  return { pedidos, casos }
}

/**
 * Lista das palavras hifenizadas, como "defi-ciência [p. 19, linha 14/25]": fólio e linha / total
 * de linhas do texto da página (sem notas de rodapé nem tabelas). Primeiro as que começam com
 * maiúscula, depois as compostas, depois as outras; em cada grupo, na ordem do documento.
 * @param trechos [[i, página, y]] começo de cada trecho do miolo (<pi>)
 * @param linhasNaoMarcadas i → nº de linhas de um parágrafo sem marcas (0 = tabela)
 */
export function listaHifenizacoes(casos, larguras, linhasPorPar, trechos, linhasNaoMarcadas, folio) {
  const porPagina = new Map()
  const incluir = (p, y) => {
    if (!porPagina.has(p)) porPagina.set(p, [])
    porPagina.get(p).push(y)
  }
  for (const { linhas } of linhasPorPar.values()) for (const l of linhas) incluir(l.pagina, l.y)
  for (const [i, pagina, y] of trechos) {
    if (linhasPorPar.has(i)) continue
    const n = linhasNaoMarcadas(i)
    // as linhas do trecho ficam logo abaixo do começo dele (só a ordem importa)
    for (let m = 0; m < n; m++) incluir(pagina, y + 0.5 + m * 0.01)
  }
  for (const ys of porPagina.values()) ys.sort((a, b) => a - b)
  const lista = casos.map(c => {
    // o maior começo que cabe no pedaço da linha: o hífen vem depois e pode avançar na margem
    // (o Typst deixa a pontuação pendurada), então ele não entra na conta
    let p = c.opcoes.length ? c.opcoes[0].p : c.palavra.length
    for (const o of c.opcoes) if ((larguras.get(o.chave) ?? Infinity) <= c.comeco + 0.3) p = o.p
    // só a palavra dividida (letras, algarismos e hífen em volta do ponto), sem pontuação nem o que
    // vem colado por espaço sem quebra
    const parte = ch => /[\p{L}\d-]/u.test(ch)
    let ini = p, fim = p
    while (ini > 0 && parte(c.palavra[ini - 1])) ini--
    while (fim < c.palavra.length && parte(c.palavra[fim])) fim++
    const dividida = c.palavra.slice(ini, p) + '-' + c.palavra.slice(p, fim)
    const ys = porPagina.get(c.pagina) || []
    const linha = ys.findIndex(y => Math.abs(y - c.y) < 0.005) + 1
    const f = folio(c.pagina)
    // grupo na lista: 0 = começa com maiúscula, 1 = palavra composta, 2 = as outras
    const grupo = /^\p{Lu}/u.test(dividida) ? 0 : /[-‐]/.test(c.palavra.slice(ini, fim)) ? 1 : 2
    return { grupo, palavra: c.palavra.slice(ini, fim), folio: f, linha, total: ys.length, texto: `${dividida} [p. ${f}, linha ${linha}/${ys.length}]` }
  })
  // maiúsculas, compostas e as outras; em cada grupo, em ordem alfabética (usuário, 2026-11-08) e,
  // na mesma palavra, na ordem do documento
  const alfa = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })
  lista.sort((a, b) => a.grupo - b.grupo || alfa.compare(a.palavra, b.palavra) || a.folio - b.folio || a.linha - b.linha)
  return lista
}
