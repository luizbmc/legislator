/**
 * composicaoLivro.js — quebra de linhas dos parágrafos justificados do miolo pelo compositor próprio
 * (compositor.js), calibrado para reproduzir o InDesign (scratchpad/calib; CF 70, Legislação sobre
 * Educação e Regimento Interno: ~85% das quebras idênticas, ~99% dos parágrafos com o mesmo nº de
 * linhas). O Typst só desenha as linhas onde o compositor manda (linebreak(justify: true)).
 *
 * - Pontos de hifenização: os do dicionário do InDesign (lido da instalação do usuário, nunca copiado),
 *   com os mínimos do estilo, filtrados pelas regras do Normando (translineacao.js: vogais, fragmentos
 *   proibidos, prefixos, siglas, 7 letras, divisão única), como no IDML — regras nos dois.
 * - Larguras: cada pedaço de palavra medido uma vez no Typst, texto puro (sem os trechos de proteção,
 *   que no Typst cortam o tracking); tracking e espaço entre palavras das variantes são calculados,
 *   com o tracking depois de cada caractere, como no InDesign.
 * - A numeração das palavras (k) é a mesma das marcas de runsMarcados (typstLivro.js): as restrições
 *   da verificação da composição (linhas.js) valem aqui sem tradução.
 */
import { formato } from './mancha.js'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { quebrarLinhas } from './compositor.js'
import { ESPACO_MINIMO } from './typstLivro.js'
import { lerPadroes, pontosDaPalavra } from './hifenizacaoIndesign.js'
import { pontosDaExcecao } from './hifenizacaoExcecoes.js'
import { ocupacaoMinima } from './mancha.js'

// linha aberta demais: o limite da correção (ABERTA em linhas.js; LIMITE_ABERTO no script do InDesign)
const LIMITE_ABERTA = 1.7
import { trechosProtegidos, prefixoDe } from '../idml/translineacao.js'

// parâmetros calibrados contra o InDesign (validados em 3 livros)
export const PARAMETROS_INDESIGN = {
  hifenBase: 800, hifenFator: 1.5, penaHifenProprio: 50, penaLinha: 50, hifensSeguidos: 30000,
  hangPonto: 1, hangHifen: 0.5, hangOutros: 0, extra: 0.6, pesoAperto: 2, pesoUltima: 4, expoenteUltima: 3,
  // regra da casa: no máximo 2 linhas seguidas terminadas em hífen (o padrão do InDesign é 3)
  limiteHifens: 2,
  // palavras empilhadas (mesmo trecho no fim ou no começo de linhas seguidas): com mais de 2 letras
  // só em último caso (usuário); de até 2 letras ("de", "a"), evitada quando sai barato
  pilha: 5e6, pilhaCurta: 50000,
}

const NBSP = String.fromCharCode(0xa0), LSEP = String.fromCharCode(0x2028)
const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d }
const LETRA = /\p{L}/u
// pontuação que a margem óptica pendura para fora da coluna
const PONT_FIM = { '-': 'hangHifen', ',': 'hangPonto', '.': 'hangPonto', ';': 'hangPonto', ':': 'hangPonto', ')': 'hangOutros', '”': 'hangOutros', '’': 'hangOutros', '"': 'hangOutros' }
const PONT_INI = { '(': 'hangOutros', '“': 'hangOutros', '‘': 'hangOutros', '"': 'hangOutros' }
// última linha do parágrafo (regra do diagramador): mínimo de 8 caracteres; 7 só em caso complexo,
// e sempre relatado (lista de problemas da tela, relatório do script do InDesign)
// só para tirar a última linha curta, além dos passos de abertura comuns (ABRIR)
const ABRIR_CURTA = [[0.012, 108], [0.015, 112], [0.018, 116], [0.02, 120]]
// aperto de linha aberta aliviado para a última linha não ficar curta: o espaço fica em 97%, as letras soltam
const ALIVIO = [[-0.003, 97], [0, 97], [0.003, 97], [0.005, 97], [0.008, 97], [0.01, 97], [0.012, 97]]

/** Dicionário de hifenização do InDesign instalado (o mais novo), ou null. */
export function acharDicionarioIndesign(caminho = null) {
  if (caminho) return existsSync(caminho) ? caminho : null
  const adobe = 'C:/Program Files/Adobe'
  if (!existsSync(adobe)) return null
  const versoes = readdirSync(adobe).filter(d => /^Adobe InDesign/.test(d)).sort().reverse()
  for (const v of versoes) {
    const arq = join(adobe, v, 'Resources/Dictionaries/LILO/Linguistics/Providers/Plugins2/AdobeHunspellPlugin/Dictionaries/pt_BR/ORTH/hyph_pt_BR.dic')
    if (existsSync(arq)) return arq
  }
  return null
}

