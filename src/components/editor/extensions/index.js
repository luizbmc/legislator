import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core'
import { HiddenChars }   from './HiddenChars.js'
import { DiffHighlight } from './DiffHighlight.js'
import { NotaRodapeConnector } from './NotaRodapeConnector.js'
import { cssFormatoCaractere, cssFormatoParagrafo } from '../../../services/preferenciasEstilo.js'
export { HiddenChars, DiffHighlight }

// ── Factory: cria um nó de bloco simples ────────────────────────
function criarNo(name, cssClass, atalho = null, extraAttrs = {}) {
  return Node.create({
    name,
    group: 'block',
    content: 'inline*',

    addAttributes() {
      return {
        alterado: { default: null },
        diffType: { default: null },
        diffSubtype: { default: null },
        ...Object.fromEntries(
          Object.entries(extraAttrs).map(([k, v]) => [k, { default: v }])
        ),
      }
    },

    parseHTML() {
      // priority 70 garante que estas regras sejam verificadas antes do
      // nó `paragraph` genérico do StarterKit (prioridade padrão 50)
      return [{ tag: `p[data-tipo="${name}"]`, priority: 70 }]
    },

    renderHTML({ node, HTMLAttributes }) {
      const dataAttrs = {}
      for (const [k, v] of Object.entries(node.attrs)) {
        if (v !== null) {
          const dataName = k.replace(/[A-Z]/g, letra => '-' + letra.toLowerCase())
          dataAttrs[`data-${dataName}`] = v
        }
      }
      return ['p', mergeAttributes(HTMLAttributes, dataAttrs, {
        'data-tipo': name,
        class: `leg leg-${cssClass}`,
      }), 0]
    },

    ...(atalho ? {
      addKeyboardShortcuts() {
        return { [atalho]: () => this.editor.commands.setNode(name) }
      },
    } : {}),
  })
}

// ── Nós estruturais (hierarquia 1-2-3) ──────────────────────────
export const Epigrafe        = criarNo('epigrafe',        'epigrafe',          'Mod-Alt-1')
export const EpigrafeApelido = criarNo('epigrafeApelido', 'epigrafe-apelido')
export const NotaTitulo      = criarNo('notaTitulo',      'nota-titulo')
export const Ementa          = criarNo('ementa',          'ementa',            'Mod-Alt-2')
export const ParagrafAbertura= criarNo('paragrafAbertura','paragrafo-abertura')
export const ParagrafFacoSaber = criarNo('paragrafFacoSaber','paragrafo-faco-saber')
export const AberturaCapitulo= criarNo('aberturaCapitulo','abertura-capitulo')

export const PartelivroTitCap = criarNo(                  // Nível 2
  'partelivroTitCap', 'parte-livro-tit-cap', 'Mod-Alt-3',
  { rotulo: null }
)
export const SecaoSubsecao   = criarNo(                   // Nível 3
  'secaoSubsecao', 'secao-subsecao', 'Mod-Alt-4'
)

// ── Nós de articulação ──────────────────────────────────────────
export const Artigo          = criarNo('artigo',          'artigo',            'Mod-Alt-5', { numero: null })
export const ArtigoTitulo    = criarNo('artigoTitulo',    'artigo-titulo')
export const CorpoTratado    = criarNo('corpoTratado',    'corpo-tratado')
export const ParagrafLei     = criarNo('paragrafLei',     'paragrafo-lei',     'Mod-Alt-6')
export const NomeJuridico    = criarNo('nomeJuridico',    'nome-juridico')
export const Inciso          = criarNo('inciso',          'inciso',            'Mod-Alt-7')
export const Alinea          = criarNo('alinea',          'alinea',            'Mod-Alt-8')
export const Item            = criarNo('item',            'item')
export const Citacao         = criarNo('citacao',         'citacao')
export const Data            = criarNo('data',            'data')
export const Assinatura      = criarNo('assinatura',      'assinatura')

// ── Nós de assinatura ───────────────────────────────────────────
export const AssinaturaData  = criarNo('assinaturaData',  'assinatura-data')
export const AssinaturaNome  = criarNo('assinaturaNome',  'assinatura-nome')

export const EstiloParagrafoCustom = Node.create({
  name: 'estiloParagrafoCustom',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      styleId: { default: null },
      label: { default: null },
      cssClass: { default: null },
      format: { default: null },
      alterado: { default: null },
      diffType: { default: null },
      diffSubtype: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'p[data-tipo="estiloParagrafoCustom"]', priority: 70 }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = {
      'data-tipo': 'estiloParagrafoCustom',
      'data-style-id': node.attrs.styleId || '',
      class: `leg leg-custom-paragrafo ${node.attrs.cssClass ? 'leg-' + node.attrs.cssClass : ''}`,
      style: cssFormatoParagrafo(node.attrs.format || {}),
    }
    if (node.attrs.label) attrs['data-style-label'] = node.attrs.label
    return ['p', mergeAttributes(HTMLAttributes, attrs), 0]
  },
})

