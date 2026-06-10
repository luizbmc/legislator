import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { isTipoTextoComum, TIPOS_NORMA } from '../constants/normas.js'

const COVER_COLORS = [
  'hsl(0 42% 78%)',
  'hsl(23 42% 78%)',
  'hsl(45 42% 78%)',
  'hsl(68 42% 78%)',
  'hsl(90 42% 78%)',
  'hsl(113 42% 78%)',
  'hsl(135 42% 78%)',
  'hsl(158 42% 78%)',
  'hsl(180 42% 78%)',
  'hsl(203 42% 78%)',
  'hsl(225 42% 78%)',
  'hsl(248 42% 78%)',
  'hsl(270 42% 78%)',
  'hsl(293 42% 78%)',
  'hsl(315 42% 78%)',
  'hsl(338 42% 78%)',
]

const DEFAULT_COVER_COLOR = COVER_COLORS[4]
const NOVA_NORMA_FORM_INICIAL = {
  tipo: 'Lei Ordinária',
  epigrafe: '',
  apelido: '',
  ementa: '',
  dados_publicacao: '',
  data_ultima_alteracao: '',
  atualizacao_pendente: false,
  vigencia: 'Vigente',
  link_acesso: '',
  anexo: '',
  observacoes: '',
}

const STATUS_NORMA = {
  rascunho:   { label: 'Rascunho',   cls: 'rascunho' },
  revisao:    { label: 'Em revisão', cls: 'revisao' },
  finalizado: { label: 'Finalizado', cls: 'finalizado' },
}

const EXPORTACAO_OPCOES = [
  { valor: 'ignorar', label: 'Ignorar' },
  { valor: 'atualizacao', label: 'Atualização' },
  { valor: 'completa', label: 'Completa' },
]

function statusNormaInfo(status) {
  return STATUS_NORMA[status] || STATUS_NORMA.rascunho
}

function exportacaoBloqueada(norma) {
  return norma?.status !== 'finalizado' || Boolean(norma?.atualizacao_pendente)
}

function exportacaoEfetiva(norma) {
  if (exportacaoBloqueada(norma)) return 'ignorar'
  return norma?.exportacao || 'completa'
}

function normalizarTag(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normaTemTagVm(norma) {
  return (norma.tags || []).some(tag => normalizarTag(tag) === 'vm')
}

function textoTagsNorma(norma) {
  const tags = (norma?.tags || [])
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
  return tags.length ? ` [${tags.join(', ')}]` : ''
}

function AvisoAtualizacaoPendente({ norma }) {
  if (!norma?.atualizacao_pendente) return null
  return <span className="norma-pendente-icone" title="Atualização pendente">⚠️</span>
}

function primeiraNormaComAtualizacaoPendente(secoes = []) {
  for (const secao of secoes) {
    for (const norma of secao.normas || []) {
      if (norma?.atualizacao_pendente) return norma
    }
  }
  return null
}

function textoInlineRecorte(content = []) {
  return content.map(node => {
    if (node.type === 'text') return node.text || ''
    if (node.type === 'hardBreak') return ' '
    return ''
  }).join('').replace(/\s+/g, ' ').trim()
}

function textoBlocoRecorte(node) {
  return textoInlineRecorte(node?.content || [])
}

function textoNoRecorte(node) {
  if (!node) return ''
  if (node.type === 'recorteOmissao') return '[...]'
  if (node.type === 'table') return '[Tabela]'
  return textoBlocoRecorte(node)
}

function textoNodeTiptap(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (!Array.isArray(node.content)) return ''
  return node.content.map(textoNodeTiptap).join('')
}

function textoDocTiptap(doc) {
  return (doc?.content || [])
    .map(node => textoNodeTiptap(node).replace(/\s+\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n')
}

function blocoTextoRecorte(type, text) {
  const conteudo = String(text || '').trim()
  if (!conteudo) return null
  return {
    type,
    content: [{ type: 'text', text: conteudo }],
  }
}

function formatarApelidoRecorte(apelido) {
  const texto = String(apelido || '').trim()
  if (!texto) return ''
  return texto.charAt(0) === '(' ? texto : `(${texto})`
}

function clonarBlocoRecorte(node) {
  if (!node) return null
  if (node.type === 'recorteOmissao') {
    return blocoTextoRecorte('paragrafLei', '[...]')
  }
  return JSON.parse(JSON.stringify(node))
}

function montarDocRecorte(norma, itens) {
  const content = [
    blocoTextoRecorte('epigrafe', norma?.epigrafe),
    blocoTextoRecorte('epigrafeApelido', formatarApelidoRecorte(norma?.apelido)),
    blocoTextoRecorte('ementa', norma?.ementa),
  ].filter(Boolean)

  for (const item of itens || []) {
    for (const bloco of item.blocos || []) {
      const clonado = clonarBlocoRecorte(bloco)
      if (clonado) content.push(clonado)
    }
  }

  return { type: 'doc', content }
}

function normalizarNumeroArtigo(valor) {
  return String(valor || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^arts?\.?/i, '')
    .replace(/^artigos?/i, '')
    .replace(/[ºª°]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
}

function normalizarTextoRecorte(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
}

function numeroArtigoNode(node) {
  const texto = textoBlocoRecorte(node)
  const match = texto.match(/^Art(?:s)?\.\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)/i)
  return match ? normalizarNumeroArtigo(match[1]) : ''
}

function numeroArtigoComoInteiro(valor) {
  const normalizado = normalizarNumeroArtigo(valor)
  if (!/^\d+$/.test(normalizado)) return null
  return parseInt(normalizado, 10)
}

function normalizarRomanoDispositivo(valor) {
  const texto = String(valor || '').toUpperCase().trim().replace(/\s+/g, '')
  const match = texto.match(/^([IVXLCDM]+)(-[A-Z])?$/)
  if (!match) return texto
  const alias = { IIV: 'VII' }
  return (alias[match[1]] || match[1]) + (match[2] || '')
}

function romanoParaNumero(romano) {
  const mapa = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const texto = normalizarRomanoDispositivo(romano).replace(/[^IVXLCDM]/g, '')
  if (!texto) return null
  var total = 0
  for (let i = 0; i < texto.length; i++) {
    const atual = mapa[texto[i]] || 0
    const prox = mapa[texto[i + 1]] || 0
    total += atual < prox ? -atual : atual
  }
  return total || null
}

function numeroRomanoNode(node) {
  const texto = textoBlocoRecorte(node)
  const match = texto.match(/^([IVXLCDM]+(?:-[A-Z])?)\s*[-\u2013\u2014]\s/i)
  return match ? normalizarRomanoDispositivo(match[1]) : ''
}

function alineaNode(node) {
  const texto = textoBlocoRecorte(node)
  const match = texto.match(/^([a-z\u00e0-\u00ff])\)\s/i)
  return match ? match[1].toLowerCase() : ''
}

function nodeEhParagrafoMarcado(node) {
  const texto = textoBlocoRecorte(node)
  return node?.type === 'paragrafLei' && (/^§\s*\d+/i.test(texto) || /^Par[aá]grafo\s+único\b/i.test(texto))
}

function numeroParagrafoNode(node) {
  const texto = textoBlocoRecorte(node)
  if (/^Par[aá]grafo\s+único\b/i.test(texto)) return 'UNICO'
  const match = texto.match(/^§\s*(\d+)\s*[ºª°]?/i)
  return match ? match[1] : ''
}

function normalizarParagrafoDispositivo(valor) {
  const texto = String(valor || '').trim()
  if (/^par[aá]grafo\s+único$/i.test(texto)) return 'UNICO'
  const match = texto.match(/^§?\s*(\d+)\s*[ºª°]?$/i)
  return match ? match[1] : texto.toUpperCase()
}

function nodeEhArtigo(node) {
  return node?.type === 'artigo' || node?.type === 'artigoTitulo'
}

function nivelHeadingRecorte(node) {
  const texto = normalizarTextoRecorte(textoBlocoRecorte(node))
  if (node?.type === 'partelivroTitCap') {
    if (/^PARTE\b/.test(texto)) return 1
    if (/^LIVRO\b/.test(texto)) return 2
    if (/^TITULO\b/.test(texto)) return 3
    if (/^CAPITULO\b/.test(texto)) return 4
    return 4
  }
  if (node?.type === 'aberturaCapitulo') return 4
  if (node?.type === 'secaoSubsecao') {
    if (/^SUBSECAO\b/.test(texto)) return 6
    if (/^SECAO\b/.test(texto)) return 5
    return 5
  }
  return null
}

function nodeEhHeadingRecorte(node) {
  return nivelHeadingRecorte(node) != null
}

function blocosDaNorma(doc) {
  return Array.isArray(doc?.content) ? doc.content : []
}

function montarIndiceArtigos(blocos) {
  const artigos = []
  for (let i = 0; i < blocos.length; i++) {
    if (!nodeEhArtigo(blocos[i])) continue
    const numero = numeroArtigoNode(blocos[i])
    if (!numero) continue
    let fim = blocos.length
    for (let j = i + 1; j < blocos.length; j++) {
      if (nodeEhArtigo(blocos[j]) || nodeEhHeadingRecorte(blocos[j])) {
        fim = j
        break
      }
    }
    artigos.push({ numero, inicio: i, fim })
  }
  return artigos
}

function dividirEntradasRecorte(especificacao) {
  const entradas = []
  let atual = ''
  let chaves = 0
  let aspas = false
  const texto = String(especificacao || '')
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (ch === '"') aspas = !aspas
    if (!aspas && ch === '{') chaves++
    if (!aspas && ch === '}') chaves = Math.max(0, chaves - 1)
    if (!aspas && chaves === 0 && ch === ';') {
      if (atual.trim()) entradas.push(atual.trim())
      atual = ''
      continue
    }
    atual += ch
  }
  if (atual.trim()) entradas.push(atual.trim())
  return entradas
}

function parseDetalheDispositivo(texto) {
  const detalhe = String(texto || '').trim()
  if (!detalhe || /^caput$/i.test(detalhe)) return { tipo: 'caput' }

  const partes = detalhe
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)

  const incisoRange = partes[0]?.match(/^([IVXLCDM]+(?:-[A-Z])?)\s+a\s+([IVXLCDM]+(?:-[A-Z])?)$/i)
  if (incisoRange) {
    return {
      tipo: 'incisosRange',
      incisoInicio: normalizarRomanoDispositivo(incisoRange[1]),
      incisoFim: normalizarRomanoDispositivo(incisoRange[2]),
    }
  }

  const inciso = partes[0]?.match(/^([IVXLCDM]+(?:-[A-Z])?)$/i)
  const incisosLista = partes.map(parte => parte.match(/^([IVXLCDM]+(?:-[A-Z])?)$/i)?.[1])
  const alineaRange = partes[1]?.match(/^"?([a-z\u00e0-\u00ff])"?\s+a\s+"?([a-z\u00e0-\u00ff])"?$/i)
  const alinea = partes[1]?.match(/^"?([a-z\u00e0-\u00ff])"?$/i)
  const alineasLista = partes.slice(1).map(parte => parte.match(/^"?([a-z\u00e0-\u00ff])"?$/i)?.[1]?.toLowerCase())

  if (inciso && alineaRange) {
    return {
      tipo: 'alineasRangeDeInciso',
      inciso: normalizarRomanoDispositivo(inciso[1]),
      alineaInicio: alineaRange[1].toLowerCase(),
      alineaFim: alineaRange[2].toLowerCase(),
    }
  }

  if (incisosLista.length > 1 && incisosLista.every(Boolean)) {
    return {
      tipo: 'incisosLista',
      incisos: incisosLista.map(normalizarRomanoDispositivo),
    }
  }

  if (inciso && alineasLista.length > 1 && alineasLista.every(Boolean)) {
    return {
      tipo: 'alineasListaDeInciso',
      inciso: normalizarRomanoDispositivo(inciso[1]),
      alineas: alineasLista,
    }
  }

  if (inciso && alinea) {
    return {
      tipo: 'alineaDeInciso',
      inciso: normalizarRomanoDispositivo(inciso[1]),
      alinea: alinea[1].toLowerCase(),
    }
  }

  if (inciso && partes.length === 1) {
    return {
      tipo: 'inciso',
      inciso: normalizarRomanoDispositivo(inciso[1]),
    }
  }

  return { erro: 'Detalhamento do artigo não reconhecido.' }
}