/**
 * Prepara a composição dos parágrafos justificados do miolo.
 * @param itens itens do miolo (itensDoMiolo: { i, tipo, fn, runs, L, ajustavel })
 * @param medir async (pedidos: [{ estilo, tr, run, palavra }]) → larguras na mesma ordem (texto puro)
 */
export async function prepararComposicao(itens, estilos, { dicionario, medir, parametros = {} }) {
  const P = { ...PARAMETROS_INDESIGN, ...parametros }
  const dic = lerPadroes(dicionario)
  const pedidos = new Map()
  const pedir = (estilo, run, t) => {
    const c = JSON.stringify([estilo, run?.char || '', t])
    if (!pedidos.has(c)) pedidos.set(c, { estilo, tr: 0, run: run?.char ? { char: run.char, texto: t } : null, palavra: t, puro: true })
    return c
  }
  const pars = new Map()
  for (const it of itens) {
    if (it.tipo !== 'par' || !it.fn.justify || !it.runs) continue
    const est = estruturaDoParagrafo(it, estilos, dic, pedir)
    if (est) pars.set(it.i, est)
  }
  const chaves = [...pedidos.keys()]
  const valores = chaves.length ? await medir([...pedidos.values()]) : []
  const larg = new Map(chaves.map((c, k) => [c, valores[k]]))
  return new Composicao(pars, larg, estilos, P)
}

/**
 * Palavras e separadores do parágrafo, com a numeração k das marcas de runsMarcados: cada parte de
 * run sem espaço é uma marca; partes seguidas sem espaço entre elas (de runs diferentes) formam uma
 * palavra. Cada parte é cortada em todos os pontos de quebra possíveis (os que valem dependem das
 * restrições) e nos espaços sem quebra.
 */
function estruturaDoParagrafo(it, estilos, dic, pedir) {
  const e = it.fn.estilo
  const p = estilos.par(e)
  const minimos = { palavra: num(p.HyphenateWordsLongerThan, 5) + 1, antes: num(p.HyphenateAfterFirst, 2), depois: num(p.HyphenateBeforeLast, 2) }
  const hifenizaMaiuscula = p.HyphenateCapitalizedWords !== 'false'
  const atomos = []   // { sep, run } | { pecas: [peca] } | { nota }
  let palavra = null, k = 0
  for (const r of it.runs) {
    if (r.nota) { atomos.push({ nota: true }); palavra = null; continue }
    if (r.texto === undefined) continue
    for (const parte of String(r.texto).split(/([ \u2028]+)/).filter(Boolean)) {
      if (/^[ \u2028]+$/.test(parte)) {
        for (const c of parte) atomos.push({ sep: c, run: r, props: propsDoRun(r, e, estilos), kSep: { espaco: pedir(e, r, 'a a'), sem: pedir(e, r, 'aa') } })
        palavra = null
        continue
      }
      const peca = pecaDePalavra(parte, r, k++, e, estilos, dic, minimos, hifenizaMaiuscula, pedir)
      if (!palavra) { palavra = { pecas: [] }; atomos.push(palavra) }
      palavra.pecas.push(peca)
    }
  }
  if (!atomos.some(a => a.pecas)) return null
  return { it, atomos, estilo: e }
}

// corpo e tracking de um trecho (milésimos de em → em); trFixo: o estilo de caractere fixa o próprio
// tracking, e o ajuste do parágrafo não vale nele (como no Typst)
function propsDoRun(run, e, estilos) {
  const c = estilos.char(run.char), p = estilos.par(e)
  return { corpo: num(c.PointSize ?? p.PointSize, 9.5), trBase: num(c.Tracking ?? p.Tracking, 0) / 1000, trFixo: c.Tracking != null }
}

