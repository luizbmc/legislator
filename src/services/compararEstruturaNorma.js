import { getNodeText } from './compararNorma.js'
import { filtrarDocPorModoVadeMecum } from './filtrarModoVadeMecum.js'

const TIPOS_ARTIGO = new Set(['artigo', 'artigoTitulo'])
const TIPOS_DISPOSITIVO = new Set(['paragrafLei', 'inciso', 'alinea', 'item', 'corpoTratado'])
const MARKS_IGNORADAS_NA_ESTRUTURA = new Set(['nota', 'notaSobrescrito', 'notaRodape'])

function textoDoNo(node) {
  return getNodeText(node)
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nodeTemMarkIgnorada(node) {
  return Array.isArray(node?.marks) && node.marks.some(mark => MARKS_IGNORADAS_NA_ESTRUTURA.has(mark?.type))
}

function textoEstruturalDoNo(node) {
  if (!node || nodeTemMarkIgnorada(node)) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return ' '
  if (!Array.isArray(node.content)) return ''
  return node.content.map(textoEstruturalDoNo).join('')
}

function textoIdentificadorDoNo(node) {
  return textoEstruturalDoNo(node)
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function nivelHeading(node, texto) {
  const norm = normalizar(texto)

  if (node?.type === 'partelivroTitCap') {
    if (/^PARTE\b/.test(norm)) return 1
    if (/^LIVRO\b/.test(norm)) return 2
    if (/^TITULO\b/.test(norm)) return 3
    if (/^CAPITULO\b/.test(norm)) return 4
    return 4
  }

  if (node?.type === 'aberturaCapitulo') return 4

  if (node?.type === 'secaoSubsecao') {
    if (/^SUBSECAO\b/.test(norm)) return 6
    if (/^SECAO\b/.test(norm)) return 5
    return 5
  }

  return null
}

function nodeEhHeading(node, texto) {
  return nivelHeading(node, texto) != null
}

function rotuloArtigo(texto) {
  const match = texto.match(/\bArt(?:\.|igo)?\s*[\u00a0\s]*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)\s*([º°])?/i)
  if (!match) return ''
  return `Art. ${match[1]}${match[2] || ''}`
}

function rotuloDispositivo(node, texto) {
  if (!TIPOS_DISPOSITIVO.has(node?.type)) return ''

  const norm = normalizar(texto)
  if (/^PARAGRAFO UNICO\b/.test(norm)) return 'Parágrafo único'

  const par = texto.match(/^§\s*\d+\s*[ºª°]?(?:-[A-Z])?/i)
  if (par) return par[0].replace(/\s+/g, ' ').trim()

  const inciso = texto.match(/^([IVXLCDM]+(?:-[A-Z])?)\s*[\u2013\u2014-]\s/i)
  if (inciso) return inciso[1].toUpperCase()

  const alinea = texto.match(/^([a-zà-ÿ])\)\s/i)
  if (alinea) return `${alinea[1].toLowerCase()})`

  const item = texto.match(/^(\d+(?:\.\d+)?)(?:[.)]|\s*[\u2013\u2014-])\s/i)
  if (item) return item[1]

  return ''
}

function linhaComIndentacao(linha) {
  return `${'  '.repeat(Math.max(0, linha.depth))}${linha.texto}`
}

function chaveLinha(linha) {
  return [
    linha.kind,
    linha.level || 0,
    normalizar(linha.caminho || ''),
    normalizar(linha.texto),
  ].join('|')
}

function criarLinha(kind, texto, depth, level, caminho) {
  const linha = { kind, texto, depth, level, caminho }
  linha.indentada = linhaComIndentacao(linha)
  linha.chave = chaveLinha(linha)
  return linha
}

function montarTextoArtigo(artigo) {
  const dispositivos = artigo.dispositivos.length
    ? ` {${artigo.dispositivos.join('; ')}};`
    : '.'
  return `${artigo.rotulo}${dispositivos}`
}

