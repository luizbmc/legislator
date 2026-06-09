import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import mammoth from 'mammoth'
import LegislatorEditor     from '../components/editor/LegislatorEditor.jsx'
import PainelSumario        from '../components/paineis/PainelSumario.jsx'
import PainelRotinas        from '../components/paineis/PainelRotinas.jsx'
import PainelEstilos        from '../components/paineis/PainelEstilos.jsx'
import PainelExcecoes       from '../components/paineis/PainelExcecoes.jsx'
import PainelBusca          from '../components/paineis/PainelBusca.jsx'
import PainelNotas          from '../components/paineis/PainelNotas.jsx'
import PainelAtualizarNorma from '../components/paineis/PainelAtualizarNorma.jsx'
import { baixarXml }        from '../services/exportarXml.js'
import { xmlParaTiptap }     from '../services/importarXml.js'
import { analisarClassesHtmlInDesign, htmlInDesignParaTiptap } from '../services/importarHtmlInDesign.js'
import { estiloAtivoNoTipo, estilosParagrafoConfigurados } from '../services/preferenciasEstilo.js'
import { limparHtmlInternet } from '../services/limpeza/00_parseHtml.js'
import { detectarExcecoes } from '../services/limpeza/06_detectarExcecoes.js'
import { TIPOS_NORMA }      from '../constants/normas.js'

const DOC_VAZIO = '{"type":"doc","content":[]}'

const PADRONIZACAO_ABAS = [
  {
    id: 'palavras',
    label: 'Palavras compostas',
    regex: /(?<![A-Za-zÀ-ÿ])(?=[A-Za-zÀ-ÿ]*[a-zà-ÿ])[A-Za-zÀ-ÿ]+-(?!(?:se|o|a|os|as|la|las|lo|los|ão|ãos|te|lhe|lhes|ia|á)\b)(?=[A-Za-zÀ-ÿ]*[a-zà-ÿ])[A-Za-zÀ-ÿ]+(?:-(?!(?:se|o|a|os|as|la|las|lo|los|ão|ãos|te|lhe|lhes|ia|á)\b)(?=[A-Za-zÀ-ÿ]*[a-zà-ÿ])[A-Za-zÀ-ÿ]+)*/g,
  },
  {
    id: 'siglas',
    label: 'Siglas',
    regex: /[A-Za-zÀ-ÿ]{2,} +(?:[-–] +[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+|\([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+\))/g,
  },
  {
    id: 'acentuacao',
    label: 'Acentuação',
    regex: /(êe)|(ôo)|(iú)|(éia)|(óia)/g,
  },
  {
    id: 'italicos',
    label: 'Itálicos',
  },
]

function contextoOcorrencia(texto, ini, fim) {
  const before = texto.slice(Math.max(0, ini - 42), ini).replace(/\s+/g, ' ')
  const after = texto.slice(fim, Math.min(texto.length, fim + 42)).replace(/\s+/g, ' ')
  return `${before}${before ? ' ' : ''}${texto.slice(ini, fim)}${after ? ' ' : ''}${after}`
}

function deveIgnorarOcorrenciaPadronizacao(abaId, texto) {
  if (abaId === 'palavras') {
    const partes = texto.split('-').map(parte => parte.toLocaleLowerCase('pt-BR'))
    return ['se', 'á', 'pré', 'ex', 'vice'].some(parteIgnorada => partes.indexOf(parteIgnorada) >= 0)
  }
  if (abaId === 'siglas') {
    const primeiraParte = texto.split(/\s+/)[0]
    return /^[IVXL]+$/i.test(primeiraParte)
  }
  return false
}

function temMarkItalico(node) {
  return Boolean(node?.marks?.some(mark => mark.type.name === 'italic' || mark.type.name === 'italicoLight'))
}

function deveIgnorarItalico(texto) {
  const normalizado = texto.replace(/\s+/g, ' ').trim()
  const ignorados = ['DOU', 'Caput', 'caput', 'Parágrafo', 'único']
  if (/^[A-Za-zÀ-ÿ]\)$/.test(normalizado)) return true
  const palavras = normalizado.match(/[A-Za-zÀ-ÿ]{2,}(?:-[A-Za-zÀ-ÿ]{2,})*/g) || []
  return palavras.length > 0 && palavras.every(palavra => ignorados.includes(palavra))
}

function normalizarNumeroArtigoBusca(valor) {
  const texto = String(valor || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^arts?\.?/i, '')
    .replace(/^artigos?/i, '')
    .replace(/[ºª°]/g, '')
    .toUpperCase()
  const match = texto.match(/^((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)$/)
  return match ? match[1].replace(/\./g, '') : ''
}

function coletarOcorrenciasItalico(editor) {
  const ocorrencias = []
  if (!editor?.state?.doc) return ocorrencias

  const sequenciaItalicoRe = /[A-Za-zÀ-ÿ]{2,}(?:-[A-Za-zÀ-ÿ]{2,})*(?:[\s\u00A0\u202F]+[A-Za-zÀ-ÿ]{2,}(?:-[A-Za-zÀ-ÿ]{2,})*)*/g

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text || !temMarkItalico(node)) return

    let match
    while ((match = sequenciaItalicoRe.exec(node.text)) !== null) {
      const texto = match[0].replace(/\s+/g, ' ').trim()
      if (!texto || deveIgnorarItalico(texto)) continue
      ocorrencias.push({
        texto,
        contexto: contextoOcorrencia(node.text, match.index, match.index + match[0].length),
        from: pos + match.index,
        to: pos + match.index + match[0].length,
      })
    }
  })

  return ocorrencias
}

function coletarOcorrenciasPadronizacao(editor, abaId) {
  const def = PADRONIZACAO_ABAS.find(a => a.id === abaId) ?? PADRONIZACAO_ABAS[0]
  const ocorrencias = []
  if (!editor?.state?.doc) return ocorrencias
  if (def.id === 'italicos') return coletarOcorrenciasItalico(editor)

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const regex = new RegExp(def.regex.source, def.regex.flags)
    let match
    while ((match = regex.exec(node.text)) !== null) {
      if (!match[0]) {
        regex.lastIndex++
        continue
      }
      if (deveIgnorarOcorrenciaPadronizacao(def.id, match[0])) continue
      ocorrencias.push({
        texto: match[0],
        contexto: contextoOcorrencia(node.text, match.index, match.index + match[0].length),
        from: pos + match.index,
        to: pos + match.index + match[0].length,
      })
    }
  })

  return ocorrencias
}

function agruparOcorrenciasPadronizacao(ocorrencias) {
  const mapa = {}
  for (const ocorrencia of ocorrencias) {
    const chave = ocorrencia.texto.replace(/\s+/g, ' ').trim()
    if (!mapa[chave]) {
      mapa[chave] = {
        chave,
        texto: ocorrencia.texto,
        ocorrencias: [],
      }
    }
    mapa[chave].ocorrencias.push(ocorrencia)
  }
  return Object.keys(mapa)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(chave => mapa[chave])
}

const EXPORTABLE_BLOCK_TYPES = new Set([
  'epigrafe',
  'epigrafeApelido',
  'notaTitulo',
  'ementa',
  'paragrafAbertura',
  'paragrafFacoSaber',
  'aberturaCapitulo',
  'partelivroTitCap',
  'secaoSubsecao',
  'artigo',
  'artigoTitulo',
  'corpoTratado',
  'paragrafLei',
  'nomeJuridico',
  'inciso',
  'alinea',
  'item',
  'citacao',
  'data',
  'assinatura',
  'assinaturaData',
  'assinaturaNome',
  'paragraph',
  'table',
])

const NODE_TO_STYLE_EXCECOES = {
  epigrafe: 'epigrafe',
  epigrafeApelido: 'epigrafe-apelido',
  notaTitulo: 'nota-titulo',
  ementa: 'ementa',
  paragrafAbertura: 'paragrafo-abertura',
  paragrafFacoSaber: 'texto-lei-faco-saber',
  aberturaCapitulo: 'abertura-capitulo',
  partelivroTitCap: 'parte-livro-tit-cap',
  secaoSubsecao: 'secao-subsecao',
  artigo: 'artigo',
  artigoTitulo: 'artigo-titulo',
  corpoTratado: 'corpo-tratado',
  paragrafLei: 'paragrafo',
  nomeJuridico: 'nome-juridico',
  inciso: 'inciso',
  alinea: 'alinea',
  item: 'item',
  citacao: 'citacao',
  data: 'data',
  assinatura: 'assinatura',
  assinaturaData: 'data',
  assinaturaNome: 'assinatura',
}

function textoInlineExcecoes(content) {
  return (content ?? []).map(node => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return ' '
    return ''
  }).join('')
}

function tiptapDocParaLinhasExcecoes(doc) {
  return (doc?.content ?? [])
    .filter(node => node.type !== 'table')
    .map(node => {
      const text = textoInlineExcecoes(node.content)
      let style = NODE_TO_STYLE_EXCECOES[node.type] ?? 'texto-lei'
      if (node.type === 'paragrafLei' && !/^§|^Parágrafo único/i.test(text)) {
        style = 'texto-lei'
      }
      return {
        style,
        text,
        content: node.content ? node.content.map(item => ({ ...item })) : [],
      }
    })
}

// ── Diff de palavras para exibição inline no painel ───────────────
// Retorna array de { type: 'equal'|'added'|'removed', text: string }
function diffWords(a, b) {
  const tok = s => s.match(/\S+|\s+/g) ?? []
  const A = tok(a), B = tok(b)
  const m = A.length, n = B.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = A[i-1] === B[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1])
  const ops = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i-1] === B[j-1]) {
      ops.unshift({ type: 'equal',   text: A[i-1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: 'added',   text: B[j-1] }); j--
    } else {
      ops.unshift({ type: 'removed', text: A[i-1] }); i--
    }
  }
  return ops
}

// ── Helpers de revisão ────────────────────────────────────────────

/** Retorna { offset, size } do nó de topo pelo índice contentIdx. */
function getNodeInfo(doc, contentIdx) {
  let result = null
  let i = 0
  doc.forEach((node, offset) => {
    if (i === contentIdx) result = { offset, size: node.nodeSize }
    i++
  })
  return result
}

/** Decrementa contentIdx de todos os diffs após o nó deletado. */
function shiftIdxAfterDelete(diffsArr, deletedIdx) {
  return diffsArr.map(d =>
    d.contentIdx > deletedIdx ? { ...d, contentIdx: d.contentIdx - 1 } : d
  )
}

/**
 * Retorna o índice do próximo diff não resolvido após `from`.
 * Se `subtype` for fornecido, filtra apenas diffs daquele subtipo. Circula.
 */
function proximoNaoResolvido(diffsArr, from, subtype = null) {
  const ok = (d) => !d.resolved && (subtype === null || d.subtype === subtype)
  for (let i = from + 1; i < diffsArr.length; i++) {
    if (ok(diffsArr[i])) return i
  }
  for (let i = 0; i < from; i++) {
    if (ok(diffsArr[i])) return i
  }
  return -1  // todos resolvidos (no subtype)
}