// uma parte de run (marca k): segmentos entre os pontos de quebra possíveis e os espaços sem quebra
function pecaDePalavra(t, run, k, e, estilos, dic, minimos, hifenizaMaiuscula, pedir) {
  const c = estilos.char(run.char)
  // pontos possíveis: dicionário do InDesign, logo depois do prefixo e depois de hífen próprio
  const dicio = new Set(), proprios = new Set()
  // exceção do usuário (Configurações → Hifenização): só os pontos dela, no lugar do dicionário e das
  // regras (vale a palavra inteira, com hífen próprio, ou cada sequência de letras)
  let excecao = null
  const nucleo = t.match(/[\p{L}-]+/u)
  const exNucleo = nucleo && pontosDaExcecao(nucleo[0])
  if (exNucleo) excecao = new Set(exNucleo.map(p => nucleo.index + p))
  for (const m of t.matchAll(/\p{L}+/gu)) {
    if (excecao && exNucleo) break
    const ex = pontosDaExcecao(m[0])
    if (ex) { excecao ||= new Set(); for (const p of ex) excecao.add(m.index + p); continue }
    if (!hifenizaMaiuscula && /^\p{Lu}/u.test(m[0])) continue
    for (const q of pontosDaPalavra(m[0], dic, minimos)) dicio.add(m.index + q)
  }
  if (excecao) for (const p of excecao) dicio.add(p)
  for (let i = 1; i < t.length - 1; i++) if ((t[i] === '-' || t[i] === '‐') && LETRA.test(t[i - 1]) && LETRA.test(t[i + 1])) proprios.add(i + 1)
  const pref = prefixoDe(t)
  const inicioLetras = t.search(LETRA)
  const posPrefixo = pref && inicioLetras >= 0 && !excecao ? inicioLetras + pref.length : null
  const cortes = new Set([...dicio, ...proprios])
  if (posPrefixo) cortes.add(posPrefixo)
  // espaços sem quebra: segmento próprio
  for (let i = 0; i < t.length; i++) if (t[i] === NBSP) { cortes.add(i); cortes.add(i + 1) }
  const ordem = [0, ...[...cortes].filter(x => x > 0 && x < t.length).sort((a, b) => a - b), t.length]
  const segs = []
  for (let s = 0; s < ordem.length - 1; s++) {
    const tx = t.slice(ordem[s], ordem[s + 1])
    if (!tx) continue
    if (tx === NBSP) { segs.push({ ini: ordem[s], nbsp: true, k1: pedir(e, run, 'a a'), k2: pedir(e, run, 'aa') }); continue }
    const ult = tx[tx.length - 1], pri = tx[0]
    segs.push({
      ini: ordem[s], t: tx, k: pedir(e, run, tx), nc: [...tx].length,
      fim: PONT_FIM[ult] ? { tipo: PONT_FIM[ult], k: pedir(e, run, ult) } : null,
      comeco: s === 0 && PONT_INI[pri] ? { tipo: PONT_INI[pri], k: pedir(e, run, pri) } : null,
    })
  }
  return {
    k, t, run, segs, dicio, proprios, posPrefixo, excecao,
    hifen: pedir(e, run, '-'),
    // itálico de estilo de caractere não se hifeniza — salvo em parágrafo já itálico pelo estilo (ementa)
    italico: /italic|oblique/i.test(c.FontStyle || '') && !/italic|oblique/i.test(estilos.par(e).FontStyle || ''),
    composta: /\p{L}[-‐]\p{L}/u.test(t),
    ...propsDoRun(run, e, estilos),
  }
}

/**
 * Ponto de divisão p (índice em t) de uma palavra composta que não precisa de liberação (regra do
 * usuário, 2026-11-11): o pedaço que começa a linha seguinte, até o próximo hífen ou o fim da
 * palavra, tem mais de 3 letras; e, se há hífen próprio antes da divisão, o pedaço entre ele e a
 * divisão também.
 * "au-|sentar-se" (sentar), "téc-|nico-legislativo" (nico), "técnico-legis-|lativo" (legis, lativo): sim;
 * "técni-|co-legislativo" (co), "técnico-legislati-|vo" (vo), "Relator-Par-|cial" (Par): não.
 */
export function pontoBomComposta(t, p) {
  const letras = s => (s.match(/\p{L}/gu) || []).length
  const antes = t.slice(0, p), depois = t.slice(p)
  const hAntes = Math.max(antes.lastIndexOf('-'), antes.lastIndexOf('‐'))
  const hDepois = [depois.indexOf('-'), depois.indexOf('‐')].filter(x => x >= 0)
  if (hAntes >= 0 && letras(antes.slice(hAntes + 1)) <= 3) return false
  if (letras(hDepois.length ? depois.slice(0, Math.min(...hDepois)) : depois) <= 3) return false
  return true
}

class Composicao {
  constructor(pars, larg, estilos, P) {
    this.pars = pars
    this.L = k => larg.get(k) ?? 0
    this.estilos = estilos
    this.P = P
    this.cache = new Map()
    this.cacheTextos = new Map()
  }

