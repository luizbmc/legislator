import { isTipoEmendaConstitucional, isTipoFacoSaber, isTipoTextoComum, isTipoTratado } from './normas.js'

export const ESTILO_DISPONIBILIDADE = {
  todos: 'Todos os tipos de norma',
  geral: 'Normas legislativas gerais; oculto em tratados internacionais',
  tratado: 'Tratados ou convenções internacionais',
  facoSaber: 'Resolução da CD, Resolução do CN e Decreto Legislativo',
  emendaConstitucional: 'Emenda Constitucional',
  textoComum: 'Texto comum',
  interno: 'Uso interno do editor/importadores',
  custom: 'Configurado pelo usuário',
}

const ESTILOS_TRATADO = new Set([
  'epigrafe',
  'epigrafeApelido',
  'notaTitulo',
  'ementa',
  'artigoTitulo',
  'corpoTratado',
  'citacao',
  'data',
  'assinatura',
])

const ESTILOS_TEXTO_COMUM = new Set([
  'textoComumTitulo',
  'textoComumSubtitulo',
  'textoComumCorrido',
  'textoComumRecuado',
  'textoComumCitacao',
  'textoComumBullets',
  'textoComumAssinatura',
  'textoComumAssinaturaCargo',
])

export const ESTILOS_EMENDA_CONSTITUCIONAL_OCULTOS = new Set([
  'aberturaCapitulo',
  'epigrafeApelido',
  'artigoTitulo',
  'corpoTratado',
  'nomeJuridico',
])

const LABELS_EMENDA_CONSTITUCIONAL = {
  epigrafe: 'Epígrafe da EC',
  ementa: 'Ementa da EC',
}

