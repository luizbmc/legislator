import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Slice } from '@tiptap/pm/model'
import { ALL_EXTENSIONS } from './extensions/index.js'
import { applyTextNota, fillNotaGaps, parseHtmlInput } from '../../services/limpeza/00_parseHtml.js'
import { processarBlocosParaTiptap } from '../../services/limpeza/index.js'
import './LegislatorEditor.css'

const STYLE_LABELS = {
  epigrafe: 'Epígrafe',
  epigrafeApelido: 'Apelido',
  partelivroTitCap: 'Título / Cap.',
  secaoSubsecao: 'Seção',
  ementa: 'Ementa',
  paragrafAbertura: 'Abertura de lei',
  paragrafFacoSaber: 'Faço saber',
  aberturaCapitulo: 'Abertura capítulo',
  artigo: 'Artigo',
  artigoTitulo: 'Artigo (título)',
  corpoTratado: 'Corpo de tratado',
  paragrafLei: 'Parágrafo',
  nomeJuridico: 'Nome jurídico',
  inciso: 'Inciso',
  alinea: 'Alínea',
  item: 'Item',
  citacao: 'Citação',
  data: 'Data',
  assinatura: 'Assinatura',
  notaTitulo: 'Nota título',
  assinaturaData: 'Data',
  assinaturaNome: 'Assinatura',
}

function firstTextRect(paragraph) {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (!node.nodeValue) continue
    const start = node.nodeValue.search(/\S/)
    if (start < 0) continue

    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, Math.min(start + 1, node.nodeValue.length))
    const rect = range.getBoundingClientRect()
    range.detach()
    if (rect.width || rect.height) return rect
  }

  return paragraph.getBoundingClientRect()
}

function convertLinksToNota(nodes) {
  const converted = nodes.map(node => {
    if (node.type !== 'text') return node
    if (!node.marks?.some(m => m.type === 'link')) return node
    const newMarks = node.marks.filter(m => m.type !== 'link' && m.type !== 'italic')
    if (node.text.trimStart().startsWith('(')) newMarks.push({ type: 'nota' })
    return { ...node, marks: newMarks }
  })

  return fillNotaGaps(applyTextNota(converted))
}

function inlineContentFromNode(node) {
    const content = []
    node.forEach(inline => {
      if (inline.type.name === 'hardBreak') {
        content.push({ type: 'hardBreak' })
        return
      }
      if (!inline.isText) return

      const marks = []
      inline.marks.forEach(mark => {
        const n = mark.type.name
        if (n === 'italic' || n === 'italicoLight') marks.push({ type: 'italic' })
        else if (n === 'regular') marks.push({ type: 'regular' })
        else if (n === 'nota') marks.push({ type: 'nota' })
        else if (n === 'notaSobrescrito') marks.push({ type: 'notaSobrescrito' })
        else if (n === 'estiloCaractereCustom') marks.push({ type: 'estiloCaractereCustom', attrs: { ...mark.attrs } })
        else if (n === 'link') marks.push({ type: 'link' })
        else if (n === 'superscript') marks.push({ type: 'superscript' })
        else if (n === 'subscript') marks.push({ type: 'subscript' })
      })

      content.push({ type: 'text', text: inline.text, marks })
    })

    return content
}

function stripBoldMarksFromJsonNode(node) {
  if (!node || typeof node !== 'object') return node

  const next = { ...node }
  if (Array.isArray(next.marks)) {
    const marks = next.marks.filter(mark => mark.type !== 'bold' && mark.type !== 'boldArtigo')
    if (marks.length) next.marks = marks
    else delete next.marks
  }

  if (Array.isArray(next.content)) {
    next.content = next.content.map(stripBoldMarksFromJsonNode)
  }

  return next
}

function extrairBlocosDoFragmento(fragment) {
  const blocos = []

  fragment.forEach(node => {
    if (node.type?.name === 'table') {
      blocos.push({ type: 'table', node: stripBoldMarksFromJsonNode(node.toJSON()) })
      return
    }

    if (node.isBlock) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) {
        blocos.push({
          type: 'text',
          text,
          content: convertLinksToNota(inlineContentFromNode(node)),
        })
      }
      return
    }

    if (node.isText || node.type?.name === 'hardBreak') {
      const text = node.textContent?.replace(/\s+/g, ' ').trim()
      if (text) {
        blocos.push({
          type: 'text',
          text,
          content: convertLinksToNota(inlineContentFromNode({ forEach: fn => fn(node) })),
        })
      }
    }
  })

  return {
    blocos,
    textoPuro: blocos.map(b => b.text).join('\n'),
  }
}

