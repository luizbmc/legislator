import { useState, useEffect } from 'react'
import { isTipoFacoSaber, isTipoTextoComum, isTipoTratado } from '../../constants/normas.js'
import {
  estilosCaractereConfigurados,
  estilosParagrafoConfigurados,
  estiloAtivoNoTipo,
} from '../../services/preferenciasEstilo.js'

const ESTILOS = [
  { node: 'aberturaCapitulo', label: 'Abertura capítulo' },
  // ── Hierarquia estrutural ──────────────────────────────────
  { node: 'epigrafe',         label: 'Epígrafe',         atalho: '⌘⌥1', nivel: 1 },
  { node: 'epigrafeApelido', label: 'Apelido',                           nivel: 1 },
  { node: 'partelivroTitCap', label: 'Título / Cap.',     atalho: '⌘⌥3', nivel: 2 },
  { node: 'secaoSubsecao',    label: 'Seção',             atalho: '⌘⌥4', nivel: 3 },
  // ── Outros ────────────────────────────────────────────────
  { node: 'ementa',           label: 'Ementa',            atalho: '⌘⌥2' },
  { node: 'paragrafAbertura', label: 'Abertura de lei' },
  { node: 'paragrafFacoSaber', label: 'Faço saber', apenasFacoSaber: true },
  { node: 'artigo',           label: 'Artigo',            atalho: '⌘⌥5' },
  { node: 'artigoTitulo',     label: 'Artigo (título)' },
  { node: 'corpoTratado',     label: 'Corpo de tratado' },
  { node: 'paragrafLei',      label: 'Parágrafo',         atalho: '⌘⌥6' },
  { node: 'nomeJuridico',     label: 'Nome jurídico' },
  { node: 'inciso',           label: 'Inciso',            atalho: '⌘⌥7' },
  { node: 'alinea',           label: 'Alínea',            atalho: '⌘⌥8' },
  { node: 'item',             label: 'Item' },
  { node: 'citacao',          label: 'Citação' },
  { node: 'data',             label: 'Data' },
  { node: 'assinatura',       label: 'Assinatura' },
  { node: 'notaTitulo',       label: 'Nota título' },
  { node: 'textoComumTitulo',          label: 'Título' },
  { node: 'textoComumSubtitulo',       label: 'Subtítulo' },
  { node: 'textoComumCorrido',         label: 'Texto corrido' },
  { node: 'textoComumRecuado',         label: 'Texto recuado' },
  { node: 'textoComumCitacao',         label: 'Citação' },
  { node: 'textoComumBullets',         label: 'Bullets' },
  { node: 'textoComumAssinatura',      label: 'Assinatura' },
  { node: 'textoComumAssinaturaCargo', label: 'Assinatura-cargo' },
]

const ESTILOS_TRATADO = new Set([
  'epigrafe',
  'epigrafeApelido',
  'notaTitulo',
  'ementa',
  'artigoTitulo',
  'corpoTratado',
  'citacao',
  'data',
  'assinatura',
])

const ESTILOS_TEXTO_COMUM = new Set([
  'textoComumTitulo',
  'textoComumSubtitulo',
  'textoComumCorrido',
  'textoComumRecuado',
  'textoComumCitacao',
  'textoComumBullets',
  'textoComumAssinatura',
  'textoComumAssinaturaCargo',
])

