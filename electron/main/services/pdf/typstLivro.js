/**
 * typstLivro.js — monta o código-fonte Typst do PDF de revisão.
 *
 * Usa os mesmos parágrafos do IDML (historia.js) e as definições dos estilos do modelo
 * (estilosModelo.js): fonte, corpo, entrelinha, recuos, espaços, alinhamento, caixa, cor,
 * "manter com o próximo" e "começar em página nova". O PDF é para revisão do texto: o ajuste
 * fino de composição continua no InDesign.
 *
 * Página, margens, fólio e cabeço vêm da mestra A-Miolo do modelo (170 × 255 mm).
 */

import { segmentarTranslineacao, comHifens } from '../idml/translineacao.js'
import { lerPadroes, comHifensIndesign } from './hifenizacaoIndesign.js'
import { pontosDaExcecao, temExcecoes } from './hifenizacaoExcecoes.js'
import { NOTAS, ascendente, formato, definirFormato, larguraMancha } from './mancha.js'

/**
 * Espaço mínimo absoluto entre palavras (% do espaço normal): nenhuma linha fica mais apertada que
 * isso, qualquer que seja o estilo ou o ajuste (regra do usuário, 2026-11-04: 78%, depois 82%).
 */
export let ESPACO_MINIMO = 82
/** Muda o piso (testes e amostras de composição). */
export function definirEspacoMinimo(v) { ESPACO_MINIMO = v }

/** Formato do livro (mancha.js) e o que depende dele aqui: piso do espaço e passos de aperto. */
export function aplicarFormato(f) {
  definirFormato(f)
  ESPACO_MINIMO = formato.espacoMinimo
  AJUSTES = [...AJUSTES_COMUNS, ...formato.ajustesExtra]
}

// calibração com o InDesign (experimento): hifenização só nos pontos do dicionário do InDesign, no
// lugar das regras do Normando — { dic, minimos } ou null (definirCalibracao, chamado por exportPdf.js)
let calibracao = null
export function definirCalibracao(c) {
  calibracao = c?.padroes ? { dic: lerPadroes(c.padroes), minimos: c.minimos || { palavra: 7, antes: 2, depois: 3 } } : null
}

const PT_MM = 2.834645669
const NBSP = String.fromCharCode(0xa0)
const LSEP = String.fromCharCode(0x2028)

// ── utilidades Typst ─────────────────────────────────────────────
/** Texto → literal de string Typst ("…"); o caractere U+2028 (quebra forçada) vira linebreak(). */
function str(t) {
  return String(t ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F﻿]/g, '')
    .split('\u2028')
    .map(parte => '"' + parte.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').replace(/\t/g, ' ') + '"')
    .join(' + linebreak() + ')
}
const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null }
const pt = v => `${Math.round(v * 1000) / 1000}pt`

/**
 * Como str(), mas com os pontos de translineação proibidos protegidos (translineacao.js): as duas
 * letras em volta do ponto ficam sem hifenização, e o resto da palavra continua hifenizável.
 */
function strTexto(t, opcoes = {}) {
  // exceções do usuário (Configurações → Hifenização): a palavra só quebra nos pontos dela
  if (temExcecoes()) {
    const pedacos = []
    let ini = 0
    for (const m of String(t).matchAll(/[\p{L}-]+/gu)) {
      const pontos = pontosDaExcecao(m[0])
      if (!pontos) continue
      if (m.index > ini) pedacos.push(strTextoSemExcecao(t.slice(ini, m.index), opcoes))
      let w = '', a = 0
      for (const p of pontos) { w += m[0].slice(a, p) + String.fromCharCode(0xad); a = p }
      pedacos.push(`text(hyphenate: false, ${str(w + m[0].slice(a))})`)
      ini = m.index + m[0].length
    }
    if (pedacos.length) {
      if (ini < String(t).length) pedacos.push(strTextoSemExcecao(t.slice(ini), opcoes))
      return pedacos.length > 40 ? `[${pedacos.map(x => `#(${x})`).join('')}]` : pedacos.join(' + ')
    }
  }
  return strTextoSemExcecao(t, opcoes)
}

function strTextoSemExcecao(t, { prefixoPreferido = false, minLetras } = {}) {
  if (calibracao) return `text(hyphenate: false, ${str(comHifensIndesign(t, calibracao.dic, calibracao.minimos))})`
  const partes = segmentarTranslineacao(t, { vogais: true, regras: true, prefixoPreferido, ...(minLetras ? { minLetras } : {}) })
    .filter(s => s.t)
    .map(s => s.protegido ? `text(hyphenate: false, ${str(comHifens(s))})` : str(s.t))
  if (!partes.length) return '""'
  // trecho longo: bloco de conteúdo — uma soma "a + b + …" de centenas de partes estoura a pilha do Typst
  return partes.length > 40 ? `[${partes.map(x => `#(${x})`).join('')}]` : partes.join(' + ')
}

const PESOS = [['extrablack', 950], ['ultrablack', 950], ['black', 900], ['heavy', 900], ['extrabold', 800], ['ultrabold', 800],
  ['semibold', 600], ['demibold', 600], ['bold', 700], ['medium', 500], ['extralight', 200], ['ultralight', 200], ['light', 300], ['thin', 100]]

/** FontStyle do InDesign ("SemiBold Italic") → { weight, italic } */
function estiloDaFonte(fs) {
  const s = String(fs || 'Regular').toLowerCase().replace(/[\s-]+/g, '')
  const peso = PESOS.find(([k]) => s.includes(k))
  return { weight: peso ? peso[1] : 400, italic: /italic|oblique/.test(s) }
}

function cor(p, estilos) {
  const self = p.FillColor || 'Color/Black'
  if (/Paper|None/.test(self)) return null
  const tint = n(p.FillTint)
  const t = tint == null || tint < 0 ? 1 : tint / 100
  const c = estilos.cor(self) || (self === 'Color/Black' ? { cmyk: [0, 0, 0, 100] } : null)
  if (!c) return null
  if (c.cmyk) return `cmyk(${c.cmyk.map(v => `${Math.round(v * t * 10) / 10}%`).join(', ')})`
  const [r, g, b] = c.rgb.map(v => Math.round(255 - (255 - v) * t))
  return `rgb(${r}, ${g}, ${b})`
}

/** Propriedades de texto (fonte, corpo, peso, cor, tracking, caixa) → argumentos de text(). */
export function argsTexto(p, estilos, { corpoPadrao = null } = {}) {
  const a = []
  if (p.AppliedFont) a.push(`font: ${str(p.AppliedFont.split('\t')[0].replace(/ \(TT\)$/, ''))}`)
  if (p.FontStyle) {
    const f = estiloDaFonte(p.FontStyle)
    a.push(`weight: ${f.weight}`, `style: "${f.italic ? 'italic' : 'normal'}"`)
  }
  const corpo = n(p.PointSize) ?? corpoPadrao
  if (corpo != null) a.push(`size: ${pt(corpo)}`)
  const c = (p.FillColor || p.FillTint) ? cor(p, estilos) : null
  if (c) a.push(`fill: ${c}`)
  if (n(p.Tracking)) a.push(`tracking: ${n(p.Tracking) / 1000}em`)
  return a
}

// ── estilos de parágrafo → funções Typst ─────────────────────────
function nomeFuncao(estilo) {
  return 'P_' + estilo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')
}