function extrairBlocosDoIntervalo(doc, from, to) {
  const blocos = []

  doc.nodesBetween(from, to, node => {
    if (!node.isBlock || node.isDoc) return true

    if (node.type?.name === 'table') {
      blocos.push({ type: 'table', node: stripBoldMarksFromJsonNode(node.toJSON()) })
      return false
    }

    const text = node.textContent.replace(/\s+/g, ' ').trim()
    if (!text) return false

    blocos.push({
      type: 'text',
      text,
      content: convertLinksToNota(inlineContentFromNode(node)),
    })
    return false
  })

  return {
    blocos,
    textoPuro: blocos.map(b => b.text).join('\n'),
  }
}

function textoMarcadorNotaRodape() {
  return '[nota]'
}

function htmlTemNotasRodape(html = '') {
  return /(?:footnote|endnote|mso-footnote-id|mso-element:\s*(?:footnote|endnote))/i.test(String(html || ''))
}

function findNotaRodapeRange(state, pos, chamada, texto) {
  const markType = state.schema.marks.notaRodape
  if (!markType) return null

  let fallback = null
  let found = null
  state.doc.descendants((node, nodePos) => {
    if (found || !node.isText) return true

    const mark = node.marks.find(m => m.type === markType)
    if (!mark) return true

    const from = nodePos
    const to = nodePos + node.nodeSize
    const sameAttrs = String(mark.attrs?.chamada || '') === String(chamada || '') &&
      String(mark.attrs?.texto || '') === String(texto || '')

    if (sameAttrs && !fallback) fallback = { from, to, mark }
    if (pos >= from && pos <= to) {
      found = { from, to, mark }
      return false
    }

    return true
  })

  return found || fallback
}