// ── Estilos de caractere ──────────────────────────────────────────
const CARACTERES = [
  {
    id:    'bold',
    label: 'N',
    title: 'Negrito',
    isAtivo: ed => ed.isActive('bold'),
    toggle:  ed => ed.chain().focus().toggleBold().run(),
    css:   'char-bold',
  },
  {
    id:    'italic',
    label: 'I',
    title: 'Itálico',
    isAtivo: ed => ed.isActive('italic') && !ed.isActive('nota'),
    toggle:  ed => ed.chain().focus().toggleItalic().run(),
    css:   'char-italic',
  },
  {
    id:    'bolditalic',
    label: 'NI',
    title: 'Negrito + Itálico',
    isAtivo: ed => ed.isActive('bold') && ed.isActive('italic') && !ed.isActive('nota'),
    toggle:  ed => {
      const ambos = ed.isActive('bold') && ed.isActive('italic')
      if (ambos) {
        ed.chain().focus().unsetBold().unsetItalic().run()
      } else {
        ed.chain().focus().setBold().setItalic().run()
      }
    },
    css:   'char-bolditalic',
  },
  {
    id:    'superscript',
    label: 'x²',
    title: 'Sobrescrito',
    isAtivo: ed => ed.isActive('superscript'),
    toggle:  ed => ed.chain().focus().toggleSuperscript().run(),
    css:   'char-sup',
  },
  {
    id:    'subscript',
    label: 'x₂',
    title: 'Subscrito',
    isAtivo: ed => ed.isActive('subscript'),
    toggle:  ed => ed.chain().focus().toggleSubscript().run(),
    css:   'char-sub',
  },
  {
    id:    'nota',
    label: 'Nota',
    title: 'Nota',
    isAtivo: ed => ed.isActive('nota') && !ed.isActive('italic'),
    toggle:  ed => ed.chain().focus().toggleMark('nota').run(),
    css:   'char-nota',
  },
  {
    id:    'notaSobrescrito',
    label: 'Nota²',
    title: 'Nota sobrescrito',
    isAtivo: ed => ed.isActive('notaSobrescrito'),
    toggle:  ed => ed.chain().focus().toggleMark('notaSobrescrito').run(),
    css:   'char-nota-sobrescrito',
  },
  {
    id:    'nota-italic',
    label: 'Nota i',
    title: 'Nota itálico',
    isAtivo: ed => ed.isActive('nota') && ed.isActive('italic'),
    toggle:  ed => {
      const ambos = ed.isActive('nota') && ed.isActive('italic')
      if (ambos) {
        ed.chain().focus().unsetMark('nota').unsetItalic().run()
      } else {
        ed.chain().focus().setMark('nota').setItalic().run()
      }
    },
    css:   'char-nota-italic',
  },
  {
    id:    'boldArtigo',
    label: 'art',
    title: 'Bold-Artigo',
    isAtivo: ed => ed.isActive('boldArtigo'),
    toggle:  ed => ed.chain().focus().toggleMark('boldArtigo').run(),
    css:   'char-bold-artigo',
  },
  {
    id:    'regular',
    label: 'Reg',
    title: 'Regular',
    isAtivo: ed => ed.isActive('regular'),
    toggle:  ed => ed.chain().focus().toggleMark('regular').run(),
    css:   'char-regular',
  },
]

function lerEstadoAtual(editor, caracteres = CARACTERES) {
  return {
    node:   editor?.state.selection.$anchor.parent?.type?.name ?? null,
    customStyleId: editor?.state.selection.$anchor.parent?.attrs?.styleId ?? null,
    marks:  caracteres.map(c => ({ id: c.id, ativo: !!editor && c.isAtivo(editor) })),
  }
}