/** Define o atributo `alterado` no nó de topo pelo índice contentIdx. */
function marcarNodoAlterado(ed, contentIdx, valor, extras = {}) {
  // 1. Localiza offset e attrs do nó alvo ANTES de criar a transaction
  let alvo = null
  let ni = 0
  ed.state.doc.forEach((node, offset) => {
    if (ni === contentIdx && alvo === null) {
      alvo = { offset, attrs: node.attrs }
    }
    ni++
  })
  if (!alvo) return

  // 2. Cria e despacha a transaction a partir do estado atual
  try {
    const { tr } = ed.state
    tr.setNodeMarkup(alvo.offset, null, { ...alvo.attrs, ...extras, alterado: valor })
    ed.view.dispatch(tr)
    // Verifica se o atributo foi persistido (confirma no console para diagnóstico)
    const attrResultante = ed.state.doc.content.child(contentIdx)?.attrs?.alterado
    if (attrResultante !== valor) {
      console.warn(`[Legislator] marcarNodoAlterado: atributo não persistiu no nó ${contentIdx}. Esperado: ${valor}, obtido: ${attrResultante}`)
    }
  } catch (e) {
    console.warn('[Legislator] marcarNodoAlterado: falha ao setar atributo', e)
  }
}

/**
 * Pisca 3× o parágrafo alvo via overlay position:fixed em document.body.
 * Não toca no DOM do ProseMirror, que reverte alterações externas.
 *
 * IMPORTANTE: chame este função APÓS a conclusão do scroll (use scroll
 * instantâneo + ~50ms de delay), não com smooth scroll em andamento — caso
 * contrário getBoundingClientRect() retorna a posição mid-animação e o
 * overlay fica fora da viewport.
 */
function flashDiffEl(diffsArr, idx, ed) {
  if (!ed || idx < 0 || !diffsArr[idx]) return
  const diff = diffsArr[idx]

  // Calcula o offset (posição ProseMirror) do nó alvo
  let nodeOffset = 0
  try {
    for (let i = 0; i < diff.contentIdx; i++) {
      nodeOffset += ed.state.doc.child(i).nodeSize
    }
  } catch { return }

  // Obtém o elemento DOM via domAtPos — fresh call, sem cache
  let domEl = null
  try {
    const { node: domNode } = ed.view.domAtPos(nodeOffset + 1)
    let el = domNode?.nodeType === Node.TEXT_NODE ? domNode.parentElement : domNode
    // Sobe até o filho direto do editor (nível de parágrafo)
    while (el && el.parentElement && !el.parentElement.classList.contains('ProseMirror')) {
      el = el.parentElement
    }
    domEl = (el instanceof Element && el !== document.documentElement && el !== document.body)
      ? el
      : null
  } catch { return }

  if (!domEl) return
  const rect = domEl.getBoundingClientRect()
  if (!rect.height) return   // elemento sem dimensões (display:none, etc.)

  // Overlay fixo sobre o parágrafo — completamente fora do DOM do editor.
  // Usa background + outline para ser visível mesmo em temas escuros/claros.
  const PAD = 3
  const ov = document.createElement('div')
  Object.assign(ov.style, {
    position:      'fixed',
    top:           (rect.top    - PAD) + 'px',
    left:          (rect.left   - PAD) + 'px',
    width:         (rect.width  + PAD * 2) + 'px',
    height:        (rect.height + PAD * 2) + 'px',
    pointerEvents: 'none',
    zIndex:        '2147483647',
    borderRadius:  '4px',
    boxSizing:     'border-box',
    background:    'transparent',
    outline:       '2px solid transparent',
    outlineOffset: '0px',
    transition:    'none',
  })
  document.body.appendChild(ov)

  const COR_BG  = 'rgba(59, 130, 246, 0.18)'
  const COR_OUT = 'rgba(59, 130, 246, 0.85)'
  const LIGADO    = 230
  const DESLIGADO = 170

  // Pulsos com timers absolutos (mais previsíveis que setTimouts aninhados)
  const ligar  = () => { ov.style.background = COR_BG;      ov.style.outline = `2px solid ${COR_OUT}` }
  const desligar = () => { ov.style.background = 'transparent'; ov.style.outline = '2px solid transparent' }

  const T = [
    [0,                         ligar   ],
    [LIGADO,                    desligar],
    [LIGADO + DESLIGADO,        ligar   ],
    [LIGADO * 2 + DESLIGADO,    desligar],
    [LIGADO * 2 + DESLIGADO * 2, ligar  ],
    [LIGADO * 3 + DESLIGADO * 2, desligar],
    [LIGADO * 3 + DESLIGADO * 2 + 80, () => ov.remove()],
  ]
  T.forEach(([delay, fn]) => setTimeout(fn, delay))
}

/** Scroll até o nó correspondente ao diff no editor.
 *  Usa scroll instantâneo para que getBoundingClientRect() em flashDiffEl
 *  reflita a posição final e não uma posição mid-animação. */
function scrollParaDiff(diffsArr, idx, ed) {
  if (!ed || idx < 0 || !diffsArr[idx]) return
  const diff = diffsArr[idx]
  let ni = 0
  ed.state.doc.forEach((node, offset) => {
    if (ni === diff.contentIdx) {
      const pos = offset + 1
      ed.commands.setTextSelection(pos)
      // Scroll instantâneo via DOM — garantia de posição final estável
      // para o flash overlay que vem logo depois.
      try {
        const { node: domNode } = ed.view.domAtPos(pos)
        const el = domNode?.nodeType === 3 /* TEXT_NODE */
          ? domNode.parentElement
          : domNode
        el?.scrollIntoView({ block: 'center', behavior: 'auto' })
      } catch {
        ed.commands.scrollIntoView()
      }
    }
    ni++
  })
}

const TIPO_LABEL = { added: 'Adicionado', removed: 'Removido', modified: 'Modificado' }

// ── Helpers para rastrear nós alterados (fallback de exportação) ──

/** Desloca as chaves do mapa de alterações após a deleção do nó em deletedIdx. */
function shiftNodesAlterados(mapa, deletedIdx) {
  const novo = {}
  for (const [k, v] of Object.entries(mapa)) {
    const idx = Number(k)
    if (idx < deletedIdx)  novo[idx] = v      // abaixo: inalterado
    else if (idx > deletedIdx) novo[idx - 1] = v  // acima: desloca para baixo
    // idx === deletedIdx: nó foi removido, descarta a entrada
  }
  return novo
}

/**
 * Retorna uma cópia do doc JSON com o atributo `alterado` injetado nos nós
 * listados no mapa `{ contentIdx → valor }`.
 */
function aplicarFlagsNoJSON(doc, mapa) {
  if (!doc?.content || Object.keys(mapa).length === 0) return doc
  return {
    ...doc,
    content: doc.content.map((no, idx) => {
      const item = mapa[idx]
      const val = typeof item === 'string' ? item : item?.alterado
      if (!val) return no
      const extras = typeof item === 'object' && item ? {
        ...(item.diffType ? { diffType: item.diffType } : {}),
        ...(item.subtype ? { diffSubtype: item.subtype } : {}),
      } : {}
      return { ...no, attrs: { ...(no.attrs ?? {}), ...extras, alterado: val } }
    }),
  }
}

function contarNosAlterados(doc, mapa = {}) {
  if (!doc?.content) return 0
  return doc.content.filter((no, idx) => {
    const item = mapa[idx]
    const val = typeof item === 'string' ? item : item?.alterado
    return Boolean(val || no?.attrs?.alterado)
  }).length
}

// ─────────────────────────────────────────────────────────────────

function jsonSemAlterado(value) {
  if (Array.isArray(value)) return value.map(jsonSemAlterado)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (key === 'alterado' || key === 'diffType' || key === 'diffSubtype' || key === 'local' || key === 'chamada') continue
      if (key === 'attrs' && val && typeof val === 'object') {
        const attrs = jsonSemAlterado(val)
        if (Object.keys(attrs).length > 0) out[key] = attrs
      } else {
        out[key] = jsonSemAlterado(val)
      }
    }
    return out
  }
  return value
}

function nodeAssinaturaManual(node) {
  return JSON.stringify(jsonSemAlterado(node?.toJSON ? node.toJSON() : node))
}

function lcsAssinaturas(base, atual) {
  const m = base.length
  const n = atual.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = base[i] === atual[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (base[i] === atual[j]) {
      ops.push({ type: 'equal', baseIdx: i, atualIdx: j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', baseIdx: i })
      i++
    } else {
      ops.push({ type: 'insert', atualIdx: j })
      j++
    }
  }
  while (i < m) ops.push({ type: 'delete', baseIdx: i++ })
  while (j < n) ops.push({ type: 'insert', atualIdx: j++ })
  return ops
}

function classificarAlteracoesManuais(base, atual) {
  const ops = lcsAssinaturas(base, atual)
  const resultado = {}
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++
      continue
    }

    const deletes = []
    const inserts = []
    while (i < ops.length && ops[i].type === 'delete') deletes.push(ops[i++])
    while (i < ops.length && ops[i].type === 'insert') inserts.push(ops[i++])

    const pareados = Math.min(deletes.length, inserts.length)
    for (let p = 0; p < pareados; p++) {
      resultado[inserts[p].atualIdx] = 'modified'
    }
    for (let p = pareados; p < inserts.length; p++) {
      resultado[inserts[p].atualIdx] = 'added'
    }
  }
  return resultado
}

function textoMarcadorNotaRodape() {
  return '[nota]'
}