function parseGrupoRecorte(conteudo) {
  return dividirEntradasRecorte(conteudo).map(parte => {
    const paragrafo = parte.match(/^(§\s*\d+\s*[ºª°]?|par[aá]grafo\s+único)\s*(?:,\s*(.+))?$/i)
    if (paragrafo) {
      const detalhe = parseDetalheDispositivo(paragrafo[2] || 'caput')
      return {
        ...detalhe,
        escopo: 'paragrafo',
        paragrafo: normalizarParagrafoDispositivo(paragrafo[1]),
      }
    }
    return { ...parseDetalheDispositivo(parte), escopo: 'artigo' }
  })
}

function parseItemRecorte(entrada) {
  const texto = entrada.trim()
  const range = texto.match(/^Arts?\.\s*((?:\d{1,3}(?:\.\d{3})+|\d+))[ºª°]?\s+a\s*((?:\d{1,3}(?:\.\d{3})+|\d+))[ºª°]?$/i)
  if (range) {
    return {
      tipo: 'artigosRange',
      inicio: normalizarNumeroArtigo(range[1]),
      fim: normalizarNumeroArtigo(range[2]),
    }
  }

  const grupo = texto.match(/^Art\.\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)[ºª°]?\s*\{([\s\S]+)\}$/i)
  if (grupo) {
    const itens = parseGrupoRecorte(grupo[2])
    const erro = itens.find(item => item.erro)
    if (erro) return { erro: erro.erro }
    return {
      tipo: 'artigoGrupo',
      numero: normalizarNumeroArtigo(grupo[1]),
      itens,
    }
  }

  const match = texto.match(/^Art\.\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)[ºª°]?(.*)$/i)
  if (!match) return { erro: 'Comando não reconhecido.' }

  const numero = normalizarNumeroArtigo(match[1])
  const detalhe = parseDetalheDispositivo(match[2].replace(/^,/, ''))
  if (detalhe.erro) return detalhe

  if (detalhe.tipo === 'caput' && !match[2].trim()) return { tipo: 'artigoInteiro', numero }
  return { ...detalhe, numero }
}

function encontrarArtigo(indice, numero) {
  return indice.find(art => art.numero === normalizarNumeroArtigo(numero))
}

function extrairBlocosArtigo(blocos, artigo) {
  return blocos.slice(artigo.inicio, artigo.fim)
}

function headingsDoArtigo(blocos, inicioArtigo) {
  let pilha = []
  for (let i = 0; i < inicioArtigo; i++) {
    const node = blocos[i]
    const nivel = nivelHeadingRecorte(node)
    if (nivel == null) continue
    pilha = pilha.filter(item => item.nivel < nivel)
    pilha.push({ node, nivel, index: i })
  }
  return pilha.map(item => item.node)
}

function limitesEscopoArtigo(blocosArtigo) {
  let fim = blocosArtigo.length
  for (let i = 1; i < blocosArtigo.length; i++) {
    if (nodeEhParagrafoMarcado(blocosArtigo[i])) {
      fim = i
      break
    }
  }
  return { inicio: 1, fim }
}

function limitesEscopoParagrafo(blocosArtigo, paragrafo) {
  const numero = normalizarParagrafoDispositivo(paragrafo)
  for (let i = 1; i < blocosArtigo.length; i++) {
    if (nodeEhParagrafoMarcado(blocosArtigo[i]) && numeroParagrafoNode(blocosArtigo[i]) === numero) {
      let fim = blocosArtigo.length
      for (let j = i + 1; j < blocosArtigo.length; j++) {
        if (nodeEhParagrafoMarcado(blocosArtigo[j])) {
          fim = j
          break
        }
      }
      return { inicio: i + 1, fim, paragrafoIndex: i }
    }
  }
  return null
}