export function funcaoParagrafo(estilo, estilos) {
  const p = estilos.par(estilo)
  const corpo = n(p.PointSize) ?? 12
  const leading = p.Leading && p.Leading !== 'Auto' ? n(p.Leading) : corpo * (n(p.AutoLeading) ?? 120) / 100
  // ascendente do estilo: topo das linhas na composição final (1ª linha da página como no InDesign, mancha.js)
  const asc = ascendente(p.AppliedFont || 'Source Sans 3', corpo)
  const esq = n(p.LeftIndent) || 0, dir = n(p.RightIndent) || 0, prim = n(p.FirstLineIndent) || 0
  const just = p.Justification || 'LeftAlign'
  const justify = /Justified/.test(just)
  const align = { CenterAlign: 'center', CenterJustified: 'center', RightAlign: 'right', RightJustified: 'right', AwayFromBindingSide: 'right' }[just] || 'left'
  // tracking do estilo + ajuste do parágrafo (tr); espaço entre palavras ajustável (sp)
  const trackingBase = (n(p.Tracking) || 0) / 1000
  const texto = argsTexto({ AppliedFont: 'Source Sans 3', FillColor: 'Color/Black', ...p, Tracking: undefined }, estilos, { corpoPadrao: corpo })
  const caixa0 = p.Capitalization === 'AllCaps' ? 'upper(body)' : p.Capitalization === 'SmallCaps' ? 'smallcaps(body)' : 'body'
  // lista com marcador (Marcadores e numeração do InDesign): "•" no recuo pendente, no lugar do
  // marcador + tabulação; o texto começa onde começa no InDesign (a Wingdings do modelo não vai no
  // instalador, o desenho é o da Source Sans 3)
  const marcador = p.BulletsAndNumberingListType === 'BulletList'
  const recuoMarcador = marcador ? (prim < 0 ? -prim : 8.5) : 0
  const caixa = marcador ? `[#box(width: ${pt(recuoMarcador)}, text(size: 1.3em, baseline: -0.04em)[•])#${caixa0}]` : caixa0
  // recuo negativo da 1ª linha (lista com marcador): recuo pendente
  const inset = prim < 0 ? esq + prim : esq
  const indent = prim > 0 ? `first-line-indent: (amount: ${pt(prim)}, all: true), ` : ''
  const hanging = prim < 0 ? `hanging-indent: ${pt(-prim)}, ` : ''
  // limites de justificação do estilo, como no InDesign: espaço entre palavras mín./máx. (% do espaço
  // normal; padrão do InDesign 80/133) e espaçamento entre letras (% do espaço → em, ~0,22 em por espaço)
  // (o mínimo nunca abaixo de ESPACO_MINIMO, qualquer que seja o estilo)
  const espMin = Math.max(n(p.MinimumWordSpacing) ?? 80, ESPACO_MINIMO), espMax = n(p.MaximumWordSpacing) ?? 133
  const letraMin = (n(p.MinimumLetterSpacing) ?? 0) * 0.0022, letraMax = (n(p.MaximumLetterSpacing) ?? 0) * 0.0022
  const limites = `justification-limits: (spacing: (min: ${espMin}%, max: ${espMax}%), tracking: (min: ${letraMin.toFixed(4)}em, max: ${letraMax.toFixed(4)}em)), `
  // "equilibrar linhas irregulares" do InDesign: equilibrar() no Typst, só nos estilos centralizados
  const equilibrar = !justify && align === 'center' && !!p.BalanceRaggedLines && !/^(NoBalancing|false)$/.test(p.BalanceRaggedLines)
  const sticky = n(p.KeepWithNext) > 0 || p.KeepAllLinesTogether === 'true'
  const inteiro = p.KeepAllLinesTogether === 'true'
  return {
    nome: nomeFuncao(estilo),
    justify,
    corpo,
    // espaço entre dois parágrafos seguidos deste estilo (no lugar de depois + antes); null = não se aplica
    mesmoEstilo: n(p.SameParaStyleSpacing),
    antes: n(p.SpaceBefore) || 0,
    depois: n(p.SpaceAfter) || 0,
    quebra: p.StartParagraph === 'NextOddPage' ? 'odd' : p.StartParagraph === 'NextEvenPage' ? 'even' : /Page/.test(p.StartParagraph || '') ? 'page' : null,
    // entrelinha como no InDesign: cada linha tem a altura da entrelinha (topo = entrelinha acima
    // da linha de base); o espaço entre parágrafos é só o espaço antes/depois do estilo
    // dados para a paginação (paginacao.js)
    leading,
    asc,
    estiloSticky: sticky,
    inteiro,
    // tr/sp: ajuste fino de tracking e espaço entre palavras; lf: fator de entrelinha da página
    // (±10%, paginação); hy: false = sem hifenização (parágrafo que cruza o fim de página ímpar)
    // plano: true = a paginação já foi decidida (paginacao.js); sem "manter junto" do Typst, que
    // levaria inteiro para a página seguinte um bloco que o plano divide
    // geometria e limites, para a verificação da composição (linhas.js)
    estilo,
    geo: {
      largura: larguraMancha() - Math.max(0, inset) - dir,
      // em relação à margem esquerda da coluna: começo da 1ª linha, das outras e fim das linhas
      recuo1: Math.max(0, inset) + (prim > 0 ? prim : 0) + recuoMarcador,
      esquerda: Math.max(0, inset) + (prim < 0 ? -prim : 0),
      direitaCol: larguraMancha() - dir,
      primeira: (prim > 0 ? prim : 0) + recuoMarcador,
      pendente: prim < 0 ? -prim : 0,
      espMin, espMax, letraMax,
    },
    // hc: custo de hifenização do parágrafo (auto = o do documento)
    def: `#let ${nomeFuncao(estilo)}(body, tr: 0em, sp: 100%, cola: false, lf: 1, hy: auto, hc: auto, plano: false, cp: false) = block(width: 100%, above: 0pt, below: 0pt, sticky: not plano and (${sticky} or cola), breakable: ${!inteiro}, ` +
      `inset: (left: ${pt(Math.max(0, inset))}, right: ${pt(dir)}), {\n` +
      `  set par(justify: ${justify}, ${justify ? limites : ''}${indent}${hanging}leading: if plano { ${pt(leading)} * lf - ${pt(asc)} } else { 0pt }, spacing: 0pt)\n` +
      `  set align(${align})\n` +
      `  set text(${texto.join(', ')}, tracking: ${trackingBase}em + tr, spacing: sp, top-edge: if plano { ${pt(asc)} } else { ${leading}pt * lf }, bottom-edge: 0pt, hyphenate: if hy == auto { ${p.Hyphenation !== 'false'} } else { hy })\n` +
      `  set text(costs: (hyphenation: hc)) if hc != auto\n` +
      // cp: quebras de linha decididas pelo compositor (composicaoLivro.js), explícitas no texto — o
      // Typst não hifeniza nem quebra por conta própria, só justifica (limites largos: a linha do
      // compositor tem de caber)
      `  set text(hyphenate: false) if cp\n` +
      `  set par(justification-limits: (spacing: (min: ${ESPACO_MINIMO}%, max: 400%), tracking: (min: -0.04em, max: 0.08em))) if cp\n` +
      `  ${equilibrar ? `equilibrar(${caixa})` : `par(${caixa})`}\n})`,
    // só o texto, com a fonte e o tracking do estilo: largura natural das palavras (linhas.js)
    defTexto: `#let T${nomeFuncao(estilo)}(body, tr: 0em) = { set text(${texto.join(', ')}, tracking: ${trackingBase}em + tr); ${caixa0} }`,
  }
}

// ── trechos (runs) ───────────────────────────────────────────────
function runsTypst(runs, estilos, notaEstilo) {
  return runs.map(r => {
    if (r.nota) {
      const corpo = r.nota.map(x => trecho(x, estilos)).join(' + ')
      return `#footnote(${corpo || '""'})`
    }
    if (r.texto === undefined) return ''
    return `#(${trecho(r, estilos)})`
  }).join('')
}

// ── marcas de linha (verificação da composição) ──────────────────
// O Typst não diz onde quebrou as linhas. Para conferir a composição, cada palavra do texto ganha
// uma marca invisível no começo: a posição final das marcas diz que palavras ficaram em cada linha
// e quais foram divididas entre duas linhas (hífen) — ver linhas.js. A marca vai só no começo da
// palavra, depois do espaço: com uma marca de cada lado, o espaço fica isolado entre elas e o
// Typst deixa de poder comprimi-lo, o que muda a composição.

/**
 * Runs → conteúdo Typst com marcas. `marcas` recebe, por índice, { palavra, run, espaco }: o texto
 * até o próximo espaço, o run de origem e se a marca vem depois de um espaço comum (justificável).
 * O texto vai em bloco de conteúdo ([…]), não em soma de strings: um parágrafo longo viraria uma
 * soma com milhares de termos, e o Typst estoura a pilha ao avaliá-la.
 */