  tem(i) { return this.pars.has(i) }

  /**
   * Pontos de quebra que valem numa peça, com as restrições da verificação: { hifen: Set, proprio: Set }.
   * Regras do Normando (como em strTexto/runsMarcados): itálico de estilo de caractere, palavra
   * composta não liberada e palavra protegida (fim de página ímpar) não hifenizam; nas outras, os
   * trechos protegidos de translineacao.js tiram pontos; o ponto logo depois do prefixo vale mesmo
   * fora do dicionário.
   */
  pontosValidos(peca, rs, semHifenPar) {
    const proprio = peca.proprios
    // ajuste local do usuário (ajustesLocais.js) prevalece: proibir, permitir (pontos do dicionário,
    // sem as regras do Normando) ou um ponto fixo
    const manual = rs.manual?.palavras?.find(([k]) => k === peca.k)?.[1]
    if (manual === 'proibir') return { hifen: new Set(), proprio: new Set() }
    if (typeof manual === 'number') return { hifen: new Set(peca.segs.some(s => s.ini === manual) ? [manual] : []), proprio: new Set() }
    if (manual === 'permitir') {
      const todos = new Set([...peca.dicio, ...(peca.posPrefixo ? [peca.posPrefixo] : [])].filter(p => !proprio.has(p)))
      return { hifen: todos, proprio }
    }
    const livre = (rs.compostasLivres || []).includes(peca.k)
    // itálico: só quando a verificação o liberou (linha aberta demais, último recurso)
    if (semHifenPar || (peca.italico && !livre)) return { hifen: new Set(), proprio }
    // exceção do usuário: os pontos dela, sem as regras de translineação (fim de página ímpar ainda protege)
    if (peca.excecao) {
      if ((rs.semHifen || []).includes(peca.k)) return { hifen: new Set(), proprio: new Set() }
      return { hifen: new Set([...peca.excecao].filter(p => !proprio.has(p))), proprio }
    }
    // palavra protegida (fim de página ímpar): nem hifenização nem quebra no hífen próprio
    if ((rs.semHifen || []).includes(peca.k)) return { hifen: new Set(), proprio: new Set() }
    const seis = (rs.seisLetras || []).includes(peca.k)
    const prot = trechosProtegidos(peca.t, { vogais: true, regras: true, prefixoPreferido: !livre, ...(seis ? { minLetras: 6 } : {}) })
    const candidatos = new Set(peca.dicio)
    if (peca.posPrefixo && !livre) candidatos.add(peca.posPrefixo)
    let hifen = new Set([...candidatos].filter(p => !proprio.has(p) && !prot.some(([a, b, h]) => a < p && p < b && !h?.includes(p))))
    // palavra composta: além do hífen próprio, só os pontos com 4 letras ou mais entre a divisão e o
    // hífen da palavra ("au-|sentar-se", "téc-|nico-legislativo", "técnico-legis-|lativo"); os outros
    // ("técni-|co-legislativo", "Relator-Par-|cial") só quando a verificação libera a palavra
    if (peca.composta && !livre) hifen = new Set([...hifen].filter(p => pontoBomComposta(peca.t, p)))
    return { hifen, proprio }
  }

