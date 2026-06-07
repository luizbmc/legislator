/**
 * DiffHighlight.js
 * Extensão TipTap que gerencia decorações visuais de diff (adicionado / removido / modificado).
 * Usa um plugin ProseMirror com DecorationSet para não modificar o documento.
 */
import { Extension }                    from '@tiptap/core'
import { Plugin, PluginKey }            from 'prosemirror-state'
import { Decoration, DecorationSet }    from 'prosemirror-view'

export const DIFF_PLUGIN_KEY = new PluginKey('diffHighlight')

// ── Reconstrói o DecorationSet a partir dos diffs e do doc atual ──
function buildDecorationSet(doc, diffs) {
  if (!diffs?.length) return DecorationSet.empty

  const decos = []
  let nodeIdx = 0

  doc.forEach((node, offset) => {
    const diff = diffs.find(d => d.contentIdx === nodeIdx && !d.resolved)
    if (diff) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: `diff-node diff-${diff.type}`,
        })
      )
    }
    nodeIdx++
  })

  return DecorationSet.create(doc, decos)
}

export const DiffHighlight = Extension.create({
  name: 'diffHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DIFF_PLUGIN_KEY,

        state: {
          init: () => ({ diffs: [], decos: DecorationSet.empty }),

          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(DIFF_PLUGIN_KEY)
            if (meta !== undefined) {
              // Recebeu nova lista de diffs → reconstrói decorações no doc atual
              return {
                diffs: meta,
                decos: buildDecorationSet(newState.doc, meta),
              }
            }
            // Documento mudou (accept/reject) → remapeia decorações existentes
            return {
              diffs: prev.diffs,
              decos: prev.decos.map(tr.mapping, newState.doc),
            }
          },
        },

        props: {
          decorations(state) {
            return DIFF_PLUGIN_KEY.getState(state).decos
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      /**
       * Aplica (ou atualiza) as decorações de diff.
       * Deve ser chamado sempre que a lista de diffs muda.
       */
      setDiffDecorations: (diffs) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(DIFF_PLUGIN_KEY, diffs))
        return true
      },

      /** Remove todas as decorações de diff. */
      clearDiffDecorations: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(DIFF_PLUGIN_KEY, []))
        return true
      },
    }
  },
})