export const ESTILOS_PARAGRAFO_LEGISLATOR = [
  { node: 'aberturaCapitulo', label: 'Abertura capítulo', xmlTag: 'AberturaCapitulo', htmlImport: 'h1.tit-subtit_abertura-cap, h1.tit-subtit_abertura-cap-quebra, h1.tit-subtit_abertura-cap-nova-pq, p.tit-subtit_abertura-cap, p.tit-subtit_abertura-cap-quebra, p.tit-subtit_abertura-cap-nova-pq', cssClass: 'abertura-capitulo', disponibilidade: 'geral' },
  { node: 'epigrafe', label: 'Epígrafe', atalho: '⌘⌥1', nivel: 1, xmlTag: 'Epigrafe', htmlImport: 'h1.tit-subtit_epigrafe, h1.tit-subtit_epigrafe-quebra, h1.tit-subtit_epigrafe-emenda, h1.tit-substit_epigrafe-emenda, p.tit-subtit_epigrafe, p.tit-subtit_epigrafe-quebra, p.tit-subtit_epigrafe-emenda, p.tit-substit_epigrafe-emenda', cssClass: 'epigrafe', disponibilidade: 'todos' },
  { node: 'epigrafeApelido', label: 'Apelido', nivel: 1, xmlTag: 'EpigrafeApelido', htmlImport: 'p.tit-subtit_epigrafe-apelido', cssClass: 'epigrafe-apelido', disponibilidade: 'todos' },
  { node: 'partelivroTitCap', label: 'Título / Cap.', atalho: '⌘⌥3', nivel: 2, xmlTag: 'Divisao', htmlImport: 'h2.tit-subtit_parte-livro-tit-cap, p.tit-subtit_parte-livro-tit-cap', cssClass: 'parte-livro-tit-cap', disponibilidade: 'geral' },
  { node: 'secaoSubsecao', label: 'Seção', atalho: '⌘⌥4', nivel: 3, xmlTag: 'Secao', htmlImport: 'h3.tit-subtit_secao-subsecao, p.tit-subtit_secao-subsecao', cssClass: 'secao-subsecao', disponibilidade: 'geral' },
  { node: 'ementa', label: 'Ementa', atalho: '⌘⌥2', xmlTag: 'Ementa', htmlImport: 'p.corpo-legis_ementa, p.corpo-legis_emenda-ementa', cssClass: 'ementa', disponibilidade: 'todos' },
  { node: 'paragrafAbertura', label: 'Abertura de lei', xmlTag: 'ParagrafoAbertura', htmlImport: 'p.corpo-legis_texto-lei-sem-indent', cssClass: 'paragrafo-abertura', disponibilidade: 'geral' },
  { node: 'paragrafFacoSaber', label: 'Faço saber', xmlTag: 'ParagrafoFacoSaber', htmlImport: 'p.corpo-legis_texto-lei-faco-saber', cssClass: 'paragrafo-faco-saber', disponibilidade: 'facoSaber', apenasFacoSaber: true },
  { node: 'artigo', label: 'Artigo', atalho: '⌘⌥5', xmlTag: 'Artigo', htmlImport: 'p.corpo-legis_art', cssClass: 'artigo', disponibilidade: 'geral' },
  { node: 'artigoTitulo', label: 'Artigo (título)', xmlTag: 'ArtigoTitulo', htmlImport: 'p.corpo-legis_art-tit-centro, p.corpo-legis_artigo-titulo', cssClass: 'artigo-titulo', disponibilidade: 'todos' },
  { node: 'corpoTratado', label: 'Corpo de tratado', xmlTag: 'CorpoTratado', htmlImport: 'p.corpo-legis_corpo-tratado', cssClass: 'corpo-tratado', disponibilidade: 'todos' },
  { node: 'paragrafLei', label: 'Parágrafo', atalho: '⌘⌥6', xmlTag: 'Paragrafo', htmlImport: 'p.corpo-legis_texto-lei; quando não for inciso, alínea ou item', cssClass: 'paragrafo-lei', disponibilidade: 'geral' },
  { node: 'nomeJuridico', label: 'Nome jurídico', xmlTag: 'NomeJuridico', htmlImport: 'p.corpo-legis_nome-juridico', cssClass: 'nome-juridico', disponibilidade: 'geral' },
  { node: 'inciso', label: 'Inciso', atalho: '⌘⌥7', xmlTag: 'Inciso', htmlImport: 'p.corpo-legis_texto-lei + padrão de inciso', cssClass: 'inciso', disponibilidade: 'geral' },
  { node: 'alinea', label: 'Alínea', atalho: '⌘⌥8', xmlTag: 'Alinea', htmlImport: 'p.corpo-legis_texto-lei + padrão de alínea', cssClass: 'alinea', disponibilidade: 'geral' },
  { node: 'item', label: 'Item', xmlTag: 'Item', htmlImport: 'p.corpo-legis_texto-lei + padrão de item', cssClass: 'item', disponibilidade: 'geral' },
  { node: 'citacao', label: 'Citação', xmlTag: 'Citacao', htmlImport: 'p.corpo-legis_texto-lei-citacao', cssClass: 'citacao', disponibilidade: 'todos' },
  { node: 'data', label: 'Data', xmlTag: 'Data', htmlImport: 'p.corpo-legis_ass-data', cssClass: 'data', disponibilidade: 'todos' },
  { node: 'assinatura', label: 'Assinatura', xmlTag: 'Assinatura', htmlImport: 'p.corpo-legis_ass-nome, p.corpo-legis_ass-nome-espaco-ant', cssClass: 'assinatura', disponibilidade: 'todos' },
  { node: 'notaTitulo', label: 'Nota título', xmlTag: 'NotaTitulo', htmlImport: 'p.corpo-legis_nota-titulos, p.corpo-legis_nota-titulos-transp', cssClass: 'nota-titulo', disponibilidade: 'todos' },
  { node: 'textoComumTitulo', label: 'Título', xmlTag: 'TextoTitulo', htmlImport: 'p.texto-comum_titulo, h1.texto-comum_titulo', cssClass: 'texto-comum-titulo', disponibilidade: 'textoComum' },
  { node: 'textoComumSubtitulo', label: 'Subtítulo', xmlTag: 'TextoSubtitulo', htmlImport: 'p.texto-comum_subtitulo, h2.texto-comum_subtitulo', cssClass: 'texto-comum-subtitulo', disponibilidade: 'textoComum' },
  { node: 'textoComumCorrido', label: 'Texto corrido', xmlTag: 'TextoCorrido', htmlImport: 'p.texto-comum_texto-corrido', cssClass: 'texto-comum-corrido', disponibilidade: 'textoComum' },
  { node: 'textoComumRecuado', label: 'Texto recuado', xmlTag: 'TextoRecuado', htmlImport: 'p.texto-comum_texto-recuado', cssClass: 'texto-comum-recuado', disponibilidade: 'textoComum' },
  { node: 'textoComumCitacao', label: 'Citação', xmlTag: 'TextoCitacao', htmlImport: 'p.texto-comum_citacao', cssClass: 'texto-comum-citacao', disponibilidade: 'textoComum' },
  { node: 'textoComumBullets', label: 'Bullets', xmlTag: 'TextoBullets', htmlImport: 'p.texto-comum_bullets', cssClass: 'texto-comum-bullets', disponibilidade: 'textoComum' },
  { node: 'textoComumAssinatura', label: 'Assinatura', xmlTag: 'TextoAssinatura', htmlImport: 'p.texto-comum_assinatura', cssClass: 'texto-comum-assinatura', disponibilidade: 'textoComum' },
  { node: 'textoComumAssinaturaCargo', label: 'Assinatura-cargo', xmlTag: 'TextoAssinaturaCargo', htmlImport: 'p.texto-comum_assinatura-cargo', cssClass: 'texto-comum-assinatura-cargo', disponibilidade: 'textoComum' },
  { node: 'paragraph', label: 'Parágrafo base', xmlTag: 'p', cssClass: 'paragraph', disponibilidade: 'interno', interno: true },
]