  /** Itens do compositor para o parágrafo i, numa variante { tr (em), sp (%), semHifen, rs, hc }. */
  itens(i, { tr = 0, sp = 100, semHifen = false, rs = {}, base = 200 } = {}) {
    const est = this.pars.get(i)
    const { L, P } = this
    const p = this.estilos.par(est.estilo)
    const ws = { min: num(p.MinimumWordSpacing, 80), des: num(p.DesiredWordSpacing, 100), max: num(p.MaximumWordSpacing, 133) }
    const des = ws.des * sp / 100, min = Math.min(ws.min, des), max = Math.max(ws.max, des)
    const ls = { min: num(p.MinimumLetterSpacing, 0), max: num(p.MaximumLetterSpacing, 0) }
    // custo do hífen: pelo controle do estilo ("Melhor espaçamento ↔ Menos hífens") e pelo custo de
    // hifenização que a verificação deu ao parágrafo (rs.hc, relativo ao do documento)
    const penaHifen = P.hifenBase * Math.pow(P.hifenFator, num(p.HyphenWeight, 5) - 8) * (rs.hc ? rs.hc / base : 1)
    const nbsp = rs.pilha?.nbsp || null
    const itens = []
    // espaço natural (o do glifo) e tracking efetivo, por trecho
    const trDe = peca => (peca.trBase + (peca.trFixo ? 0 : tr)) * peca.corpo
    let ultimaPeca = null, espacoRef = null
    const cola = (kEspaco, kSem, peca, inseparavel, ref, c = null) => {
      // largura medida "a a" − "aa" = espaço + tracking do trecho (Typst, texto puro)
      const espacoGlifo = L(kEspaco) - L(kSem) - peca.trBase * peca.corpo
      espacoRef = espacoRef ?? espacoGlifo
      if (inseparavel) itens.push({ tipo: 'pena', p: Infinity })
      // encolhimento até o mínimo do estilo, mas o espaço (com o tracking) nunca abaixo de
      // ESPACO_MINIMO do espaço normal: com o aperto do compositor limitado a ele, nenhuma linha passa
      const w = espacoGlifo * des / 100 + trDe(peca), wn = espacoGlifo + trDe(peca)
      const sh = Math.max(0, Math.min(espacoGlifo * (des - min) / 100, w - wn * ESPACO_MINIMO / 100))
      itens.push({ tipo: 'cola', w, st: espacoGlifo * (max - des) / 100, sh, t: ' ', ref, c, wn, g: espacoGlifo })
    }
    for (let a = 0; a < est.atomos.length; a++) {
      const at = est.atomos[a]
      if (at.nota) { if (ultimaPeca) itens.push({ tipo: 'caixa', w: 3, nc: 0, t: '', nota: true }); continue }
      if (at.sep) {
        if (at.sep === LSEP) { itens.push({ tipo: 'pena', p: Infinity }, { tipo: 'cola', w: 0, st: 1e6, sh: 0, t: '' }, { tipo: 'pena', p: -Infinity, forcada: true }); continue }
        // espaço sem quebra decidido pela verificação (palavras empilhadas)
        const prox = est.atomos.slice(a + 1).find(x => x.pecas)?.pecas[0]
        const junta = (nbsp && ((nbsp.lado === 'depois' && ultimaPeca?.k === nbsp.k) || (nbsp.lado === 'antes' && prox?.k === nbsp.k))) ||
          // espaço sem quebra pedido pelo usuário depois da palavra
          (ultimaPeca && (rs.manual?.juntar || []).includes(ultimaPeca.k))
        cola(at.kSep.espaco, at.kSep.sem, at.props, junta, { aposK: ultimaPeca?.k ?? -1 }, at.run.char || null)
        continue
      }
      for (const peca of at.pecas) {
        const { hifen, proprio } = this.pontosValidos(peca, rs, semHifen)
        peca.segs.forEach((s, j) => {
          if (j > 0 && !s.nbsp && !peca.segs[j - 1].nbsp) {
            const pos = s.ini
            if (hifen.has(pos)) {
              const wh = L(peca.hifen) + trDe(peca)
              itens.push({ tipo: 'pena', p: penaHifen, hifen: true, w: wh * (1 - P.hangHifen), t: '-', ref: { k: peca.k, pos, hifen: true } })
            } else if (proprio.has(pos)) {
              const wh = L(peca.hifen)
              itens.push({ tipo: 'pena', p: P.penaHifenProprio, hifen: false, contaHifen: true, w: -wh * P.hangHifen, t: '', ref: { k: peca.k, pos, hifen: false } })
            }
          }
          if (s.nbsp) { cola(s.k1, s.k2, peca, true, null, peca.run.char || null); return }
          const w = L(s.k) + peca.trBase * peca.corpo + s.nc * (peca.trFixo ? 0 : tr) * peca.corpo
          itens.push({ tipo: 'caixa', w, nc: s.nc, t: s.t, c: peca.run.char || null, trc: (peca.trBase + (peca.trFixo ? 0 : tr)) * peca.corpo, hangFim: s.fim ? L(s.fim.k) * P[s.fim.tipo] : 0, hangIni: s.comeco ? L(s.comeco.k) * P[s.comeco.tipo] : 0 })
        })
        ultimaPeca = peca
      }
    }
    // espaçamento entre letras: % da largura do espaço, por caractere
    const esp = espacoRef ?? 2
    for (const it of itens) if (it.tipo === 'caixa') { it.st = it.nc * esp * ls.max / 100; it.sh = it.nc * esp * -ls.min / 100 }
    itens.push({ tipo: 'pena', p: Infinity }, { tipo: 'cola', w: 0, st: 1e6, sh: 0, t: '' }, { tipo: 'pena', p: -Infinity })
    return itens
  }