export function runsMarcados(runs, estilos, i, marcas, protegidas = null, { compostasLivres = null, inseparavel = null, seisLetras = null, quebras = null, estiloPar = null } = {}) {
  // parágrafo já itálico pelo estilo (ementa): o itálico do estilo de caractere não impede a hifenização
  const parItalico = italicoDoPar(estiloPar, estilos)
  // último run com texto: ganha também uma marca no fim do parágrafo, logo depois da última palavra
  // — sem ela, a linha com o resto da última palavra hifenizada não teria marca nenhuma
  const ultimoTexto = runs.reduce((u, r, ri) => (!r.nota && r.texto?.trim() ? ri : u), -1)
  // espaço antes da próxima palavra; atravessa os runs (" do " + itálico "caput": o espaço antes de
  // "caput" está no run anterior)
  let anterior = null
  // quebras do compositor (composicaoLivro.js): k da última palavra antes de cada espaço
  let kUlt = null
  const QUEBRA = '#linebreak(justify: true)'
  return runs.map((r, ri) => {
    if (r.nota || r.texto === undefined) return runsTypst([r], estilos)
    const partes = String(r.texto).split(/([ \u2028]+)/).filter(Boolean)
    const ehEspaco = p => /^[ \u2028]+$/.test(p)
    if (!partes.some(p => !ehEspaco(p))) {
      if (partes.length) anterior = partes.join('')
      if (quebras?.espaco.has(kUlt) && !partes.join('').includes(LSEP)) return QUEBRA
      return runsTypst([r], estilos)
    }
    // peças: { espaco } ou { k, typ } (palavra com marca) — os espaços saem no fim, para poder
    // trocar um deles por espaço sem quebra
    const pecas = []
    let fimPalavra = 0
    for (const parte of partes) {
      if (ehEspaco(parte)) {
        pecas.push({ espaco: parte, kAntes: kUlt })
        anterior = parte
        continue
      }
      marcas.push({ palavra: parte, run: ri, espaco: anterior != null && !anterior.includes('\u2028'), italico: !parItalico && italicoDoRun(r, estilos) })
      // palavra protegida pela verificação (hífen no fim de página ímpar): sem hifenização
      const k = marcas.length - 1
      // palavra composta ("Salário-Educação", "nomeando-as"): quebra de preferência no hífen próprio —
      // as partes ficam sem hifenização (o Typst repete o hífen no começo da linha seguinte, como no
      // português); o espaçamento um pouco mais apertado ou aberto que isso causar é aceito
      // (compostasLivres: as que a verificação liberou, porque deixavam a linha aberta demais)
      const composta = /\p{L}[-‐]\p{L}/u.test(parte) && !compostasLivres?.has(k)
      // palavra com prefixo ("socioprofissionais"): quebra de preferência logo depois dele, salvo
      // quando a verificação liberou a palavra
      // (seisLetras: palavras em volta de linha aberta acima de 190%, que podem ser hifenizadas com 6 letras)
      let t
      if (quebras) {
        // quebras do compositor: texto puro, com o hífen e a quebra nos pontos decididos (no hífen
        // próprio, o hífen se repete no começo da linha seguinte, como no português)
        const dentro = (quebras.dentro.get(k) || []).slice().sort((a, b) => a.pos - b.pos)
        let ini = 0
        const pedacos = []
        for (const q of dentro) {
          pedacos.push(`#(${str(parte.slice(ini, q.pos))})`, q.hifen ? '#("-")' : '', QUEBRA, q.hifen ? '' : '#("-")')
          ini = q.pos
        }
        pedacos.push(`#(${str(parte.slice(ini))})`)
        t = `[${pedacos.join('')}]`
      } else {
        const base = strTexto(parte, { prefixoPreferido: !compostasLivres?.has(k), minLetras: seisLetras?.has(k) ? 6 : undefined })
        t = protegidas?.has(k) || composta ? `text(hyphenate: false, ${base})` : base
        // itálico liberado pela verificação (linha aberta demais): hifeniza, por cima do estilo de caractere
        if (!protegidas?.has(k) && !composta && (parItalico || compostasLivres?.has(k)) && italicoDoRun(r, estilos)) t = `text(hyphenate: true, ${base})`
      }
      pecas.push({ k, typ: `#metadata((${i}, ${k}))<w>#(${t})` })
      fimPalavra = pecas.length
      anterior = null
      kUlt = k
    }
    if (ri === ultimoTexto) {
      marcas.push({ palavra: '', run: ri, espaco: false, fim: true })
      pecas.splice(fimPalavra, 0, { typ: `#metadata((${i}, ${marcas.length - 1}))<w>` })
    }
    // espaço sem quebra antes ou depois de uma palavra (verificação: palavras empilhadas)
    const markup = pecas.map((p, n) => {
      if (p.espaco == null) return p.typ
      if (quebras?.espaco.has(p.kAntes) && !p.espaco.includes(LSEP)) return QUEBRA
      const juntar = inseparavel && (
        (inseparavel.lado === 'antes' && pecas[n + 1]?.k === inseparavel.k) ||
        (inseparavel.lado === 'depois' && pecas[n - 1]?.k === inseparavel.k))
      return `#(${str(juntar ? NBSP : p.espaco)})`
    }).join('')
    return `#(${trecho(r, estilos, `[${markup}]`)})`
  }).join('')
}

// estilo de caractere itálico (não se hifeniza, salvo como último recurso de linha aberta demais)
const italicoDoRun = (r, estilos) => !!r?.char && /italic|oblique/i.test(estilos.char(r.char).FontStyle || '')
// estilo de parágrafo itálico por definição (ementa)
export const italicoDoPar = (estilo, estilos) => !!estilo && /italic|oblique/i.test(estilos.par(estilo)?.FontStyle || '')

export function trecho(r, estilos, s = strTexto(r.texto)) {
  // tracking local (milésimos de em, como no InDesign): substitui o do estilo
  if (r.tracking != null) return `text(tracking: ${r.tracking / 1000}em, ${trecho({ ...r, tracking: null }, estilos, s)})`
  if (!r.char) return s
  const c = estilos.char(r.char)
  const args = argsTexto(c, estilos)
  // estilo de caractere itálico: sem hifenização (regra do usuário, só no PDF)
  if (/italic|oblique/i.test(c.FontStyle || '')) args.push('hyphenate: false')
  let corpo = args.length ? `text(${args.join(', ')}, ${s})` : s
  if (c.Position === 'Superscript' || c.Position === 'OTSuperscript') corpo = `super(${corpo})`
  if (c.Position === 'Subscript' || c.Position === 'OTSubscript') corpo = `sub(${corpo})`
  if (c.Capitalization === 'AllCaps') corpo = `upper(${corpo})`
  return corpo
}

// passos do ajuste fino: tracking (em) e espaço entre palavras (%). Limites moderados ("apertado
// leve"/"aberto leve" do InDesign): no Typst a justificação ainda encolhe/estica o espaço por
// cima destes valores, então −15/88% já fica ilegível
const AJUSTES_COMUNS = [[-0.003, 100], [-0.005, 100], [-0.005, 97], [-0.008, 97], [-0.01, 97], [-0.012, 97]]
export let AJUSTES = AJUSTES_COMUNS
export const ABRIR = [[0.003, 100], [0.005, 100], [0.005, 103], [0.008, 105], [0.01, 105]]

// custo de hifenização do documento (%; o padrão do Typst é 100): mais alto, o Typst só hifeniza
// quando evitar o hífen deixaria a linha bem mais aberta — as linhas abertas demais a verificação
// da composição corrige parágrafo a parágrafo (linhas.js)
export const HIFENIZACAO = 200

/** Passos de ajuste sem os proibidos ([[tr, sp], …]) → array Typst. */
function listaPassos(passos, proibidos) {
  const ok = passos.filter(([tr, sp]) => !proibidos.some(([t, s]) => Math.abs(t - tr) < 1e-6 && Math.abs(s - sp) < 1e-6))
  return `(${ok.map(([tr, sp]) => `(${tr}em, ${sp}%)`).join(', ')}${ok.length === 1 ? ',' : ''})`
}

// última linha curta = menos de 8 caracteres

/**
 * Runs sem os últimos LINHA_CURTA − 1 caracteres: se o parágrafo assim tem uma linha a menos, a
 * última linha tinha menos de LINHA_CURTA caracteres. null se não dá para testar (nota no fim,
 * parágrafo curto).
 */
function semFinal(runs) {
  if (!runs.length || runs[runs.length - 1].nota) return null
  const total = runs.filter(r => !r.nota).map(r => r.texto || '').join('').trim()
  if (total.length < formato.ultimaLinha * 3) return null
  let tirar = formato.ultimaLinha - 1
  const out = runs.map(r => ({ ...r }))
  // espaços no fim não contam
  for (let i = out.length - 1; i >= 0 && tirar > 0; i--) {
    const r = out[i]
    if (r.nota) return null
    const t = (r.texto || '').replace(/\s+$/, '')
    if (t.length <= tirar) { tirar -= t.length; out.splice(i, 1) } else { r.texto = t.slice(0, t.length - tirar); tirar = 0 }
  }
  return out
}

const textoPuro = runs => runs.filter(r => !r.nota).map(r => r.texto || '').join('').replace(/\u2028/g, ' ').trim()