export default function LegislatorEditor({
  docJson,
  onEditorReady,
  zoom = 1,
  styleIndicatorsActive = false,
  spellcheckAtivo = true,
  editable = true,
  tipoNorma = '',
  tags = [],
  onPasteRotinas,
}) {
  const scrollRef = useRef(null)
  const tipoNormaRef = useRef(tipoNorma)
  const tagsRef = useRef(tags)
  const onPasteRotinasRef = useRef(onPasteRotinas)
  const [styleIndicators, setStyleIndicators] = useState([])
  const [styleIndicatorsHeight, setStyleIndicatorsHeight] = useState(0)
  const [notaRodapeAberta, setNotaRodapeAberta] = useState(null)

  useEffect(() => {
    tipoNormaRef.current = tipoNorma
  }, [tipoNorma])

  useEffect(() => {
    tagsRef.current = tags
  }, [tags])

  useEffect(() => {
    onPasteRotinasRef.current = onPasteRotinas
  }, [onPasteRotinas])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // paragraph: mantido ativo — necessário como conteúdo de células de tabela
        heading:        false,
        bulletList:     false,
        orderedList:    false,
        listItem:       false,
        blockquote:     false,
        codeBlock:      false,
        code:           false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,       // não abre ao clicar (editor, não leitor)
        autolink: false,          // não detecta URLs digitadas automaticamente
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Superscript,
      Subscript,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      ...ALL_EXTENSIONS,
    ],
    content: docJson ?? { type: 'doc', content: [] },
    editable,
    editorProps: {
      attributes: {
        class: 'legislator-editor-inner',
        spellcheck: 'true',
        lang: 'pt-BR',
        'xml:lang': 'pt-BR',
      },

      /**
       * Chamado pelo TipTap antes de parsear qualquer HTML colado.
       *
       * — Paste interno (copiado do próprio Legislator):
       *   O ProseMirror inclui `data-pm-slice` no HTML; não modificamos nada,
       *   preservando tipos de nó e marks exatamente como foram copiados.
       *
       * — Paste externo (Word, navegadores, etc.):
       *   O Word insere `<br>` dentro de parágrafos como quebras de linha suaves.
       *   Substituímos por espaço para evitar hardBreaks indesejados no texto.
       */
      transformPastedHTML(html) {
        if (html.includes('data-pm-slice')) return html  // paste interno — sem alteração

        // Paste externo (Word, browsers, etc.)
        const doc = new window.DOMParser().parseFromString(html, 'text/html')

        // 1. Remove elementos de quebra de linha do Word:
        //    <br> padrão e <w:br> (namespace Office)
        doc.querySelectorAll('br, w\\:br').forEach(el => {
          el.replaceWith(document.createTextNode(' '))
        })

        // 2. Normaliza \r\n e \t nos nós de texto.
        //    O Word às vezes emite o conteúdo de um parágrafo com newlines reais
        //    no HTML, que o ProseMirror interpreta como hardBreaks.
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        const textNodes = []
        let tn
        while ((tn = walker.nextNode())) textNodes.push(tn)
        textNodes.forEach(tn => {
          tn.nodeValue = tn.nodeValue.replace(/[\r\n\t]+/g, ' ')
        })

        return doc.body.innerHTML
      },

      handlePaste(view, event, slice) {
        const html = event.clipboardData?.getData('text/html') || ''
        const textoPuro = event.clipboardData?.getData('text/plain') || ''

        if (html.includes('data-pm-slice')) return false
        if (!html.trim() && !textoPuro.trim()) return false

        try {
          const entrada = htmlTemNotasRodape(html)
            ? parseHtmlInput(html)
            : slice?.content
              ? extrairBlocosDoFragmento(slice.content)
              : { textoPuro, blocos: [] }
          if (!entrada.textoPuro.trim()) return false

          const resultado = processarBlocosParaTiptap(entrada, {
            tipoNorma: tipoNormaRef.current,
            estiloVadeMecum: (tagsRef.current || []).some(t => String(t).toLowerCase() === 'vm'),
            notasVadeMecum: (tagsRef.current || []).some(t => String(t).toLowerCase() === 'vm'),
          })
          if (!resultado.doc?.content?.length) return false

          const fragment = view.state.schema.nodeFromJSON(resultado.doc).content
          const tr = view.state.tr
            .replaceSelection(new Slice(fragment, 0, 0))
            .scrollIntoView()

          event.preventDefault()
          view.dispatch(tr)
          onPasteRotinasRef.current?.(resultado)
          return true
        } catch (err) {
          console.error('Erro ao aplicar rotinas na colagem externa:', err)
          return false
        }
      },
    },
  })

  // Notifica o pai quando o editor estiver pronto
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
    try {
      editor.view.dom.setAttribute('contenteditable', editable ? 'true' : 'false')
    } catch {}
  }, [editor, editable])

  // Sincroniza o atributo spellcheck no contenteditable do ProseMirror
  useEffect(() => {
    if (!editor) return
    editor.view.dom.setAttribute('spellcheck', spellcheckAtivo ? 'true' : 'false')
    editor.view.dom.setAttribute('lang', 'pt-BR')
    editor.view.dom.setAttribute('xml:lang', 'pt-BR')
    document.documentElement.setAttribute('lang', 'pt-BR')
  }, [editor, spellcheckAtivo])

  // Atualiza o conteúdo quando docJson mudar (ex: após pipeline)
  useEffect(() => {
    if (editor && docJson) {
      editor.commands.setContent(docJson, false)
    }
  }, [docJson]) // eslint-disable-line

  useLayoutEffect(() => {
    if (!editor || !styleIndicatorsActive) {
      setStyleIndicators([])
      setStyleIndicatorsHeight(0)
      return
    }

    let raf = 0
    const updateIndicators = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const scroller = scrollRef.current
        const root = editor.view.dom
        if (!scroller || !root) return

        const scrollerRect = scroller.getBoundingClientRect()
        const rootRect = root.getBoundingClientRect()
        const paragraphs = root.querySelectorAll('p[data-tipo]')
        const pageLeft = rootRect.left - scrollerRect.left + scroller.scrollLeft
        var labelX = pageLeft - 128
        var lineStartX = pageLeft - 20
        if (labelX < 8) {
          labelX = 8
          lineStartX = Math.max(labelX + 108, pageLeft - 20)
        }
        const next = []

        setStyleIndicatorsHeight(Math.max(scroller.scrollHeight, root.offsetTop + root.offsetHeight))

        paragraphs.forEach((paragraph, index) => {
          const tipo = paragraph.getAttribute('data-tipo')
          const textRect = firstTextRect(paragraph)
          const y = textRect.top - scrollerRect.top + scroller.scrollTop + textRect.height / 2
          const targetX = textRect.left - scrollerRect.left + scroller.scrollLeft + textRect.width / 2

          next.push({
            id: `${index}-${tipo}-${Math.round(y)}`,
            label: STYLE_LABELS[tipo] || tipo,
            labelX,
            lineStartX,
            targetX,
            y,
          })
        })

        setStyleIndicators(next)
      })
    }

    updateIndicators()
    editor.on('update', updateIndicators)
    editor.on('selectionUpdate', updateIndicators)
    window.addEventListener('resize', updateIndicators)
    return () => {
      cancelAnimationFrame(raf)
      editor.off('update', updateIndicators)
      editor.off('selectionUpdate', updateIndicators)
      window.removeEventListener('resize', updateIndicators)
    }
  }, [editor, styleIndicatorsActive, zoom])

  function handleEditorClick(event) {
    const noteEl = event.target?.closest?.('.leg-nota-rodape')
    if (!noteEl || !scrollRef.current?.contains(noteEl)) return

    const chamada = noteEl.getAttribute('data-chamada') || ''
    const texto = noteEl.getAttribute('data-texto') || noteEl.textContent || ''
    let range = null
    try {
      const pos = editor.view.posAtDOM(noteEl, 0)
      range = findNotaRodapeRange(editor.state, pos, chamada, texto)
    } catch {}

    event.preventDefault()
    setNotaRodapeAberta({ chamada, texto, range })
  }

  function salvarNotaRodape(event) {
    event.preventDefault()
    if (!editable || !editor || !notaRodapeAberta?.range) return

    const texto = String(notaRodapeAberta.texto || '').trim()
    if (!texto) return

    const markType = editor.state.schema.marks.notaRodape
    if (!markType) return

    const marker = textoMarcadorNotaRodape()
    const { from, to } = notaRodapeAberta.range
    const tr = editor.state.tr.insertText(marker, from, to)
    const mappedFrom = tr.mapping.map(from)
    const mappedTo = mappedFrom + marker.length

    tr.addMark(mappedFrom, mappedTo, markType.create({ texto }))
    editor.view.dispatch(tr.scrollIntoView())
    setNotaRodapeAberta(null)
  }

  if (!editor) return null

  return (
    <div
      ref={scrollRef}
      className={`legislator-editor${styleIndicatorsActive ? ' style-indicators-active' : ''}${editable ? '' : ' legislator-editor-readonly'}`}
      style={{ '--editor-zoom': zoom }}
      onClick={handleEditorClick}
    >
      {styleIndicatorsActive && (
        <div
          className="style-indicators-layer"
          style={{ height: styleIndicatorsHeight || '100%' }}
          aria-hidden="true"
        >
          <svg className="style-indicators-lines">
            {styleIndicators.map(item => (
              <line
                key={`${item.id}-line`}
                x1={item.lineStartX}
                y1={item.y}
                x2={item.targetX}
                y2={item.y}
              />
            ))}
          </svg>
          {styleIndicators.map(item => (
            <span
              key={`${item.id}-label`}
              className="style-indicator-label"
              style={{ left: item.labelX, top: item.y }}
            >
              {item.label}
            </span>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
      {notaRodapeAberta && (
        <div
          className="nota-rodape-view-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setNotaRodapeAberta(null)
          }}
        >
          <form className="nota-rodape-view-modal" onSubmit={salvarNotaRodape} onMouseDown={event => event.stopPropagation()}>
            <div className="nota-rodape-view-header">
              <h3>Nota de rodapé</h3>
              <button
                type="button"
                className="btn-ghost nota-rodape-view-fechar"
                onClick={() => setNotaRodapeAberta(null)}
                title="Fechar"
              >
                ×
              </button>
            </div>
            {editable ? (
              <textarea
                className="nota-rodape-view-textarea"
                value={notaRodapeAberta.texto}
                onChange={event => setNotaRodapeAberta(nota => ({ ...nota, texto: event.target.value }))}
                autoFocus
              />
            ) : (
              <div className="nota-rodape-view-texto">
                {notaRodapeAberta.texto}
              </div>
            )}
            {editable && (
              <div className="nota-rodape-view-acoes">
                <button type="button" className="btn-ghost" onClick={() => setNotaRodapeAberta(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={!String(notaRodapeAberta.texto || '').trim() || !notaRodapeAberta.range}>
                  Salvar nota
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