export const ESTILOS_CARACTERE_LEGISLATOR = [
  { id: 'bold', label: 'Negrito', painelLabel: 'N', xmlTag: 'b', htmlImport: 'b, strong', disponibilidade: 'todos' },
  { id: 'italic', label: 'Itálico', painelLabel: 'I', xmlTag: 'i', htmlImport: 'em, i', disponibilidade: 'todos' },
  { id: 'bolditalic', label: 'Negrito + Itálico', painelLabel: 'NI', xmlTag: 'b + i', disponibilidade: 'todos', combinado: true },
  { id: 'superscript', label: 'Sobrescrito', painelLabel: 'x²', xmlTag: 'sup', disponibilidade: 'todos' },
  { id: 'subscript', label: 'Subscrito', painelLabel: 'x₂', xmlTag: 'sub', disponibilidade: 'todos' },
  { id: 'nota', label: 'Nota', painelLabel: 'Nota', xmlTag: 'Nota', htmlImport: 'span.nota-novo-formato, span.nota-titulos', disponibilidade: 'todos' },
  { id: 'notaSobrescrito', label: 'Nota sobrescrito', painelLabel: 'Nota²', xmlTag: 'NotaSobrescrito', htmlImport: 'sup.sobrescrito-nota, span.nota-sobrescrito, span.leg-nota-sobrescrito', disponibilidade: 'todos' },
  { id: 'nota-italic', label: 'Nota itálico', painelLabel: 'Nota i', xmlTag: 'Nota + i', disponibilidade: 'todos', combinado: true },
  { id: 'boldArtigo', label: 'Bold-Artigo', painelLabel: 'art', xmlTag: 'Rotulo', htmlImport: 'span.bold-artigo', disponibilidade: 'todos' },
  { id: 'regular', label: 'Regular', painelLabel: 'Reg', xmlTag: 'Regular', disponibilidade: 'todos' },
  { id: 'italicoLight', label: 'Itálico suave', painelLabel: 'Nota i', importTag: null, exportTag: 'i', htmlImport: 'em.italico-light', disponibilidade: 'interno', interno: true },
]

export function ajustarEstiloParagrafoPorTipo(estilo, tipoNorma = '') {
  if (!estilo || !isTipoEmendaConstitucional(tipoNorma)) return estilo
  const label = LABELS_EMENDA_CONSTITUCIONAL[estilo.node]
  return label ? { ...estilo, label } : estilo
}

export function estilosParagrafoDisponiveis(tipoNorma = '') {
  if (isTipoTextoComum(tipoNorma)) {
    return ESTILOS_PARAGRAFO_LEGISLATOR.filter(e => ESTILOS_TEXTO_COMUM.has(e.node))
  }
  if (isTipoTratado(tipoNorma)) {
    return ESTILOS_PARAGRAFO_LEGISLATOR.filter(e => ESTILOS_TRATADO.has(e.node))
  }
  return ESTILOS_PARAGRAFO_LEGISLATOR.filter(e => {
    if (e.interno) return false
    if (isTipoEmendaConstitucional(tipoNorma) && ESTILOS_EMENDA_CONSTITUCIONAL_OCULTOS.has(e.node)) return false
    if (e.apenasFacoSaber) return isTipoFacoSaber(tipoNorma)
    return e.disponibilidade !== 'tratado' && e.disponibilidade !== 'textoComum'
  }).map(e => ajustarEstiloParagrafoPorTipo(e, tipoNorma))
}

export function descricaoDisponibilidade(estilo) {
  return ESTILO_DISPONIBILIDADE[estilo?.disponibilidade] || ESTILO_DISPONIBILIDADE.todos
}
