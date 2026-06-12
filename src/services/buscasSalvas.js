const STORAGE_KEY = 'legislator.buscasSalvas.v1'
export const BUSCAS_SALVAS_EVENT = 'legislator:buscas-salvas'

export function carregarBuscasSalvas() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const lista = raw ? JSON.parse(raw) : []
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

export function salvarBuscaSalva(busca) {
  const lista = carregarBuscasSalvas()
  const nova = {
    id: `busca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: new Date().toISOString(),
    ...busca,
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...lista, nova]))
  window.dispatchEvent(new CustomEvent(BUSCAS_SALVAS_EVENT))
  return nova
}

export function excluirBuscaSalva(id) {
  const lista = carregarBuscasSalvas().filter(busca => busca.id !== id)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lista))
  window.dispatchEvent(new CustomEvent(BUSCAS_SALVAS_EVENT))
}

export function buildRegexBuscaSalva(busca, global = true) {
  if (!busca?.pat) return null
  const flags = (global ? 'g' : '') + (busca.flagI ? 'i' : '')
  return busca.useReg
    ? new RegExp(busca.pat, flags)
    : new RegExp(busca.pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}

export function coletarOcorrenciasBuscaSalva(editor, busca) {
  if (!editor || !busca?.pat) return []
  const regex = buildRegexBuscaSalva(busca, true)
  const filtroParags = new Set(busca.filtroParags ?? [])
  const filtroChars = new Set(busca.filtroChars ?? [])
  const found = []
  const cruzarParagrafos = Boolean(busca.useReg && /\\n|\n/.test(busca.pat))

  function textBlockParts(block, blockPos) {
    const parts = []
    let text = ''

    block.descendants((child, childPos) => {
      if (!child.isText) return
      parts.push({
        start: text.length,
        end: text.length + child.text.length,
        from: blockPos + 1 + childPos,
        marks: child.marks,
        text: child.text,
      })
      text += child.text
    })

    return { text, parts }
  }

  function positionFromOffset(parts, offset) {
    if (!parts.length) return null
    for (const part of parts) {
      if (offset >= part.start && offset <= part.end) {
        return part.from + (offset - part.start)
      }
    }
    const last = parts[parts.length - 1]
    return last.from + last.text.length
  }

  function rangeHasCharacterFilters(parts, fromOffset, toOffset) {
    if (filtroChars.size === 0) return true
    return parts.some(part => {
      if (part.end <= fromOffset || part.start >= toOffset) return false
      const markNames = new Set(part.marks.map(m => m.type.name))
      return [...filtroChars].every(f => markNames.has(f))
    })
  }

  function marksAtOffset(parts, offset) {
    for (const part of parts) {
      if (offset >= part.start && offset < part.end) return part.marks
    }
    return parts.length ? parts[0].marks : []
  }

  const blocos = []

  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return

    if (filtroParags.size > 0) {
      const tipo = node?.type?.name ?? ''
      if (!filtroParags.has(tipo)) return
    }

    const { text, parts } = textBlockParts(node, pos)
    if (!text || !parts.length) return

    blocos.push({ node, pos, text, parts })

    if (cruzarParagrafos) return

    regex.lastIndex = 0
    let match
    while ((match = regex.exec(text)) !== null) {
      const from = positionFromOffset(parts, match.index)
      const to = positionFromOffset(parts, match.index + match[0].length)
      if (from == null || to == null) break
      if (rangeHasCharacterFilters(parts, match.index, match.index + match[0].length)) {
        found.push({
          from,
          to,
          texto: match[0],
          fullMatch: match[0],
          groups: Array.from(match),
          marks: marksAtOffset(parts, match.index),
        })
      }
      if (match[0].length === 0) regex.lastIndex++
    }
  })

  if (cruzarParagrafos) {
    for (let i = 0; i < blocos.length; i++) {
      const primeiro = blocos[i]
      if (!primeiro.text.trim()) continue

      let j = i + 1
      while (j < blocos.length && !blocos[j].text.trim()) j++
      if (j >= blocos.length) continue

      const segundo = blocos[j]
      const sepOffset = primeiro.text.length
      const combined = `${primeiro.text}\n${segundo.text}`

      regex.lastIndex = 0
      let match
      while ((match = regex.exec(combined)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        const cruzaSeparador = start <= sepOffset && end > sepOffset
        if (cruzaSeparador && rangeHasCharacterFilters(primeiro.parts, 0, primeiro.text.length)) {
          found.push({
            tipo: 'entreParagrafos',
            from: positionFromOffset(primeiro.parts, Math.min(start, primeiro.text.length)),
            to: positionFromOffset(segundo.parts, Math.max(0, end - sepOffset - 1)),
            texto: match[0],
            fullMatch: match[0],
            groups: Array.from(match),
            marks: marksAtOffset(primeiro.parts, Math.min(start, primeiro.text.length)),
            index: start,
            combined,
            primeiro: {
              pos: primeiro.pos,
              nodeSize: primeiro.node.nodeSize,
              contentSize: primeiro.node.content.size,
            },
            ultimo: {
              pos: segundo.pos,
              nodeSize: segundo.node.nodeSize,
            },
          })
        }
        if (match[0].length === 0) regex.lastIndex++
      }
    }
  }

  return found
}
