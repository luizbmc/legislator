import { isTipoEmendaConstitucional, TIPOS_NORMA } from '../constants/normas.js'
import {
  ajustarEstiloParagrafoPorTipo,
  ESTILOS_EMENDA_CONSTITUCIONAL_OCULTOS,
  ESTILOS_CARACTERE_LEGISLATOR,
  ESTILOS_PARAGRAFO_LEGISLATOR,
} from '../constants/estilosLegislator.js'

const STORAGE_KEY = 'legislator.preferenciasEstilo.v1'

export const OPCOES_FORMATACAO = {
  tamanhos: ['P', 'M', 'G', 'GG'],
  cores: [
    { id: 'preto', label: 'Preto', valor: '#111111' },
    { id: 'cinza', label: '#777', valor: '#777777' },
    { id: 'azulNota', label: 'Azul da nota', valor: '#1d6fd1' },
  ],
  alinhamentos: [
    { id: 'left', label: 'Esquerda' },
    { id: 'center', label: 'Centro' },
    { id: 'right', label: 'Direita' },
  ],
  espacamentos: ['P', 'M', 'G', 'GG'],
}

export const FORMATO_PARAGRAFO_PADRAO = {
  tamanhoFonte: 'M',
  corFonte: 'preto',
  alinhamento: 'left',
  indentacao: false,
  espacoAntes: 'P',
  espacoDepois: 'P',
  italico: false,
  negrito: false,
}

export const FORMATO_CARACTERE_PADRAO = {
  tamanhoFonte: 'M',
  corFonte: 'preto',
  italico: false,
  negrito: false,
}

function storageDisponivel() {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function preferenciasVazias() {
  return {
    version: 1,
    overrides: { paragrafo: {}, caractere: {} },
    custom: { paragrafo: [], caractere: [] },
  }
}

export function carregarPreferenciasEstilo() {
  if (!storageDisponivel()) return preferenciasVazias()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return preferenciasVazias()
    const parsed = JSON.parse(raw)
    return {
      ...preferenciasVazias(),
      ...parsed,
      overrides: {
        paragrafo: parsed?.overrides?.paragrafo || {},
        caractere: parsed?.overrides?.caractere || {},
      },
      custom: {
        paragrafo: Array.isArray(parsed?.custom?.paragrafo) ? parsed.custom.paragrafo : [],
        caractere: Array.isArray(parsed?.custom?.caractere) ? parsed.custom.caractere : [],
      },
    }
  } catch {
    return preferenciasVazias()
  }
}

export function salvarPreferenciasEstilo(preferencias) {
  const prefs = {
    ...preferenciasVazias(),
    ...preferencias,
    version: 1,
  }
  if (storageDisponivel()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    window.dispatchEvent(new CustomEvent('legislator:preferencias-estilo', { detail: prefs }))
  }
  return prefs
}

export function slugEstilo(valor) {
  const slug = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'estilo'
}

export function idEstiloCustom(tipo, label) {
  return `custom${tipo === 'paragrafo' ? 'P' : 'C'}_${slugEstilo(label)}_${Date.now().toString(36)}`
}

function aplicarOverride(estilo, override = {}) {
  return {
    ...estilo,
    importTag: override.importTag ?? estilo.importTag,
    exportTag: override.exportTag ?? estilo.exportTag,
    htmlImport: override.htmlImport ?? estilo.htmlImport,
    cssClass: override.cssClass ?? estilo.cssClass,
  }
}

export function estilosParagrafoConfigurados({ incluirInternos = true, tipoNorma = '' } = {}) {
  const prefs = carregarPreferenciasEstilo()
  const base = ESTILOS_PARAGRAFO_LEGISLATOR
    .filter(e => incluirInternos || !e.interno)
    .map(e => ajustarEstiloParagrafoPorTipo(e, tipoNorma))
    .map(e => aplicarOverride(e, prefs.overrides.paragrafo[e.node]))
  return [...base, ...prefs.custom.paragrafo.map(e => ({ ...e, custom: true, disponibilidade: 'custom' }))]
}

export function estilosCaractereConfigurados({ incluirInternos = true } = {}) {
  const prefs = carregarPreferenciasEstilo()
  const base = ESTILOS_CARACTERE_LEGISLATOR
    .filter(e => incluirInternos || !e.interno)
    .map(e => aplicarOverride(e, prefs.overrides.caractere[e.id]))
  return [...base, ...prefs.custom.caractere.map(e => ({ ...e, custom: true, disponibilidade: 'custom' }))]
}

export function estiloAtivoNoTipo(estilo, tipoNorma = '') {
  if (!estilo?.custom) {
    if (isTipoEmendaConstitucional(tipoNorma) && ESTILOS_EMENDA_CONSTITUCIONAL_OCULTOS.has(estilo?.node)) return false
    return true
  }
  const tipos = Array.isArray(estilo.tiposNorma) ? estilo.tiposNorma : []
  return tipos.length === 0 || tipos.includes(tipoNorma)
}

