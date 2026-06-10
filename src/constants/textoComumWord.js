export const TEXTO_COMUM_WORD_STYLE_MAP = [
  "p[style-name='_TITULOS>Título 1 com quebra'] => p.texto-comum_titulo:fresh",
  "p[style-name='_TITULOS>Título 2'] => p.texto-comum_subtitulo:fresh",
  "p[style-name='_MIOLO>Corpo'] => p.texto-comum_texto-corrido:fresh",
  "p[style-name='_MIOLO>Citação'] => p.texto-comum_citacao:fresh",
  "p[style-name='_MIOLO>Assinatura'] => p.texto-comum_assinatura:fresh",
  "p[style-name='_MIOLO>Recuo nível 1'] => p.texto-comum_texto-recuado:fresh",
  "p[style-name='_MIOLO>Marcador nível 1'] => p.texto-comum_bullets:fresh",
]

const WORD_STYLE_TO_PIPELINE_STYLE = {
  '_titulos>titulo 1 com quebra': 'texto-comum-titulo',
  '_titulos>titulo 2': 'texto-comum-subtitulo',
  '_miolo>corpo': 'texto-comum-corrido',
  '_miolo>citacao': 'texto-comum-citacao',
  '_miolo>assinatura': 'texto-comum-assinatura',
  '_miolo>recuo nivel 1': 'texto-comum-recuado',
  '_miolo>marcador nivel 1': 'texto-comum-bullets',
}

const HTML_CLASS_TO_PIPELINE_STYLE = {
  'texto-comum_titulo': 'texto-comum-titulo',
  'texto-comum_subtitulo': 'texto-comum-subtitulo',
  'texto-comum_texto-corrido': 'texto-comum-corrido',
  'texto-comum_citacao': 'texto-comum-citacao',
  'texto-comum_assinatura': 'texto-comum-assinatura',
  'texto-comum_texto-recuado': 'texto-comum-recuado',
  'texto-comum_bullets': 'texto-comum-bullets',
}

function normalizar(valor) {
  return String(valor || '')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&')
    .replace(/\\/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*>\s*/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function compacto(valor) {
  return normalizar(valor).replace(/[^a-z0-9]/g, '')
}

export function estiloTextoComumPorWordStyleName(nome) {
  const n = normalizar(nome)
  if (!n) return null
  if (WORD_STYLE_TO_PIPELINE_STYLE[n]) return WORD_STYLE_TO_PIPELINE_STYLE[n]

  if (n.includes('_titulos>titulo 1') && n.includes('quebra')) return 'texto-comum-titulo'
  if (n.includes('_titulos>titulo 2')) return 'texto-comum-subtitulo'
  if (n.includes('_miolo>corpo')) return 'texto-comum-corrido'
  if (n.includes('_miolo>citacao')) return 'texto-comum-citacao'
  if (n.includes('_miolo>assinatura')) return 'texto-comum-assinatura'
  if (n.includes('_miolo>recuo nivel 1')) return 'texto-comum-recuado'
  if (n.includes('_miolo>marcador nivel 1')) return 'texto-comum-bullets'

  const c = compacto(nome)
  if (c.includes('titulos') && c.includes('titulo1') && c.includes('quebra')) return 'texto-comum-titulo'
  if (c.includes('titulo1comquebra')) return 'texto-comum-titulo'
  if (c.includes('titulos') && c.includes('titulo2')) return 'texto-comum-subtitulo'
  if (c.includes('titulo2')) return 'texto-comum-subtitulo'
  if (c.includes('miolo') && c.includes('corpo')) return 'texto-comum-corrido'
  if (c.includes('miolo') && c.includes('citacao')) return 'texto-comum-citacao'
  if (c.includes('citacao')) return 'texto-comum-citacao'
  if (c.includes('miolo') && c.includes('assinatura')) return 'texto-comum-assinatura'
  if (c.includes('assinatura')) return 'texto-comum-assinatura'
  if (c.includes('recuonivel1')) return 'texto-comum-recuado'
  if (c.includes('marcadornivel1') || c.includes('marcadornivel1')) return 'texto-comum-bullets'

  return null
}

export function estiloTextoComumPorHtmlClass(classe) {
  return HTML_CLASS_TO_PIPELINE_STYLE[String(classe || '').trim()] ||
    estiloTextoComumPorWordStyleName(classe)
}
