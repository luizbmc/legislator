/**
 * hifenizacaoExcecoes.js — exceções de hifenização do usuário (Configurações → Hifenização): uma
 * palavra por linha, com "_" nos pontos onde ela pode ser dividida ("aero_es_pa_cial"). Palavra
 * sem "_" não se divide.
 *
 * Valem no compositor do Normando (só esses pontos, no lugar dos do dicionário e das regras de
 * translineação), no texto do PDF composto pelo Typst e no IDML (dicionário do documento do
 * InDesign, "aero~es~pa~cial").
 *
 * Guardadas no cadastro "hifenizacao" ({ palavras: texto }), comum a todas as publicações; quem
 * gera o PDF/IDML carrega a lista com definirExcecoes antes.
 */

let excecoes = new Map()  // palavra em minúsculas, sem "_" → [posições de quebra]

const minusculas = t => String(t).toLocaleLowerCase('pt-BR')

/** Texto da configuração → { mapa, invalidas: [linhas] }. */
export function lerExcecoes(texto) {
  const mapa = new Map(), invalidas = []
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const l = bruta.trim()
    if (!l || l.startsWith('#')) continue
    // letras, "_" nos pontos e hífen próprio (palavra composta)
    if (!/^[\p{L}_-]+$/u.test(l) || /__|^_|_$|_-|-_/.test(l)) { invalidas.push(l); continue }
    const pontos = []
    let palavra = ''
    for (const c of l) {
      if (c === '_') pontos.push(palavra.length)
      else palavra += c
    }
    mapa.set(minusculas(palavra), pontos)
  }
  return { mapa, invalidas }
}

/** Define as exceções da geração atual (texto da configuração ou o objeto { palavras }). */
export function definirExcecoes(valor) {
  const texto = typeof valor === 'string' ? valor : valor?.palavras
  excecoes = lerExcecoes(texto).mapa
}

/** Pontos de quebra da exceção da palavra (só letras/hífen), ou null se ela não está na lista. */
export function pontosDaExcecao(palavra) {
  return excecoes.get(minusculas(palavra)) ?? null
}

export const temExcecoes = () => excecoes.size > 0

/** Palavra com "~" nos pontos (formato do dicionário do InDesign); sem pontos: "~palavra" (não divide). */
export function formatoIndesign(palavra, pontos) {
  if (!pontos.length) return '~' + palavra
  let s = '', ini = 0
  for (const p of pontos) { s += palavra.slice(ini, p) + '~'; ini = p }
  return s + palavra.slice(ini)
}

/** Lista para o IDML: [{ palavra, indesign }]. */
export function excecoesParaIndesign() {
  return [...excecoes].map(([palavra, pontos]) => ({ palavra, indesign: formatoIndesign(palavra, pontos) }))
}

/**
 * designmap.xml com as exceções do usuário no dicionário do documento do InDesign (português do
 * Brasil, neutro e acordo ortográfico): a entrada da mesma palavra é trocada, as outras ficam.
 */
export function excecoesNoDesignmap(designmap) {
  const lista = excecoesParaIndesign()
  if (!lista.length) return designmap
  const novas = new Map(lista.map(x => [x.palavra, x.indesign]))
  const chave = e => minusculas(e.replace(/^\$ID\//, '').replace(/~/g, ''))
  let out = designmap.replace(/<HyphenationException\b[^>]*\/>/g, tag => {
    if (!/Name="\$ID\/(Neutral|Portuguese[^"]*)"/.test(tag)) return tag
    return tag.replace(/AddedExceptions="([^"]*)"/, (m, v) => {
      const atuais = v.split(' ').filter(e => e && e !== '$ID/' && !novas.has(chave(e)))
      return `AddedExceptions="${[...atuais, ...[...novas.values()].map(w => '$ID/' + w)].join(' ')}"`
    })
  })
  // documento sem dicionário próprio (ex.: CF de bolso): cria o das duas variantes do português
  const todas = [...novas.values()].map(w => '$ID/' + w).join(' ')
  const faltam = ['Portuguese: Brazilian', 'Portuguese: Orthographic Agreement']
    .filter(l => !out.includes(`<HyphenationException Self="`) || !out.split('<HyphenationException ').some(t => t.includes(`Name="$ID/${l}"`)))
  if (faltam.length) {
    const tags = faltam.map((l, k) => `\t<HyphenationException Self="dHyphenationExceptionNormando${k}" Name="$ID/${l}" RemovedExceptions="" AddedExceptions="${todas}" />\n`).join('')
    const i = out.search(/\t?<IndexingSortOption\b/)
    out = i >= 0 ? out.slice(0, i) + tags + out.slice(i) : out.replace('</Document>', tags + '</Document>')
  }
  return out
}