// ── tabelas ──────────────────────────────────────────────────────
function tabelaTypst(t, estilos) {
  const P = e => estilos.par(e)
  const corpo = P('tabela:tab-corpo-esq'), cab = P('tabela:tab-cab-centro')
  const txt = (p, bold) => `set text(size: ${pt(n(p.PointSize) || 7.5)}${bold ? ', weight: 700' : ''}); set par(leading: ${pt(Math.max(0, (n(p.Leading) || 10) - (n(p.PointSize) || 7.5)))}, justify: false)`
  const celula = x => {
    const conteudo = x.pars.map(runs => runsTypst(runs, estilos)).join(' #linebreak() ')
    const args = [x.cs > 1 ? `colspan: ${x.cs}` : '', x.rs > 1 ? `rowspan: ${x.rs}` : '', x.cabecalho ? 'align: center' : ''].filter(Boolean)
    return `table.cell(${args.join(', ')}${args.length ? ', ' : ''})[#{${txt(x.cabecalho ? cab : corpo, x.cabecalho)}}#[${conteudo}]]`
  }
  const cabecalho = t.celulas.filter(x => x.r < t.cabecalho)
  const resto = t.celulas.filter(x => x.r >= t.cabecalho)
  return `#block(above: 4pt, below: 4pt, table(columns: (${t.pesos.map(p => `${Math.round(p * 100) / 100}fr`).join(', ')}), ` +
    `stroke: 0.5pt + cmyk(0%, 0%, 0%, 50%), inset: (x: 3.4pt, top: 2.8pt, bottom: 4.2pt),\n` +
    (cabecalho.length ? `table.header(${cabecalho.map(celula).join(',\n')}),\n` : '') +
    resto.map(celula).join(',\n') + '))'
}

// ── documento ────────────────────────────────────────────────────

/**
 * Itens do miolo (parágrafos e tabelas) com os dados que a paginação usa: entrelinha, espaço
 * antes (soma do "depois" anterior com o "antes" do estilo, como no InDesign), quebras e
 * "manter junto". `i` é a posição no miolo.
 */
export function itensDoMiolo(pars, estilos, f, { ajustes = true } = {}) {
  const itens = []
  let depoisAnterior = 0, estiloAnterior = null
  pars.forEach((p, i) => {
    if (p.tabela) {
      itens.push({ i, tipo: 'tabela', xml: tabelaTypst(p.tabela, estilos), espaco: 0, quebra: null, sticky: false, inteiro: true })
      depoisAnterior = 0
      estiloAnterior = null
      return
    }
    const fn = f(p.estilo)
    // mesmo estilo do anterior, com "espaço entre parágrafos do mesmo estilo" definido: vale esse espaço
    const espaco = estiloAnterior === p.estilo && fn.mesmoEstilo != null ? fn.mesmoEstilo : depoisAnterior + fn.antes
    estiloAnterior = p.estilo
    const sem = ajustes && fn.justify ? semFinal(p.runs) : null
    itens.push({
      i, tipo: 'par', fn,
      runs: p.runs,
      conteudo: runsTypst(p.runs, estilos),
      semTyp: sem ? `[${runsTypst(sem, estilos)}]` : 'none',
      notas: p.runs.filter(r => r.nota).map(r => `[#(${r.nota.map(x => trecho(x, estilos)).join(' + ') || '""'})]`),
      espaco,
      quebra: fn.quebra,
      L: fn.leading,
      // não quebrar a página entre este e o seguinte: estilo, abertura da norma, termina com ":"
      sticky: fn.estiloSticky || !!p.cola || !!p.doisPontos || !!p.fecho,
      cola: !!p.cola || !!p.doisPontos || !!p.fecho,
      manter2: !!p.manter2,
      inteiro: fn.inteiro,
      inicioNorma: !!p.inicioNorma,
      // começo de artigo e trecho de artigo (parágrafo, inciso, alínea, citação): para a paginação
      // não deixar a última linha do artigo sozinha no alto da página (paginacao.js)
      artigo: p.estilo === 'corpo-legis:art',
      trechoArtigo: p.estilo === 'corpo-legis:texto-lei' || p.estilo === 'corpo-legis:texto-lei-citacao',
      // apertar/soltar o parágrafo inteiro para ganhar/perder uma linha (paginação)
      ajustavel: ajustes && fn.justify && !p.runs.some(r => r.nota),
      parte1: textoPuro(p.runs.filter(r => r.char === 'parte1')),
      cabModo: p.cabModo || null,
      // cabeço da página ímpar da CF: 1º artigo da página (variável "Artigo-CF" do livro)
      cabArtigo: textoPuro(p.runs.filter(r => r.char === 'bold-artigo' && !r.grep).slice(0, 1)).replace(/[.\s]+$/, ''),
      nivel: nivelSumario(p.estilo),
      titulo: textoPuro(p.runs),
    })
    depoisAnterior = fn.depois
  })
  return itens
}

/** Itens do miolo para o plano de paginação (os mesmos que documentoTypst emite). */
export function itensParaPaginacao(pars, estilos) {
  const funcoes = new Map()
  const f = estilo => {
    if (!funcoes.has(estilo)) funcoes.set(estilo, funcaoParagrafo(estilo, estilos))
    return funcoes.get(estilo)
  }
  return itensDoMiolo(pars, estilos, f).map(it => ({ ...it, estiloSticky: it.fn?.estiloSticky }))
}

/**
 * @param partes {
 *   pre: [[parágrafos da 1ª página pré-textual], [2ª], …],   // páginas antes do sumário
 *   miolo: parágrafos (historia.js),
 *   colofao: parágrafos,
 *   cabecalhoPar: texto fixo do cabeço da página par,
 *   modo: 'simples' (o Typst pagina sozinho) | 'medir' (só mede os parágrafos do miolo) |
 *         'final' (com o plano de paginação de paginacao.js),
 *   plano: { [i]: { tr, sp, lf, hy, cola, quebraAntes, fatorEspaco } },
 *   verificar: marca a página de cada parágrafo (<pos>), para conferir o plano
 * }
 */
