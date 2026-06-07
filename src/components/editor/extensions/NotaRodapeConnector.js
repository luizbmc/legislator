import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const KEY = new PluginKey('notaRodapeConnector')
const RE_CONNECTOR = /^[\s\u00a0]*e[\s\u00a0]*$/i

function hasNotaRodapeMark(node) {
  return !!node?.marks?.some(mark => mark.type.name === 'notaRodape')
}

function isVisibleInlineText(node) {
  return node?.isText && String(node.text || '').trim().length > 0
}

function previousVisibleChild(parent, index) {
  for (let i = index - 1; i >= 0; i--) {
    const child = parent.child(i)
    if (isVisibleInlineText(child)) return child
  }
  return null
}

function nextVisibleChild(parent, index) {
  for (let i = index + 1; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (isVisibleInlineText(child)) return child
  }
  return null
}

function connectorIndex(text) {
  return String(text || '').search(/e/i)
}

function buildDecorations(doc) {
  const decos = []

  doc.descendants((node, pos) => {
    if (!node.isBlock || !node.childCount) return true

    node.forEach((child, offset, index) => {
      if (!child.isText || !RE_CONNECTOR.test(child.text || '')) return

      const prev = previousVisibleChild(node, index)
      const next = nextVisibleChild(node, index)
      if (!hasNotaRodapeMark(prev) || !hasNotaRodapeMark(next)) return

      const startInText = connectorIndex(child.text)
      if (startInText < 0) return

      const from = pos + 1 + offset + startInText
      decos.push(Decoration.inline(from, from + 1, {
        class: 'leg-nota-rodape-conector',
      }))
    })

    return true
  })

  return DecorationSet.create(doc, decos)
}

export const NotaRodapeConnector = Extension.create({
  name: 'notaRodapeConnector',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, oldDecos, oldState, newState) => {
            if (!tr.docChanged && oldState.doc.eq(newState.doc)) return oldDecos.map(tr.mapping, tr.doc)
            return buildDecorations(newState.doc)
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state)
          },
        },
      }),
    ]
  },
})
