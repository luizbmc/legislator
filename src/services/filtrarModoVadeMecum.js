export function filtrarNoPorModoVadeMecum(no, modoVadeMecum = false) {
  if (!no || typeof no !== 'object') return no

  const role = no.attrs?.vmRole
  if (role === 'vm' && !modoVadeMecum) return null
  if (role === 'original' && modoVadeMecum) return null

  const out = { ...no }
  if (out.type === 'text') {
    const preparado = prepararTextoPorModoVadeMecum(out, modoVadeMecum)
    return preparado?.text ? preparado : null
  }

  if (out.attrs) {
    const attrs = { ...out.attrs }
    delete attrs.vmRole
    if (Object.keys(attrs).length) out.attrs = attrs
    else delete out.attrs
  }

  if (Array.isArray(out.content)) {
    out.content = out.content
      .map(filho => filtrarNoPorModoVadeMecum(filho, modoVadeMecum))
      .filter(Boolean)
  }

  return out
}

function limparAttrsNotaVm(mark) {
  if (!mark?.attrs) return mark
  const attrs = { ...mark.attrs }
  delete attrs.vmText
  delete attrs.vmHidden
  return Object.keys(attrs).length ? { ...mark, attrs } : { type: mark.type }
}

function prepararMarkNota(mark, modoVadeMecum) {
  if (mark?.type !== 'nota') return mark
  if (modoVadeMecum && mark.attrs?.vmHidden) return null
  return limparAttrsNotaVm(mark)
}

function prepararTextoPorModoVadeMecum(no, modoVadeMecum) {
  const notaMark = no.marks?.find(mark => mark.type === 'nota')
  if (modoVadeMecum && notaMark?.attrs?.vmHidden) return null

  const out = { ...no }
  if (modoVadeMecum && notaMark?.attrs?.vmText != null) {
    out.text = String(notaMark.attrs.vmText || '')
  }

  if (Array.isArray(out.marks)) {
    out.marks = out.marks
      .map(mark => prepararMarkNota(mark, modoVadeMecum))
      .filter(Boolean)
    if (!out.marks.length) delete out.marks
  }

  return out
}

export function filtrarDocPorModoVadeMecum(doc, modoVadeMecum = false) {
  return {
    ...(doc || { type: 'doc' }),
    content: (doc?.content || [])
      .map(no => filtrarNoPorModoVadeMecum(no, modoVadeMecum))
      .filter(Boolean),
  }
}