export function documentoTypst(partes, estilos) {
  const modo = partes.modo || 'simples'
  const funcoes = new Map()
  const f = estilo => {
    if (!funcoes.has(estilo)) funcoes.set(estilo, funcaoParagrafo(estilo, estilos))
    return funcoes.get(estilo)
  }
  const corpo = []
  const quebra = q => q === 'page' ? '#pagebreak(weak: true)' : `#pagebreak(weak: true, to: "${q}")`

  // pré-textuais e colofão: sem ajuste nem plano
  const emitirSimples = pars => {
    for (const it of itensDoMiolo(pars, estilos, f, { ajustes: false })) {
      if (it.tipo === 'tabela') { corpo.push(it.xml); continue }
      if (it.quebra) corpo.push(quebra(it.quebra))
      if (it.espaco > 0) corpo.push(`#v(${pt(it.espaco)}, weak: true)`)
      corpo.push(`#${it.fn.nome}[${it.conteudo}]`)
    }
  }

  // miolo: simples, medição ou final (com o plano)
  const emitirMiolo = pars => {
    const plano = partes.plano || {}
    for (const it of itensDoMiolo(pars, estilos, f)) {
      // medição parcial (rodadas da verificação): só os parágrafos pedidos
      if (modo === 'medir' && partes.somente && !partes.somente.has(it.i)) continue
      // parágrafo do compositor (composicaoLivro.js): ele mede; o Typst só mede as notas de rodapé
      const doCompositor = partes.compostos?.has(it.i)
      if (modo === 'medir' && doCompositor && !it.notas.length) continue
      // restrições da verificação da composição (linhas.js): custo de hifenização e passos de
      // ajuste proibidos neste parágrafo
      const rs = partes.restricoes?.get(it.i) || {}
      // marcas de linha nas duas fases: elas mexem (pouco) na composição do Typst, então a medição
      // tem de ver o mesmo texto que a composição final
      let conteudo = it.conteudo
      if (partes.linhas && it.tipo === 'par' && it.fn.justify) {
        const marcas = []
        conteudo = runsMarcados(it.runs, estilos, it.i, marcas, rs.semHifen ? new Set(rs.semHifen) : null,
          { compostasLivres: rs.compostasLivres ? new Set(rs.compostasLivres) : null, inseparavel: rs.pilha?.nbsp || null, seisLetras: rs.seisLetras ? new Set(rs.seisLetras) : null,
            quebras: modo === 'final' ? partes.quebras?.get(it.i) || null : null, estiloPar: it.fn.estilo })
        if (modo === 'final') partes.linhas.set(it.i, { marcas, runs: it.runs, fn: it.fn })
      }
      if (modo === 'medir') {
        if (it.tipo === 'tabela') {
          corpo.push(`#context [#metadata((i: ${it.i}, h: measure(${it.xml.slice(1)}, width: largura-mancha).height.pt(), tabela: true)) <med>]`)
          continue
        }
        const fn = rs.hc ? `${it.fn.nome}.with(hc: ${rs.hc}%)` : it.fn.nome
        let passos = rs.proibidos?.length
          ? `, aj: ${listaPassos(AJUSTES, rs.proibidos)}, ab: ${listaPassos(ABRIR, rs.proibidos)}`
          : ''
        // composição de uma rodada anterior, melhor que a das correções seguintes (exportPdf.js)
        if (rs.fixo) passos += `, fixo: (${rs.fixo.tr}em, ${rs.fixo.sp}%)`
        else if (rs.aperto != null) passos += `, fixo: (${AJUSTES[rs.aperto][0]}em, ${AJUSTES[rs.aperto][1]}%)`
        // passo escolhido para desfazer palavras empilhadas (pilhas.js)
        else if (rs.pilha?.tr != null) passos += `, fixo: (${rs.pilha.tr}em, ${rs.pilha.sp}%)`
        corpo.push(`#medir-par(${it.i}, ${fn}, [${conteudo}], ${it.semTyp}, (${it.notas.join(', ')}${it.notas.length === 1 ? ',' : ''}), ${it.ajustavel}, ${it.L}pt${passos})`)
        continue
      }
      const pl = plano[it.i] || {}
      if (it.quebra) corpo.push(quebra(it.quebra))
      if (pl.quebraAntes) corpo.push('#pagebreak(weak: true)')
      // começo e fim de cada trecho do miolo: página que nenhum trecho cobre é página em branco (sem cabeço)
      if (it.tipo === 'tabela') { corpo.push(`#metadata(${it.i})<pi>`, it.xml, '#metadata(none)<pf>'); continue }
      // com plano, a 1ª linha tem o topo na ascendente: o resto da entrelinha dela vai com o espaço antes
      // (fraco: some no alto da página, onde a linha-base fica na ascendente, como no InDesign)
      const comPlano = modo === 'final' && !!partes.plano && !pl.livre
      const espaco = it.espaco * (pl.fatorEspaco ?? 1) + (comPlano ? it.fn.leading * (pl.lf ?? 1) - it.fn.asc : 0)
      if (espaco > 0) corpo.push(`#v(${pt(espaco)}, weak: true)`)
      // cabeço corrido: texto em `parte1` (como a variável "Epígrafe parte 1" do InDesign)
      if (it.parte1) corpo.push(`#metadata(${str(it.parte1)}) <parte1>`)
      if (it.cabModo) corpo.push(`#metadata(${str(it.cabModo)}) <cab-modo>`)
      if (partes.cabecoArtigo && it.cabArtigo) corpo.push(`#metadata(${str(it.cabArtigo)}) <artigo-cab>`)
      // aberturas e epígrafes: entrada do sumário de revisão e marcador do PDF (título invisível)
      if (it.nivel) {
        const t = str(it.titulo)
        corpo.push(`#metadata((nivel: ${it.nivel}, texto: ${t})) <sum>`, `#heading(level: ${it.nivel}, outlined: false, bookmarked: true, ${t})`)
      }
      const marca = partes.verificar ? `#context [#metadata((i: ${it.i}, p: here().page())) <pos>]` : ''
      if (modo === 'final') {
        const args = [`tr: ${pl.tr ?? 0}em`, `sp: ${pl.sp ?? 100}%`, `lf: ${pl.lf ?? 1}`, `cola: ${pl.cola ?? it.cola}`, `plano: ${!!partes.plano && !pl.livre}`]
        if (pl.hy === false) args.push('hy: false')
        if (rs.hc) args.push(`hc: ${rs.hc}%`)
        if (partes.quebras?.has(it.i)) args.push('cp: true')
        // última linha apertada pelo compositor: justificada (no Typst a última linha não aperta)
        const fimJust = partes.quebras?.get(it.i)?.fimApertado ? '#linebreak(justify: true)' : ''
        corpo.push(`#metadata(${it.i})<pi>`, `#${it.fn.nome}(${args.join(', ')})[${marca}${conteudo}${fimJust}]`, '#metadata(none)<pf>')
      } else if (it.manter2) {
        // simples: ajuste fino e "manter 2 linhas" decididos pelo próprio Typst
        corpo.push(`#metadata(${it.i})<pi>`, `#manter2(${it.fn.nome}, [${marca}${it.conteudo}], ${it.semTyp})`, '#metadata(none)<pf>')
      } else if (it.semTyp !== 'none') {
        corpo.push(`#metadata(${it.i})<pi>`, `#ajustar(${it.fn.nome}, [${marca}${it.conteudo}], ${it.semTyp}${it.cola ? ', cola: true' : ''})`, '#metadata(none)<pf>')
      } else {
        corpo.push(`#metadata(${it.i})<pi>`, it.cola ? `#${it.fn.nome}(cola: true)[${marca}${it.conteudo}]` : `#${it.fn.nome}[${marca}${it.conteudo}]`, '#metadata(none)<pf>')
      }
    }
  }

  if (modo !== 'medir' && !partes.semPreTextuais) {
    for (const pagina of partes.pre || []) {
      emitirSimples(pagina)
      corpo.push('#pagebreak()')
    }
    // sumário de revisão (o do livro é feito no InDesign)
    corpo.push('#sumario()', '#pagebreak(weak: true, to: "odd")')
  }
  // o miolo começa na mesma página do IDML (as pré-textuais do modelo têm tamanho fixo), para a
  // revisão citar as mesmas páginas
  if (modo !== 'medir' && partes.primeiraPaginaMiolo) corpo.push(`#counter(page).update(${partes.primeiraPaginaMiolo})`)
  corpo.push('#metadata("miolo") <inicio-miolo>')
  emitirMiolo(partes.miolo || [])
  corpo.push('#metadata("fim") <fim-miolo>')
  // páginas ocupadas por algum trecho do miolo (calculado uma vez; o cabeço de cada página consulta)
  if (modo !== 'medir') {
    corpo.push('#context { let pares = query(<pi>).zip(query(<pf>)).map(((a, b)) => (a.location().page(), b.location().page())); let n = pares.fold(0, (m, p) => calc.max(m, p.at(1))); let oc = range(n + 1).map(_ => false); for (a, b) in pares { for p in range(a, b + 1) { oc.at(p) = true } }; [#metadata(oc) <ocupadas>] }')
  }
  // posição final das marcas de linha: (parágrafo, marca, página, x, y)
  if (partes.linhas && modo === 'final') {
    // e a página física e o fólio do começo do miolo (para saber a paridade do fólio de cada página)
    corpo.push('#context [#metadata((marcas: query(<w>).map(m => { let p = m.location().position(); (..m.value, p.page, p.x.pt(), p.y.pt()) }), trechos: query(<pi>).map(m => (m.value, m.location().page(), m.location().position().y.pt())), inicio: (query(<inicio-miolo>).first().location().page(), counter(page).at(query(<inicio-miolo>).first().location()).first()))) <wpos>]')
  }
  if (modo !== 'medir' && partes.colofao?.length) {
    // colofão na última página, com o total de páginas múltiplo de 4 (cadernos da gráfica): páginas
    // em branco antes dele, sem cabeço nem fólio
    corpo.push('#set page(header: none, footer: none)')
    corpo.push('#context { let n = here().page(); for _ in range(calc.rem(4 - calc.rem(n, 4), 4)) { pagebreak() } }')
    emitirSimples(partes.colofao)
  }

  const nota = estilos.par('corpo-legis:nota-rodape')
  // o estilo da nota recua o texto: a chamada fica no recuo (tabulação) e todas as linhas começam nele
  const recuoNota = n(nota.LeftIndent) || 0
  const cabPar = estilos.par('pg-mestra:cab-esq'), cabImpar = estilos.par('pg-mestra:cab-dir'), folio = estilos.par('pg-mestra:num-pag-impar')
  return [
    '// PDF de revisão gerado pelo Normando — não é o arquivo da gráfica.',
    `#let largura-mancha = ${larguraMancha()}pt`,
    `#set document(title: ${str(partes.titulo || '')})`,
    `#set text(font: "Source Sans 3", lang: "pt", region: "br", hyphenate: true, size: 9.5pt, top-edge: 1em, bottom-edge: 0em, costs: (widow: 100%, orphan: 100%, hyphenation: ${partes.hifenizacao ?? HIFENIZACAO}%))`,
    '#set par(spacing: 0pt)',
    '// títulos só para os marcadores do PDF: não aparecem na página',
    '#show heading: it => place(hide(it.body))',
    // o Typst põe o "gap" também antes da 1ª nota: clearance + gap = Spacer do InDesign (mancha.js)
    `#set footnote.entry(separator: line(length: 85pt, stroke: 0.5pt + cmyk(0%, 0%, 0%, 50%)), gap: ${NOTAS.entre}pt, indent: 0pt, clearance: ${NOTAS.espacador - NOTAS.entre}pt)`,
    `#show footnote.entry: set text(${argsTexto({ AppliedFont: 'Source Sans 3', ...nota }, estilos).join(', ')})`,
    `#show footnote.entry: set text(top-edge: ${pt(n(nota.Leading) || 9)}, bottom-edge: 0pt)`,
    '#show footnote.entry: set par(leading: 0pt, justify: true)',
    `#show footnote.entry: it => par(hanging-indent: ${pt(recuoNota)}, box(width: ${pt(recuoNota)}, numbering(it.note.numbering, ..counter(footnote).at(it.note.location()))) + it.note.body)`,
    '',
    '// cabeço e fólio (mestra A-Miolo): par = fólio + título da publicação; ímpar = parte1 + fólio',
    '#let cabeco() = {',
    '  let pg = here().page()',
    '  let ini = query(<inicio-miolo>)',
    '  let fim = query(<fim-miolo>)',
    '  if ini.len() == 0 or pg < ini.first().location().page() { return }',
    '  if fim.len() > 0 and pg > fim.first().location().page() { return }',
    '  // página em branco (quebra para página ímpar/par): nenhum trecho do miolo começa, termina ou passa por ela',
    '  let oc = query(<ocupadas>)',
    '  if oc.len() > 0 and not oc.first().value.at(pg, default: true) { return }',
    '  let num = counter(page).display()',
    ...cabecoDoFormato(partes),
    `  let caixa = box(width: 9.2mm, height: 6mm, stroke: 0.5pt + cmyk(0%, 0%, 0%, 40%), align(center + horizon, text(font: "Montserrat", weight: 500, size: ${pt(n(folio.PointSize) || 8.5)}, fill: cmyk(0%, 0%, 0%, 60%), top-edge: "cap-height", bottom-edge: "baseline", num)))`,
    '  if calc.even(pg) {',
    '    place(top + left, dx: 4.1mm, dy: 7.9mm, caixa)',
    `    place(top + left, dx: 17mm, dy: 9.6mm, box(width: largura-mancha, text(font: "Montserrat", size: ${pt(n(cabPar.PointSize) || 8)}, tracking: ${(n(cabPar.Tracking) || 0) / 1000}em, fill: cmyk(0%, 0%, 0%, 50%), top-edge: "cap-height", upper(${str(partes.cabecalhoPar || '')}))))`,
    '  } else {',
    '    let marcas = query(<parte1>)',
    '    let aqui = marcas.filter(m => m.location().page() == pg)',
    '    let antes = marcas.filter(m => m.location().page() < pg)',
    `    let t = if aqui.len() > 0 { aqui.first().value } else if antes.len() > 0 { antes.last().value } else { ${str(partes.cabecalhoImpar || '')} }`,
    '    let arts = query(<artigo-cab>)',
    '    let artAqui = arts.filter(m => m.location().page() == pg)',
    '    let artAntes = arts.filter(m => m.location().page() < pg)',
    '    let art = if t != "" { none } else if artAqui.len() > 0 { artAqui.first().value } else if artAntes.len() > 0 { artAntes.last().value } else { none }',
    '    place(top + left, dx: 156.2mm, dy: 7.9mm, caixa)',
    `    place(top + left, dx: 22mm, dy: 9.6mm, box(width: largura-mancha, align(right, text(font: "Montserrat", size: ${pt(n(cabImpar.PointSize) || 7.5)}, tracking: ${(n(cabImpar.Tracking) || 0) / 1000}em, fill: cmyk(0%, 0%, 0%, 60%), top-edge: "cap-height", upper(t)))))`,
    '    if art != none { place(top + left, dx: 22mm, dy: 9.3mm, box(width: largura-mancha, align(right, text(font: "Source Sans 3", weight: 700, size: 8pt, tracking: 0.02em, fill: cmyk(0%, 0%, 0%, 60%), top-edge: "cap-height", smallcaps(art))))) }',
    '  }',
    '}',
    '',
    '// ajuste fino (como o diagramador faz no InDesign): se a última linha tem menos de 8 caracteres',
    '// — o parágrafo sem os últimos 9 tem uma linha a menos —, aperta tracking e espaço entre palavras',
    '// em passos, até o fim subir; senão abre, até a última linha ficar com 8 ou mais; sem solução',
    '// dentro dos limites, fica como estava',
    `#let AJUSTES = (${AJUSTES.map(([tr, sp]) => `(${tr}em, ${sp}%)`).join(', ')})`,
    `#let ABRIR = (${ABRIR.map(([tr, sp]) => `(${tr}em, ${sp}%)`).join(', ')})`,
    '#let escolha(f, corpo, sem, aj: AJUSTES, ab: ABRIR) = {',
    '  if sem == none { return (0em, 100%) }',
    '  let medir(c) = measure(c, width: largura-mancha).height',
    '  let h0 = medir(f(corpo))',
    '  let h1 = medir(f(sem))',
    '  if h1 >= h0 { return (0em, 100%) }',
    '  // 1º apertar: o fim sobe e o parágrafo perde uma linha',
    '  for (tr, sp) in aj {',
    '    if medir(f(corpo, tr: tr, sp: sp)) <= h1 { return (tr, sp) }',
    '  }',
    '  // 2º abrir: mais texto desce (mesmo nº de linhas; sem os últimos 9 caracteres, nenhuma linha a menos)',
    '  for (tr, sp) in ab {',
    '    let a = medir(f(corpo, tr: tr, sp: sp))',
    '    if a <= h0 and medir(f(sem, tr: tr, sp: sp)) >= a { return (tr, sp) }',
    '  }',
    '  (0em, 100%)',
    '}',
    '#let escolher(f, corpo, sem, cola: false) = {',
    '  let (tr, sp) = escolha(f, corpo, sem)',
    '  f(corpo, tr: tr, sp: sp, cola: cola)',
    '}',
    '#let ajustar(f, corpo, sem, cola: false) = context escolher(f, corpo, sem, cola: cola)',
    '',
    '// "equilibrar linhas irregulares" (InDesign, VeeShape): a menor largura que mantém o número de',
    '// linhas — as linhas ficam parecidas; se a última ficar a mais longa, alarga até a primeira puxar',
    '// mais uma palavra (a mais longa em cima, como no InDesign). O parágrafo fica nessa largura, com o',
    '// alinhamento do estilo. Recebe o corpo do parágrafo (sem par()).',
    '#let equilibrar(corpo) = layout(tam => {',
    '  let alt(w, c) = measure(block(width: w, par(c))).height',
    '  let h = alt(tam.width, corpo)',
    '  // uma linha só: nada a equilibrar',
    '  if alt(100 * tam.width, corpo) >= h - 0.1pt { return par(corpo) }',
    '  let (lo, hi) = (0pt, tam.width)',
    '  for _ in range(14) {',
    '    let m = (lo + hi) / 2',
    '    if alt(m, corpo) <= h + 0.1pt { hi = m } else { lo = m }',
    '  }',
    '  // folga no fim da última linha: a maior caixa invisível que cabe nela sem criar outra linha (a',
    '  // caixa tem altura: uma linha só com caixa sem altura não aumentaria o parágrafo)',
    '  let folga(w) = {',
    '    let hw = alt(w, corpo)',
    '    let (a, b) = (0pt, w)',
    '    for _ in range(10) {',
    '      let m = (a + b) / 2',
    '      if alt(w, [#corpo#box(width: m, height: 1pt)]) <= hw + 0.1pt { a = m } else { b = m }',
    '    }',
    '    a',
    '  }',
    '  let w = hi',
    '  if folga(hi) < 2pt {',
    '    // a menor largura em que a última linha fica mais curta que as outras (ou o número de linhas muda)',
    '    let (a, b) = (hi, tam.width)',
    '    for _ in range(10) {',
    '      let m = (a + b) / 2',
    '      if alt(m, corpo) < h - 0.1pt or m - folga(m) < hi - 1pt { b = m } else { a = m }',
    '    }',
    '    if calc.abs((alt(b, corpo) - h).pt()) < 0.1 { w = b }',
    '  }',
    '  block(width: w + 0.2pt, par(corpo))',
    '})',
    '',
    '// medição para a paginação: ajuste fino escolhido, altura com e sem hifenização, notas',
    `#let nota-entrada(c) = block(width: largura-mancha - ${pt(recuoNota)}, { set text(${argsTexto({ AppliedFont: 'Source Sans 3', ...nota }, estilos).join(', ')}, top-edge: ${pt(n(nota.Leading) || 9)}, bottom-edge: 0pt); set par(leading: 0pt, justify: true); c })`,
    '// variantes para a paginação: o aperto mais leve que tira uma linha (menos) e a abertura mais',
    '// leve que acrescenta uma (mais); testa primeiro o limite, para não medir à toa',
    '#let variante(f, corpo, h, passos, menos) = {',
    '  let medir(c) = measure(c, width: largura-mancha).height',
    '  let ok(x) = if menos { x < h - 1pt } else { x > h + 1pt }',
    '  if passos.len() == 0 { return none }',
    '  let (tl, sl) = passos.last()',
    '  if not ok(medir(f(corpo, tr: tl, sp: sl))) { return none }',
    '  for (k, (t, s)) in passos.enumerate() {',
    '    let x = medir(f(corpo, tr: t, sp: s))',
    '    if ok(x) { return (tr: t.em, sp: s / 100%, h: x.pt(), passo: k) }',
    '  }',
    '  none',
    '}',
    '// fixo: aperto decidido pela verificação da composição (linha aberta além do limite)',
    '#let medir-par(i, f, corpo, sem, notas, ajustavel, L, aj: AJUSTES, ab: ABRIR, fixo: none) = context {',
    '  let (tr, sp) = if fixo != none { fixo } else { escolha(f, corpo, sem, aj: aj, ab: ab) }',
    '  let h = measure(f(corpo, tr: tr, sp: sp), width: largura-mancha).height',
    '  let hn = measure(f(corpo, tr: tr, sp: sp, hy: false), width: largura-mancha).height',
    '  let hnotas = notas.map(c => measure(nota-entrada(c)).height.pt())',
    '  // só parágrafos com 2 linhas ou mais',
    '  let ajusta = fixo == none and ajustavel and h > 1.5 * L',
    '  let menos = if ajusta { variante(f, corpo, h, aj, true) } else { none }',
    '  let mais = if ajusta { variante(f, corpo, h, ab, false) } else { none }',
    '  [#metadata((i: i, h: h.pt(), hn: hn.pt(), tr: tr.em, sp: sp / 100%, notas: hnotas, menos: menos, mais: mais)) <med>]',
    '}',
    '',
    '// 1º parágrafo de texto da norma: se tem uma linha só, cola no seguinte (a epígrafe fica com',
    '// pelo menos 2 linhas do texto; o "órfão" de 1 linha o Typst já evita)',
    '#let manter2(f, corpo, sem) = context {',
    '  let curto = measure(f(corpo), width: largura-mancha).height < 1.5 * measure(f([x]), width: largura-mancha).height',
    '  if sem == none { f(corpo, cola: curto) } else { escolher(f, corpo, sem, cola: curto) }',
    '}',
    '',
    '// sumário de revisão: aberturas de seção e epígrafes, com página',
    '#let sumario() = context {',
    '  block(below: 12pt, align(center, text(font: "Montserrat", weight: 500, size: 12pt, tracking: 0.02em, upper("Sumário"))))',
    '  set text(size: 8.5pt)',
    '  set par(leading: 3.5pt, justify: false)',
    '  for m in query(<sum>) {',
    '    let v = m.value',
    '    let pg = counter(page).at(m.location()).first()',
    '    let linha = link(m.location(), box(width: 100%, [#v.texto #box(width: 1fr, repeat[.]) #pg]))',
    '    if v.nivel == 1 { block(above: 8pt, below: 3pt, text(weight: 700, upper(linha))) }',
    '    else { block(above: 2.5pt, pad(left: 4mm, linha)) }',
    '  }',
    '}',
    '',
    ...[...funcoes.values()].map(x => x.def),
    '',
    `#set page(width: ${formato.largura}pt, height: ${formato.altura}pt, binding: left,`,
    `  margin: (top: ${formato.topo}pt, bottom: ${formato.baixo}pt, inside: ${formato.dentro}pt, outside: ${formato.fora}pt),`,
    '  foreground: context cabeco())',
    '',
    ...corpo,
  ].join('\n')
}

