/**
 * hifenizacaoIndesign.js — pontos de hifenização como os do InDesign (experimento de calibração).
 *
 * Lê os padrões de hifenização (Liang, formato do libhyphen/Hunspell) do dicionário que o próprio
 * InDesign usa — o arquivo fica na instalação do InDesign do usuário e não é copiado para o projeto —
 * e aplica os mínimos do estilo de parágrafo (palavras com mais de N letras, letras antes e depois do
 * hífen). O texto sai com hífens discricionários (U+00AD) nesses pontos: no Typst, com a hifenização
 * automática desligada, só eles quebram.
 */
import { readFileSync } from 'fs'

const HIFEN_DISCRICIONARIO = String.fromCharCode(0xad)

/** Padrões de um arquivo hyph_*.dic: Map(letras → níveis entre as letras). */
export function lerPadroes(arquivo) {
  const padroes = new Map()
  let maior = 0
  for (const bruta of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const l = bruta.trim()
    // cabeçalho, comentários, palavras-chave e padrões não padronizados ("7-/=-,1,1")
    if (!l || l.startsWith('%') || /^[A-Z]/.test(l) || l.includes('/') || l.includes(',')) continue
    const letras = l.replace(/\d/g, '')
    const niveis = new Array(letras.length + 1).fill(0)
    let k = 0
    for (const c of l) {
      if (/\d/.test(c)) niveis[k] = Number(c)
      else k++
    }
    padroes.set(letras, niveis)
    maior = Math.max(maior, letras.length)
  }
  return { padroes, maior }
}

/**
 * Pontos de quebra de uma palavra (só letras): posições p (quebra entre p-1 e p).
 * minimos = { palavra: letras mínimas da palavra, antes, depois }
 */
export function pontosDaPalavra(palavra, { padroes, maior }, minimos) {
  const n = palavra.length
  if (n < minimos.palavra) return []
  const w = '.' + palavra.toLocaleLowerCase('pt-BR') + '.'
  const niveis = new Array(w.length + 1).fill(0)
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j <= Math.min(w.length, i + maior); j++) {
      const v = padroes.get(w.slice(i, j))
      if (!v) continue
      for (let k = 0; k < v.length; k++) if (v[k] > niveis[i + k]) niveis[i + k] = v[k]
    }
  }
  const out = []
  // nível ímpar entre as letras p-1 e p da palavra = niveis[p + 1] (o "." do começo desloca 1)
  for (let p = minimos.antes; p <= n - minimos.depois; p++) if (niveis[p + 1] % 2 === 1) out.push(p)
  return out
}

/** Texto com hífens discricionários nos pontos do InDesign (cada sequência de letras é uma palavra). */
export function comHifensIndesign(texto, dic, minimos) {
  return String(texto).replace(/\p{L}+/gu, palavra => {
    const pontos = pontosDaPalavra(palavra, dic, minimos)
    if (!pontos.length) return palavra
    let s = ''
    let ini = 0
    for (const p of pontos) { s += palavra.slice(ini, p) + HIFEN_DISCRICIONARIO; ini = p }
    return s + palavra.slice(ini)
  })
}