function extrairInciso(blocosArtigo, inciso, escopo) {
  const selecionados = []
  const limite = escopo || limitesEscopoArtigo(blocosArtigo)
  let capturando = false
  for (let i = limite.inicio; i < limite.fim; i++) {
    const node = blocosArtigo[i]
    if (node.type === 'inciso') {
      capturando = numeroRomanoNode(node) === inciso
    } else if (nodeEhParagrafoMarcado(node)) {
      capturando = false
    }
    if (capturando) selecionados.push(node)
  }
  return selecionados
}

function extrairIncisos(blocosArtigo, inicio, fim, escopo) {
  const inicioNum = romanoParaNumero(inicio)
  const fimNum = romanoParaNumero(fim)
  if (!inicioNum || !fimNum) return []
  const selecionados = []
  let capturando = false
  const limite = escopo || limitesEscopoArtigo(blocosArtigo)
  for (let i = limite.inicio; i < limite.fim; i++) {
    const node = blocosArtigo[i]
    if (node.type === 'inciso') {
      const num = romanoParaNumero(numeroRomanoNode(node))
      capturando = Boolean(num && num >= inicioNum && num <= fimNum)
    } else if (nodeEhParagrafoMarcado(node)) {
      capturando = false
    }
    if (capturando) selecionados.push(node)
  }
  return selecionados
}

function extrairIncisosLista(blocosArtigo, incisos, escopo) {
  const resultado = []
  for (const inciso of incisos) {
    adicionarUnicos(resultado, extrairInciso(blocosArtigo, inciso, escopo))
  }
  return resultado
}

function extrairAlineasDeInciso(blocosArtigo, inciso, alineaInicio, alineaFim, escopo) {
  const resultado = []
  let dentroInciso = false
  const limite = escopo || limitesEscopoArtigo(blocosArtigo)
  const ini = alineaInicio.charCodeAt(0)
  const fim = alineaFim.charCodeAt(0)
  for (let i = limite.inicio; i < limite.fim; i++) {
    const node = blocosArtigo[i]
    if (node.type === 'inciso') {
      dentroInciso = numeroRomanoNode(node) === inciso
      if (dentroInciso) resultado.push(node)
      continue
    }
    if (!dentroInciso) continue
    if (nodeEhParagrafoMarcado(node) || node.type === 'inciso') break
    if (node.type === 'alinea') {
      const codigo = alineaNode(node).charCodeAt(0)
      if (!codigo || codigo < ini || codigo > fim) continue
      resultado.push(node)
      for (let j = i + 1; j < blocosArtigo.length; j++) {
        const child = blocosArtigo[j]
        if (child.type === 'alinea' || child.type === 'inciso' || nodeEhParagrafoMarcado(child)) break
        if (child.type === 'item') resultado.push(child)
      }
    }
  }
  return resultado
}

function extrairAlineaDeInciso(blocosArtigo, inciso, alinea, escopo) {
  return extrairAlineasDeInciso(blocosArtigo, inciso, alinea, alinea, escopo)
}

function extrairAlineasListaDeInciso(blocosArtigo, inciso, alineas, escopo) {
  const resultado = []
  for (const alinea of alineas) {
    adicionarUnicos(resultado, extrairAlineaDeInciso(blocosArtigo, inciso, alinea, escopo))
  }
  return resultado
}

function adicionarUnicos(destino, blocos) {
  for (const bloco of blocos) {
    if (!destino.includes(bloco)) destino.push(bloco)
  }
}

function nodeTemConteudoRecorte(node) {
  if (!node) return false
  if (node.type === 'table') return true
  return Boolean(textoBlocoRecorte(node))
}

function ordenarUnicosPorPosicao(blocosArtigo, selecionados) {
  const vistos = []
  for (const node of selecionados) {
    if (node && !vistos.includes(node)) vistos.push(node)
  }
  return vistos.sort((a, b) => blocosArtigo.indexOf(a) - blocosArtigo.indexOf(b))
}

function inserirMarcadoresOmissao(blocosBase, selecionados, fimOmissaoAte) {
  const ordenados = ordenarUnicosPorPosicao(blocosBase, selecionados)
  if (ordenados.length <= 1) return ordenados

  const resultado = []
  let indiceAnterior = -1
  for (const node of ordenados) {
    const indiceAtual = blocosBase.indexOf(node)
    if (
      indiceAnterior >= 0 &&
      indiceAtual > indiceAnterior + 1 &&
      blocosBase.slice(indiceAnterior + 1, indiceAtual).some(nodeTemConteudoRecorte)
    ) {
      resultado.push({ type: 'recorteOmissao' })
    }
    resultado.push(node)
    indiceAnterior = indiceAtual
  }
  const limiteFim = fimOmissaoAte == null ? blocosBase.length : fimOmissaoAte
  if (
    indiceAnterior >= 0 &&
    indiceAnterior < limiteFim - 1 &&
    blocosBase.slice(indiceAnterior + 1, limiteFim).some(nodeTemConteudoRecorte)
  ) {
    resultado.push({ type: 'recorteOmissao' })
  }
  return resultado
}

function extrairDetalheArtigo(blocosArtigo, detalhe, escopo) {
  if (!detalhe || detalhe.tipo === 'caput') return []
  if (detalhe.tipo === 'inciso') return extrairInciso(blocosArtigo, detalhe.inciso, escopo)
  if (detalhe.tipo === 'incisosRange') return extrairIncisos(blocosArtigo, detalhe.incisoInicio, detalhe.incisoFim, escopo)
  if (detalhe.tipo === 'incisosLista') return extrairIncisosLista(blocosArtigo, detalhe.incisos, escopo)
  if (detalhe.tipo === 'alineaDeInciso') return extrairAlineaDeInciso(blocosArtigo, detalhe.inciso, detalhe.alinea, escopo)
  if (detalhe.tipo === 'alineasRangeDeInciso') return extrairAlineasDeInciso(blocosArtigo, detalhe.inciso, detalhe.alineaInicio, detalhe.alineaFim, escopo)
  if (detalhe.tipo === 'alineasListaDeInciso') return extrairAlineasListaDeInciso(blocosArtigo, detalhe.inciso, detalhe.alineas, escopo)
  return []
}

function extrairGrupoArtigo(blocosArtigo, itens) {
  const selecionados = [blocosArtigo[0]]
  for (const item of itens) {
    if (item.escopo === 'paragrafo') {
      const escopo = limitesEscopoParagrafo(blocosArtigo, item.paragrafo)
      if (!escopo) continue
      adicionarUnicos(selecionados, [blocosArtigo[escopo.paragrafoIndex]])
      adicionarUnicos(selecionados, extrairDetalheArtigo(blocosArtigo, item, escopo))
      continue
    }
    adicionarUnicos(selecionados, extrairDetalheArtigo(blocosArtigo, item, limitesEscopoArtigo(blocosArtigo)))
  }
  return selecionados
}