/**
 * Documento que só mede a largura natural de palavras (verificação da composição, linhas.js).
 * @param pedidos [{ estilo, tr, run, palavra }]
 * @returns código Typst; a consulta <lg> devolve as larguras (pt), na ordem dos pedidos
 */
/**
 * Cabeço e fólio de um formato com mestra própria (bolso): tudo pela posição dos quadros da mestra
 * (formatoDoLivro). Sem `formato.cabeco`, segue o cabeço do modelo, logo abaixo no documento.
 */
function cabecoDoFormato(partes) {
  const c = formato.cabeco
  if (!c) return []
  const tinta = (e, d) => `cmyk(0%, 0%, 0%, ${e.tinta ?? d}%)`
  // quadro do InDesign alinhado no topo: 1ª linha de base na ascendente da fonte (top-edge
  // "ascender"); centro/baixo conforme o quadro da mestra
  const vert = q => q.vertical === 'centro' ? 'horizon' : q.vertical === 'baixo' ? 'bottom' : 'top'
  const em = (q, alinhar, conteudo) => `place(top + left, dx: ${q.x}pt, dy: ${q.y}pt, box(width: ${q.w}pt, height: ${q.h}pt, align(${alinhar} + ${vert(q)}, ${conteudo})))`
  const fonte = (e, resto = '') => `font: "Montserrat", size: ${e.corpo || 7.5}pt, tracking: ${(e.tracking || 0) / 1000}em, top-edge: "ascender", bottom-edge: "baseline"${resto}`
  const num = (q, alinhar) => `place(top + left, dx: ${q.x}pt, dy: ${q.y}pt, box(width: ${q.w}pt, height: ${q.h}pt, align(${alinhar} + ${q.vertical ? vert(q) : 'horizon'}, text(font: "Montserrat", size: ${c.folio.corpo}pt, fill: cmyk(0%, 0%, 0%, ${c.folio.tinta}%), top-edge: "${q.vertical && q.vertical !== 'centro' ? 'ascender' : 'cap-height'}", bottom-edge: "baseline", num))))`
  // valor em vigor na página: o 1º marcado nela ou, sem nenhum, o último antes (como as variáveis
  // "primeiro na página" do InDesign)
  const corrente = (rotulo, nome, padrao) => [
    `    let ${nome}M = query(<${rotulo}>)`,
    `    let ${nome}Aqui = ${nome}M.filter(m => m.location().page() == pg)`,
    `    let ${nome}Antes = ${nome}M.filter(m => m.location().page() < pg)`,
    `    let ${nome} = if ${nome}Aqui.len() > 0 { ${nome}Aqui.first().value } else if ${nome}Antes.len() > 0 { ${nome}Antes.last().value } else { ${padrao} }`,
  ]
  if (partes.cabecoPorNorma) {
    // livro dividido pelas epígrafes (Regimento): par = título corrido da norma; ímpar = artigo ou
    // título, conforme a mestra da norma no livro (cab-modo)
    return [
      ...corrente('parte1', 't', str(partes.cabecalhoImpar || partes.cabecalhoPar || '')),
      '  if calc.even(pg) {',
      `    ${num(c.folio.par, 'left')}`,
      `    ${em(c.esquerda.quadro, 'left', `text(${fonte(c.esquerda, `, fill: ${tinta(c.esquerda, 50)}`)}, upper(t))`)}`,
      '  } else {',
      `    ${num(c.folio.impar, 'right')}`,
      // a mestra da página: a da norma que começa nela, ou a da norma que vem de antes
      '    let modos = query(<cab-modo>)',
      '    let modoAntes = modos.filter(m => m.location().page() < pg)',
      '    let modoAqui = modos.filter(m => m.location().page() == pg)',
      '    let modo = if modoAqui.len() > 0 { modoAqui.first().value } else if modoAntes.len() > 0 { modoAntes.last().value } else { "artigo" }',
      ...corrente('artigo-cab', 'art', 'none'),
      `    if modo == "artigo" and art != none { ${em(c.artigo.quadro, 'right', `text(${fonte(c.artigo, ', weight: 700, fill: cmyk(0%, 0%, 0%, 60%)')}, smallcaps(art))`)} }`,
      // (norma com cabeço de título: o quadro da mestra dela, quando o livro tem — c.titulo)
      // (mestra dessas normas sem quadro de cabeço na ímpar — c.tituloVazio: a ímpar fica sem cabeço)
      c.tituloVazio ? '    else if modo != "artigo" { }' :
      `    else if modo != "artigo" { ${em((c.titulo || c.direita).quadro, 'right', `text(${fonte(c.titulo || c.direita, `, fill: ${tinta(c.titulo || c.direita, 60)}`)}, upper(t))`)} }`,
      `    else { ${em(c.direita.quadro, 'right', `text(${fonte(c.direita, `, fill: ${tinta(c.direita, 60)}`)}, upper(t))`)} }`,
      '  }',
      '  return',
    ]
  }
  return [
    '  if calc.even(pg) {',
    `    ${num(c.folio.par, 'left')}`,
    `    ${em(c.esquerda.quadro, 'left', `text(${fonte(c.esquerda, `, fill: ${tinta(c.esquerda, 50)}`)}, upper(${str(partes.cabecalhoPar || '')}))`)}`,
    '  } else {',
    `    ${num(c.folio.impar, 'right')}`,
    '    let marcas = query(<parte1>)',
    '    let aqui = marcas.filter(m => m.location().page() == pg)',
    '    let antes = marcas.filter(m => m.location().page() < pg)',
    `    let t = if aqui.len() > 0 { aqui.first().value } else if antes.len() > 0 { antes.last().value } else { ${str(partes.cabecalhoImpar || '')} }`,
    '    let arts = query(<artigo-cab>)',
    '    let artAqui = arts.filter(m => m.location().page() == pg)',
    '    let artAntes = arts.filter(m => m.location().page() < pg)',
    '    let art = if t != "" { none } else if artAqui.len() > 0 { artAqui.first().value } else if artAntes.len() > 0 { artAntes.last().value } else { none }',
    `    if art != none { ${em(c.artigo.quadro, 'right', `text(${fonte(c.artigo, ', weight: 700, fill: cmyk(0%, 0%, 0%, 60%)')}, smallcaps(art))`)} }`,
    // título na ímpar: o quadro da mestra das páginas de título (c.titulo), quando o livro tem
    // um — o cab-dir da mestra A pode estar em outro lugar (CF de bolso: ADCT)
    c.tituloVazio ? '    else { }' :
    `    else { ${em((c.titulo || c.direita).quadro, 'right', `text(${fonte(c.titulo || c.direita, `, fill: ${tinta(c.titulo || c.direita, 60)}`)}, upper(t))`)} }`,
    '  }',
    '  return',
  ]
}