function adicionarDispositivo(artigo, node, texto) {
  const rotulo = rotuloDispositivo(node, texto)
  if (!rotulo) return

  if (node.type === 'paragrafLei') {
    artigo.paragrafoAtual = rotulo
    artigo.incisoAtual = ''
    artigo.alineaAtual = ''
    artigo.dispositivos.push(rotulo)
    return
  }

  if (node.type === 'inciso') {
    artigo.incisoAtual = rotulo
    artigo.alineaAtual = ''
    artigo.dispositivos.push(artigo.paragrafoAtual ? `${artigo.paragrafoAtual} > ${rotulo}` : rotulo)
    return
  }

  if (node.type === 'alinea') {
    artigo.alineaAtual = rotulo
    const partes = [artigo.paragrafoAtual, artigo.incisoAtual, rotulo].filter(Boolean)
    artigo.dispositivos.push(partes.join(' > '))
    return
  }

  if (node.type === 'item') {
    const partes = [artigo.paragrafoAtual, artigo.incisoAtual, artigo.alineaAtual, rotulo].filter(Boolean)
    artigo.dispositivos.push(partes.join(' > '))
  }
}

export function montarArvoreEstrutural(doc, opcoes = {}) {
  doc = filtrarDocPorModoVadeMecum(doc, !!opcoes.modoVadeMecum)

  const blocos = Array.isArray(doc?.content) ? doc.content : []
  const linhas = []
  let headings = []
  let artigoAtual = null

  function caminhoAtual() {
    return headings.map(item => item.texto).join(' > ')
  }

  function finalizarArtigo() {
    if (!artigoAtual) return
    const texto = montarTextoArtigo(artigoAtual)
    linhas.push(criarLinha('artigo', texto, headings.length, 0, artigoAtual.caminho))
    artigoAtual = null
  }

  for (const node of blocos) {
    const texto = textoDoNo(node)
    const textoIdentificador = textoIdentificadorDoNo(node) || texto
    if (!texto) continue

    const nivel = nivelHeading(node, textoIdentificador)
    if (nivel != null) {
      finalizarArtigo()
      headings = headings.filter(item => item.level < nivel)
      headings.push({ level: nivel, texto })
      linhas.push(criarLinha('heading', texto, headings.length - 1, nivel, caminhoAtual()))
      continue
    }

    if (TIPOS_ARTIGO.has(node.type)) {
      finalizarArtigo()
      const rotulo = rotuloArtigo(textoIdentificador)
      if (!rotulo) continue
      artigoAtual = {
        rotulo,
        caminho: caminhoAtual(),
        dispositivos: [],
        paragrafoAtual: '',
        incisoAtual: '',
        alineaAtual: '',
      }
      continue
    }

    if (artigoAtual && TIPOS_DISPOSITIVO.has(node.type)) {
      adicionarDispositivo(artigoAtual, node, textoIdentificador)
    }
  }

  finalizarArtigo()

  return {
    linhas,
    texto: linhas.map(linha => linha.indentada).join('\n'),
  }
}

function diffMultiset(base, comparado) {
  const contagem = new Map()
  for (const linha of comparado) {
    contagem.set(linha.chave, (contagem.get(linha.chave) || 0) + 1)
  }

  const faltantes = []
  for (const linha of base) {
    const total = contagem.get(linha.chave) || 0
    if (total > 0) {
      contagem.set(linha.chave, total - 1)
    } else {
      faltantes.push(linha)
    }
  }
  return faltantes
}

export function compararEstruturasNorma(oldDoc, newDoc, opcoes = {}) {
  const antiga = montarArvoreEstrutural(oldDoc, opcoes)
  const nova = montarArvoreEstrutural(newDoc, opcoes)
  const removidos = diffMultiset(antiga.linhas, nova.linhas)
  const adicionados = diffMultiset(nova.linhas, antiga.linhas)

  return {
    antiga,
    nova,
    removidos,
    adicionados,
    totalAntiga: antiga.linhas.length,
    totalNova: nova.linhas.length,
    totalDiferencas: removidos.length + adicionados.length,
  }
}