function extrairRecortesDaNorma(doc, especificacao) {
  const blocos = blocosDaNorma(doc)
  const indice = montarIndiceArtigos(blocos)
  const entradas = dividirEntradasRecorte(especificacao)

  return entradas.map(entrada => {
    const parsed = parseItemRecorte(entrada)
    if (parsed.erro) return { entrada, erro: parsed.erro, textos: [], blocos: [] }

    if (parsed.tipo === 'artigosRange') {
      const ini = numeroArtigoComoInteiro(parsed.inicio)
      const fim = numeroArtigoComoInteiro(parsed.fim)
      if (ini == null || fim == null) return { entrada, erro: 'Intervalo de artigos inválido.', textos: [] }
      const artigosSelecionados = indice
        .filter(art => {
          const n = numeroArtigoComoInteiro(art.numero)
          return n != null && n >= ini && n <= fim
        })
      const selecionados = artigosSelecionados.flatMap(art => extrairBlocosArtigo(blocos, art))
      const primeiroArtigo = artigosSelecionados[0]
      const ultimoArtigo = artigosSelecionados[artigosSelecionados.length - 1]
      const comHeadings = primeiroArtigo
        ? [...headingsDoArtigo(blocos, primeiroArtigo.inicio), ...selecionados]
        : selecionados
      const exibidos = ultimoArtigo
        ? inserirMarcadoresOmissao(blocos, comHeadings, ultimoArtigo.fim)
        : comHeadings
      return { entrada, textos: exibidos.map(textoNoRecorte), blocos: exibidos, total: selecionados.length }
    }

    const artigo = encontrarArtigo(indice, parsed.numero)
    if (!artigo) return { entrada, erro: `Artigo ${parsed.numero} não encontrado.`, textos: [] }
    const blocosArtigo = extrairBlocosArtigo(blocos, artigo)
    let selecionados = []

    if (parsed.tipo === 'artigoInteiro') selecionados = blocosArtigo
    if (parsed.tipo === 'caput') selecionados = blocosArtigo.slice(0, 1)
    if (parsed.tipo === 'inciso') selecionados = [blocosArtigo[0], ...extrairInciso(blocosArtigo, parsed.inciso)]
    if (parsed.tipo === 'incisosRange') selecionados = [blocosArtigo[0], ...extrairIncisos(blocosArtigo, parsed.incisoInicio, parsed.incisoFim)]
    if (parsed.tipo === 'incisosLista') selecionados = [blocosArtigo[0], ...extrairIncisosLista(blocosArtigo, parsed.incisos)]
    if (parsed.tipo === 'alineaDeInciso') selecionados = [blocosArtigo[0], ...extrairAlineaDeInciso(blocosArtigo, parsed.inciso, parsed.alinea)]
    if (parsed.tipo === 'alineasRangeDeInciso') selecionados = [blocosArtigo[0], ...extrairAlineasDeInciso(blocosArtigo, parsed.inciso, parsed.alineaInicio, parsed.alineaFim)]
    if (parsed.tipo === 'alineasListaDeInciso') selecionados = [blocosArtigo[0], ...extrairAlineasListaDeInciso(blocosArtigo, parsed.inciso, parsed.alineas)]
    if (parsed.tipo === 'artigoGrupo') selecionados = extrairGrupoArtigo(blocosArtigo, parsed.itens)
    const comHeadings = [...headingsDoArtigo(blocos, artigo.inicio), ...selecionados]
    const exibidos = inserirMarcadoresOmissao(blocos, comHeadings, artigo.fim)

    return {
      entrada,
      erro: selecionados.length <= 1 && parsed.tipo !== 'caput' ? 'Nenhum dispositivo específico encontrado no artigo.' : null,
      textos: exibidos.map(textoNoRecorte),
      blocos: exibidos,
      total: selecionados.length,
    }
  })
}

