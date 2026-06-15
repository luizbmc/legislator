import { useEffect, useState } from 'react'

function hasMark(node, name) {
  return (node.marks || []).some(mark => mark.type.name === name)
}

function compactText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function isItalic(node) {
  return hasMark(node, 'italic') || hasMark(node, 'italicoLight')
}

function notaMark(node) {
  return (node.marks || []).find(mark => mark.type.name === 'nota')
}

function normalizeSegments(segments) {
  const normalized = []
  for (const seg of segments) {
    const text = (seg.text || '').replace(/\s+/g, ' ')
    if (!text) continue
    const last = normalized[normalized.length - 1]
    if (last && last.italic === seg.italic) {
      last.text += text
    } else {
      normalized.push({ text, italic: !!seg.italic })
    }
  }

  if (normalized.length) normalized[0].text = normalized[0].text.replace(/^\s+/, '')
  if (normalized.length) {
    const last = normalized[normalized.length - 1]
    last.text = last.text.replace(/\s+$/, '')
  }
  return normalized.filter(seg => seg.text)
}

function segmentsText(segments) {
  return compactText((segments || []).map(seg => seg.text).join(''))
}

function labelTipo(tipo) {
  if (tipo === 'notaTitulo') return 'Nota titulo'
  return 'Nota'
}

function ocultoPorModoVm(node, modoVadeMecum = false) {
  const role = node?.attrs?.vmRole
  return (role === 'vm' && !modoVadeMecum) || (role === 'original' && modoVadeMecum)
}

function collectNotesFromBlock(node, pos) {
  const notas = []
  if (!node?.isTextblock) return notas

  if (node.type.name === 'notaTitulo') {
    const segments = []
    node.descendants(child => {
      if (child.isText) segments.push({ text: child.text, italic: isItalic(child) })
      return true
    })
    const normalizedSegments = normalizeSegments(segments)
    const texto = segmentsText(normalizedSegments)
    if (texto) {
      notas.push({
        id: `${pos}-notaTitulo`,
        tipo: 'notaTitulo',
        texto,
        segments: normalizedSegments,
        contexto: '',
        from: pos + 1,
        to: Math.max(pos + 1, pos + node.nodeSize - 1),
      })
    }
    return notas
  }

  const blockStart = pos
  const contexto = compactText(node.textContent).slice(0, 120)
  const runs = []
  let current = null

  node.descendants((child, childPos) => {
    if (!child.isText) return true

    const markNota = notaMark(child)
    const tipo = markNota ? 'nota' : null

    const from = blockStart + 1 + childPos
    const to = from + child.text.length

    if (!tipo) {
      if (current) {
        runs.push(current)
        current = null
      }
      return true
    }

    if (markNota?.attrs?.vmHidden && current?.vmSegments) {
      current.vmStatus = 'excluida'
    }

    const texto = child.text
    const segment = { text: texto, italic: isItalic(child) }
    let vmSegment = null
    if (markNota?.attrs?.vmText != null) {
      vmSegment = { text: markNota.attrs.vmText, italic: false }
    } else if (markNota?.attrs?.vmHidden) {
      vmSegment = null
    } else {
      vmSegment = { text: texto, italic: isItalic(child) }
    }

    if (current && current.tipo === tipo && current.to === from) {
      current.texto += texto
      current.segments.push(segment)
      if (vmSegment) current.vmSegments.push(vmSegment)
      if (markNota?.attrs?.vmHidden || markNota?.attrs?.vmText != null) current.temVm = true
      current.to = to
    } else {
      if (current) runs.push(current)
      current = {
        tipo,
        texto,
        segments: [segment],
        vmSegments: vmSegment ? [vmSegment] : [],
        temVm: markNota?.attrs?.vmHidden || markNota?.attrs?.vmText != null,
        from,
        to,
        contexto,
      }
    }

    return true
  })

  if (current) runs.push(current)
  for (const run of runs) {
    const normalizedSegments = normalizeSegments(run.segments)
    const texto = segmentsText(normalizedSegments)
    if (!texto) continue
    notas.push({
      id: `${run.from}-${run.to}-${run.tipo}`,
      tipo: run.tipo,
      texto,
      segments: normalizedSegments,
      vmPreview: run.temVm
        ? (() => {
            const vmSegments = normalizeSegments(run.vmSegments || [])
            if (!vmSegments.length) return { status: 'excluida', texto: 'excluída', segments: [] }
            return { status: 'alterada', texto: segmentsText(vmSegments), segments: vmSegments }
          })()
        : null,
      contexto: run.contexto,
      from: run.from,
      to: run.to,
    })
  }

  return notas
}

