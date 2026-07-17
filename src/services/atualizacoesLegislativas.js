const MESES_PT = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function dataNormaIso(valor) {
  const texto = String(valor || '').trim()
  if (!texto) return ''
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const data = new Date(texto)
  if (Number.isNaN(data.getTime())) return ''
  return data.toISOString().slice(0, 10)
}

export function dataMaisRecente(...valores) {
  return valores
    .map(dataNormaIso)
    .filter(Boolean)
    .sort()
    .pop() || ''
}

function montarDataIso(ano, mes, dia) {
  if (!ano || !mes || !dia) return ''
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export function dataIsoDeTextoLegislativo(valor) {
  const texto = String(valor || '').replace(/\u00a0/g, ' ')
  let match = texto.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (match) return montarDataIso(Number(match[3]), Number(match[2]), Number(match[1]))

  match = texto.match(/\b(?:de\s+)?(\d{1,2})(?:\u00ba|\u00b0|o)?\.?\s+de\s+([A-Za-z\u00c0-\u00ff]+)\.?\s+de\s+(\d{4})\b/i)
  if (!match) return ''
  const mes = MESES_PT[normalizarTexto(match[2])]
  return montarDataIso(Number(match[3]), mes, Number(match[1]))
}

function chaveAtoLegislativo(valor) {
  const texto = normalizarTexto(valor)
    .replace(/n[\u00ba\u00b0o]\.?/g, 'n')
  const tipo = texto.match(/\b(emenda constitucional|lei complementar|medida provisoria|decreto-lei|decreto|lei ordinaria|lei)\b/)?.[1] || ''
  const inicioBusca = tipo ? texto.indexOf(tipo) + tipo.length : 0
  const numero = texto.slice(inicioBusca).match(/\b(?:n\s*)?(\d[\d.]*)\b/)?.[1] || ''
  const tipoCanonico = tipo.includes('lei ordinaria') ? 'lei' : tipo
  return `${tipoCanonico}:${numero.replace(/\./g, '')}`
}

export function extrairReferenciasLegislativasDeTexto(texto) {
  const fonte = String(texto || '').replace(/\u00a0/g, ' ')
  const regex = /\b(?:Emenda Constitucional|Lei Complementar|Medida Provis.ria|Decreto-Lei|Decreto|Lei)\s+(?:n\S*\s*)?\d[\d.]*[A-Za-z-]*(?:\s*,?\s*de\s*(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}(?:\u00ba|\u00b0|o)?\.?\s+de\s+[A-Za-z\u00c0-\u00ff]+\.?\s+de\s+\d{4}))?/gi
  const refs = []

  for (const match of fonte.matchAll(regex)) {
    const textoReferencia = match[0].replace(/\s+/g, ' ').trim()
    const data = dataIsoDeTextoLegislativo(textoReferencia)
    if (!data) continue
    refs.push({
      texto: textoReferencia,
      data,
      chave: chaveAtoLegislativo(textoReferencia),
    })
  }

  return refs
}

function textoTemMarkNota(node) {
  return node?.type === 'text' && (node.marks || []).some(mark => mark.type === 'nota')
}

function coletarTrechosNotaEmBloco(node, trechos) {
  if (!node) return
  if (!Array.isArray(node.content)) return

  let atual = ''
  for (const filho of node.content) {
    if (textoTemMarkNota(filho)) {
      atual += filho.text || ''
      continue
    }
    if (atual.trim()) trechos.push(atual)
    atual = ''
    coletarTrechosNotaEmBloco(filho, trechos)
  }
  if (atual.trim()) trechos.push(atual)
}

export function extrairReferenciasLegislativasDasNotas(docJson) {
  const trechos = []
  coletarTrechosNotaEmBloco(docJson, trechos)

  const mapa = new Map()
  for (const trecho of trechos) {
    for (const ref of extrairReferenciasLegislativasDeTexto(trecho)) {
      const id = `${ref.chave}:${ref.data}`
      if (!mapa.has(id)) mapa.set(id, ref)
    }
  }

  return Array.from(mapa.values()).sort((a, b) => a.data.localeCompare(b.data))
}

export function ultimaReferenciaLegislativaDasNotas(docJson) {
  const referencias = extrairReferenciasLegislativasDasNotas(docJson)
  return {
    referencias,
    maisRecente: referencias[referencias.length - 1] || null,
  }
}

export function filtrarAlteradorasPendentes(videNormas, dataBase) {
  const base = dataNormaIso(dataBase)
  if (!base) return []
  return (videNormas || []).filter(item => {
    const dataAlteradora = dataNormaIso(item?.data)
    return dataAlteradora && dataAlteradora > base
  })
}