export const ParagraphAlteradoAttrs = Extension.create({
  name: 'paragraphAlteradoAttrs',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          alterado: {
            default: null,
            parseHTML: element => element.getAttribute('data-alterado'),
            renderHTML: attrs => attrs.alterado ? { 'data-alterado': attrs.alterado } : {},
          },
          diffType: {
            default: null,
            parseHTML: element => element.getAttribute('data-diff-type'),
            renderHTML: attrs => attrs.diffType ? { 'data-diff-type': attrs.diffType } : {},
          },
          diffSubtype: {
            default: null,
            parseHTML: element => element.getAttribute('data-diff-subtype'),
            renderHTML: attrs => attrs.diffSubtype ? { 'data-diff-subtype': attrs.diffSubtype } : {},
          },
        },
      },
    ]
  },
})

// ── Marks customizados ──────────────────────────────────────────

// Nota: texto entre parênteses após . ; :
export const Nota = Mark.create({
  name: 'nota',
  // priority 70: verificado antes de italic/bold do StarterKit (padrão 50)
  parseHTML() { return [{ tag: 'span.leg-nota', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'leg-nota' }), 0]
  },
})

export const NotaSobrescrito = Mark.create({
  name: 'notaSobrescrito',
  parseHTML() { return [{ tag: 'span.leg-nota-sobrescrito', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'leg-nota-sobrescrito' }), 0]
  },
})

// Itálico leve (nota-titulos, DOU, caput)
export const NotaRodape = Mark.create({
  name: 'notaRodape',
  addAttributes() {
    return {
      chamada: {
        default: null,
        parseHTML: element => element.getAttribute('data-chamada') || element.getAttribute('chamada'),
        renderHTML: () => ({}),
      },
      texto: {
        default: null,
        parseHTML: element => element.getAttribute('data-texto') || element.getAttribute('texto'),
        renderHTML: attrs => attrs.texto ? { 'data-texto': attrs.texto } : {},
      },
    }
  },
  parseHTML() { return [{ tag: 'span.leg-nota-rodape', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'leg-nota-rodape' }),
      ['span', { class: 'leg-nota-rodape-marker', contenteditable: 'false' }, '[nota]'],
      ['span', { class: 'leg-nota-rodape-content', 'aria-hidden': 'true' }, 0],
    ]
  },
})

export const ItalicoLight = Mark.create({
  name: 'italicoLight',
  parseHTML() { return [{ tag: 'em.leg-italico-light', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return ['em', mergeAttributes(HTMLAttributes, { class: 'leg-italico-light' }), 0]
  },
})

// Rótulo de artigo em negrito (ex.: "Art. 1º")
export const BoldArtigo = Mark.create({
  name: 'boldArtigo',
  parseHTML() { return [{ tag: 'strong.leg-bold-artigo', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return ['strong', mergeAttributes(HTMLAttributes, { class: 'leg-bold-artigo' }), 0]
  },
})

export const Regular = Mark.create({
  name: 'regular',
  parseHTML() { return [{ tag: 'span.leg-regular', priority: 70 }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'leg-regular' }), 0]
  },
})

export const EstiloCaractereCustom = Mark.create({
  name: 'estiloCaractereCustom',
  addAttributes() {
    return {
      styleId: { default: null },
      label: { default: null },
      cssClass: { default: null },
      format: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-marca="estiloCaractereCustom"]', priority: 70 }]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const attrs = {
      'data-marca': 'estiloCaractereCustom',
      'data-style-id': mark.attrs.styleId || '',
      class: `leg-custom-caractere ${mark.attrs.cssClass ? 'leg-' + mark.attrs.cssClass : ''}`,
      style: cssFormatoCaractere(mark.attrs.format || {}),
    }
    if (mark.attrs.label) attrs['data-style-label'] = mark.attrs.label
    return ['span', mergeAttributes(HTMLAttributes, attrs), 0]
  },
})

// ── Exportação agrupada ─────────────────────────────────────────
export const ALL_EXTENSIONS = [
  Epigrafe, EpigrafeApelido, NotaTitulo, Ementa, ParagrafAbertura, ParagrafFacoSaber, AberturaCapitulo,
  PartelivroTitCap, SecaoSubsecao,
  Artigo, ArtigoTitulo, CorpoTratado, ParagrafLei, NomeJuridico, Inciso, Alinea, Item, Citacao,
  Data, Assinatura,
  AssinaturaData, AssinaturaNome, EstiloParagrafoCustom,
  ParagraphAlteradoAttrs,
  Nota, NotaSobrescrito, NotaRodape, ItalicoLight, BoldArtigo, Regular, EstiloCaractereCustom,
  HiddenChars,
  DiffHighlight,
  NotaRodapeConnector,
]
