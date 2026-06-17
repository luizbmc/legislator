function maxOffset(node) {
  if (!node) return 0
  return node.nodeType === Node.TEXT_NODE
    ? node.nodeValue.length
    : node.childNodes.length
}

function clampOffset(node, offset) {
  return Math.max(0, Math.min(Number(offset) || 0, maxOffset(node)))
}

function aplicarSelecaoDom(editor, from, to) {
  try {
    const start = editor.view.domAtPos(from)
    const end = editor.view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, clampOffset(start.node, start.offset))
    range.setEnd(end.node, clampOffset(end.node, end.offset))

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  } catch {
    return false
  }
}

export function selecionarTextoNoEditor(editor, range, options = {}) {
  if (!editor || !range) return false

  const from = Number(range.from)
  const to = Number(range.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false

  try {
    editor.commands.setTextSelection({ from, to })
  } catch {}

  if (editor.isEditable) {
    try {
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
    } catch {}
  }

  requestAnimationFrame(() => {
    aplicarSelecaoDom(editor, from, to)
    try {
      const { node } = editor.view.domAtPos(from)
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      el?.scrollIntoView({
        behavior: options.behavior || 'smooth',
        block: options.block || 'center',
      })
    } catch {
      try {
        editor.commands.scrollIntoView()
      } catch {}
    }
  })

  return true
}
