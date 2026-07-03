import { useEffect, useRef, useState } from 'react'
import { Fragment } from 'prosemirror-model'
import { selecionarTextoNoEditor } from '../editor/selecionarTexto.js'

function hasMark(node, name) {
  return (node.marks || []).some(mark => mark.type.name === name)
}

function compactText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function isItalic(node) {
  return hasMark(node, 'italic') || hasMark(node, 'italicoLight')
}

function isNotaSobrescrito(node) {
  return hasMark(node, 'notaSobrescrito')
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
    if (last && last.italic === seg.italic && last.superscript === seg.superscript) {
      last.text += text
    } else {
      normalized.push({ text, italic: !!seg.italic, superscript: !!seg.superscript })
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

function parseSegmentsAttr(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return normalizeSegments(parsed.map(seg => ({
      text: String(seg?.text || ''),
      italic: !!seg?.italic,
      superscript: !!seg?.superscript,
    })))
  } catch {
    return []
  }
}

function segmentsEqual(a = [], b = []) {
  const aa = normalizeSegments(a)
  const bb = normalizeSegments(b)
  if (aa.length !== bb.length) return false
  return aa.every((seg, idx) => (
    seg.text === bb[idx].text
    && !!seg.italic === !!bb[idx].italic
    && !!seg.superscript === !!bb[idx].superscript
  ))
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function segmentsToHtml(segments = []) {
  return normalizeSegments(segments).map(seg => {
    let texto = escapeHtml(seg.text)
    if (seg.italic) texto = `<i>${texto}</i>`
    if (seg.superscript) texto = `<sup>${texto}</sup>`
    return texto
  }).join('')
}

function segmentsFromEditable(root) {
  const out = []

  function walk(node, italic = false, superscript = false) {
    if (!node) return
    if (node.nodeType === Node.TEXT_NODE) {
      out.push({ text: node.nodeValue || '', italic, superscript })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const tag = node.tagName?.toLowerCase?.() || ''
    const isItalic = italic || tag === 'i' || tag === 'em' || node.style?.fontStyle === 'italic'
    const isSuperscript = superscript || tag === 'sup' || node.style?.verticalAlign === 'super'
    if (tag === 'br') {
      out.push({ text: ' ', italic, superscript })
      return
    }
    node.childNodes.forEach(child => walk(child, isItalic, isSuperscript))
    if (tag === 'div' || tag === 'p') out.push({ text: ' ', italic, superscript })
  }

  root?.childNodes?.forEach(node => walk(node, false, false))
  return normalizeSegments(out)
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
    const vmSegments = []
    let temVm = false
    node.descendants(child => {
      if (!child.isText) return true

      const segment = { text: child.text, italic: isItalic(child), superscript: isNotaSobrescrito(child) }
      segments.push(segment)

      const markNota = notaMark(child)
      if (!markNota) return true

      const vmSegmentsAttr = parseSegmentsAttr(markNota?.attrs?.vmSegments)
      if (vmSegmentsAttr.length) {
        vmSegments.push(...vmSegmentsAttr)
        temVm = true
      } else if (markNota?.attrs?.vmText != null) {
        vmSegments.push({ text: markNota.attrs.vmText, italic: false, superscript: false })
        temVm = true
      } else if (markNota?.attrs?.vmHidden) {
        temVm = true
      } else {
        vmSegments.push(segment)
      }
      return true
    })
    const normalizedSegments = normalizeSegments(segments)
    const texto = segmentsText(normalizedSegments)
    const normalizedVmSegments = normalizeSegments(vmSegments)
    if (texto) {
      notas.push({
        id: `${pos}-notaTitulo`,
        tipo: 'notaTitulo',
        texto,
        segments: normalizedSegments,
        normalSegments: normalizedSegments,
        normalTexto: texto,
        vmPreview: temVm
          ? normalizedVmSegments.length
            ? { status: 'alterada', texto: segmentsText(normalizedVmSegments), segments: normalizedVmSegments }
            : { status: 'excluida', texto: 'excluída', segments: [] }
          : null,
        contexto: '',
        blockFrom: pos,
        blockTo: pos + node.nodeSize,
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
    const segment = { text: texto, italic: isItalic(child), superscript: isNotaSobrescrito(child) }
    let vmSegments = []
    const vmSegmentsAttr = parseSegmentsAttr(markNota?.attrs?.vmSegments)
    if (vmSegmentsAttr.length) {
      vmSegments = vmSegmentsAttr
    } else if (markNota?.attrs?.vmText != null) {
      vmSegments = [{ text: markNota.attrs.vmText, italic: false, superscript: false }]
    } else if (markNota?.attrs?.vmHidden) {
      vmSegments = []
    } else {
      vmSegments = [{ text: texto, italic: isItalic(child), superscript: isNotaSobrescrito(child) }]
    }

    if (current && current.tipo === tipo && current.to === from) {
      current.texto += texto
      current.segments.push(segment)
      if (vmSegments.length) current.vmSegments.push(...vmSegments)
      if (markNota?.attrs?.vmHidden || markNota?.attrs?.vmText != null || vmSegmentsAttr.length) current.temVm = true
      current.to = to
    } else {
      if (current) runs.push(current)
      current = {
        tipo,
        texto,
        segments: [segment],
        vmSegments: vmSegments.length ? [...vmSegments] : [],
        temVm: markNota?.attrs?.vmHidden || markNota?.attrs?.vmText != null || vmSegmentsAttr.length,
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
      normalSegments: normalizedSegments,
      normalTexto: texto,
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
        ? { ...nota, texto: nota.vmPreview.texto, segments: nota.vmPreview.segments, normalSegments: nota.normalSegments || nota.segments, normalTexto: nota.normalTexto || nota.texto }
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
  const segments = nota.segments?.length ? nota.segments : [{ text: nota.texto, italic: false, superscript: false }]
  return segments.map((seg, idx) => (
    <span
      key={idx}
      className={[
        seg.italic ? 'nota-texto-italico' : '',
        seg.superscript ? 'nota-texto-sobrescrito' : '',
      ].filter(Boolean).join(' ') || undefined}
    >
      {seg.text}
    </span>
  ))
}

function renderVmPreview(preview) {
  if (!preview) return null
  if (preview.status === 'excluida') return <span className="nota-vm-excluida">excluída</span>
  return renderNotaTexto(preview)
}

function criarNodesNota(schema, nota, normalSegments, vmSegments) {
  const notaType = schema.marks.nota
  const italicType = schema.marks.italic
  const notaSobrescritoType = schema.marks.notaSobrescrito
  if (!notaType) return []

  const normal = normalizeSegments(normalSegments)
  const vm = normalizeSegments(vmSegments)
  const vmTexto = segmentsText(vm)
  const normalTexto = segmentsText(normal)
  const vmIgualNormal = vmTexto === normalTexto && segmentsEqual(vm, normal)
  const vmExcluida = !vmTexto
  const attrsVm = vmIgualNormal
    ? null
    : vmExcluida
      ? { vmHidden: true }
      : { vmText: vmTexto, vmSegments: JSON.stringify(vm), vmHidden: null }

  return normal.map((seg, idx) => {
    const attrs = !attrsVm
      ? {}
      : vmExcluida
        ? { vmHidden: true }
        : idx === 0
          ? attrsVm
          : { vmHidden: true }
    const marks = [notaType.create(attrs)]
    if (seg.italic && italicType) marks.push(italicType.create())
    if (seg.superscript && notaSobrescritoType) marks.push(notaSobrescritoType.create())
    return schema.text(seg.text, marks)
  })
}

function criarInlineNodesNotaTitulo(schema, normalSegments, vmSegments) {
  const notaType = schema.marks.nota
  const italicType = schema.marks.italic
  const notaSobrescritoType = schema.marks.notaSobrescrito
  const normal = normalizeSegments(normalSegments)
  const vm = normalizeSegments(vmSegments)
  const vmTexto = segmentsText(vm)
  const normalTexto = segmentsText(normal)
  const vmIgualNormal = vmTexto === normalTexto && segmentsEqual(vm, normal)
  const vmExcluida = !vmTexto
  const attrsVm = vmIgualNormal
    ? null
    : vmExcluida
      ? { vmHidden: true }
      : { vmText: vmTexto, vmSegments: JSON.stringify(vm), vmHidden: null }

  return normal.map((seg, idx) => {
    const attrs = !attrsVm
      ? {}
      : vmExcluida
        ? { vmHidden: true }
        : idx === 0
          ? attrsVm
          : { vmHidden: true }
    const marks = notaType ? [notaType.create(attrs)] : []
    if (seg.italic && italicType) marks.push(italicType.create())
    if (seg.superscript && notaSobrescritoType) marks.push(notaSobrescritoType.create())
    return schema.text(seg.text, marks)
  })
}

function substituirNota(editor, nota, normalSegments, vmSegments) {
  if (!editor || !nota || nota.tipo !== 'nota') return false
  const nodes = criarNodesNota(editor.state.schema, nota, normalSegments, vmSegments)
  if (!nodes.length) return false
  const tr = editor.state.tr.replaceWith(nota.from, nota.to, Fragment.fromArray(nodes))
  editor.view.dispatch(tr)
  return true
}

function substituirNotaTitulo(editor, nota, normalSegments, vmSegments) {
  if (!editor || !nota || nota.tipo !== 'notaTitulo') return false
  const nodes = criarInlineNodesNotaTitulo(editor.state.schema, normalSegments, vmSegments)
  if (!nodes.length) return false
  const tr = editor.state.tr.replaceWith(nota.from, nota.to, Fragment.fromArray(nodes))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function excluirNota(editor, nota) {
  if (!editor || !nota) return false
  if (nota.tipo === 'notaTitulo' && Number.isFinite(nota.blockFrom) && Number.isFinite(nota.blockTo)) {
    const tr = editor.state.tr.delete(nota.blockFrom, nota.blockTo)
    editor.view.dispatch(tr.scrollIntoView())
    return true
  }
  if (nota.tipo !== 'nota') return false
  const tr = editor.state.tr.delete(nota.from, nota.to)
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export default function PainelNotas({ editor, aberto, onFechar, modoVadeMecum = false, editable = false, editarNotaRequest = null }) {
  const [notas, setNotas] = useState(() => collectNotes(editor, modoVadeMecum))
  const [ativa, setAtiva] = useState(-1)
  const [editando, setEditando] = useState(null)
  const normalRef = useRef(null)
  const vmRef = useRef(null)
  const campoAtivoRef = useRef(null)
  const ultimaEdicaoRequestRef = useRef(null)

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

  useEffect(() => {
    if (!editando) return
    const normalSegments = editando.normalSegments || editando.segments || []
    const vmSegments = editando.vmPreview?.status === 'excluida'
      ? []
      : editando.vmPreview?.segments || normalSegments
    window.setTimeout(() => {
      if (normalRef.current) normalRef.current.innerHTML = segmentsToHtml(normalSegments)
      if (vmRef.current) vmRef.current.innerHTML = segmentsToHtml(vmSegments)
    }, 0)
  }, [editando])

  useEffect(() => {
    if (!editor || !editarNotaRequest) return
    const requestKey = editarNotaRequest.time ?? editarNotaRequest.pos ?? editarNotaRequest
    if (ultimaEdicaoRequestRef.current === requestKey) return
    ultimaEdicaoRequestRef.current = requestKey

    const pos = Number(editarNotaRequest.pos)
    const coletadas = collectNotes(editor, modoVadeMecum)
    setNotas(coletadas)

    let alvo = null
    if (Number.isFinite(pos)) {
      alvo = coletadas.find(nota => pos >= nota.from && pos <= nota.to)
        || coletadas.find(nota => pos >= nota.from - 1 && pos <= nota.to + 1)
    }
    if (!alvo) return

    const alvoIdx = coletadas.findIndex(nota => nota.id === alvo.id)
    setAtiva(alvoIdx)
    if (!editable) {
      alert('Entre no modo de edição para alterar notas.')
      return
    }

    setEditando(alvo)
  }, [editor, editarNotaRequest, modoVadeMecum, editable])

  if (!aberto && !editando) return null

  function irParaNota(nota, idx) {
    if (!editor || !nota) return
    setAtiva(idx)
    selecionarTextoNoEditor(editor, { from: nota.from, to: nota.to })
  }

  function abrirEdicaoNota(nota, idx, event) {
    event?.stopPropagation()
    if (!editable) {
      alert('Entre no modo de edição para alterar notas.')
      return
    }
    setAtiva(idx)
    setEditando(nota)
  }

  function excluirNotaSelecionada(nota, event) {
    event?.stopPropagation()
    if (!editable) {
      alert('Entre no modo de edição para excluir notas.')
      return
    }
    if (!confirm('Excluir esta nota do parágrafo?')) return
    if (excluirNota(editor, nota)) {
      setEditando(null)
      setNotas(collectNotes(editor, modoVadeMecum))
    }
  }

  function notaPodeSerEditada(nota) {
    return nota?.tipo === 'nota' || nota?.tipo === 'notaTitulo'
  }

  function aplicarNotaItalico() {
    const alvo = campoAtivoRef.current || normalRef.current
    if (!alvo) return
    alvo.focus()
    document.execCommand('italic')
  }

  function aplicarNotaSobrescrito() {
    const alvo = campoAtivoRef.current || normalRef.current
    if (!alvo) return
    alvo.focus()
    document.execCommand('superscript')
  }

  function salvarEdicaoNota() {
    const normalSegments = segmentsFromEditable(normalRef.current)
    const vmSegments = segmentsFromEditable(vmRef.current)
    if (!segmentsText(normalSegments)) {
      alert('A nota normal não pode ficar vazia.')
      return
    }
    const salva = editando?.tipo === 'notaTitulo'
      ? substituirNotaTitulo(editor, editando, normalSegments, vmSegments)
      : substituirNota(editor, editando, normalSegments, vmSegments)
    if (salva) {
      setEditando(null)
      setNotas(collectNotes(editor, modoVadeMecum))
    }
  }

  return (
    <>
      {aberto && (
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
              <div
                className={`nota-item${idx === ativa ? ' ativa' : ''}`}
                onClick={() => irParaNota(nota, idx)}
                title={nota.contexto || nota.texto}
                role="button"
                tabIndex={0}
              >
                <span className={`nota-tipo nota-tipo-${nota.tipo}`}>{labelTipo(nota.tipo)}</span>
                <span className="nota-texto">{renderNotaTexto(nota)}</span>
                {!modoVadeMecum && nota.vmPreview && (
                  <span className={`nota-vm-preview nota-vm-preview-${nota.vmPreview.status}`}>
                    <span className="nota-vm-label">VM</span>
                    <span className="nota-vm-texto">{renderVmPreview(nota.vmPreview)}</span>
                  </span>
                )}
                {notaPodeSerEditada(nota) && (
                  <span className="nota-acoes">
                    <button
                      type="button"
                      className="nota-editar-btn"
                      onClick={event => abrirEdicaoNota(nota, idx, event)}
                      title={editable ? 'Alterar nota normal e nota VM' : 'Entre no modo de edição para alterar notas'}
                    >
                      Alterar
                    </button>
                    <button
                      type="button"
                      className="nota-editar-btn nota-excluir-btn"
                      onClick={event => excluirNotaSelecionada(nota, event)}
                      title={editable ? 'Excluir nota normal e nota VM' : 'Entre no modo de edição para excluir notas'}
                    >
                      Excluir
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
        </div>
      )}

      {editando && (
        <div className="nota-edicao-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setEditando(null) }}>
          <div className="nota-edicao-modal" role="dialog" aria-label="Editar nota">
            <div className="nota-edicao-topo">
              <h3>{editando.tipo === 'notaTitulo' ? 'Editar Nota título' : 'Editar nota'}</h3>
              <button className="btn-ghost notas-fechar" onClick={() => setEditando(null)} title="Fechar">x</button>
            </div>
            <div className="nota-edicao-toolbar">
              <button
                type="button"
                className="btn-ghost btn-sm nota-italico-btn"
                onMouseDown={event => event.preventDefault()}
                onClick={aplicarNotaItalico}
              >
                Aplicar nota itálico
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm nota-sobrescrito-btn"
                onMouseDown={event => event.preventDefault()}
                onClick={aplicarNotaSobrescrito}
              >
                Aplicar nota sobrescrito
              </button>
            </div>
            <label className="nota-edicao-campo">
              <span>{editando.tipo === 'notaTitulo' ? 'Nota título' : 'Nota normal'}</span>
              <div
                ref={normalRef}
                className="nota-edicao-editor"
                contentEditable
                suppressContentEditableWarning
                onFocus={() => { campoAtivoRef.current = normalRef.current }}
              />
            </label>
            <label className="nota-edicao-campo">
              <span>Nota VM</span>
              <div
                ref={vmRef}
                className="nota-edicao-editor"
                contentEditable
                suppressContentEditableWarning
                onFocus={() => { campoAtivoRef.current = vmRef.current }}
              />
            </label>
            <div className="nota-edicao-acoes">
              <button type="button" className="btn-ghost nota-edicao-excluir" onClick={event => excluirNotaSelecionada(editando, event)}>Excluir</button>
              <button type="button" className="btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={salvarEdicaoNota}>Salvar nota</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