export function tiposNormaTexto(estilo) {
  if (!estilo?.custom) return null
  const tipos = Array.isArray(estilo.tiposNorma) ? estilo.tiposNorma : []
  return tipos.length ? tipos.join(', ') : 'Todos os tipos de norma'
}

function tagImportacao(estilo) {
  return estilo?.importTag ?? estilo?.xmlTag ?? ''
}

function tagExportacao(estilo) {
  return estilo?.exportTag ?? estilo?.xmlTag ?? ''
}

export function encontrarParagrafoPorTagImportacao(tag) {
  const alvo = String(tag || '')
  return estilosParagrafoConfigurados().find(e => tagImportacao(e) === alvo || e.xmlTag === alvo) || null
}

export function encontrarCaracterePorTagImportacao(tag) {
  const alvo = String(tag || '')
  return estilosCaractereConfigurados().find(e => tagImportacao(e) === alvo || e.xmlTag === alvo) || null
}

export function tagExportacaoParagrafo(type, attrs = {}) {
  if (type === 'estiloParagrafoCustom') {
    const estilo = estilosParagrafoConfigurados().find(e => e.id === attrs.styleId)
    return tagExportacao(estilo) || attrs.styleId || null
  }
  const estilo = estilosParagrafoConfigurados().find(e => e.node === type)
  return tagExportacao(estilo) || null
}

export function tagExportacaoCaractere(mark) {
  if (!mark) return null
  if (mark.type === 'estiloCaractereCustom') {
    const estilo = estilosCaractereConfigurados().find(e => e.id === mark.attrs?.styleId)
    return tagExportacao(estilo) || mark.attrs?.styleId || null
  }
  const estilo = estilosCaractereConfigurados().find(e => e.id === mark.type)
  return tagExportacao(estilo) || null
}

function seletorCasa(el, seletor) {
  const s = String(seletor || '').trim()
  if (!s) return false
  if (s.startsWith('.')) return el.classList?.contains(s.slice(1))
  const m = s.match(/^([a-z0-9_-]+)\.([a-z0-9_-]+)$/i)
  if (m) return el.tagName?.toLowerCase() === m[1].toLowerCase() && el.classList?.contains(m[2])
  return el.tagName?.toLowerCase() === s.toLowerCase() || el.classList?.contains(s)
}

export function encontrarParagrafoPorHtml(el) {
  return estilosParagrafoConfigurados()
    .filter(e => e.htmlImport)
    .find(e => String(e.htmlImport).split(',').some(sel => seletorCasa(el, sel))) || null
}

export function encontrarCaracterePorHtml(el) {
  return estilosCaractereConfigurados()
    .filter(e => e.htmlImport)
    .find(e => String(e.htmlImport).split(',').some(sel => seletorCasa(el, sel))) || null
}

const FONTES_PARAGRAFO = { P: '10pt', M: '12pt', G: '14pt', GG: '18pt' }
const FONTES_CARACTERE = { P: '0.85em', M: '1em', G: '1.15em', GG: '1.35em' }
const ESPACOS = { P: '4pt', M: '8pt', G: '14pt', GG: '24pt' }

function corValor(id) {
  return OPCOES_FORMATACAO.cores.find(c => c.id === id)?.valor || '#111111'
}

export function cssFormatoParagrafo(format = {}) {
  const f = { ...FORMATO_PARAGRAFO_PADRAO, ...format }
  const regras = [
    `font-size: ${FONTES_PARAGRAFO[f.tamanhoFonte] || FONTES_PARAGRAFO.M}`,
    `color: ${corValor(f.corFonte)}`,
    `text-align: ${f.alinhamento || 'left'}`,
    `margin-top: ${ESPACOS[f.espacoAntes] || ESPACOS.P}`,
    `margin-bottom: ${ESPACOS[f.espacoDepois] || ESPACOS.P}`,
    `text-indent: ${f.indentacao ? '24pt' : '0'}`,
    `font-style: ${f.italico ? 'italic' : 'normal'}`,
    `font-weight: ${f.negrito ? '700' : '400'}`,
  ]
  return regras.join('; ')
}

export function cssFormatoCaractere(format = {}) {
  const f = { ...FORMATO_CARACTERE_PADRAO, ...format }
  const regras = [
    `font-size: ${FONTES_CARACTERE[f.tamanhoFonte] || FONTES_CARACTERE.M}`,
    `color: ${corValor(f.corFonte)}`,
    `font-style: ${f.italico ? 'italic' : 'normal'}`,
    `font-weight: ${f.negrito ? '700' : '400'}`,
  ]
  return regras.join('; ')
}

export function normalizarTiposNorma(tipos = []) {
  const set = new Set((tipos || []).filter(t => TIPOS_NORMA.includes(t)))
  return [...set]
}
