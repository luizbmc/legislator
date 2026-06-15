const ESTILOS_VM = {
  paragrafLei: { label: 'Parágrafo', mark: 'bold' },
  inciso: { label: 'Inciso', mark: 'bold' },
  alinea: { label: 'Alínea', mark: 'italic' },
  item: { label: 'Item', mark: 'italic' },
}

function cloneDoc(doc) {
  return doc ? JSON.parse(JSON.stringify(doc)) : { type: 'doc', content: [] }
}

function textoDoNo(no) {
  if (!no) return ''
  if (no.type === 'text') return no.text || ''
  if (!Array.isArray(no.content)) return ''
  return no.content.map(textoDoNo).join('')
}

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trimStart()
}

function ehParagrafoUnico(texto) {
  return /^paragrafo\s+unico\./.test(normalizarTexto(texto))
}

function temMark(no, markType) {
  return (no.marks || []).some(mark => mark.type === markType)
}

function addMark(marks = [], markType) {
  return marks.some(mark => mark.type === markType) ? marks : [...marks, { type: markType }]
}

function removeMark(marks = [], markType) {
  return marks.filter(mark => mark.type !== markType)
}

function prefixoEstiloVm(texto, tipo) {
  const raw = String(texto || '')
  if (!raw) return 0

  if (tipo === 'inciso') {
    const marcadorInciso = /^[IVXLCDM]+(?:-[A-Z])?\s*[–—-]/i.exec(raw)
    if (marcadorInciso) return marcadorInciso[0].length
  }

  const primeiroEspacoNormal = raw.indexOf(' ')
  if (primeiroEspacoNormal === 0) return 0
  if (primeiroEspacoNormal > 0) return primeiroEspacoNormal
  return raw.length
}

function aplicarMarkNoPrefixo(content = [], limite, markType, aplicar) {
  if (!limite || limite <= 0) return content

  let restante = limite
  const out = []

  for (const node of content) {
    if (!restante || node.type !== 'text' || !node.text) {
      out.push(node)
      continue
    }

    const texto = node.text
    const len = texto.length
    const alvo = Math.min(restante, len)
    const antes = texto.slice(0, alvo)
    const depois = texto.slice(alvo)
    const marks = aplicar ? addMark(node.marks || [], markType) : removeMark(node.marks || [], markType)

    if (antes) out.push({ ...node, text: antes, marks })
    if (depois) out.push({ ...node, text: depois })
    restante -= alvo
  }

  return out
}

function prefixoTemMark(content = [], limite, markType) {
  if (!limite || limite <= 0) return false

  let restante = limite
  for (const node of content) {
    if (!restante) break
    if (node.type !== 'text' || !node.text) continue

    const len = Math.min(restante, node.text.length)
    if (len > 0 && !temMark(node, markType)) return false
    restante -= len
  }

  return restante === 0
}

function listaAlvos(doc) {
  const itens = []
  let linha = 0

  ;(doc?.content || []).forEach((node, index) => {
    if (node?.type === 'table') return
    linha++
    const cfg = ESTILOS_VM[node?.type]
    if (!cfg) return

    const texto = textoDoNo(node).trim()
    if (!texto) return
    if (node?.type === 'paragrafLei' && ehParagrafoUnico(texto)) return

    const prefixLen = prefixoEstiloVm(textoDoNo(node), node.type)
    if (!prefixLen) {
      itens.push({ index, linha, node, cfg, texto, prefixLen, semPrefixo: true })
      return
    }

    itens.push({ index, linha, node, cfg, texto, prefixLen, semPrefixo: false })
  })

  return itens
}

export function validarEstiloVadeMecum(doc) {
  const alvos = listaAlvos(doc)
  const pendentes = alvos
    .filter(item => item.semPrefixo || !prefixoTemMark(item.node.content || [], item.prefixLen, item.cfg.mark))
    .map(item => ({
      linha: item.linha,
      estilo: item.cfg.label,
      esperado: item.cfg.mark === 'bold' ? 'negrito' : 'itálico',
      texto: item.texto,
    }))

  return {
    totalAlvos: alvos.length,
    totalPendentes: pendentes.length,
    pendentes,
  }
}

export function documentoTemEstiloVadeMecum(doc) {
  const validacao = validarEstiloVadeMecum(doc)
  return validacao.totalAlvos > 0 && validacao.totalPendentes === 0
}

export function aplicarEstiloVadeMecumDoc(doc, ativo = true) {
  const next = cloneDoc(doc)
  let alterados = 0

  const alvos = listaAlvos(next)
  alvos.forEach(item => {
    const node = next.content[item.index]
    if (!node || !item.prefixLen) return

    const before = JSON.stringify(node.content || [])
    node.content = aplicarMarkNoPrefixo(node.content || [], item.prefixLen, item.cfg.mark, ativo)
    if (JSON.stringify(node.content || []) !== before) alterados++
  })

  const validacao = ativo
    ? validarEstiloVadeMecum(next)
    : { totalAlvos: alvos.length, totalPendentes: 0, pendentes: [] }

  return {
    doc: next,
    ativo,
    alterados,
    totalAlvos: alvos.length,
    ...validacao,
  }
}