function topLevelBlocks(editor) {
  const blocos = []
  editor?.state.doc.forEach((node, offset, index) => {
    blocos.push({ node, pos: offset, index })
  })
  return blocos
}

function vmPreviewParaNota(nota, vmNotas, idx, fallbackIgual = false) {
  if (fallbackIgual) {
    return { status: 'igual', texto: nota.texto, segments: nota.segments }
  }
  const vmNota = vmNotas?.[idx]
  if (!vmNota) return { status: 'excluida', texto: 'excluída', segments: [] }
  return { status: 'alterada', texto: vmNota.texto, segments: vmNota.segments }
}

function collectNotes(editor, modoVadeMecum = false) {
  const notas = []
  if (!editor) return notas

  const blocos = topLevelBlocks(editor)

  for (let i = 0; i < blocos.length; i++) {
    const { node, pos } = blocos[i]
    if (ocultoPorModoVm(node, modoVadeMecum)) continue

    const notasBloco = collectNotesFromBlock(node, pos)
    if (!notasBloco.length) continue

    if (modoVadeMecum) {
      notas.push(...notasBloco.map(nota => nota.vmPreview?.status === 'alterada'
        ? { ...nota, texto: nota.vmPreview.texto, segments: nota.vmPreview.segments }
        : nota).filter(nota => nota.vmPreview?.status !== 'excluida'))
      continue
    }

    notasBloco.forEach(nota => {
      notas.push(nota.vmPreview ? nota : { ...nota, vmPreview: vmPreviewParaNota(nota, null, 0, true) })
    })
  }

  return notas
}

function renderNotaTexto(nota) {
  const segments = nota.segments?.length ? nota.segments : [{ text: nota.texto, italic: false }]
  return segments.map((seg, idx) => (
    <span key={idx} className={seg.italic ? 'nota-texto-italico' : undefined}>
      {seg.text}
    </span>
  ))
}

function renderVmPreview(preview) {
  if (!preview) return null
  if (preview.status === 'excluida') return <span className="nota-vm-excluida">excluída</span>
  return renderNotaTexto(preview)
}

function scrollToSelection(editor, from) {
  requestAnimationFrame(() => {
    try {
      const { node } = editor.view.domAtPos(from)
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      editor.commands.scrollIntoView()
    }
  })
}

export default function PainelNotas({ editor, aberto, onFechar, modoVadeMecum = false }) {
  const [notas, setNotas] = useState(() => collectNotes(editor, modoVadeMecum))
  const [ativa, setAtiva] = useState(-1)

  useEffect(() => {
    if (!editor || !aberto) return
    const update = () => setNotas(collectNotes(editor, modoVadeMecum))
    update()
    editor.on('update', update)
    return () => editor.off('update', update)
  }, [editor, aberto, modoVadeMecum])

  useEffect(() => {
    if (!aberto) setAtiva(-1)
  }, [aberto])

  if (!aberto) return null

  function irParaNota(nota, idx) {
    if (!editor || !nota) return
    setAtiva(idx)
    editor.chain().focus().setTextSelection({ from: nota.from, to: nota.to }).run()
    scrollToSelection(editor, nota.from)
  }

  return (
    <div className="notas-painel notas-navegador-painel" role="dialog" aria-label="Navegador de notas">
      <div className="notas-topo">
        <div>
          <span className="notas-titulo">Notas</span>
          <span className="notas-contador">{notas.length}</span>
        </div>
        <button className="btn-ghost notas-fechar" onClick={onFechar} title="Fechar">x</button>
      </div>

      {notas.length === 0 ? (
        <p className="notas-vazio">Nenhuma nota encontrada.</p>
      ) : (
        <ul className="notas-lista">
          {notas.map((nota, idx) => (
            <li key={nota.id}>
              <button
                className={`nota-item${idx === ativa ? ' ativa' : ''}`}
                onClick={() => irParaNota(nota, idx)}
                title={nota.contexto || nota.texto}
              >
                <span className={`nota-tipo nota-tipo-${nota.tipo}`}>{labelTipo(nota.tipo)}</span>
                <span className="nota-texto">{renderNotaTexto(nota)}</span>
                {!modoVadeMecum && nota.vmPreview && (
                  <span className={`nota-vm-preview nota-vm-preview-${nota.vmPreview.status}`}>
                    <span className="nota-vm-label">VM</span>
                    <span className="nota-vm-texto">{renderVmPreview(nota.vmPreview)}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