export function documentoLarguras(pedidos, estilos) {
  const funcoes = new Map()
  const f = estilo => {
    if (!funcoes.has(estilo)) funcoes.set(estilo, funcaoParagrafo(estilo, estilos))
    return funcoes.get(estilo)
  }
  const medidas = pedidos.map(({ estilo, tr, run, palavra, divisivel, prefixoPreferido, minLetras, puro }) => {
    // puro: o texto inteiro, sem os trechos de proteção (que no Typst cortam o tracking)
    const s = puro ? str(palavra) : strTexto(palavra, { prefixoPreferido: !!prefixoPreferido, minLetras })
    const c = run ? trecho(run, estilos, s) : s
    const t = `T${f(estilo).nome}(tr: ${tr}em, ${c})`
    // divisível: quantas linhas a palavra ocupa numa coluna de 1 pt (mais de 1 = tem ponto de
    // divisão permitido, com as mesmas proteções do livro)
    if (divisivel) return `calc.round(measure(block(width: 1pt, ${t})).height / measure(block(width: 10000pt, ${t})).height)`
    return `measure(${t}).width.pt()`
  })
  return [
    '#set text(font: "Source Sans 3", lang: "pt", region: "br", size: 9.5pt, hyphenate: true)',
    ...[...funcoes.values()].map(x => x.defTexto),
    `#context [#metadata((${medidas.join(',\n')}${medidas.length === 1 ? ',' : ''})) <lg>]`,
  ].join('\n')
}