export default function Editor() {
  const { id } = useParams()
  const nav    = useNavigate()

  const fileRef = useRef(null)
  const colagemRef = useRef(null)
  // Mapa { contentIdx → 'modificado' | 'remocaoApos' } atualizado a cada aceite.
  // Usado como fonte autoritativa para injetar flags no JSON exportado/salvo.
  const nodesAlteradosRef = useRef({})

  const [norma,     setNorma]     = useState(null)
  const [fase,      setFase]      = useState('editar')
  const [docJson,   setDocJson]   = useState(null)
  const [inputHtml, setInputHtml] = useState('')
  const [nomeArq,   setNomeArq]   = useState('')
  const [autoExecutarRotinas, setAutoExecutarRotinas] = useState(0)
  const [excecoes,  setExcecoes]  = useState([])
  const [editor,    setEditor]    = useState(null)
  const [salvando,  setSalvando]  = useState(false)
  const [abaEsq,    setAbaEsq]    = useState('rotinas')
  const [status,           setStatus]           = useState('rascunho')
  const [modificado,       setModificado]       = useState(false)
  const [modoEdicaoManual, setModoEdicaoManual] = useState(false)
  const [buscaAberta,      setBuscaAberta]      = useState(false)
  const [notasAberto,      setNotasAberto]      = useState(false)
  const [excecoesAberto,   setExcecoesAberto]   = useState(false)
  const [modalPadronizacao, setModalPadronizacao] = useState(false)
  const [abaPadronizacao, setAbaPadronizacao] = useState('palavras')
  const [gruposPadronizacaoAbertos, setGruposPadronizacaoAbertos] = useState({})
  const [substituicoesPadronizacao, setSubstituicoesPadronizacao] = useState({})
  const [hiddenCharsAtivo, setHiddenCharsAtivo] = useState(false)
  const [styleIndicatorsAtivo, setStyleIndicatorsAtivo] = useState(false)
  const [spellcheckAtivo, setSpellcheckAtivo] = useState(true)
  const [zoom,             setZoom]             = useState(1)
  const [irArtigoInput,    setIrArtigoInput]    = useState('')
  const [irArtigoErro,     setIrArtigoErro]     = useState(false)
  const irArtigoRef = useRef(null)

  // ── Estados de revisão ────────────────────────────────────────
  const [modalAtualizarAberto,  setModalAtualizarAberto]  = useState(false)
  const [modalEditarMeta,       setModalEditarMeta]       = useState(false)
  const [modalNotaRodape,       setModalNotaRodape]       = useState(false)
  const [modalColarTexto,       setModalColarTexto]       = useState(false)
  const [modalClassesHtml,      setModalClassesHtml]      = useState(null)
  const [colagemTemConteudo,    setColagemTemConteudo]    = useState(false)
  const [notaRodapeForm,        setNotaRodapeForm]        = useState({ chamada: '1', texto: '' })
  const [editForm,              setEditForm]              = useState({
    tipo: '',
    epigrafe: '',
    apelido: '',
    ementa: '',
    dados_publicacao: '',
    data_ultima_alteracao: '',
    atualizacao_pendente: false,
    vigencia: 'Vigente',
    link_acesso: '',
    anexo: '',
    observacoes: '',
  })
  const [editTags,              setEditTags]              = useState([])
  const [editTagInput,          setEditTagInput]          = useState('')
  const [editTagSugestoes,      setEditTagSugestoes]      = useState([])
  const [todasTags,             setTodasTags]             = useState([])
  const [editSalvando,          setEditSalvando]          = useState(false)
  const [editErro,              setEditErro]              = useState('')
  const [emRevisao,    setEmRevisao]    = useState(false)
  const [diffs,        setDiffs]        = useState([])
  const [currDiffIdx,  setCurrDiffIdx]  = useState(-1)
  const [docAnterior,  setDocAnterior]  = useState(null)
  const [abaRevisao,   setAbaRevisao]   = useState('texto')  // 'texto' | 'formatacao'
  const notaRodapeSelectionRef = useRef(null)
  const manualBaselineRef = useRef([])
  const manualTrackingRef = useRef(false)
  const ocorrenciasPadronizacao = modalPadronizacao
    ? coletarOcorrenciasPadronizacao(editor, abaPadronizacao)
    : []
  const gruposPadronizacao = agruparOcorrenciasPadronizacao(ocorrenciasPadronizacao)
  const padronizacaoPodeSubstituir = modoEdicaoManual || emRevisao

  // ── Carga inicial ─────────────────────────────────────────────
  useEffect(() => {
    window.legislator.normas.buscar(parseInt(id)).then(n => {
      setNorma(n)
      setStatus(n.status ?? 'rascunho')
      setFase('editar')
      setModoEdicaoManual(false)
      if (n.conteudo_doc && n.conteudo_doc !== DOC_VAZIO) {
        setDocJson(JSON.parse(n.conteudo_doc))
        setAbaEsq('sumario')
      }
    })
  }, [id])

  // ── Atalhos de teclado globais ────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'f' && fase === 'editar' && !emRevisao) {
        e.preventDefault()
        setBuscaAberta(a => !a)
        return
      }
      if (fase === 'editar' && !emRevisao) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          setZoom(z => Math.min(+(z + 0.1).toFixed(1), 2.0))
        } else if (e.key === '-') {
          e.preventDefault()
          setZoom(z => Math.max(+(z - 0.1).toFixed(1), 0.5))
        } else if (e.key === '0') {
          e.preventDefault()
          setZoom(1)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [fase, emRevisao])

  // ── Detectar modificações não salvas ──────────────────────────
  useEffect(() => {
    if (!editor) return
    const handler = () => setModificado(true)
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor])

  function iniciarEdicaoManual() {
    setModalAtualizarAberto(false)
    setModoEdicaoManual(true)
    if (!editor) return
    manualBaselineRef.current = []
    editor.state.doc.forEach(node => {
      manualBaselineRef.current.push(nodeAssinaturaManual(node))
    })
    editor.setEditable(true)
    setTimeout(() => {
      try {
        editor.setEditable(true)
        editor.commands.focus('end')
      } catch {}
    }, 0)
  }

  function marcarAlteracoesManuais() {
    if (!editor || manualTrackingRef.current) return
    manualTrackingRef.current = true
    try {
      var tr = editor.state.tr
      var changed = false
      const atuais = []
      const posicoes = []
      editor.state.doc.forEach((node, offset) => {
        atuais.push(nodeAssinaturaManual(node))
        posicoes.push({ node, offset })
      })
      const classificados = classificarAlteracoesManuais(manualBaselineRef.current, atuais)
      for (const [idxTexto, diffType] of Object.entries(classificados)) {
        const idx = Number(idxTexto)
        const alvo = posicoes[idx]
        if (!alvo) continue
        if (alvo.node.attrs?.alterado === 'modificado' && alvo.node.attrs?.diffType === diffType) continue
        try {
          tr = tr.setNodeMarkup(alvo.offset, null, {
            ...alvo.node.attrs,
            alterado: 'modificado',
            diffType,
          })
          changed = true
        } catch {}
      }
      if (changed) {
        tr = tr.setMeta('addToHistory', false)
        editor.view.dispatch(tr)
        nodesAlteradosRef.current = {}
        editor.state.doc.forEach((node, _offset, index) => {
          if (node.attrs?.alterado === 'modificado') {
            nodesAlteradosRef.current[index] = {
              alterado: 'modificado',
              diffType: node.attrs?.diffType || 'modified',
            }
          } else if (node.attrs?.alterado === 'remocaoApos') {
            nodesAlteradosRef.current[index] = {
              alterado: 'remocaoApos',
              diffType: 'removed',
            }
          }
        })
      }
    } finally {
      manualTrackingRef.current = false
    }
  }

  useEffect(() => {
    if (!editor || !modoEdicaoManual) return
    const handler = () => marcarAlteracoesManuais()
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor, modoEdicaoManual])

  // ── Aviso ao fechar a janela/app com modificações pendentes ───
  useEffect(() => {
    const handler = e => {
      if (!modificado) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [modificado])

  // ── Ir para artigo ────────────────────────────────────────────
  function irParaArtigo() {
    if (!editor || !irArtigoInput.trim()) return
    // Aceita "5", "10-A", "1001", "1.001" e variações com símbolo ordinal.
    const norm = normalizarNumeroArtigoBusca(irArtigoInput)
    if (!norm) { setIrArtigoErro(true); return }

    let found = false
    editor.state.doc.forEach((node, offset) => {
      if (found) return
      const tipo = node.type.name
      if (tipo !== 'artigo' && tipo !== 'artigoTitulo') return

      const texto = node.textContent || ''
      // Casa tanto "Art. 5º" quanto "Art. 1.001" e "Artigo 5" (artigoTitulo).
      const numeroArtigoRe = /((?:\d{1,3}(?:\.\d{3})+|\d+)[ºª°]?(?:-[A-Za-z])?)/
      const m = texto.match(new RegExp('^Arts?\\.\\s*' + numeroArtigoRe.source))
             || texto.match(new RegExp('^Artigos?\\s+' + numeroArtigoRe.source, 'i'))
      if (!m) return

      const artigoNorm = normalizarNumeroArtigoBusca(m[1])
      if (artigoNorm !== norm) return

      found = true
      const pos = offset + 1
      try {
        editor.commands.setTextSelection(pos)
        const { node: domNode } = editor.view.domAtPos(pos)
        const el = domNode?.nodeType === 3 /* TEXT_NODE */
          ? domNode.parentElement
          : domNode
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } catch {
        editor.commands.scrollIntoView()
      }
    })

    setIrArtigoErro(!found)
  }

  // ── Upload de DOCX ────────────────────────────────────────────
  function abrirNotaRodape() {
    if (!editor) return
    const { from, to } = editor.state.selection
    notaRodapeSelectionRef.current = { from, to }
    setNotaRodapeForm({
      chamada: '',
      texto: '',
    })
    setModalNotaRodape(true)
  }

  function localizarBlocoExcecao(exc) {
    if (!editor || !exc) return null
    let linhaAtual = 0
    let bloco = null

    editor.state.doc.forEach((node, offset) => {
      if (bloco) return
      if (node.type?.name === 'table') return
      linhaAtual++
      if (linhaAtual !== exc.linha) return
      bloco = {
        node,
        from: offset + 1,
        to: offset + node.nodeSize - 1,
      }
    })

    return bloco
  }

  function posicaoDocPorOffsetTexto(bloco, offsetTexto) {
    if (!editor || !bloco) return null
    const alvo = Math.max(0, Number(offsetTexto) || 0)
    let acumulado = 0
    let posicao = null

    editor.state.doc.descendants((node, pos) => {
      if (posicao != null) return false
      if (pos < bloco.from || pos > bloco.to) return true

      if (node.isText && node.text) {
        const len = node.text.length
        if (alvo <= acumulado + len) {
          posicao = pos + Math.max(0, alvo - acumulado)
          return false
        }
        acumulado += len
        return false
      }

      if (node.type?.name === 'hardBreak') {
        if (alvo <= acumulado + 1) {
          posicao = pos
          return false
        }
        acumulado += 1
        return false
      }

      return true
    })

    return posicao ?? bloco.to
  }

  function localizarExcecaoNoEditor(exc) {
    const bloco = localizarBlocoExcecao(exc)
    if (!bloco) return exc

    const texto = bloco.node.textContent || ''
    let inicio = Number.isFinite(exc.alvoInicio) ? exc.alvoInicio : null
    let fim = Number.isFinite(exc.alvoFim) ? exc.alvoFim : null

    if (inicio == null || fim == null || inicio < 0 || fim <= inicio || inicio > texto.length) {
      const alvo = exc.alvoTexto || exc.texto || ''
      const idx = alvo ? texto.indexOf(alvo) : -1
      inicio = idx >= 0 ? idx : 0
      fim = idx >= 0 ? idx + alvo.length : Math.min(texto.length, 80)
    }

    const from = posicaoDocPorOffsetTexto(bloco, inicio)
    const to = posicaoDocPorOffsetTexto(bloco, fim)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return exc

    return { ...exc, from, to }
  }

  function receberExcecoesDetectadas(lista = []) {
    const normalizadas = (Array.isArray(lista) ? lista : []).map(localizarExcecaoNoEditor)
    setExcecoes(normalizadas)
    const temPendentes = normalizadas.some(exc => !exc.resolvida)
    setExcecoesAberto(temPendentes)
    if (temPendentes) setNotasAberto(false)
    return temPendentes
  }

  function rodarExcecoesDoTopo() {
    if (!editor) return
    const resultado = detectarExcecoes(tiptapDocParaLinhasExcecoes(editor.getJSON()))
    const temPendentes = receberExcecoesDetectadas(resultado.excecoes)
    if (!temPendentes) alert('Nenhuma exceção encontrada.')
  }

  function limparExcecoesDetectadas() {
    setExcecoes([])
    setExcecoesAberto(false)
  }

  function inserirNotaRodape(e) {
    e.preventDefault()
    if (!editor) return
    const texto = notaRodapeForm.texto.trim()
    if (!texto) {
      alert('Informe o texto da nota de rodape.')
      return
    }

    const selection = notaRodapeSelectionRef.current || editor.state.selection
    const marker = textoMarcadorNotaRodape()
    editor
      .chain()
      .focus()
      .setTextSelection(selection)
      .insertContent({
        type: 'text',
        text: marker,
        marks: [{ type: 'notaRodape', attrs: { texto } }],
      })
      .run()

    setModalNotaRodape(false)
    setNotaRodapeForm({ chamada: '1', texto: '' })
    notaRodapeSelectionRef.current = null
    setModificado(true)
  }

  function alterarStatusNorma(novoStatus) {
    setStatus(atual => {
      if (atual === novoStatus) return atual
      setModificado(true)
      return novoStatus
    })
  }

  function irParaOcorrenciaPadronizacao(ocorrencia) {
    if (!editor || !ocorrencia) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from: ocorrencia.from, to: ocorrencia.to })
      .scrollIntoView()
      .run()
  }

  function trocarAbaPadronizacao(abaId) {
    setAbaPadronizacao(abaId)
    setGruposPadronizacaoAbertos({})
  }

  function alternarGrupoPadronizacao(chave) {
    setGruposPadronizacaoAbertos(prev => ({
      ...prev,
      [chave]: !prev[chave],
    }))
  }

  function substituirGrupoPadronizacao(grupo) {
    if (!padronizacaoPodeSubstituir) return
    if (!editor || !grupo) return
    const substituicao = substituicoesPadronizacao[grupo.chave] ?? ''
    if (!substituicao) return

    const ocorrencias = grupo.ocorrencias
      .slice()
      .sort((a, b) => b.from - a.from)

    let tr = editor.state.tr
    for (const ocorrencia of ocorrencias) {
      const $from = tr.doc.resolve(ocorrencia.from)
      const nodeAfter = $from.nodeAfter
      const marks = nodeAfter && nodeAfter.isText ? nodeAfter.marks : $from.marks()
      tr = tr.replaceWith(ocorrencia.from, ocorrencia.to, editor.state.schema.text(substituicao, marks))
    }

    editor.view.dispatch(tr)
    editor.view.focus()
    setModificado(true)
    setSubstituicoesPadronizacao(prev => {
      const next = { ...prev }
      delete next[grupo.chave]
      return next
    })
    setGruposPadronizacaoAbertos(prev => {
      const next = { ...prev }
      delete next[grupo.chave]
      return next
    })
  }

  function estilosDisponiveisParaMapeamentoHtml() {
    return estilosParagrafoConfigurados({ incluirInternos: false })
      .filter(estilo => estiloAtivoNoTipo(estilo, norma?.tipo))
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
  }

  function aplicarDocumentoHtmlImportado(doc, nomeArquivo) {
    setDocJson(doc)
    editor?.commands.setContent(doc, false)
    setInputHtml('')
    setNomeArq(nomeArquivo)
    limparExcecoesDetectadas()
    setFase('editar')
    setAbaEsq('sumario')
    setModificado(true)
  }

  function importarHtmlComMapeamento(html, nomeArquivo, blockClassMap = {}) {
    const doc = htmlInDesignParaTiptap(html, { blockClassMap })
    aplicarDocumentoHtmlImportado(doc, nomeArquivo)
  }

  function atualizarMapeamentoClasseHtml(classe, valor) {
    setModalClassesHtml(prev => {
      if (!prev) return prev
      return {
        ...prev,
        mapeamentos: {
          ...prev.mapeamentos,
          [classe]: valor,
        },
      }
    })
  }

  function confirmarImportacaoHtmlMapeada() {
    if (!modalClassesHtml) return
    const blockClassMap = {}
    for (const item of modalClassesHtml.ocorrencias) {
      const valor = modalClassesHtml.mapeamentos[item.classe]
      if (valor) blockClassMap[item.classe] = valor
    }

    try {
      importarHtmlComMapeamento(
        modalClassesHtml.html,
        modalClassesHtml.nomeArquivo,
        blockClassMap,
      )
      setModalClassesHtml(null)
    } catch (err) {
      alert(String(err?.message || err))
    }
  }

  async function handleArquivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      if (/\.xml$/i.test(file.name)) {
        const xml = await file.text()
        const doc = xmlParaTiptap(xml)
        setDocJson(doc)
        editor?.commands.setContent(doc, false)
        setInputHtml('')
        setNomeArq(file.name)
        limparExcecoesDetectadas()
        setFase('editar')
        setAbaEsq('rotinas')
        setModificado(true)
      } else if (/\.html?$/i.test(file.name)) {
        const html = await file.text()
        const ocorrencias = analisarClassesHtmlInDesign(html)
        if (ocorrencias.length) {
          setModalClassesHtml({
            html,
            nomeArquivo: file.name,
            ocorrencias,
            mapeamentos: {},
          })
          return
        }
        importarHtmlComMapeamento(html, file.name)
      } else {
        const arrayBuffer = await file.arrayBuffer()
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
        setInputHtml(html)
        setNomeArq(file.name)
        limparExcecoesDetectadas()
        setFase('editar')
        setAbaEsq('rotinas')
        setAutoExecutarRotinas(valor => valor + 1)
      }
    } catch (err) {
      alert(String(err?.message || err))
    } finally {
      e.target.value = ''
    }
  }

  // ── Salvar ────────────────────────────────────────────────────
  function abrirColagemInternet() {
    setModalColarTexto(true)
    setColagemTemConteudo(false)
    window.setTimeout(() => {
      if (!colagemRef.current) return
      colagemRef.current.innerHTML = ''
      colagemRef.current.focus()
    }, 0)
  }

  function colarTextoInternet(e) {
    e.preventDefault()
    const html = e.clipboardData?.getData('text/html') || ''
    const textoPuro = e.clipboardData?.getData('text/plain') || ''
    const limpo = limparHtmlInternet(html, textoPuro)

    if (!colagemRef.current) return
    colagemRef.current.innerHTML = limpo
    setColagemTemConteudo(Boolean(colagemRef.current.textContent?.trim()))
  }

  function confirmarColagemInternet() {
    if (!colagemRef.current) return
    const limpo = limparHtmlInternet(
      colagemRef.current.innerHTML,
      colagemRef.current.innerText,
    )
    if (!colagemRef.current.textContent?.trim()) return

    setInputHtml(limpo)
    setNomeArq('Texto colado da internet')
    limparExcecoesDetectadas()
    setFase('editar')
    setAbaEsq('rotinas')
    setModalColarTexto(false)
    setAutoExecutarRotinas(valor => valor + 1)
  }

  const handleSalvar = useCallback(async (opts = {}) => {
    if (!editor) return
    setSalvando(true)
    try {
      const doc = aplicarFlagsNoJSON(editor.getJSON(), nodesAlteradosRef.current)
      const txt = editor.getText()
      const payload = {
        conteudo_doc: JSON.stringify(doc),
        conteudo_txt: txt,
        status,
      }
      if (opts.data_atualizacao) payload.data_atualizacao = opts.data_atualizacao
      await window.legislator.normas.salvar(parseInt(id), payload)
      if (excecoes.length) {
        await window.legislator.excecoes.salvar(parseInt(id), excecoes)
      }
      setModificado(false)
    } catch (err) {
      alert(err?.message || 'Não foi possível salvar a norma.')
    } finally {
      setSalvando(false)
    }
  }, [editor, id, excecoes, status])

  // ── Editar metadados ──────────────────────────────────────────
  async function abrirEditarMeta() {
    setEditForm({
      tipo:     norma.tipo     ?? '',
      epigrafe: norma.epigrafe ?? '',
      apelido:  norma.apelido  ?? '',
      ementa:   norma.ementa   ?? '',
      dados_publicacao: norma.dados_publicacao ?? '',
      data_ultima_alteracao: norma.data_ultima_alteracao ?? '',
      atualizacao_pendente: Boolean(norma.atualizacao_pendente),
      vigencia: norma.vigencia ?? 'Vigente',
      link_acesso: norma.link_acesso ?? '',
      anexo: norma.anexo ?? '',
      observacoes: norma.observacoes ?? '',
    })
    setEditTags(norma.tags ?? [])
    setEditTagInput('')
    setEditTagSugestoes([])
    setEditErro('')
    setModalEditarMeta(true)
    try {
      const todas = await window.legislator.normas.tags()
      setTodasTags(todas)
    } catch {
      setTodasTags([])
    }
  }

  async function salvarMeta(e) {
    e.preventDefault()
    if (!editForm.epigrafe.trim()) { setEditErro('A epígrafe é obrigatória.'); return }
    setEditSalvando(true)
    setEditErro('')
    try {
      const atualizada = await window.legislator.normas.atualizarMeta(parseInt(id), { ...editForm, tags: editTags })
      setNorma(atualizada)
      setModalEditarMeta(false)
    } catch (err) {
      setEditErro(err.message || 'Erro ao salvar.')
    } finally {
      setEditSalvando(false)
    }
  }

  // ── Exportar ──────────────────────────────────────────────────
  function nomeBaseNorma(sufixo = '') {
    const base = norma?.epigrafe
      ? norma.epigrafe.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
      : `norma-${id}`
    return sufixo ? `${base}-${sufixo}` : base
  }

  function exportacaoBloqueadaPorAtualizacaoPendente() {
    if (!norma?.atualizacao_pendente) return false
    alert('Esta norma está com Atualização pendente. A exportação fica bloqueada até essa marcação ser removida nos dados da norma.')
    return true
  }

  function docJsonDaSelecao() {
    if (!editor) return null
    const { state } = editor
    const { selection } = state
    if (!selection || selection.empty) return null

    const slice = selection.content()
    try {
      const node = state.schema.topNodeType.createAndFill(null, slice.content)
      const json = node?.toJSON()
      if (json?.content?.length) return json
    } catch {}

    let content = slice.content?.toJSON?.() ?? []
    if (!Array.isArray(content)) content = content ? [content] : []
    if (!content.length) return null

    const hasOnlyBlocks = content.every(no => EXPORTABLE_BLOCK_TYPES.has(no?.type))
    if (hasOnlyBlocks) return { type: 'doc', content }

    const parent = selection.$from.parent
    return {
      type: 'doc',
      content: [{
        type: parent?.type?.name || 'paragrafLei',
        attrs: parent?.attrs ?? {},
        content,
      }],
    }
  }

  async function handleExportar(formato) {
    try {
      if (exportacaoBloqueadaPorAtualizacaoPendente()) return

      if (formato === 'xml-completo') {
        if (!editor) return
        baixarXml(editor.getJSON(), { tipo: norma.tipo, epigrafe: norma.epigrafe }, nomeBaseNorma(), {
          modo: 'completo',
          incluirAlterado: false,
        })
        return
      }
      if (formato === 'xml-legacy') {
        if (!editor) return
        const doc = aplicarFlagsNoJSON(editor.getJSON(), nodesAlteradosRef.current)
        baixarXml(doc, { tipo: norma.tipo, epigrafe: norma.epigrafe }, nomeBaseNorma('legacy'), {
          modo: 'legacy',
          incluirAlterado: true,
        })
        return
      }
      if (formato === 'xml-atualizacao') {
        if (!editor) return
        const doc = aplicarFlagsNoJSON(editor.getJSON(), nodesAlteradosRef.current)
        if (!contarNosAlterados(doc, nodesAlteradosRef.current)) {
          alert('Nao ha paragrafos marcados como alterados para exportar a atualizacao.')
          return
        }
        baixarXml(doc, { tipo: norma.tipo, epigrafe: norma.epigrafe }, nomeBaseNorma('atualizacao'), {
          modo: 'atualizacao',
          alteracoes: nodesAlteradosRef.current,
          diffs,
        })
        return
      }
      await handleSalvar()
      if (formato === 'docx') await window.legislator.exportar.docx(parseInt(id))
      if (formato === 'html') await window.legislator.exportar.html(parseInt(id))
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar a norma.')
    }
  }

  async function handleExportarSelecao(formato) {
    try {
      if (exportacaoBloqueadaPorAtualizacaoPendente()) return

      const doc = docJsonDaSelecao()
      if (!doc) {
        alert('Selecione um trecho da norma antes de exportar a seleção.')
        return
      }

      const nomeBase = nomeBaseNorma('selecao')
      const payload = {
        norma_id: parseInt(id),
        epigrafe: norma.epigrafe,
        nomeBase,
        conteudo_doc: JSON.stringify(doc),
      }

      if (formato === 'xml') {
        baixarXml(doc, { tipo: norma.tipo, epigrafe: norma.epigrafe }, nomeBase)
        return
      }
      if (formato === 'docx') await window.legislator.exportar.docxSelecao(payload)
      if (formato === 'html') await window.legislator.exportar.htmlSelecao(payload)
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar a seleção.')
    }
  }

  // ── Revisão: iniciar ──────────────────────────────────────────
  function onIniciarRevisao(mergedDoc, novoDiffs) {
    if (!editor) return
    setDocAnterior(editor.getJSON())
    setModalAtualizarAberto(false)
    editor.commands.setContent(mergedDoc)
    editor.commands.setDiffDecorations(novoDiffs)
    setDiffs(novoDiffs)
    setAbaRevisao('texto')
    const primeiro = novoDiffs.findIndex(d => !d.resolved && d.subtype === 'text')
    setCurrDiffIdx(primeiro >= 0 ? primeiro : novoDiffs.findIndex(d => !d.resolved))
    setEmRevisao(true)
    if (primeiro >= 0) {
      setTimeout(() => scrollParaDiff(novoDiffs, primeiro, editor), 150)
    }
  }

  // ── Revisão: aceitar diff atual ───────────────────────────────
  function aceitarDiff() {
    if (!editor || currDiffIdx < 0) return
    const diff = diffs[currDiffIdx]
    if (!diff || diff.resolved) return

    let newDiffs = diffs.map((d, i) => i === currDiffIdx ? { ...d, resolved: true } : d)

    if (diff.type === 'removed') {
      // Aceitar remoção = excluir o nó do documento; parágrafo anterior recebe flag
      const prevIdx = diff.contentIdx - 1
      const info = getNodeInfo(editor.state.doc, diff.contentIdx)
      if (info) {
        if (prevIdx >= 0) {
          marcarNodoAlterado(editor, prevIdx, 'remocaoApos', { diffType: 'removed' })
          nodesAlteradosRef.current[prevIdx] = { alterado: 'remocaoApos', diffType: 'removed' }
        }
        const { tr } = editor.state
        tr.delete(info.offset, info.offset + info.size)
        editor.view.dispatch(tr)
        newDiffs = shiftIdxAfterDelete(newDiffs, diff.contentIdx)
        nodesAlteradosRef.current = shiftNodesAlterados(nodesAlteradosRef.current, diff.contentIdx)
      }
    } else {
      // 'added' ou 'modified': o nó já contém o conteúdo novo — marca como alterado
      marcarNodoAlterado(editor, diff.contentIdx, 'modificado', { diffType: diff.type, diffSubtype: diff.subtype })
      nodesAlteradosRef.current[diff.contentIdx] = { alterado: 'modificado', diffType: diff.type, subtype: diff.subtype }
    }

    const next = proximoNaoResolvido(newDiffs, currDiffIdx, diff.subtype)
    setDiffs(newDiffs)
    setCurrDiffIdx(next)
    editor.commands.setDiffDecorations(newDiffs)
    if (next >= 0) setTimeout(() => scrollParaDiff(newDiffs, next, editor), 50)
  }

  // ── Revisão: recusar diff atual ───────────────────────────────
  function recusarDiff() {
    if (!editor || currDiffIdx < 0) return
    const diff = diffs[currDiffIdx]
    if (!diff || diff.resolved) return

    let newDiffs = diffs.map((d, i) => i === currDiffIdx ? { ...d, resolved: true } : d)

    if (diff.type === 'added') {
      // Recusar adição = excluir o nó adicionado
      const info = getNodeInfo(editor.state.doc, diff.contentIdx)
      if (info) {
        const { tr } = editor.state
        tr.delete(info.offset, info.offset + info.size)
        editor.view.dispatch(tr)
        newDiffs = shiftIdxAfterDelete(newDiffs, diff.contentIdx)
      }
    } else if (diff.type === 'modified') {
      // Recusar modificação = restaurar o nó original
      const info = getNodeInfo(editor.state.doc, diff.contentIdx)
      if (info && diff.oldNode) {
        try {
          const { tr } = editor.state
          const oldPMNode = editor.state.schema.nodeFromJSON(diff.oldNode)
          tr.replaceWith(info.offset, info.offset + info.size, oldPMNode)
          editor.view.dispatch(tr)
        } catch (err) {
          console.warn('Erro ao restaurar nó antigo:', err)
        }
      }
    }
    // Para 'removed': o nó já está no doc — só marca resolvido

    const next = proximoNaoResolvido(newDiffs, currDiffIdx, diff.subtype)
    setDiffs(newDiffs)
    setCurrDiffIdx(next)
    editor.commands.setDiffDecorations(newDiffs)
    if (next >= 0) setTimeout(() => scrollParaDiff(newDiffs, next, editor), 50)
  }

  // ── Revisão: aceitar todos os diffs da aba ativa ─────────────
  function aceitarTodos() {
    if (!editor) return
    const subtype = abaRevisao === 'texto' ? 'text' : 'format'

    // Processa de trás para frente (maior contentIdx primeiro) para não
    // deslocar os índices dos nós ainda não processados
    const pendentes = diffs
      .filter(d => !d.resolved && d.subtype === subtype)
      .sort((a, b) => b.contentIdx - a.contentIdx)

    if (pendentes.length === 0) return

    let newDiffs = diffs.map(d =>
      !d.resolved && d.subtype === subtype ? { ...d, resolved: true } : d
    )

    for (const d of pendentes) {
      if (d.type === 'removed') {
        // Aceitar remoção = excluir o nó do documento; parágrafo anterior recebe flag
        const prevIdx = d.contentIdx - 1
        if (prevIdx >= 0) {
          marcarNodoAlterado(editor, prevIdx, 'remocaoApos', { diffType: 'removed' })
          nodesAlteradosRef.current[prevIdx] = { alterado: 'remocaoApos', diffType: 'removed' }
        }
        const info = getNodeInfo(editor.state.doc, d.contentIdx)
        if (info) {
          const { tr } = editor.state
          tr.delete(info.offset, info.offset + info.size)
          editor.view.dispatch(tr)
          newDiffs = shiftIdxAfterDelete(newDiffs, d.contentIdx)
          nodesAlteradosRef.current = shiftNodesAlterados(nodesAlteradosRef.current, d.contentIdx)
        }
      } else {
        // 'added' ou 'modified': novo conteúdo já está no doc — marca como alterado
        marcarNodoAlterado(editor, d.contentIdx, 'modificado', { diffType: d.type, diffSubtype: d.subtype })
        nodesAlteradosRef.current[d.contentIdx] = { alterado: 'modificado', diffType: d.type, subtype: d.subtype }
      }
    }

    setDiffs(newDiffs)
    setCurrDiffIdx(-1)
    editor.commands.setDiffDecorations(newDiffs)
  }

  // ── Revisão: recusar todos os diffs da aba ativa ──────────────
  function recusarTodos() {
    if (!editor) return
    const subtype = abaRevisao === 'texto' ? 'text' : 'format'

    const pendentes = diffs
      .filter(d => !d.resolved && d.subtype === subtype)
      .sort((a, b) => b.contentIdx - a.contentIdx)

    if (pendentes.length === 0) return

    let newDiffs = diffs.map(d =>
      !d.resolved && d.subtype === subtype ? { ...d, resolved: true } : d
    )

    for (const d of pendentes) {
      if (d.type === 'added') {
        // Recusar adição = excluir o nó adicionado
        const info = getNodeInfo(editor.state.doc, d.contentIdx)
        if (info) {
          const { tr } = editor.state
          tr.delete(info.offset, info.offset + info.size)
          editor.view.dispatch(tr)
          newDiffs = shiftIdxAfterDelete(newDiffs, d.contentIdx)
        }
      } else if (d.type === 'modified') {
        // Recusar modificação = restaurar o nó original
        const info = getNodeInfo(editor.state.doc, d.contentIdx)
        if (info && d.oldNode) {
          try {
            const { tr } = editor.state
            const oldPMNode = editor.state.schema.nodeFromJSON(d.oldNode)
            tr.replaceWith(info.offset, info.offset + info.size, oldPMNode)
            editor.view.dispatch(tr)
          } catch (err) {
            console.warn('Erro ao restaurar nó antigo:', err)
          }
        }
      }
      // 'removed': nó já está no doc — só marca resolvido
    }

    setDiffs(newDiffs)
    setCurrDiffIdx(-1)
    editor.commands.setDiffDecorations(newDiffs)
  }

  // ── Revisão: navegar entre diffs (dentro da aba ativa) ──────
  function navegarDiff(delta) {
    const subtypeAtivo = abaRevisao === 'texto' ? 'text' : 'format'
    const livres = diffs
      .map((d, i) => ({ d, i }))
      .filter(x => !x.d.resolved && x.d.subtype === subtypeAtivo)
      .map(x => x.i)
    if (livres.length <= 1) return
    const pos = livres.indexOf(currDiffIdx)
    const nextPos = ((pos < 0 ? 0 : pos) + delta + livres.length) % livres.length
    const nextIdx = livres[nextPos]
    setCurrDiffIdx(nextIdx)
    scrollParaDiff(diffs, nextIdx, editor)
    setTimeout(() => flashDiffEl(diffs, nextIdx, editor), 50)
  }

  // ── Revisão: trocar aba e saltar para o 1º diff da aba ───────
  function mudarAbaRevisao(aba) {
    setAbaRevisao(aba)
    const subtype = aba === 'texto' ? 'text' : 'format'
    const primeiro = diffs.findIndex(d => !d.resolved && d.subtype === subtype)
    setCurrDiffIdx(primeiro)
    if (primeiro >= 0) setTimeout(() => scrollParaDiff(diffs, primeiro, editor), 50)
  }

  // ── Revisão: concluir (salva com data_atualizacao) ────────────
  async function concluirRevisao() {
    if (!editor) return
    setSalvando(true)
    try {
      const dataAtual = new Date().toISOString()
      // Aplica flags do ref como fallback (caso setNodeMarkup não tenha persistido)
      const doc = aplicarFlagsNoJSON(editor.getJSON(), nodesAlteradosRef.current)
      const txt = editor.getText()
      await window.legislator.normas.salvar(parseInt(id), {
        conteudo_doc: JSON.stringify(doc),
        conteudo_txt: txt,
        data_atualizacao: dataAtual,
      })
      setNorma(prev => ({ ...prev, data_atualizacao: dataAtual }))
      editor.commands.clearDiffDecorations()
      setEmRevisao(false)
      setModificado(false)
      setDiffs([])
      setCurrDiffIdx(-1)
      setDocAnterior(null)
      nodesAlteradosRef.current = {}
    } finally {
      setSalvando(false)
    }
  }

  // ── Revisão: cancelar (restaura doc anterior) ─────────────────
  function cancelarRevisao() {
    if (!editor) return
    if (docAnterior) editor.commands.setContent(docAnterior)
    editor.commands.clearDiffDecorations()
    setEmRevisao(false)
    setModificado(false)
    setDiffs([])
    setCurrDiffIdx(-1)
    setDocAnterior(null)
    nodesAlteradosRef.current = {}
  }

  // ── Dados derivados para o painel de revisão ──────────────────
  const diffAtual      = currDiffIdx >= 0 ? diffs[currDiffIdx] : null
  const totalDiffs     = diffs.length
  const resolvidosQtd  = diffs.filter(d => d.resolved).length
  const livresQtd      = totalDiffs - resolvidosQtd   // total geral (para o botão Concluir)

  const subtypeAtivo   = abaRevisao === 'texto' ? 'text' : 'format'
  const diffsAtivos    = diffs.filter(d => d.subtype === subtypeAtivo)
  const livresTexto    = diffs.filter(d => d.subtype === 'text'   && !d.resolved).length
  const livresFormato  = diffs.filter(d => d.subtype === 'format' && !d.resolved).length
  const livresAba      = abaRevisao === 'texto' ? livresTexto : livresFormato

  // ── Helpers de tags ───────────────────────────────────────────
  function calcSugestoes(val, tags, todas) {
    const q = val.trim().toLowerCase()
    return todas
      .filter(t => !tags.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 8)
  }

  function onTagInputChange(val) {
    setEditTagInput(val)
    setEditTagSugestoes(calcSugestoes(val, editTags, todasTags))
  }

  function adicionarTag(nome) {
    const nomeTrim = nome.trim()
    if (!nomeTrim || editTags.includes(nomeTrim)) return
    setEditTags(prev => [...prev, nomeTrim])
    setEditTagInput('')
    setEditTagSugestoes([])
  }

  function removerTag(nome) {
    setEditTags(prev => prev.filter(t => t !== nome))
  }

  function onTagKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      adicionarTag(editTagInput)
    } else if (e.key === 'Backspace' && !editTagInput && editTags.length > 0) {
      removerTag(editTags[editTags.length - 1])
    }
  }

  const dataAtualizacaoFormatada = norma?.data_atualizacao
    ? new Date(norma.data_atualizacao).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
    : null

  if (!norma) return <div className="loading">Carregando…</div>

  return (
    <div className="editor-page">

      {/* ── Topbar ───────────────────────────────────────────────── */}
      <header className="editor-topbar">
        <div className="editor-topbar-meta">
          <span className="editor-tipo">{norma.tipo}</span>
          <button
            type="button"
            className="editor-epigrafe editor-epigrafe-btn"
            onClick={abrirEditarMeta}
            title="Editar dados da norma"
          >
            {norma.epigrafe}
          </button>
          {norma.apelido && (
            <span className="editor-apelido" title="Apelido da lei">({norma.apelido})</span>
          )}
          {dataAtualizacaoFormatada && (
            <span className="editor-data-atualizacao" title="Data da última atualização">
              🔄 {dataAtualizacaoFormatada}
            </span>
          )}
          {fase === 'editar' && !emRevisao && (
            <span className={`editor-modo-badge${modoEdicaoManual ? ' editor-modo-edicao' : ''}`}>
              {modoEdicaoManual ? 'Modo de edição' : 'Modo leitura'}
            </span>
          )}
        </div>
        <div className="editor-topbar-controls">
          <div className="editor-controles-esquerda">
            <button
              className="btn-ghost btn-voltar"
              onClick={() => {
                if (modificado && !confirm('Há alterações não salvas. Deseja voltar ao catálogo sem salvar?')) return
                nav('/')
              }}
            >← Catálogo</button>
            {fase === 'editar' && !emRevisao && (
              <div className="editor-titulo-acoes">
                <select
                  className="status-select"
                  value={status}
                  onChange={e => alterarStatusNorma(e.target.value)}
                  title="Status da norma"
                >
                  <option value="rascunho">Rascunho</option>
                  <option value="revisao">Em revisão</option>
                  <option value="finalizado">Finalizado</option>
                </select>
                <button
                  className="btn-ghost btn-atualizar-norma-topo"
                  onClick={() => setModalAtualizarAberto(true)}
                  title="Carregar nova versão da norma e revisar alterações"
                >🔄 Atualizar norma</button>
              </div>
            )}
            {fase === 'editar' && !emRevisao && <>
              <button
                className={`btn-ghost btn-busca${buscaAberta ? ' ativa' : ''}`}
                onClick={() => setBuscaAberta(a => !a)}
                title="Localizar/Substituir (Ctrl+F)"
              >🔍 Buscar</button>
              <div className={`ir-artigo-wrap${irArtigoErro ? ' ir-artigo-erro' : ''}`}>
                <span className="ir-artigo-label">Art.</span>
                <input
                  ref={irArtigoRef}
                  className="ir-artigo-input"
                  type="text"
                  value={irArtigoInput}
                  placeholder="nº"
                  title="Ir para artigo (Enter)"
                  onChange={e => { setIrArtigoInput(e.target.value); setIrArtigoErro(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') irParaArtigo() }}
                />
                <button
                  className="btn-ghost ir-artigo-btn"
                  onClick={irParaArtigo}
                  title="Ir para artigo"
                >→</button>
              </div>
              <button
                className={`btn-ghost btn-padronizacao${modalPadronizacao ? ' ativa' : ''}`}
                onClick={() => setModalPadronizacao(v => !v)}
                title="Verificar pontos de padronização"
              >Padronização</button>
              <button
                className={`btn-ghost btn-hidden-chars${hiddenCharsAtivo ? ' ativa' : ''}`}
                onClick={() => {
                  if (!editor) return
                  editor.commands.toggleHiddenChars()
                  setHiddenCharsAtivo(!!editor.storage.hiddenChars?.active)
                }}
                title="Exibir caracteres ocultos (¶ · ↵)"
              >¶</button>
              <button
                className={`btn-ghost btn-style-indicators${styleIndicatorsAtivo ? ' ativa' : ''}`}
                onClick={() => setStyleIndicatorsAtivo(v => !v)}
                title="Exibir indicadores de estilo de parágrafo"
              >¶→</button>
              <button
                className={`btn-ghost btn-notas${notasAberto ? ' ativa' : ''}`}
                onClick={() => { setNotasAberto(v => !v); setExcecoesAberto(false) }}
                title="Navegador de notas"
              >Ver notas</button>
              <button
                className="btn-ghost btn-nota-rodape"
                onClick={abrirNotaRodape}
                disabled={!modoEdicaoManual}
                title="Inserir nota de rodape"
              >+ Nota de rodapé</button>
              <button
                className={`btn-ghost btn-excecoes${excecoesAberto ? ' ativa' : ''}`}
                onClick={rodarExcecoesDoTopo}
                title="Executar rotina de exceções e navegar pelos resultados"
              >Exceções</button>
            </>}
            {emRevisao && (
              <span className="revisao-modo-label">🔍 Modo revisão</span>
            )}
          </div>
          <div className="editor-acoes">

          {/* Ações principais à direita */}
          {fase === 'editar' && !emRevisao && <>
            <div className="zoom-controle">
              <button
                className="btn-ghost zoom-btn"
                onClick={() => setZoom(z => Math.max(+(z - 0.1).toFixed(1), 0.5))}
                title="Reduzir zoom (Ctrl+−)"
                disabled={zoom <= 0.5}
              >−</button>
              <button
                className={`zoom-label${zoom !== 1 ? ' zoom-alterado' : ''}`}
                onClick={() => setZoom(1)}
                title="Restaurar zoom (Ctrl+0)"
              >{Math.round(zoom * 100)}%</button>
              <button
                className="btn-ghost zoom-btn"
                onClick={() => setZoom(z => Math.min(+(z + 0.1).toFixed(1), 2.0))}
                title="Aumentar zoom (Ctrl+=)"
                disabled={zoom >= 2.0}
              >+</button>
            </div>
            <div className="dropdown">
              <button className="btn-ghost">⬇ Exportar ▾</button>
              <div className="dropdown-menu">
                <button onClick={() => handleExportar('docx')}>DOCX (Word)</button>
                <button onClick={() => handleExportar('html')}>HTML com tags</button>
                <button onClick={() => handleExportar('xml-completo')}>XML completo</button>
                <button onClick={() => handleExportar('xml-legacy')}>XML (legacy)</button>
                <button onClick={() => handleExportar('xml-atualizacao')}>XML de atualizacao</button>
                <button onClick={() => handleExportarSelecao('docx')}>DOCX da seleção</button>
                <button onClick={() => handleExportarSelecao('html')}>HTML da seleção</button>
                <button onClick={() => handleExportarSelecao('xml')}>XML da seleção</button>
              </div>
            </div>
            <button className={`btn-primary${modificado ? ' btn-salvar-modificado' : ''}`} onClick={handleSalvar} disabled={salvando}>
              {salvando ? 'Salvando…' : '💾 Salvar'}
            </button>
          </>}

          </div>
        </div>
      </header>

      {/* ── Layout principal ─────────────────────────────────────── */}
      {fase === 'editar' && (
        <div className={`editor-layout${emRevisao ? ' editor-layout-revisao' : ''}`}>

          {/* ── Painel de alterações (esquerda, em modo revisão) ──── */}
          {emRevisao && (
            <aside className="painel-revisao">

              {/* Cabeçalho */}
              <div className="painel-revisao-topo">
                <span className="painel-revisao-titulo">Alterações</span>
                <span className="painel-revisao-contador">
                  {resolvidosQtd}/{totalDiffs}
                </span>
              </div>

              {/* Abas: Texto / Formatação */}
              <div className="painel-revisao-abas">
                <button
                  className={`painel-revisao-aba${abaRevisao === 'texto' ? ' ativa' : ''}`}
                  onClick={() => mudarAbaRevisao('texto')}
                >
                  Texto
                  {livresTexto > 0 && (
                    <span className="painel-revisao-aba-badge">{livresTexto}</span>
                  )}
                </button>
                <button
                  className={`painel-revisao-aba${abaRevisao === 'formatacao' ? ' ativa' : ''}`}
                  onClick={() => mudarAbaRevisao('formatacao')}
                >
                  Formatação
                  {livresFormato > 0 && (
                    <span className="painel-revisao-aba-badge">{livresFormato}</span>
                  )}
                </button>
              </div>

              {/* Navegação e ação do diff atual */}
              <div className="painel-revisao-controles">
                <div className="painel-revisao-nav">
                  <button
                    className="btn-ghost btn-nav-diff"
                    onClick={() => navegarDiff(-1)}
                    disabled={livresAba <= 1}
                    title="Diferença anterior"
                  >← Anterior</button>
                  <button
                    className="btn-ghost btn-nav-diff"
                    onClick={() => navegarDiff(1)}
                    disabled={livresAba <= 1}
                    title="Próxima diferença"
                  >Próxima →</button>
                </div>

                {diffAtual && !diffAtual.resolved ? (
                  <div className="painel-revisao-card">
                    <span className={`diff-badge diff-badge-${diffAtual.type}`}>
                      {TIPO_LABEL[diffAtual.type]}
                    </span>

                    {/* Modificado: diff inline palavra a palavra */}
                    {diffAtual.type === 'modified' && (() => {
                      const ops = diffWords(diffAtual.oldText ?? '', diffAtual.newText ?? '')
                      return (
                        <>
                          <div className="painel-revisao-old">
                            <span className="painel-revisao-label">Antes</span>
                            <p>
                              {ops.filter(o => o.type !== 'added').map((o, i) =>
                                o.type === 'removed'
                                  ? <mark key={i} className="diff-mark-removed">{o.text}</mark>
                                  : <span key={i}>{o.text}</span>
                              )}
                            </p>
                          </div>
                          <div className="painel-revisao-new">
                            <span className="painel-revisao-label">Depois</span>
                            <p>
                              {ops.filter(o => o.type !== 'removed').map((o, i) =>
                                o.type === 'added'
                                  ? <mark key={i} className="diff-mark-added">{o.text}</mark>
                                  : <span key={i}>{o.text}</span>
                              )}
                            </p>
                          </div>
                        </>
                      )
                    })()}

                    {/* Removido ou adicionado: texto simples */}
                    {diffAtual.type === 'removed' && (
                      <div className="painel-revisao-old">
                        <span className="painel-revisao-label">Texto</span>
                        <p>{diffAtual.oldText}</p>
                      </div>
                    )}
                    {diffAtual.type === 'added' && (
                      <div className="painel-revisao-new">
                        <span className="painel-revisao-label">Texto</span>
                        <p>{diffAtual.newText}</p>
                      </div>
                    )}

                    <div className="painel-revisao-btns">
                      <button
                        className="btn-recusar"
                        onClick={recusarDiff}
                        title={
                          diffAtual.type === 'added'   ? 'Remover parágrafo adicionado' :
                          diffAtual.type === 'removed' ? 'Manter parágrafo (não excluir)' :
                          'Restaurar versão anterior'
                        }
                      >✕ Recusar</button>
                      <button
                        className="btn-aceitar"
                        onClick={aceitarDiff}
                        title={
                          diffAtual.type === 'added'   ? 'Aceitar novo parágrafo' :
                          diffAtual.type === 'removed' ? 'Confirmar exclusão' :
                          'Aceitar alteração'
                        }
                      >✓ Aceitar</button>
                    </div>
                  </div>
                ) : livresAba === 0 && diffsAtivos.length > 0 ? (
                  <div className="painel-revisao-concluido">
                    ✓ Todas revisadas nesta categoria
                  </div>
                ) : null}
              </div>

              {/* Lista filtrada pela aba ativa */}
              <div className="painel-revisao-lista">
                {diffsAtivos.length === 0 ? (
                  <p className="painel-revisao-vazio">
                    Nenhuma alteração de {abaRevisao === 'texto' ? 'texto' : 'formatação'} encontrada.
                  </p>
                ) : diffsAtivos.map((diff) => {
                  const i     = diffs.indexOf(diff)
                  const texto = (diff.newText || diff.oldText) ?? ''
                  return (
                    <button
                      key={diff.id}
                      className={[
                        'diff-item',
                        `diff-item-${diff.type}`,
                        diff.resolved    ? 'diff-item-resolvido' : '',
                        i === currDiffIdx ? 'diff-item-atual'    : '',
                      ].join(' ')}
                      onClick={() => {
                        setCurrDiffIdx(i)
                        scrollParaDiff(diffs, i, editor)
                        setTimeout(() => flashDiffEl(diffs, i, editor), 50)
                      }}
                    >
                      <span className={`diff-item-badge diff-item-badge-${diff.type}`}>
                        {diff.type === 'added' ? '+' : diff.type === 'removed' ? '−' : '~'}
                      </span>
                      <span className="diff-item-texto">
                        {texto.slice(0, 120)}{texto.length > 120 ? '…' : ''}
                      </span>
                      {diff.resolved && <span className="diff-item-ok">✓</span>}
                    </button>
                  )
                })}
              </div>

              {/* Rodapé: recusar/aceitar todos + cancelar/concluir */}
              <div className="painel-revisao-rodape">
                {livresAba > 0 && (
                  <div className="painel-revisao-todos">
                    <button
                      className="btn-recusar-todos"
                      onClick={recusarTodos}
                      title={`Recusar todas as ${livresAba} alteração${livresAba !== 1 ? 'ões' : ''} desta categoria`}
                    >
                      ✕ Recusar todos
                    </button>
                    <button
                      className="btn-aceitar-todos"
                      onClick={aceitarTodos}
                      title={`Aceitar todas as ${livresAba} alteração${livresAba !== 1 ? 'ões' : ''} desta categoria`}
                    >
                      ✓ Aceitar todos
                    </button>
                  </div>
                )}
                <div className="painel-revisao-rodape-acoes">
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={cancelarRevisao}>
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    onClick={concluirRevisao}
                    disabled={salvando || livresQtd > 0}
                    title={livresQtd > 0
                      ? `Ainda há ${livresQtd} diferença${livresQtd !== 1 ? 's' : ''} não revisada${livresQtd !== 1 ? 's' : ''}`
                      : 'Salvar e registrar data de atualização'}
                  >
                    {salvando ? 'Salvando…' : '✓ Concluir'}
                  </button>
                </div>
              </div>
            </aside>
          )}

          {/* Painel esquerdo (oculto em modo revisão) */}
          {!emRevisao && (
            <aside className="painel painel-esquerdo">
              <div className="rotinas-importacao">
                <div
                  className="rotinas-troca-arq"
                  onClick={() => fileRef.current?.click()}
                  title="Importar arquivo"
                >
                  <input ref={fileRef} type="file" accept=".docx,.xml,.html,.htm"
                    style={{ display: 'none' }} onChange={handleArquivo} />
                  <span>📄</span>
                  <span className="rotinas-nome-arq">
                    {nomeArq || 'Nenhum arquivo'}
                  </span>
                  <span className="rotinas-btn-trocar">Importar</span>
                </div>
                <button
                  type="button"
                  className="rotinas-colar-btn"
                  onClick={abrirColagemInternet}
                  title="Colar texto da internet"
                >
                  Colar
                </button>
              </div>

              <div className="abas-esq">
                <button
                  className={`aba-esq${abaEsq === 'rotinas' ? ' ativa' : ''}`}
                  onClick={() => setAbaEsq('rotinas')}
                >Rotinas</button>
                <button
                  className={`aba-esq${abaEsq === 'sumario' ? ' ativa' : ''}`}
                  onClick={() => setAbaEsq('sumario')}
                >Sumário</button>
              </div>

              {abaEsq === 'rotinas' ? (
                <div className="aba-conteudo">
                  <PainelRotinas
                    inputHtml={inputHtml}
                    editor={editor}
                    tipoNorma={norma?.tipo}
                    tags={norma?.tags ?? []}
                    autoExecutarKey={autoExecutarRotinas}
                    onExcecoes={receberExcecoesDetectadas}
                    onModificado={() => setModificado(true)}
                  />
                </div>
              ) : (
                <PainelSumario editor={editor} />
              )}
            </aside>
          )}

          {/* Editor principal */}
          <main className="editor-principal">
            {!emRevisao && (
              <PainelBusca
                editor={editor}
                aberto={buscaAberta}
                onFechar={() => setBuscaAberta(false)}
                onModificado={() => setModificado(true)}
              />
            )}
            {!emRevisao && (
              <PainelNotas
                editor={editor}
                aberto={notasAberto}
                onFechar={() => setNotasAberto(false)}
              />
            )}
            {!emRevisao && (
              <PainelExcecoes
                excecoes={excecoes}
                editor={editor}
                aberto={excecoesAberto}
                onFechar={() => setExcecoesAberto(false)}
                onResolver={idx =>
                  setExcecoes(prev => prev.map((e, i) =>
                    i === idx ? { ...e, resolvida: true } : e))
                }
              />
            )}
            <LegislatorEditor
              docJson={docJson}
              onEditorReady={setEditor}
              zoom={zoom}
              styleIndicatorsActive={styleIndicatorsAtivo}
              spellcheckAtivo={spellcheckAtivo}
              editable={modoEdicaoManual || emRevisao}
              tipoNorma={norma?.tipo}
              tags={norma?.tags ?? []}
              onPasteRotinas={() => setModificado(true)}
            />
          </main>

          {/* Painel direito normal (oculto em modo revisão) */}
          {!emRevisao && (
            <div className="editor-direita">
              <PainelEstilos editor={editor} editable={modoEdicaoManual} tipoNorma={norma?.tipo} />
            </div>
          )}

          {/* Painel de estilos (direita, em modo revisão) */}
          {emRevisao && (
            <div className="editor-direita">
              <PainelEstilos editor={editor} editable tipoNorma={norma?.tipo} />
            </div>
          )}
        </div>
      )}

      {/* ── Modal: Atualizar norma ────────────────────────────────── */}
      {modalAtualizarAberto && (
        <PainelAtualizarNorma
          editorDoc={editor?.getJSON()}
          tipoNorma={norma?.tipo}
          tags={norma?.tags ?? []}
          onIniciarRevisao={onIniciarRevisao}
          onFechar={() => setModalAtualizarAberto(false)}
          onEditarManual={iniciarEdicaoManual}
        />
      )}

      {/* ── Modal: Editar dados da norma ─────────────────────────── */}
      {modalNotaRodape && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalNotaRodape(false) }}>
          <div className="modal-box modal-nota-rodape" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Inserir nota de rodape</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalNotaRodape(false)}>x</button>
            </div>
            <form onSubmit={inserirNotaRodape}>
              <div className="campo">
                <label>Chamada</label>
                <div className="nota-rodape-chamada-auto">nota</div>
              </div>
              <div className="campo">
                <label>Texto da nota</label>
                <textarea
                  autoFocus
                  rows={5}
                  value={notaRodapeForm.texto}
                  onChange={e => setNotaRodapeForm(f => ({ ...f, texto: e.target.value }))}
                  placeholder="Digite o conteudo da nota de rodape"
                  required
                />
              </div>
              <div className="modal-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModalNotaRodape(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={!notaRodapeForm.texto.trim()}>
                  Inserir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalColarTexto && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalColarTexto(false) }}>
          <div className="modal-box modal-colar-internet" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Colar texto da internet</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalColarTexto(false)}>x</button>
            </div>
            <div className="modal-colar-corpo">
              <div
                ref={colagemRef}
                className="modal-colar-area"
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Cole aqui o texto copiado da internet"
                onPaste={colarTextoInternet}
                onInput={e => setColagemTemConteudo(Boolean(e.currentTarget.textContent?.trim()))}
              />
              <div className="modal-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModalColarTexto(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" disabled={!colagemTemConteudo} onClick={confirmarColagemInternet}>
                  Usar texto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalClassesHtml && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalClassesHtml(null) }}>
          <div className="modal-box modal-classes-html" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mapear classes HTML</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalClassesHtml(null)}>x</button>
            </div>
            <div className="classes-html-corpo">
              <p className="classes-html-aviso">
                Foram encontrados paragrafos com classes que o Legislator ainda nao reconhece.
                Mapeie cada classe para um estilo de paragrafo ou deixe como ignorada.
              </p>
              <div className="classes-html-lista">
                {modalClassesHtml.ocorrencias.map(item => (
                  <div className="classes-html-item" key={item.classe}>
                    <div className="classes-html-topo">
                      <div>
                        <div className="classes-html-classe">{item.classe}</div>
                        <div className="classes-html-meta">
                          {item.total} ocorrencia{item.total === 1 ? '' : 's'} em &lt;{item.tag}&gt;
                        </div>
                      </div>
                      <select
                        value={modalClassesHtml.mapeamentos[item.classe] || ''}
                        onChange={e => atualizarMapeamentoClasseHtml(item.classe, e.target.value)}
                      >
                        <option value="">Ignorar classe</option>
                        {estilosDisponiveisParaMapeamentoHtml().map(estilo => (
                          <option
                            key={estilo.custom ? estilo.id : estilo.node}
                            value={estilo.custom ? estilo.id : estilo.node}
                          >
                            {estilo.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="classes-html-exemplos">
                      {item.exemplos.map((exemplo, idx) => (
                        <div className="classes-html-exemplo" key={`${item.classe}-${idx}`}>
                          {exemplo}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModalClassesHtml(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={confirmarImportacaoHtmlMapeada}>
                  Importar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalPadronizacao && (
        <div className="padronizacao-painel" onKeyDown={e => e.stopPropagation()}>
          <div className="padronizacao-card">
            <div className="modal-header">
              <h3>Padronização</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalPadronizacao(false)}>x</button>
            </div>

            <div className="padronizacao-abas">
              {PADRONIZACAO_ABAS.map(aba => (
                <button
                  key={aba.id}
                  className={`padronizacao-aba${abaPadronizacao === aba.id ? ' ativa' : ''}`}
                  onClick={() => trocarAbaPadronizacao(aba.id)}
                >
                  {aba.label}
                  <span>{coletarOcorrenciasPadronizacao(editor, aba.id).length}</span>
                </button>
              ))}
            </div>

            <div className="padronizacao-lista">
              {ocorrenciasPadronizacao.length === 0 ? (
                <div className="padronizacao-vazio">Nenhuma ocorrência encontrada.</div>
              ) : (
                gruposPadronizacao.map((grupo, grupoIdx) => (
                  <div key={grupo.chave} className="padronizacao-grupo">
                    <div className="padronizacao-grupo-topo">
                      <button
                        type="button"
                        className="padronizacao-grupo-toggle-btn"
                        onClick={() => alternarGrupoPadronizacao(grupo.chave)}
                        aria-expanded={Boolean(gruposPadronizacaoAbertos[grupo.chave])}
                      >
                        <span className="padronizacao-grupo-toggle">
                          {gruposPadronizacaoAbertos[grupo.chave] ? '-' : '+'}
                        </span>
                        <span className="padronizacao-grupo-texto">{grupo.texto}</span>
                      </button>
                      <span className="padronizacao-grupo-contagem">
                        {grupo.ocorrencias.length} ocorrência{grupo.ocorrencias.length === 1 ? '' : 's'}
                      </span>
                      <input
                        className="padronizacao-substituicao-input"
                        value={substituicoesPadronizacao[grupo.chave] ?? ''}
                        onChange={e => setSubstituicoesPadronizacao(prev => ({
                          ...prev,
                          [grupo.chave]: e.target.value,
                        }))}
                        disabled={!padronizacaoPodeSubstituir}
                        placeholder={padronizacaoPodeSubstituir ? 'Substituir por...' : 'Disponível no modo de edição'}
                      />
                      <button
                        type="button"
                        className="btn-primary padronizacao-substituicao-btn"
                        disabled={!padronizacaoPodeSubstituir || !substituicoesPadronizacao[grupo.chave]}
                        onClick={() => substituirGrupoPadronizacao(grupo)}
                      >
                        Aplicar
                      </button>
                    </div>
                    {gruposPadronizacaoAbertos[grupo.chave] && (
                      <div className="padronizacao-grupo-ocorrencias">
                        {grupo.ocorrencias.map((oc, i) => (
                          <button
                            key={`${oc.from}-${oc.to}-${i}`}
                            className="padronizacao-item"
                            onClick={() => irParaOcorrenciaPadronizacao(oc)}
                          >
                            <span className="padronizacao-item-num">{grupoIdx + 1}.{i + 1}</span>
                            <span className="padronizacao-item-contexto">{oc.contexto}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {modalEditarMeta && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalEditarMeta(false) }}>
          <div className="modal-box modal-editar-meta" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar dados da norma</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalEditarMeta(false)}>✕</button>
            </div>
            <form onSubmit={salvarMeta}>
              <div className="campo">
                <label>Tipo</label>
                <select
                  value={editForm.tipo}
                  onChange={e => setEditForm(f => ({ ...f, tipo: e.target.value }))}
                >
                  {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="campo">
                <label>Epígrafe *</label>
                <input
                  autoFocus
                  value={editForm.epigrafe}
                  onChange={e => setEditForm(f => ({ ...f, epigrafe: e.target.value }))}
                  required
                />
              </div>
              <div className="campo">
                <label>Apelido <span className="campo-opcional">(opcional)</span></label>
                <input
                  placeholder="Ex: Lei de Direitos Autorais"
                  value={editForm.apelido}
                  onChange={e => setEditForm(f => ({ ...f, apelido: e.target.value }))}
                />
              </div>
              <div className="campo">
                <label>Ementa <span className="campo-opcional">(opcional)</span></label>
                <textarea
                  rows={3}
                  placeholder="Dispõe sobre…"
                  value={editForm.ementa}
                  onChange={e => setEditForm(f => ({ ...f, ementa: e.target.value }))}
                />
              </div>
              <div className="form-secao">
                <h3>Dados complementares</h3>
                <div className="campo">
                  <label>Dados de publicação, republicação e retificação <span className="campo-opcional">(opcional)</span></label>
                  <textarea
                    rows={3}
                    value={editForm.dados_publicacao}
                    onChange={e => setEditForm(f => ({ ...f, dados_publicacao: e.target.value }))}
                  />
                </div>

                <div className="form-grid-2">
                  <div className="campo">
                    <label>Data da última alteração <span className="campo-opcional">(opcional)</span></label>
                    <input
                      type="date"
                      value={editForm.data_ultima_alteracao}
                      onChange={e => setEditForm(f => ({ ...f, data_ultima_alteracao: e.target.value }))}
                    />
                  </div>
                  <div className="campo campo-check">
                    <label className={`home-check pendente-check${editForm.atualizacao_pendente ? ' ativo' : ''}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(editForm.atualizacao_pendente)}
                        onChange={e => setEditForm(f => ({ ...f, atualizacao_pendente: e.target.checked }))}
                      />
                      {editForm.atualizacao_pendente && <span className="pendente-check-alerta" aria-hidden="true">⚠️</span>}
                      <span>Atualização pendente</span>
                    </label>
                  </div>
                  <div className="campo">
                    <label>Vigência</label>
                    <input
                      value={editForm.vigencia}
                      onChange={e => setEditForm(f => ({ ...f, vigencia: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="campo">
                  <label>Link para acesso <span className="campo-opcional">(opcional)</span></label>
                  <input
                    type="url"
                    value={editForm.link_acesso}
                    onChange={e => setEditForm(f => ({ ...f, link_acesso: e.target.value }))}
                  />
                </div>

                <div className="campo">
                  <label>Anexo <span className="campo-opcional">(opcional)</span></label>
                  <input
                    value={editForm.anexo}
                    onChange={e => setEditForm(f => ({ ...f, anexo: e.target.value }))}
                  />
                </div>

                <div className="campo">
                  <label>Outras observações <span className="campo-opcional">(opcional)</span></label>
                  <textarea
                    rows={3}
                    value={editForm.observacoes}
                    onChange={e => setEditForm(f => ({ ...f, observacoes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="campo">
                <label>Tags <span className="campo-opcional">(opcional)</span></label>
                <div className="tag-input-wrap">
                  {editTags.map(t => (
                    <span key={t} className="tag-chip">
                      {t}
                      <button type="button" className="tag-chip-remover" onClick={() => removerTag(t)}>×</button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    placeholder={editTags.length === 0 ? 'Adicionar tag…' : ''}
                    value={editTagInput}
                    onChange={e => onTagInputChange(e.target.value)}
                    onFocus={() => setEditTagSugestoes(calcSugestoes(editTagInput, editTags, todasTags))}
                    onBlur={() => setTimeout(() => setEditTagSugestoes([]), 150)}
                    onKeyDown={onTagKeyDown}
                  />
                </div>
                {editTagSugestoes.length > 0 && (
                  <ul className="tag-sugestoes">
                    {editTagSugestoes.map(t => (
                      <li key={t}>
                        <button type="button" onClick={() => adicionarTag(t)}>{t}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {editErro && <p className="form-erro">{editErro}</p>}
              <div className="form-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModalEditarMeta(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={editSalvando || !editForm.epigrafe.trim()}>
                  {editSalvando ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
