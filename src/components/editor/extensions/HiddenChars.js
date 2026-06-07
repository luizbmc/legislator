/**
 * HiddenChars — extensão TipTap para exibir caracteres ocultos.
 *
 * Quando ativa, adiciona a classe CSS `show-hidden-chars` ao elemento
 * raiz do editor (.ProseMirror) e cria decorações inline para:
 *   · hc-space  — espaço normal (U+0020)
 *   · hc-nbsp   — espaço não-separável (U+00A0)
 *   · hc-tab    — tabulação (U+0009)
 *   · hc-break  — widget ↵ imediatamente antes de cada hardBreak
 *
 * Símbolo de parágrafo (¶) é renderizado via CSS ::after em p[data-tipo].
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const KEY      = new PluginKey('hiddenChars')
const CSS_CLASS = 'show-hidden-chars'

// ── Constrói o conjunto de decorações para um doc ────────────────
function buildDecorations(doc) {
  const decos = []

  doc.descendants((node, pos) => {
    // Decorações inline sobre nós de texto
    if (node.isText) {
      const text = node.text
      for (let i = 0; i < text.length; i++) {
        let cls = null
        const ch = text[i]
        if      (ch === ' ')         cls = 'hc-space'
        else if (ch === ' ')    cls = 'hc-nbsp'
        else if (ch === '\t')        cls = 'hc-tab'
        if (cls) {
          decos.push(Decoration.inline(pos + i, pos + i + 1, { class: cls }))
        }
      }
    }

    // Widget ↵ antes de cada hardBreak
    if (node.type.name === 'hardBreak') {
      decos.push(
        Decoration.widget(pos, createBreakWidget, { side: -1, key: `hbr-${pos}` })
      )
    }
  })

  return DecorationSet.create(doc, decos)
}

function createBreakWidget() {
  const span = document.createElement('span')
  span.className          = 'hc-break'
  span.contentEditable    = 'false'
  span.setAttribute('aria-hidden', 'true')
  return span
}

// ── Extensão ─────────────────────────────────────────────────────
export const HiddenChars = Extension.create({
  name: 'hiddenChars',

  addStorage() {
    return { active: false }
  },

  addCommands() {
    return {
      /**
       * Alterna a exibição de caracteres ocultos.
       * Retorna true se ficou ativo, false se foi desligado.
       */
      toggleHiddenChars: () => ({ editor, tr, dispatch }) => {
        const next = !editor.storage.hiddenChars.active
        // Só aplica efeitos colaterais quando TipTap está em modo de execução
        // (dispatch === null em modo "can()" — verificação sem execução).
        // Sempre retorna true para que TipTap saiba que o comando foi tratado.
        if (dispatch) {
          editor.storage.hiddenChars.active = next
          editor.view.dom.classList.toggle(CSS_CLASS, next)
          dispatch(tr.setMeta(KEY, next))
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,

        state: {
          init: () => ({ active: false, decos: DecorationSet.empty }),

          apply(tr, prev, _oldState, newState) {
            const meta   = tr.getMeta(KEY)
            const active = meta !== undefined ? meta : prev.active

            if (!active) return { active: false, decos: DecorationSet.empty }

            // Reconstrói ao ligar ou quando o doc muda; caso contrário, mapeia
            if (meta !== undefined || tr.docChanged) {
              return { active, decos: buildDecorations(newState.doc) }
            }
            return { active, decos: prev.decos.map(tr.mapping, newState.doc) }
          },
        },

        props: {
          decorations(state) {
            return KEY.getState(state).decos
          },
        },
      }),
    ]
  },
})