export default function PublicacaoPage() {
  const { id } = useParams()
  const nav    = useNavigate()

  const [pub,       setPub]       = useState(null)
  const [form,      setForm]      = useState({ titulo: '', edicao: '', organizador: '', lancado_em: '', descricao: '', caminho_rede: '', status: 'previsto', cor_capa: DEFAULT_COVER_COLOR, ultima_edicao: false })
  const [secoes,    setSecoes]    = useState([])
  const [salvando,  setSalvando]  = useState(false)
  const [modificado,setModificado]= useState(false)
  const [dragNorma, setDragNorma] = useState(null)

  // Modal adicionar norma
  const [modalSecaoIdx, setModalSecaoIdx] = useState(null)  // índice da seção alvo
  const [buscaNorma,    setBuscaNorma]    = useState('')
  const [somenteVm,     setSomenteVm]     = useState(false)
  const [somenteTextoComum, setSomenteTextoComum] = useState(false)
  const [normasDisponiveis, setNormasDisponiveis] = useState([])
  const [loadingNormas, setLoadingNormas] = useState(false)
  const [abaModalNorma, setAbaModalNorma] = useState('catalogo')
  const [novaNormaForm, setNovaNormaForm] = useState(NOVA_NORMA_FORM_INICIAL)
  const [novaNormaTags, setNovaNormaTags] = useState([])
  const [novaNormaTagInput, setNovaNormaTagInput] = useState('')
  const [novaNormaSugestoes, setNovaNormaSugestoes] = useState([])
  const [todasTags, setTodasTags] = useState([])
  const [criandoNorma, setCriandoNorma] = useState(false)
  const [erroNovaNorma, setErroNovaNorma] = useState('')
  const [recorteNormaId, setRecorteNormaId] = useState('')
  const [recorteDispositivos, setRecorteDispositivos] = useState('')
  const [recorteErro, setRecorteErro] = useState('')
  const [recorteCarregando, setRecorteCarregando] = useState(false)
  const [criandoRecorte, setCriandoRecorte] = useState(false)
  const [recorteAjudaAberta, setRecorteAjudaAberta] = useState(false)
  const [modalResultadoRecorte, setModalResultadoRecorte] = useState(null)

  // Modal nova seção
  const [modalSecao,    setModalSecao]    = useState(false)
  const [novaSecaoTit,  setNovaSecaoTit]  = useState('')

  // Edição inline de seção
  const [editandoSecao, setEditandoSecao] = useState(null) // idx

  useEffect(() => { carregar() }, [id])

  async function carregar() {
    const data = await window.legislator.publicacoes.buscar(parseInt(id))
    if (!data) { nav('/publicacoes'); return }
    setPub(data)
    setForm({
      titulo:      data.titulo      ?? '',
      edicao:      data.edicao      ?? '',
      organizador: data.organizador ?? '',
      lancado_em:  data.lancado_em  ?? '',
      descricao:   data.descricao   ?? '',
      caminho_rede: data.caminho_rede ?? '',
      status:      data.status      ?? 'previsto',
      cor_capa:    data.cor_capa    ?? DEFAULT_COVER_COLOR,
      ultima_edicao: Boolean(data.ultima_edicao),
    })
    setSecoes(data.secoes ?? [])
    setModificado(false)
  }

  // ── Salvar ──────────────────────────────────────────────────────
  const salvar = useCallback(async () => {
    setSalvando(true)
    try {
      const atualizada = await window.legislator.publicacoes.salvar(parseInt(id), { ...form, secoes })
      setPub(atualizada)
      setModificado(false)
    } finally {
      setSalvando(false)
    }
  }, [id, form, secoes])

  function marcarModificado() { setModificado(true) }
  const setField = campo => e => { setForm(f => ({ ...f, [campo]: e.target.value })); marcarModificado() }
  const setCorCapa = cor => { setForm(f => ({ ...f, cor_capa: cor })); marcarModificado() }

  // ── Seções ──────────────────────────────────────────────────────
  function moverSecao(idx, dir) {
    const s = [...secoes]
    const destino = idx + dir
    if (destino < 0 || destino >= s.length) return;
    [s[idx], s[destino]] = [s[destino], s[idx]]
    setSecoes(s); marcarModificado()
  }

  function excluirSecao(idx) {
    if (!confirm(`Excluir a seção "${secoes[idx].titulo}"? As normas serão removidas dela.`)) return
    setSecoes(s => s.filter((_, i) => i !== idx)); marcarModificado()
  }

  function renomearSecao(idx, titulo) {
    setSecoes(s => s.map((sec, i) => i === idx ? { ...sec, titulo } : sec))
    marcarModificado()
  }

  function adicionarSecao() {
    if (!novaSecaoTit.trim()) return
    setSecoes(s => [...s, { titulo: novaSecaoTit.trim(), normas: [] }])
    setNovaSecaoTit('')
    setModalSecao(false)
    marcarModificado()
  }

  // ── Normas nas seções ───────────────────────────────────────────
  function removerNormaDaSecao(secaoIdx, pnId) {
    setSecoes(s => s.map((sec, i) =>
      i === secaoIdx ? { ...sec, normas: sec.normas.filter(n => n.pn_id !== pnId) } : sec
    ))
    marcarModificado()
  }

  function moverNorma(secaoIdx, normaIdx, dir) {
    const s = secoes.map((sec, i) => {
      if (i !== secaoIdx) return sec
      const ns = [...sec.normas]
      const dest = normaIdx + dir
      if (dest < 0 || dest >= ns.length) return sec;
      [ns[normaIdx], ns[dest]] = [ns[dest], ns[normaIdx]]
      return { ...sec, normas: ns }
    })
    setSecoes(s); marcarModificado()
  }

  function alterarExportacaoNorma(secaoIdx, normaIdx, exportacao) {
    setSecoes(s => s.map((sec, i) => {
      if (i !== secaoIdx) return sec
      return {
        ...sec,
        normas: sec.normas.map((norma, j) =>
          j === normaIdx ? { ...norma, exportacao } : norma
        ),
      }
    }))
    marcarModificado()
  }

  function moverNormaPorDrag(origem, destino) {
    if (!origem || !destino) return
    if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx === destino.normaIdx) return
    if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx + 1 === destino.normaIdx) return
    if (!secoes[origem.secaoIdx]?.normas?.[origem.normaIdx]) return
    if (!secoes[destino.secaoIdx]) return

    setSecoes(prev => {
      if (!prev[origem.secaoIdx]?.normas?.[origem.normaIdx]) return prev
      if (!prev[destino.secaoIdx]) return prev
      const next = prev.map(sec => ({ ...sec, normas: [...(sec.normas || [])] }))
      const [item] = next[origem.secaoIdx].normas.splice(origem.normaIdx, 1)
      if (!item) return prev

      let destinoIdx = destino.normaIdx
      if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx < destino.normaIdx) {
        destinoIdx -= 1
      }
      destinoIdx = Math.max(0, Math.min(destinoIdx, next[destino.secaoIdx].normas.length))
      next[destino.secaoIdx].normas.splice(destinoIdx, 0, item)
      return next
    })
    marcarModificado()
  }

  function moverNormaParaFimPorDrag(origem, secaoIdx) {
    if (!origem) return
    const total = secoes[secaoIdx]?.normas?.length || 0
    moverNormaPorDrag(origem, { secaoIdx, normaIdx: total })
  }

  function iniciarDragNorma(e, secaoIdx, normaIdx) {
    setDragNorma({ secaoIdx, normaIdx })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${secaoIdx}:${normaIdx}`)
  }

  function encerrarDragNorma() {
    setDragNorma(null)
  }

  // ── Modal adicionar norma ───────────────────────────────────────
  function resetarNovaNormaForm() {
    setNovaNormaForm(NOVA_NORMA_FORM_INICIAL)
    setNovaNormaTags([])
    setNovaNormaTagInput('')
    setNovaNormaSugestoes([])
    setErroNovaNorma('')
    setRecorteNormaId('')
    setRecorteDispositivos('')
    setRecorteErro('')
    setRecorteCarregando(false)
    setCriandoRecorte(false)
    setRecorteAjudaAberta(false)
    setSomenteTextoComum(false)
  }

  function fecharModalNorma() {
    setModalSecaoIdx(null)
    setAbaModalNorma('catalogo')
    resetarNovaNormaForm()
  }

  function calcSugestoesTags(val, tagsAtuais) {
    const q = val.trim().toLowerCase()
    return todasTags
      .filter(t => !tagsAtuais.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 8)
  }

  function onNovaNormaTagInputChange(val) {
    setNovaNormaTagInput(val)
    setNovaNormaSugestoes(calcSugestoesTags(val, novaNormaTags))
  }

  function adicionarNovaNormaTag(nome) {
    const nomeTrim = nome.trim()
    if (!nomeTrim || novaNormaTags.includes(nomeTrim)) return
    setNovaNormaTags(prev => [...prev, nomeTrim])
    setNovaNormaTagInput('')
    setNovaNormaSugestoes([])
  }

  function removerNovaNormaTag(nome) {
    setNovaNormaTags(prev => prev.filter(t => t !== nome))
  }

  function onNovaNormaTagKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      adicionarNovaNormaTag(novaNormaTagInput)
    } else if (e.key === 'Backspace' && !novaNormaTagInput && novaNormaTags.length > 0) {
      removerNovaNormaTag(novaNormaTags[novaNormaTags.length - 1])
    }
  }

  async function abrirModalNorma(secaoIdx) {
    setModalSecaoIdx(secaoIdx)
    setAbaModalNorma('catalogo')
    resetarNovaNormaForm()
    setBuscaNorma('')
    setSomenteVm(false)
    setLoadingNormas(true)
    const [normas, tags] = await Promise.all([
      window.legislator.normas.listar({}),
      window.legislator.normas.tags().catch(() => []),
    ])
    setNormasDisponiveis(normas)
    setTodasTags(tags)
    setLoadingNormas(false)
  }

  function normaJaNaPublicacao(normaId) {
    return secoes.some(s => s.normas.some(n => n.norma_id === normaId))
  }

  function adicionarNorma(norma) {
    setSecoes(s => s.map((sec, i) =>
      i === modalSecaoIdx
        ? { ...sec, normas: [...sec.normas, { pn_id: Date.now(), norma_id: norma.id, tipo: norma.tipo, epigrafe: norma.epigrafe, apelido: norma.apelido, status: norma.status, atualizacao_pendente: norma.atualizacao_pendente, exportacao: exportacaoEfetiva(norma) }] }
        : sec
    ))
    marcarModificado()
  }

  // ── Export ──────────────────────────────────────────────────────
  async function criarNormaEAdicionar(e) {
    e.preventDefault()
    if (!novaNormaForm.epigrafe.trim()) {
      setErroNovaNorma('A epígrafe é obrigatória.')
      return
    }
    setCriandoNorma(true)
    setErroNovaNorma('')
    try {
      const criada = await window.legislator.normas.criar({
        tipo: novaNormaForm.tipo,
        epigrafe: novaNormaForm.epigrafe.trim(),
        apelido: novaNormaForm.apelido.trim(),
        ementa: novaNormaForm.ementa.trim(),
        dados_publicacao: novaNormaForm.dados_publicacao.trim(),
        data_ultima_alteracao: novaNormaForm.data_ultima_alteracao,
        atualizacao_pendente: Boolean(novaNormaForm.atualizacao_pendente),
        vigencia: novaNormaForm.vigencia.trim() || 'Vigente',
        link_acesso: novaNormaForm.link_acesso.trim(),
        anexo: novaNormaForm.anexo.trim(),
        observacoes: novaNormaForm.observacoes.trim(),
        tags: novaNormaTags,
      })
      const normaCriada = {
        ...criada,
        tags: novaNormaTags,
        status: criada.status || 'rascunho',
      }
      adicionarNorma(normaCriada)
      setNormasDisponiveis(prev => [...prev, normaCriada])
      fecharModalNorma()
    } catch (err) {
      setErroNovaNorma(err.message || 'Erro ao criar norma.')
    } finally {
      setCriandoNorma(false)
    }
  }

  async function testarRecorteNorma(e) {
    e.preventDefault()
    if (!recorteNormaId) {
      setRecorteErro('Selecione a norma de origem.')
      return
    }
    if (!recorteDispositivos.trim()) {
      setRecorteErro('Informe os dispositivos do recorte.')
      return
    }

    setRecorteCarregando(true)
    setRecorteErro('')
    try {
      const norma = await window.legislator.normas.buscar(parseInt(recorteNormaId, 10))
      if (!norma) throw new Error('Norma de origem não encontrada.')
      const doc = norma.conteudo_doc ? JSON.parse(norma.conteudo_doc) : { type: 'doc', content: [] }
      const itens = extrairRecortesDaNorma(doc, recorteDispositivos)
      setModalResultadoRecorte({
        norma,
        especificacao: recorteDispositivos,
        itens,
      })
    } catch (err) {
      setRecorteErro(err?.message || 'Não foi possível gerar o recorte.')
    } finally {
      setRecorteCarregando(false)
    }
  }

  async function criarRecorteConfirmado() {
    if (!modalResultadoRecorte) return
    if (modalResultadoRecorte.itens.some(item => item.erro)) {
      setRecorteErro('Corrija os itens com erro antes de criar o recorte.')
      return
    }

    const doc = montarDocRecorte(modalResultadoRecorte.norma, modalResultadoRecorte.itens)
    if (!doc.content.length) {
      setRecorteErro('O recorte nÃ£o possui conteÃºdo para criar a norma.')
      return
    }

    setCriandoRecorte(true)
    setRecorteErro('')
    try {
      const origem = modalResultadoRecorte.norma
      const conteudoDoc = JSON.stringify(doc)
      const conteudoTxt = textoDocTiptap(doc)
      const criada = await window.legislator.normas.criar({
        tipo: 'Recorte',
        epigrafe: `Recorte de ${origem.epigrafe || 'norma'}`,
        apelido: origem.apelido || '',
        ementa: origem.ementa || '',
        vigencia: origem.vigencia || 'Vigente',
        tags: [],
        status: 'rascunho',
      })
      const salva = await window.legislator.normas.salvar(criada.id, {
        conteudo_doc: conteudoDoc,
        conteudo_txt: conteudoTxt,
        status: 'rascunho',
        data_atualizacao: criada.data_atualizacao || null,
      })
      const normaCriada = {
        ...criada,
        ...salva,
        tipo: 'Recorte',
        tags: [],
        status: salva.status || criada.status || 'rascunho',
      }
      adicionarNorma(normaCriada)
      setNormasDisponiveis(prev => [...prev, normaCriada])
      setModalResultadoRecorte(null)
      fecharModalNorma()
    } catch (err) {
      setRecorteErro(err?.message || 'NÃ£o foi possÃ­vel criar o recorte.')
    } finally {
      setCriandoRecorte(false)
    }
  }

  async function exportar(tipo) {
    try {
      if (modificado) {
        if (!confirm('Há alterações não salvas. Salvar antes de exportar?')) return
        await salvar()
      }

      const pendente = primeiraNormaComAtualizacaoPendente(secoes)
      if (pendente) {
        alert(`A publicação contém norma com Atualização pendente:\n${pendente.epigrafe}\n\nRemova essa marcação nos dados da norma antes de exportar a publicação.`)
        return
      }

      if (tipo === 'word') {
        const result = await window.legislator.publicacoes.exportarWord(parseInt(id))
        if (result?.ok && result.gerados === 0) {
          alert('Nenhuma norma foi exportada. Todas as normas estão configuradas como Ignorar.')
        }
      }
      if (tipo === 'indesign') {
        const result = await window.legislator.publicacoes.exportarInDesign(parseInt(id))
        if (result?.semExportacao) {
          alert('Todas as normas estão configuradas como Ignorar. Nada foi exportado.')
        }
      }
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar a publicação.')
    }
  }

  const normasFiltradas = normasDisponiveis.filter(n =>
    !normaJaNaPublicacao(n.id) &&
    (!somenteVm || normaTemTagVm(n)) &&
    (!somenteTextoComum || isTipoTextoComum(n.tipo)) &&
    (n.epigrafe.toLowerCase().includes(buscaNorma.toLowerCase()) ||
     (n.apelido ?? '').toLowerCase().includes(buscaNorma.toLowerCase()))
  )

  if (!pub) return <div className="loading">Carregando…</div>

  return (
    <div className="pub-page">

      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="editor-topbar">
        <button
          className="btn-ghost btn-voltar"
          onClick={() => {
            if (modificado && !confirm('Há alterações não salvas. Deseja sair?')) return
            nav('/publicacoes')
          }}
        >← Publicações</button>

        <div className="editor-titulo">
          <div className="editor-titulo-l1">
            <span className="editor-tipo">Publicação</span>
          </div>
          <div className="editor-titulo-l2">
            <span className="editor-epigrafe">{pub.titulo}</span>
          </div>
        </div>

        <div className="editor-acoes">
          <div className="dropdown">
            <button className="btn-ghost">⬇ Exportar ▾</button>
            <div className="dropdown-menu">
              <button onClick={() => exportar('word')}>Word</button>
              <button onClick={() => exportar('indesign')}>InDesign</button>
            </div>
          </div>
          <button
            className={`btn-primary${modificado ? ' btn-salvar-modificado' : ''}`}
            onClick={salvar}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : '💾 Salvar'}
          </button>
        </div>
      </header>

      <div className="pub-body">

        {/* ── Metadados ─────────────────────────────────────────── */}
        <section className="pub-meta-section">
          <h2 className="pub-section-title">Dados da publicação</h2>
          <div className="pub-meta-grid">
            <div className="campo">
              <label>Título *</label>
              <input value={form.titulo} onChange={setField('titulo')} />
            </div>
            <div className="pub-edicao-row">
              <div className="campo pub-edicao-campo">
                <label>Edição</label>
                <input value={form.edicao} onChange={setField('edicao')} placeholder="Ex: 1ª edição" />
              </div>
              <label className={`home-check pub-ultima-edicao-check${form.ultima_edicao ? ' ativo' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(form.ultima_edicao)}
                  onChange={e => { setForm(f => ({ ...f, ultima_edicao: e.target.checked })); marcarModificado() }}
                />
                <span>Última edição</span>
              </label>
            </div>
            <div className="campo">
              <label>Organizador</label>
              <input value={form.organizador} onChange={setField('organizador')} placeholder="Nome do organizador" />
            </div>
            <div className="campo">
              <label>Lançado em</label>
              <input type="date" value={form.lancado_em} onChange={setField('lancado_em')} />
            </div>
            <div className="campo pub-meta-descricao">
              <label>Descrição</label>
              <textarea rows={3} value={form.descricao} onChange={setField('descricao')} placeholder="Descrição da publicação…" />
            </div>
            <div className="campo">
              <label>Caminho na rede</label>
              <input
                value={form.caminho_rede}
                onChange={setField('caminho_rede')}
                placeholder={'Ex: \\\\servidor\\pasta\\publicacao.indd'}
              />
            </div>
            <div className="campo">
              <label>Status</label>
              <select className="status-select" value={form.status} onChange={setField('status')}>
                <option value="previsto">Previsto</option>
                <option value="solicitado">Solicitado</option>
                <option value="em produção">Em produção</option>
                <option value="parado">Parado</option>
                <option value="concluído">Concluído</option>
              </select>
            </div>
          </div>
        </section>

        {/* ── Seções ────────────────────────────────────────────── */}
        <section className="pub-cover-section">
          <h2 className="pub-section-title">Cor da capa</h2>
          <div className="pub-cover-colors">
            {COVER_COLORS.map((cor, idx) => (
              <button
                key={cor}
                type="button"
                className={`pub-cover-color${(form.cor_capa || DEFAULT_COVER_COLOR) === cor ? ' ativa' : ''}`}
                style={{ '--cover-option-color': cor }}
                onClick={() => setCorCapa(cor)}
                title={`Cor ${idx + 1}`}
              />
            ))}
          </div>
        </section>

        <section className="pub-secoes-section">
          <div className="pub-secoes-header">
            <h2 className="pub-section-title">Seções</h2>
            <button className="btn-ghost" onClick={() => { setNovaSecaoTit(''); setModalSecao(true) }}>
              + Nova seção
            </button>
          </div>

          {secoes.length === 0 && (
            <p className="pub-vazio">Nenhuma seção. Clique em "+ Nova seção" para começar.</p>
          )}

          {secoes.map((secao, si) => (
            <div key={si} className="pub-secao">
              <div className="pub-secao-header">
                {editandoSecao === si ? (
                  <input
                    className="pub-secao-titulo-input"
                    autoFocus
                    value={secao.titulo}
                    onChange={e => renomearSecao(si, e.target.value)}
                    onBlur={() => setEditandoSecao(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditandoSecao(null) }}
                  />
                ) : (
                  <h3 className="pub-secao-titulo" onDoubleClick={() => setEditandoSecao(si)}>
                    {secao.titulo}
                  </h3>
                )}
                <div className="pub-secao-controles">
                  <button className="btn-ghost btn-sm" onClick={() => moverSecao(si, -1)} disabled={si === 0} title="Mover para cima">↑</button>
                  <button className="btn-ghost btn-sm" onClick={() => moverSecao(si, 1)} disabled={si === secoes.length - 1} title="Mover para baixo">↓</button>
                  <button className="btn-ghost btn-sm" onClick={() => setEditandoSecao(si)} title="Renomear">✏️</button>
                  <button className="btn-ghost btn-sm" onClick={() => excluirSecao(si)} title="Excluir seção">🗑</button>
                </div>
              </div>

              {/* Lista de normas */}
              <div
                className="pub-normas-lista"
                onDragOver={e => {
                  if (!dragNorma) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={e => {
                  if (!dragNorma) return
                  e.preventDefault()
                  moverNormaParaFimPorDrag(dragNorma, si)
                  encerrarDragNorma()
                }}
              >
                {secao.normas.length === 0 && (
                  <p className="pub-norma-vazio">Nenhuma norma nesta seção.</p>
                )}
                {secao.normas.length > 0 && (
                  <div className="pub-norma-lista-header">
                    <span></span>
                    <span>Norma</span>
                    <span>Exportação</span>
                    <span>Ações</span>
                  </div>
                )}
                {secao.normas.map((n, ni) => {
                  const st = statusNormaInfo(n.status)
                  const exportacao = exportacaoEfetiva(n)
                  const bloqueada = exportacaoBloqueada(n)
                  return (
                    <div
                      key={n.pn_id}
                      className={`pub-norma-item${dragNorma?.secaoIdx === si && dragNorma?.normaIdx === ni ? ' arrastando' : ''}`}
                      onDragOver={e => {
                        if (!dragNorma) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={e => {
                        if (!dragNorma) return
                        e.preventDefault()
                        e.stopPropagation()
                        moverNormaPorDrag(dragNorma, { secaoIdx: si, normaIdx: ni })
                        encerrarDragNorma()
                      }}
                    >
                      <span
                        className="pub-norma-drag-handle"
                        title="Arrastar para reordenar"
                        draggable
                        onDragStart={e => iniciarDragNorma(e, si, ni)}
                        onDragEnd={encerrarDragNorma}
                      >⋮⋮</span>
                      <div
                        className="pub-norma-info pub-norma-info-link"
                        title="Abrir no editor"
                        onClick={() => nav(`/editor/${n.norma_id}`)}
                      >
                        <span className="pub-norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</span>
                        {n.apelido && <span className="pub-norma-apelido">{n.apelido}</span>}
                        <span className={`pub-norma-status pub-norma-status-${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="pub-norma-exportacao">
                        <select
                          value={exportacao}
                          disabled={bloqueada}
                          onChange={e => alterarExportacaoNorma(si, ni, e.target.value)}
                          title={n.atualizacao_pendente ? 'Bloqueada por Atualização pendente' : bloqueada ? 'Disponível apenas para normas finalizadas' : 'Configurar exportação'}
                        >
                          {EXPORTACAO_OPCOES.map(op => (
                            <option key={op.valor} value={op.valor}>{op.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="pub-norma-controles">
                        <button className="btn-ghost btn-sm" onClick={() => moverNorma(si, ni, -1)} disabled={ni === 0}>↑</button>
                        <button className="btn-ghost btn-sm" onClick={() => moverNorma(si, ni, 1)} disabled={ni === secao.normas.length - 1}>↓</button>
                        <button className="btn-ghost btn-sm" onClick={() => removerNormaDaSecao(si, n.pn_id)}>✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button className="btn-ghost pub-add-norma" onClick={() => abrirModalNorma(si)}>
                + Adicionar norma
              </button>
            </div>
          ))}
        </section>
      </div>

      {/* ── Modal: adicionar norma ─────────────────────────────── */}
      {modalSecaoIdx !== null && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) fecharModalNorma() }}>
          <div className="modal-box modal-norma-picker" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Adicionar norma — {secoes[modalSecaoIdx]?.titulo}</h3>
              <button className="btn-ghost modal-fechar" onClick={fecharModalNorma}>✕</button>
            </div>
            <div className="modal-norma-abas">
              <button
                type="button"
                className={abaModalNorma === 'catalogo' ? 'ativa' : ''}
                onClick={() => setAbaModalNorma('catalogo')}
              >
                Escolher existente
              </button>
              <button
                type="button"
                className={abaModalNorma === 'recorte' ? 'ativa' : ''}
                onClick={() => setAbaModalNorma('recorte')}
              >
                Adicionar recorte de norma
              </button>
              <button
                type="button"
                className={abaModalNorma === 'nova' ? 'ativa' : ''}
                onClick={() => setAbaModalNorma('nova')}
              >
                Criar nova norma
              </button>
            </div>
            <div className="modal-norma-picker-body">
              {abaModalNorma === 'catalogo' && (
                <>
                  <div className="modal-norma-filtros">
                    <input
                      className="input-busca"
                      autoFocus
                      placeholder="Buscar por epígrafe ou apelido..."
                      value={buscaNorma}
                      onChange={e => setBuscaNorma(e.target.value)}
                    />
                    <label className={`home-check${somenteVm ? ' ativo' : ''}`}>
                      <input
                        type="checkbox"
                        checked={somenteVm}
                        onChange={e => setSomenteVm(e.target.checked)}
                      />
                      <span>Vade mecum</span>
                    </label>
                    <label className={`home-check${somenteTextoComum ? ' ativo' : ''}`}>
                      <input
                        type="checkbox"
                        checked={somenteTextoComum}
                        onChange={e => setSomenteTextoComum(e.target.checked)}
                      />
                      <span>Texto comum</span>
                    </label>
                  </div>
                  <div className="modal-norma-lista">
                    {loadingNormas ? (
                      <p className="pub-vazio">Carregando...</p>
                    ) : normasFiltradas.length === 0 ? (
                      <p className="pub-vazio">Nenhuma norma disponível.</p>
                    ) : normasFiltradas.map(n => {
                      const st = statusNormaInfo(n.status)
                      return (
                        <button
                          key={n.id}
                          className="modal-norma-item"
                          onClick={() => { adicionarNorma(n); fecharModalNorma() }}
                        >
                          <span className="pub-norma-tipo">{n.tipo}</span>
                          <span className={`pub-norma-status pub-norma-status-${st.cls}`}>{st.label}</span>
                          <span className="pub-norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</span>
                          {n.apelido && <span className="pub-norma-apelido">{n.apelido}</span>}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              {abaModalNorma === 'recorte' && (
                <form className="modal-recorte-norma-form" onSubmit={testarRecorteNorma}>
                  <div className="campo">
                    <label>Norma de origem *</label>
                    <select
                      value={recorteNormaId}
                      onChange={e => setRecorteNormaId(e.target.value)}
                    >
                      <option value="">Selecione uma norma...</option>
                      {normasDisponiveis.map(n => (
                        <option key={n.id} value={n.id}>
                          {n.atualizacao_pendente ? '⚠️ ' : ''}{n.epigrafe}{n.apelido ? ` (${n.apelido})` : ''}{textoTagsNorma(n)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="campo">
                    <div className="modal-recorte-label-linha">
                      <label>Dispositivos do recorte *</label>
                      <button
                        type="button"
                        className="modal-recorte-help-btn"
                        onClick={() => setRecorteAjudaAberta(v => !v)}
                        aria-expanded={recorteAjudaAberta}
                        title="Ver exemplos de fórmula de extração"
                      >
                        ?
                      </button>
                    </div>
                    <textarea
                      rows={5}
                      value={recorteDispositivos}
                      onChange={e => setRecorteDispositivos(e.target.value)}
                      placeholder={'Ex: Art. 11; Art. 14, caput; Art. 23, III a V; Art. 34 { V, "b"; VII, "b" a "e" }; Art. 60 { §4º, II }; Arts. 38 a 41'}
                    />
                  </div>

                  {recorteAjudaAberta && (
                    <div className="modal-recorte-help">
                      <strong>Exemplos de fórmula</strong>
                      <ul>
                        <li><code>Art. 11</code><span>artigo inteiro</span></li>
                        <li><code>Art. 14, caput</code><span>somente o texto inicial do artigo</span></li>
                        <li><code>Art. 5º {'{'} I, II, V {'}'}</code><span>incisos específicos</span></li>
                        <li><code>Art. 23, III a V</code><span>intervalo de incisos</span></li>
                        <li><code>Art. 34 {'{'} VII, "a", "b", "d" {'}'}</code><span>alíneas soltas do mesmo inciso</span></li>
                        <li><code>Art. 34 {'{'} VII, "b" a "e" {'}'}</code><span>intervalo de alíneas</span></li>
                        <li><code>Art. 60 {'{'} §4º, II {'}'}</code><span>inciso dentro de parágrafo</span></li>
                        <li><code>Arts. 38 a 41</code><span>intervalo de artigos completos</span></li>
                      </ul>
                    </div>
                  )}

                  <p className="modal-recorte-ajuda">
                    Separe artigos por ponto e vírgula. Use chaves para recortar vários dispositivos do mesmo artigo, inclusive incisos dentro de parágrafos.
                  </p>

                  {recorteErro && <p className="form-erro">{recorteErro}</p>}

                  <div className="form-acoes">
                    <button type="button" className="btn-ghost" onClick={fecharModalNorma}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={recorteCarregando || !recorteNormaId || !recorteDispositivos.trim()}>
                      {recorteCarregando ? 'Extraindo...' : 'Testar extração'}
                    </button>
                  </div>
                </form>
              )}
              {abaModalNorma === 'nova' && (
                <form className="modal-nova-norma-form" onSubmit={criarNormaEAdicionar}>
                  <div className="campo">
                    <label>Tipo *</label>
                    <select
                      value={novaNormaForm.tipo}
                      onChange={e => setNovaNormaForm(f => ({ ...f, tipo: e.target.value }))}
                    >
                      {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="campo">
                    <label>Epígrafe *</label>
                    <input
                      autoFocus
                      placeholder="Ex: Lei nº 9.610, de 19 de fevereiro de 1998"
                      value={novaNormaForm.epigrafe}
                      onChange={e => setNovaNormaForm(f => ({ ...f, epigrafe: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="campo">
                    <label>Apelido <span className="campo-opcional">(opcional)</span></label>
                    <input
                      placeholder="Ex: Lei de Direitos Autorais"
                      value={novaNormaForm.apelido}
                      onChange={e => setNovaNormaForm(f => ({ ...f, apelido: e.target.value }))}
                    />
                  </div>
                  <div className="campo">
                    <label>Ementa <span className="campo-opcional">(opcional)</span></label>
                    <textarea
                      rows={3}
                      placeholder="Dispõe sobre..."
                      value={novaNormaForm.ementa}
                      onChange={e => setNovaNormaForm(f => ({ ...f, ementa: e.target.value }))}
                    />
                  </div>

                  <div className="form-secao">
                    <h3>Dados complementares</h3>
                    <div className="campo">
                      <label>Dados de publicação, republicação e retificação <span className="campo-opcional">(opcional)</span></label>
                      <textarea
                        rows={3}
                        value={novaNormaForm.dados_publicacao}
                        onChange={e => setNovaNormaForm(f => ({ ...f, dados_publicacao: e.target.value }))}
                      />
                    </div>

                    <div className="form-grid-2">
                      <div className="campo">
                        <label>Data da última alteração <span className="campo-opcional">(opcional)</span></label>
                        <input
                          type="date"
                          value={novaNormaForm.data_ultima_alteracao}
                          onChange={e => setNovaNormaForm(f => ({ ...f, data_ultima_alteracao: e.target.value }))}
                        />
                      </div>
                      <div className="campo campo-check">
                        <label className={`home-check pendente-check${novaNormaForm.atualizacao_pendente ? ' ativo' : ''}`}>
                          <input
                            type="checkbox"
                            checked={Boolean(novaNormaForm.atualizacao_pendente)}
                            onChange={e => setNovaNormaForm(f => ({ ...f, atualizacao_pendente: e.target.checked }))}
                          />
                          {novaNormaForm.atualizacao_pendente && <span className="pendente-check-alerta" aria-hidden="true">⚠️</span>}
                          <span>Atualização pendente</span>
                        </label>
                      </div>
                      <div className="campo">
                        <label>Vigência</label>
                        <input
                          value={novaNormaForm.vigencia}
                          onChange={e => setNovaNormaForm(f => ({ ...f, vigencia: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="campo">
                      <label>Link para acesso <span className="campo-opcional">(opcional)</span></label>
                      <input
                        type="url"
                        value={novaNormaForm.link_acesso}
                        onChange={e => setNovaNormaForm(f => ({ ...f, link_acesso: e.target.value }))}
                      />
                    </div>

                    <div className="campo">
                      <label>Anexo <span className="campo-opcional">(opcional)</span></label>
                      <input
                        value={novaNormaForm.anexo}
                        onChange={e => setNovaNormaForm(f => ({ ...f, anexo: e.target.value }))}
                      />
                    </div>

                    <div className="campo">
                      <label>Outras observações <span className="campo-opcional">(opcional)</span></label>
                      <textarea
                        rows={3}
                        value={novaNormaForm.observacoes}
                        onChange={e => setNovaNormaForm(f => ({ ...f, observacoes: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="campo">
                    <label>Tags <span className="campo-opcional">(opcional)</span></label>
                    <div className="tag-input-wrap">
                      {novaNormaTags.map(t => (
                        <span key={t} className="tag-chip">
                          {t}
                          <button type="button" className="tag-chip-remover" onClick={() => removerNovaNormaTag(t)}>×</button>
                        </span>
                      ))}
                      <input
                        className="tag-input"
                        placeholder={novaNormaTags.length === 0 ? 'Adicionar tag...' : ''}
                        value={novaNormaTagInput}
                        onChange={e => onNovaNormaTagInputChange(e.target.value)}
                        onFocus={() => setNovaNormaSugestoes(calcSugestoesTags(novaNormaTagInput, novaNormaTags))}
                        onBlur={() => setTimeout(() => setNovaNormaSugestoes([]), 150)}
                        onKeyDown={onNovaNormaTagKeyDown}
                      />
                    </div>
                    {novaNormaSugestoes.length > 0 && (
                      <ul className="tag-sugestoes">
                        {novaNormaSugestoes.map(t => (
                          <li key={t}>
                            <button type="button" onClick={() => adicionarNovaNormaTag(t)}>{t}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {erroNovaNorma && <p className="form-erro">{erroNovaNorma}</p>}
                  <div className="form-acoes">
                    <button type="button" className="btn-ghost" onClick={fecharModalNorma}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={criandoNorma || !novaNormaForm.epigrafe.trim()}>
                      {criandoNorma ? 'Criando...' : 'Criar e adicionar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nova seção ──────────────────────────────────── */}
      {modalResultadoRecorte && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalResultadoRecorte(null) }}>
          <div className="modal-box modal-recorte-resultado" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Resultado do recorte</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalResultadoRecorte(null)}>×</button>
            </div>
            <div className="modal-recorte-resultado-corpo">
              <div className="modal-recorte-resumo">
                <strong>{modalResultadoRecorte.norma.epigrafe}</strong>
                {modalResultadoRecorte.norma.apelido && <span>{modalResultadoRecorte.norma.apelido}</span>}
                <code>{modalResultadoRecorte.especificacao}</code>
              </div>

              <div className="modal-recorte-resultados">
                {modalResultadoRecorte.itens.map((item, idx) => (
                  <section key={`${item.entrada}-${idx}`} className={`modal-recorte-item${item.erro ? ' com-erro' : ''}`}>
                    <header>
                      <span>{idx + 1}</span>
                      <strong>{item.entrada}</strong>
                      {!item.erro && <em>{item.total || item.textos.length} bloco(s)</em>}
                    </header>
                    {item.erro ? (
                      <p className="form-erro">{item.erro}</p>
                    ) : (
                      <ul>
                        {item.textos.map((texto, textoIdx) => (
                          <li key={`${idx}-${textoIdx}`}>{texto || '—'}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
              {recorteErro && <p className="form-erro">{recorteErro}</p>}
              <div className="modal-recorte-resultado-footer">
                <button type="button" className="btn-ghost" onClick={() => setModalResultadoRecorte(null)}>
                  Voltar ao ajuste
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={criandoRecorte || modalResultadoRecorte.itens.some(item => item.erro)}
                  onClick={criarRecorteConfirmado}
                >
                  {criandoRecorte ? 'Criando...' : 'Criar recorte'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalSecao && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalSecao(false) }}>
          <div className="modal-box" style={{ width: 'min(380px, 96vw)' }} onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nova seção</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalSecao(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="campo">
                <label>Título da seção</label>
                <input
                  autoFocus
                  value={novaSecaoTit}
                  onChange={e => setNovaSecaoTit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') adicionarSecao() }}
                  placeholder="Ex: Jurisprudência"
                />
              </div>
              <div className="form-acoes">
                <button className="btn-ghost" onClick={() => setModalSecao(false)}>Cancelar</button>
                <button className="btn-primary" onClick={adicionarSecao} disabled={!novaSecaoTit.trim()}>Adicionar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