  /**
   * Linhas do parágrafo i numa variante: { n, quebras: { espaco: Set(k), dentro: Map(k → [{ pos, hifen }]), fimApertado },
   * ultima: caracteres da última linha (sem espaços no fim) }.
   */
  compor(i, opcoes = {}) {
    const chave = JSON.stringify([i, opcoes.tr ?? 0, opcoes.sp ?? 100, !!opcoes.semHifen, opcoes.rs || {}])
    if (this.cache.has(chave)) return this.cache.get(chave)
    const est = this.pars.get(i)
    const f = est.it.fn
    const itens = this.itens(i, opcoes)
    const larguraLinha = n => f.geo.largura + this.P.extra - (n === 0 ? f.geo.primeira : f.geo.pendente)
    const linhas = quebrarLinhas(itens, larguraLinha, this.P) || quebrarLinhas(itens, larguraLinha, { ...this.P, razaoMax: 1e6 })
    const espaco = new Set(), dentro = new Map()
    let ultima = 0, fimApertado = false, ocupa = 1, ultimaNota = false
    if (linhas) {
      linhas.forEach((l, n) => {
        const q = itens[l.fim]
        if (n === linhas.length - 1) {
          const da = itens.slice(l.ini, l.fim).filter(x => x.tipo !== 'pena')
          ultima = da.map(x => x.t).join('').trimEnd().length
          // ocupação da última linha: largura natural do texto sobre a largura disponível
          const caixas = da.filter(x => x.tipo === 'caixa' && x.t)
          let fimTexto = da.length
          while (fimTexto > 0 && da[fimTexto - 1].tipo !== 'caixa') fimTexto--
          const W = da.slice(0, fimTexto).reduce((s, x) => s + (x.w || 0), 0)
          ocupa = W / Math.max(1, larguraLinha(n))
          // última linha só com texto em "nota novo formato" (corpo menor): o mínimo de caracteres sobe 1
          ultimaNota = caixas.length > 0 && caixas.every(x => /nota novo formato/i.test(x.c || ''))
          // última linha apertada para caber (o InDesign aperta a última linha; no Typst ela só aperta
          // justificada: linebreak(justify: true) no fim do parágrafo)
          fimApertado = l.razao < 0
          return
        }
        if (q.forcada) return
        if (q.tipo === 'cola' && q.ref) espaco.add(q.ref.aposK)
        else if (q.tipo === 'pena' && q.ref) {
          if (!dentro.has(q.ref.k)) dentro.set(q.ref.k, [])
          dentro.get(q.ref.k).push({ pos: q.ref.pos, hifen: q.ref.hifen })
        }
      })
    }
    // linha de cada chamada de nota de rodapé (a nota vai para a página dessa linha)
    const notas = []
    if (linhas) linhas.forEach((l, n) => { for (let k = l.ini; k < l.fim; k++) if (itens[k].nota) notas.push(n) })
    const r = { n: linhas ? linhas.length : 1, quebras: { espaco, dentro, fimApertado }, ultima, ocupa, ultimaNota, notas }
    this.cache.set(chave, r)
    return r
  }