export default function PainelEstilos({ editor, editable = true, tipoNorma = '', onAcaoRepetivel = null }) {
  const [prefsTick, setPrefsTick] = useState(0)
  const caracteresCustom = estilosCaractereConfigurados({ incluirInternos: false })
    .filter(e => e.custom && estiloAtivoNoTipo(e, tipoNorma))
    .map(e => ({
      id: e.id,
      label: e.painelLabel || e.label,
      title: e.label,
      isAtivo: ed => ed.isActive('estiloCaractereCustom', { styleId: e.id }),
      toggle: ed => ed.chain().focus().toggleMark('estiloCaractereCustom', {
        styleId: e.id,
        label: e.label,
        cssClass: e.cssClass,
        format: e.format,
      }).run(),
      css: 'char-custom',
    }))
  const caracteres = [...CARACTERES, ...caracteresCustom]
  const [estado, setEstado] = useState(() => lerEstadoAtual(editor, caracteres))

  useEffect(() => {
    const atualizarPrefs = () => setPrefsTick(t => t + 1)
    window.addEventListener('legislator:preferencias-estilo', atualizarPrefs)
    window.addEventListener('storage', atualizarPrefs)
    return () => {
      window.removeEventListener('legislator:preferencias-estilo', atualizarPrefs)
      window.removeEventListener('storage', atualizarPrefs)
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    const atualizar = () => setEstado(lerEstadoAtual(editor, caracteres))
    editor.on('selectionUpdate', atualizar)
    editor.on('transaction',     atualizar)
    return () => {
      editor.off('selectionUpdate', atualizar)
      editor.off('transaction',     atualizar)
    }
  }, [editor, prefsTick, tipoNorma])

  const { node: ativoAtual, customStyleId, marks } = estado
  const estilosConfigurados = estilosParagrafoConfigurados({ incluirInternos: false })
  const estilosBaseDisponiveis = isTipoTextoComum(tipoNorma)
    ? ESTILOS.filter(e => ESTILOS_TEXTO_COMUM.has(e.node))
    : isTipoTratado(tipoNorma)
      ? ESTILOS.filter(e => ESTILOS_TRATADO.has(e.node))
      : ESTILOS.filter(e => !ESTILOS_TEXTO_COMUM.has(e.node) && (!e.apenasFacoSaber || isTipoFacoSaber(tipoNorma)))
  const estilosCustomDisponiveis = estilosConfigurados
    .filter(e => e.custom && estiloAtivoNoTipo(e, tipoNorma))
  const estilosDisponiveis = [...estilosBaseDisponiveis, ...estilosCustomDisponiveis]
  const labelAtivo = ativoAtual === 'estiloParagrafoCustom'
    ? estilosCustomDisponiveis.find(e => e.id === customStyleId)?.label
    : ESTILOS.find(e => e.node === ativoAtual)?.label

  function aplicarNo(estilo) {
    if (!editable) return
    if (estilo.custom) {
      editor?.chain().focus().setNode('estiloParagrafoCustom', {
        styleId: estilo.id,
        label: estilo.label,
        cssClass: estilo.cssClass,
        format: estilo.format,
      }).run()
      onAcaoRepetivel?.({
        tipo: 'paragrafo',
        custom: true,
        styleId: estilo.id,
        label: estilo.label,
        cssClass: estilo.cssClass,
        format: estilo.format,
      })
      return
    }
    editor?.chain().focus().setNode(estilo.node).run()
    onAcaoRepetivel?.({ tipo: 'paragrafo', node: estilo.node })
  }

  return (
    <aside className="painel painel-estilos">

      {/* ── Estilos de parágrafo ─────────────────────────────── */}
      <div className="painel-titulo">
        Parágrafo
        {labelAtivo && <span className="estilo-atual-badge">{labelAtivo}</span>}
      </div>
      <div className="estilos-lista">
        {estilosDisponiveis.map(e => (
          <button key={e.custom ? e.id : e.node}
            className={`estilo-btn estilo-${e.node || e.id} nivel-${e.nivel ?? 0}${(e.custom ? ativoAtual === 'estiloParagrafoCustom' && customStyleId === e.id : ativoAtual === e.node) ? ' ativo' : ''}`}
            onClick={() => aplicarNo(e)}
            disabled={!editable}
            title={e.atalho ?? ''}>
            <span className="estilo-label">{e.label}</span>
            {e.atalho && <kbd className="estilo-atalho">{e.atalho}</kbd>}
          </button>
        ))}
      </div>

      {/* ── Estilos de caractere ─────────────────────────────── */}
      <div className="painel-titulo painel-titulo-sep">Caractere</div>
      <div className="char-lista">
        {CARACTERES.map(c => {
          const ativo = marks.find(m => m.id === c.id)?.ativo
          return (
            <button key={c.id}
              className={`char-btn ${c.css}${ativo ? ' ativo' : ''}`}
              onClick={() => {
                if (!editable || !editor) return
                c.toggle(editor)
                onAcaoRepetivel?.({ tipo: 'caractere', id: c.id, acao: ativo ? 'remove' : 'apply' })
              }}
              disabled={!editable}
              title={c.title}>
              {c.label}
            </button>
          )
        })}
      </div>

    </aside>
  )
}