/**
 * Documento de tentativas (palavras empilhadas, pilhas.js): cada tentativa é um parágrafo do miolo
 * composto sozinho, numa página da largura da mancha, com outro tracking/espaço ou um espaço sem
 * quebra. As marcas <w> usam o id da tentativa; a consulta <wpos> tem o mesmo formato da do livro.
 * @param tentativas [{ id, it (item do miolo), tr, sp, lf, hc, semHifen, compostasLivres, nbsp }]
 * @param marcasPorId Map id → marcas (preenchido aqui)
 */
export function documentoTentativas(tentativas, estilos, { hifenizacao, marcasPorId }) {
  const funcoes = new Map()
  const f = estilo => {
    if (!funcoes.has(estilo)) funcoes.set(estilo, funcaoParagrafo(estilo, estilos))
    return funcoes.get(estilo)
  }
  const corpo = tentativas.map(t => {
    const fn = f(t.it.fn.estilo)
    const marcas = []
    const conteudo = runsMarcados(t.it.runs, estilos, t.id, marcas, t.semHifen ? new Set(t.semHifen) : null,
      { compostasLivres: t.compostasLivres ? new Set(t.compostasLivres) : null, inseparavel: t.nbsp || null, quebras: t.quebras || null, estiloPar: t.it.fn.estilo })
    marcasPorId.set(t.id, marcas)
    const args = [`tr: ${t.tr}em`, `sp: ${t.sp}%`, `lf: ${t.lf ?? 1}`, 'plano: true']
    if (t.hc) args.push(`hc: ${t.hc}%`)
    if (t.quebras) args.push('cp: true')
    return `#block(width: largura-mancha)[#${fn.nome}(${args.join(', ')})[${conteudo}${t.quebras?.fimApertado ? '#linebreak(justify: true)' : ''}]]
#pagebreak()`
  })
  return [
    `#set text(font: "Source Sans 3", lang: "pt", region: "br", hyphenate: true, size: 9.5pt, top-edge: 1em, bottom-edge: 0em, costs: (widow: 100%, orphan: 100%, hyphenation: ${hifenizacao ?? HIFENIZACAO}%))`,
    '#set par(spacing: 0pt)',
    `#let largura-mancha = ${larguraMancha()}pt`,
    `#set page(width: ${larguraMancha() + 10 * PT_MM}pt, height: auto, margin: 5mm)`,
    ...[...funcoes.values()].map(x => x.def),
    ...corpo,
    '#context [#metadata((marcas: query(<w>).map(m => { let p = m.location().position(); (..m.value, p.page, p.x.pt(), p.y.pt()) }), trechos: (), inicio: (1, 1))) <wpos>]',
  ].join('\n')
}

/** Nível no sumário/marcadores do PDF: aberturas de seção (1) e epígrafes de norma ou de texto (2). */
function nivelSumario(estilo) {
  if (/abertura-cap/.test(estilo)) return 1
  if (/tit-subtit:epigrafe(-emenda|-quebra)?$/.test(estilo) || estilo === 'artigos:epigrafe-artigo') return 2
  return 0
}

// ── pré-textuais: story IDML (já com os campos preenchidos) → parágrafos ─────────────
export function paragrafosDaStory(xml) {
  const pars = []
  for (const psr of xml.matchAll(/<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle\/([^"]+)"[^>]*>([\s\S]*?)<\/ParagraphStyleRange>/g)) {
    const estilo = decodeURIComponent(psr[1].replace(/%3a/gi, ':'))
    let runs = []
    // grupos e quadros ancorados (brasão) ficam de fora
    const corpo = psr[2].replace(/<(Group|Rectangle|TextFrame)[\s\S]*?<\/\1>/g, '')
    for (const csr of corpo.matchAll(/<CharacterStyleRange[^>]*AppliedCharacterStyle="CharacterStyle\/([^"]+)"[^>]*>([\s\S]*?)<\/CharacterStyleRange>/g)) {
      const char = /^\$ID\//.test(csr[1]) ? null : decodeURIComponent(csr[1])
      for (const parte of csr[2].matchAll(/<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g)) {
        if (parte[0].startsWith('<Br')) { pars.push({ estilo, runs }); runs = []; continue }
        const t = parte[1].replace(/<\?ACE 8\?>/g, '   ').replace(/<\?[^>]*\?>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        if (t) runs.push({ texto: t, char })
      }
    }
    if (runs.length) pars.push({ estilo, runs })
  }
  return pars.filter(p => p.runs.some(r => r.texto.trim()))
}