  /**
   * Texto das linhas do parágrafo i numa variante, para a tela de paginação: [{ partes: [{ t, c }],
   * hifen, razao, justificada, repeteHifen }] — partes com o estilo de caractere (c), razão de ajuste
   * do espaçamento (folga > 0, aperto < 0), linha justificada (todas menos a última e as de quebra
   * forçada, salvo a última apertada) e o hífen repetido no começo (quebra no hífen próprio).
   */
  textos(i, opcoes = {}) {
    const chave = JSON.stringify([i, opcoes.tr ?? 0, opcoes.sp ?? 100, !!opcoes.semHifen, opcoes.rs || {}])
    if (this.cacheTextos.has(chave)) return this.cacheTextos.get(chave)
    const f = this.pars.get(i).it.fn
    const itens = this.itens(i, opcoes)
    const larguraLinha = n => f.geo.largura + this.P.extra - (n === 0 ? f.geo.primeira : f.geo.pendente)
    const linhas = quebrarLinhas(itens, larguraLinha, this.P) || quebrarLinhas(itens, larguraLinha, { ...this.P, razaoMax: 1e6 }) || []
    let repete = false
    const out = linhas.map((l, n) => {
      const partes = []
      for (let k = l.ini; k < l.fim; k++) {
        const it = itens[k]
        if (it.tipo === 'pena' || !it.t) continue
        const ult = partes[partes.length - 1]
        if (ult && ult.c === (it.c ?? null)) ult.t += it.t
        else partes.push({ t: it.t, c: it.c ?? null })
      }
      const q = itens[l.fim]
      const ultima = n === linhas.length - 1
      const forcada = !!q?.forcada
      const justificada = (!ultima && !forcada) || (ultima && l.razao < 0)
      // espaço entre palavras em relação ao normal (1 = 100%), com a justificação em etapas do
      // InDesign: os espaços até o máximo do estilo, depois o espaçamento entre letras (até o limite),
      // e o que sobrar volta para os espaços (passando do máximo)
      let W = 0, G = 0, Gn = 0, Gg = 0, Gst = 0, Lst = 0, Gsh = 0, Lsh = 0, nG = 0, nc = 0, trc = 0
      for (let k = l.ini; k < l.fim; k++) {
        const it = itens[k]
        if (it.tipo === 'pena') continue
        W += it.w
        if (it.tipo === 'cola' && it.wn) { G += it.w; Gn += it.wn; Gg += it.g || it.wn; Gst += it.st || 0; Gsh += it.sh || 0; nG++ }
        if (it.tipo === 'caixa') { Lst += it.st || 0; Lsh += it.sh || 0; nc += it.nc || 0; trc += (it.nc || 0) * (it.trc || 0) }
      }
      // largura como a do compositor (larguraDaLinha): hífen da quebra e margem óptica
      if (q?.tipo === 'pena') W += q.w || 0
      if (q?.tipo === 'cola') W -= itens[l.fim - 1]?.hangFim || 0
      W -= itens[l.ini]?.hangIni || 0
      let sobra = justificada ? larguraLinha(n) - W : 0, letras = 0
      if (sobra > Gst) { letras = Math.min(sobra - Gst, Lst); sobra -= letras }
      // aperto, também em etapas: os espaços até o mínimo, depois as letras, e só então os espaços
      // abaixo do mínimo
      else if (sobra < -Gsh) { letras = -Math.min(-Gsh - sobra, Lsh); sobra -= letras }
      const espaco = Gn > 0 ? (G + sobra) / Gn : 1
      // para a tela (o navegador não sabe do tracking): espaçamento entre letras médio da linha em pt
      // (tracking do estilo e do parágrafo + o da justificação) e largura média do espaço em pt
      const tracking = nc > 0 ? Math.round((trc + letras) / nc * 1000) / 1000 : 0
      const espacoPt = nG > 0 ? Math.round((G + sobra) / nG * 1000) / 1000 : null
      // espaço visível, como o script do InDesign mede: o vão (com o tracking) sobre o espaço do glifo
      const visivel = Gg > 0 ? (G + sobra) / Gg : 1
      const r = { partes, hifen: !!l.hifen, razao: Math.round(l.razao * 100) / 100, espaco: Math.round(espaco * 100) / 100, visivel: Math.round(visivel * 1000) / 1000, justificada, repeteHifen: repete, tracking, espacoPt }
      repete = q?.tipo === 'pena' && q.contaHifen && !q.hifen
      return r
    })
    this.cacheTextos.set(chave, out)
    return out
  }

  /**
   * Medidas para a paginação (o mesmo formato de medir-par em typstLivro.js): ajuste fino da última
   * linha curta, altura com e sem hifenização e as variantes de uma linha a menos/a mais.
   * @param passos { aj, ab } passos de ajuste permitidos (sem os proibidos); fixo [tr, sp] ou null
   */
  medidas(i, { rs = {}, fixo = null, aj, ab, base }) {
    const est = this.pars.get(i)
    const it = est.it
    const L = it.L
    const c = (tr, sp, semHifen = false) => this.compor(i, { tr, sp, semHifen, rs, base })
    // mínimo de caracteres (+1 quando a última linha é só nota, de corpo menor: bolso)
    const minimo = (x, min) => min + (formato.notaMaisUm && x.ultimaNota ? 1 : 0)
    const semCurta = (x, min = formato.ultimaLinha) => x.n < 2 || x.ultima >= minimo(x, min)
    // ocupação mínima da última linha (bolso, usuário 2026-11-10): 10% com 2 linhas, 11% com 3,
    // 12% com 4, 13% com 5 ou mais; o mínimo de caracteres continua valendo se não der
    const semVazia = x => !formato.ultimaOcupacao || x.n < 2 || x.ocupa >= ocupacaoMinima(x.n)
    // aperto que tira linha: o espaço visível não passa do limite (formato.visivelMinimo, bolso). O
    // compositor mede uns 4 pontos mais folgado que o InDesign; o limite já vem com essa folga. Sem
    // ele, o InDesign precisa de mais tracking e fica abaixo do limite (usuário, 2026-11-07: melhor a
    // linha a mais, aberta dentro do limite, que a linha apertada demais)
    const visivelOk = (t, s) => !formato.visivelMinimo || this.textos(i, { tr: t, sp: s, rs, base }).every(l => !l.justificada || l.visivel >= formato.visivelMinimo - 1e-9)
    let tr = 0, sp = 100
    if (fixo) {
      [tr, sp] = fixo
      // o aperto da verificação (linha aberta, linhas.js) também respeita a última linha: se ela ficou
      // curta, vale o passo mais próximo com o mesmo nº de linhas. Se a linha abrir de novo, a
      // verificação sobe o aperto ou desiste dele
      if (rs.aperto != null && rs.manual?.tr == null && !rs.fixo) {
        const f = c(tr, sp)
        if (!semCurta(f)) {
          const outro = [...ALIVIO, ...aj, ...ab, ...ABRIR_CURTA].find(([t, s]) => { const x = c(t, s); return x.n === f.n && semCurta(x) })
          if (outro) [tr, sp] = outro
        }
      }
    } else if (it.ajustavel) {
      // última linha curta: aperta até ela subir; senão abre até ela ter o mínimo (ou 7, se não der)
      const c0 = c(0, 100)
      // 1º a ocupação: apertar até a linha subir ou soltar até ela crescer, dentro dos limites
      if (c0.n > 1 && !semVazia(c0)) {
        const aperto = aj.find(([t, s]) => { const x = c(t, s); return x.n < c0.n && semCurta(x) && semVazia(x) && visivelOk(t, s) })
        // soltar não pode abrir linha além do limite (170%, como o script do InDesign)
        const abertaOk = (t, s) => this.textos(i, { tr: t, sp: s, rs, base }).every(l => !l.justificada || l.espaco <= LIMITE_ABERTA)
        const abre = !aperto && ab.length && [...ab, ...ABRIR_CURTA].find(([t, s]) => { const x = c(t, s); return x.n === c0.n && semCurta(x) && semVazia(x) && abertaOk(t, s) })
        if (aperto) [tr, sp] = aperto
        else if (abre) [tr, sp] = abre
      }
      // se não deu: o mínimo de caracteres, como antes
      if (tr === 0 && sp === 100 && c0.n > 1 && !semCurta(c0)) {
        const aperto = aj.find(([t, s]) => { const x = c(t, s); return x.n < c0.n && semCurta(x) && visivelOk(t, s) })
        const abrir = min => [...ab, ...ABRIR_CURTA].find(([t, s]) => { const x = c(t, s); return x.n === c0.n && semCurta(x, min) })
        const abre = !aperto && ab.length && (abrir(formato.ultimaLinha) || (c0.ultima < minimo(c0, formato.ultimaComplexa) && abrir(formato.ultimaComplexa)))
        if (aperto) [tr, sp] = aperto
        else if (abre) [tr, sp] = abre
      }
    }
    const n = c(tr, sp).n
    const variante = (passos, menos) => {
      if (!passos.length) return null
      const ok = x => menos ? x < n : x > n
      const [tl, sl] = passos[passos.length - 1]
      if (!ok(c(tl, sl).n)) return null
      for (let k = 0; k < passos.length; k++) {
        const [t, s] = passos[k]
        // a variante não pode criar última linha curta
        const x = c(t, s)
        // apertar: espaço visível dentro do limite; soltar: nenhuma linha além de 170%
        if (ok(x.n) && semCurta(x) && (menos ? visivelOk(t, s) : this.textos(i, { tr: t, sp: s, rs, base }).every(l => !l.justificada || l.espaco <= LIMITE_ABERTA))) return { tr: t, sp: s / 100, h: x.n * L, passo: k }
      }
      return null
    }
    const ajusta = !fixo && it.ajustavel && n >= 2
    return {
      i, h: n * L, hn: c(tr, sp, true).n * L, tr, sp: sp / 100,
      // linha da chamada de cada nota (paginação: parágrafo dividido entre páginas)
      notasLinha: c(tr, sp).notas,
      menos: ajusta ? variante(aj, true) : null,
      mais: ajusta ? variante(ab, false) : null,
      compositor: true,
    }
  }
}
