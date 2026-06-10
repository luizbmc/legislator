import { useState, useEffect, useRef } from 'react'
import { parseHtmlInput, fillNotaGaps, applyTextNota } from '../../services/limpeza/00_parseHtml.js'
import { normalizarTexto }     from '../../services/limpeza/01_normalizarTexto.js'
import { normalizarPontuacao } from '../../services/limpeza/02_normalizarPontuacao.js'
import { detectarEstrutura }   from '../../services/limpeza/03_detectarEstrutura.js'
import { aplicarContextuais }  from '../../services/limpeza/04_contextuais.js'
import { aplicarNBSP }         from '../../services/limpeza/05_aplicarNBSP.js'
import { detectarExcecoes }    from '../../services/limpeza/06_detectarExcecoes.js'
import { aplicarMarcas }       from '../../services/limpeza/07_aplicarMarcas.js'
import { corrigirPontuacaoEnumeracoes } from '../../services/limpeza/08_corrigirPontuacaoEnumeracoes.js'
import { linhasParaTiptap, mergeComHtml, normalizarDocNotas } from '../../services/limpeza/index.js'
import { aplicarNotasVadeMecum }          from '../../services/notasVadeMecum.js'
import { aplicarCitacoes }               from '../../services/aplicarCitacoes.js'

// ── Helpers para o modo seleção ────────────────────────────────────

/**
 * Converte marks "link" em "nota" quando o texto começa com "(",
 * e propaga a marca por toda a extensão dos parênteses abertos
 * (replica a lógica de parseInline + fillNotaGaps do 00_parseHtml.js,
 *  mas operando diretamente sobre o modelo TipTap em vez do DOM).
 */
function convertLinksToNota(nodes) {
  // 1ª passagem: link → nota (se texto começa com "(")
  const converted = nodes.map(node => {
    if (node.type !== 'text') return node
    if (!node.marks.some(m => m.type === 'link')) return node
    const newMarks = node.marks.filter(m => m.type !== 'link' && m.type !== 'italic')
    if (node.text.trimStart().startsWith('(')) newMarks.push({ type: 'nota' })
    return { ...node, marks: newMarks }
  })

  // 2ª passagem: detecta notas em texto puro (sem hyperlink) pelo padrão
  // de palavras-gatilho como "Vide", "Revogado", "Incluído", etc.
  const withTextNota = applyTextNota(converted)

  // 3ª passagem: propaga nota por toda a extensão dos parênteses abertos
  return fillNotaGaps(withTextNota)
}

/**
 * Percorre os nós do documento entre `from` e `to`, extrai os blocos
 * de texto com seus marks e retorna a estrutura esperada pela pipeline
 * (equivalente ao retorno de parseHtmlInput).
 */
function getSelectionBlocos(editor, from, to, origem = 'seleção') {
  const blocos = []

  editor.state.doc.nodesBetween(from, to, node => {
    if (!node.isBlock || node.isDoc) return true   // desce para blocos filhos

    const text = node.textContent.replace(/\s+/g, ' ').trim()
    if (!text) return false

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
        if      (n === 'bold' || n === 'boldArtigo')      marks.push({ type: 'bold' })
        else if (n === 'italic' || n === 'italicoLight')  marks.push({ type: 'italic' })
        else if (n === 'regular')                         marks.push({ type: 'regular' })
        else if (n === 'nota')                            marks.push({ type: 'nota' })
        else if (n === 'notaSobrescrito')                  marks.push({ type: 'notaSobrescrito' })
        else if (n === 'estiloCaractereCustom')            marks.push({ type: 'estiloCaractereCustom', attrs: { ...mark.attrs } })
        else if (n === 'link')                            marks.push({ type: 'link' })
        else if (n === 'superscript')                     marks.push({ type: 'superscript' })
        else if (n === 'subscript')                       marks.push({ type: 'subscript' })
      })

      content.push({ type: 'text', text: inline.text, marks })
    })

    blocos.push({ type: 'text', text, content: convertLinksToNota(content) })
    return false  // não desce — inline já foi processado manualmente
  })

  return {
    blocos,
    textoPuro: blocos.map(b => b.text).join('\n'),
    log: [`${blocos.length} parágrafo(s) ${origem === 'seleção' ? 'da seleção' : 'do documento'} processado(s)`],
  }
}

function getDocumentBlocos(editor) {
  return getSelectionBlocos(editor, 0, editor.state.doc.content.size, 'documento')
}

const DEFS = [
  { id: 0, nome: '00 — Extrair texto'         },
  { id: 1, nome: '01 — Normalizar texto'       },
  { id: 2, nome: '02 — Normalizar pontuação'   },
  { id: 3, nome: '03 — Detectar estrutura'     },
  { id: 4, nome: '04 — Ajustes contextuais'    },
  { id: 5, nome: '05 — Espaços não-separáveis' },
  { id: 6, nome: '06 — Marcas de caractere'    },
  { id: 7, nome: '07 — Pontuação de enumerações' },
  { id: 8, nome: '08 — Aplicar citações'       },
  { id: 9, nome: '09 — Detectar exceções'      },
]

// Converte texto puro em TipTap doc simples (sem classificação de estilos)
function textoParaDoc(texto) {
  return {
    type: 'doc',
    content: texto.split('\n')
      .filter(l => l.trim())
      .map(t => ({ type: 'paragrafLei', content: [{ type: 'text', text: t }] })),
  }
}

// Converte blocos ricos (negrito/itálico/tabelas preservados) em TipTap doc.
// Usado nas etapas 0-2, onde o pipeline ainda não classificou os estilos.
function blocosParaDoc(blocos) {
  const content = []
  for (const bloco of blocos) {
    if (bloco.type === 'table') {
      content.push(bloco.node)
      continue
    }
    if (!bloco.text?.trim()) continue
    const inlineContent = bloco.content?.length > 0
      ? bloco.content
      : [{ type: 'text', text: bloco.text }]
    content.push({ type: 'paragrafLei', content: inlineContent })
  }
  return { type: 'doc', content }
}

// Mapeamento inverso: tipo TipTap → style do pipeline (para detectarExcecoes)
const NODE_TO_STYLE = {
  'epigrafe':         'epigrafe',
  'epigrafeApelido':  'epigrafe-apelido',
  'notaTitulo':       'nota-titulo',
  'ementa':           'ementa',
  'paragrafAbertura': 'paragrafo-abertura',
  'paragrafFacoSaber':'texto-lei-faco-saber',
  'aberturaCapitulo': 'abertura-capitulo',
  'partelivroTitCap': 'parte-livro-tit-cap',
  'secaoSubsecao':    'secao-subsecao',
  'artigo':           'artigo',
  'artigoTitulo':     'artigo-titulo',
  'corpoTratado':     'corpo-tratado',
  'paragrafLei':      'paragrafo',
  'nomeJuridico':     'nome-juridico',
  'inciso':           'inciso',
  'alinea':           'alinea',
  'item':             'item',
  'citacao':          'citacao',
  'data':             'data',
  'assinatura':       'assinatura',
  'assinaturaData':   'data',
  'assinaturaNome':   'assinatura',
  'textoComumTitulo': 'texto-comum-titulo',
  'textoComumSubtitulo': 'texto-comum-subtitulo',
  'textoComumCorrido': 'texto-comum-corrido',
  'textoComumRecuado': 'texto-comum-recuado',
  'textoComumCitacao': 'texto-comum-citacao',
  'textoComumBullets': 'texto-comum-bullets',
  'textoComumAssinatura': 'texto-comum-assinatura',
  'textoComumAssinaturaCargo': 'texto-comum-assinatura-cargo',
}

const STYLE_TO_NODE_DIRETO = {
  'epigrafe':           'epigrafe',
  'epigrafe-apelido':   'epigrafeApelido',
  'nota-titulo':        'notaTitulo',
  'ementa':             'ementa',
  'paragrafo-abertura': 'paragrafAbertura',
  'texto-lei-faco-saber':'paragrafFacoSaber',
  'paragrafo-faco-saber':'paragrafFacoSaber',
  'abertura-capitulo':  'aberturaCapitulo',
  'parte-livro-tit-cap':'partelivroTitCap',
  'secao-subsecao':     'secaoSubsecao',
  'artigo':             'artigo',
  'artigo-titulo':      'artigoTitulo',
  'corpo-tratado':      'corpoTratado',
  'paragrafo':          'paragrafLei',
  'texto-lei':          'paragrafLei',
  'nome-juridico':      'nomeJuridico',
  'inciso':             'inciso',
  'alinea':             'alinea',
  'item':               'item',
  'citacao':            'citacao',
  'data':               'data',
  'assinatura':         'assinatura',
  'texto-comum-titulo': 'textoComumTitulo',
  'texto-comum-subtitulo': 'textoComumSubtitulo',
  'texto-comum-corrido': 'textoComumCorrido',
  'texto-comum-recuado': 'textoComumRecuado',
  'texto-comum-citacao': 'textoComumCitacao',
  'texto-comum-bullets': 'textoComumBullets',
  'texto-comum-assinatura': 'textoComumAssinatura',
  'texto-comum-assinatura-cargo': 'textoComumAssinaturaCargo',
}

const ROTINAS_INDIVIDUAIS = new Set([4, 5, 6, 7, 8, 9])

function textoInline(content) {
  return (content ?? []).map(node => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return ' '
    return ''
  }).join('')
}

// Representação rica do documento atual para rotinas que operam isoladamente.
// Mantém content/marks e uma referência ao índice do bloco original.
function tiptapDocParaLinhasRicas(doc) {
  return (doc?.content ?? []).map((node, nodeIndex) => {
    if (node.type === 'table') {
      return { isTable: true, style: '_table', text: '', tableNode: node, _nodeIndex: nodeIndex }
    }

    const text = textoInline(node.content)
    let style = NODE_TO_STYLE[node.type] ?? 'texto-lei'
    if (node.type === 'paragrafLei' && !/^§|^Parágrafo único/i.test(text)) {
      style = 'texto-lei'
    }

    return {
      style,
      text,
      content: node.content ? node.content.map(item => ({ ...item })) : [],
      _nodeIndex: nodeIndex,
    }
  })
}

function aplicarLinhasNoDoc(doc, linhas) {
  const porIndice = new Map(linhas.map(linha => [linha._nodeIndex, linha]))

  return {
    ...doc,
    content: (doc?.content ?? []).map((node, nodeIndex) => {
      const linha = porIndice.get(nodeIndex)
      if (!linha || linha.isTable) return node

      const type = STYLE_TO_NODE_DIRETO[linha.style] ?? node.type
      const content = linha.content?.length
        ? linha.content
        : linha.text ? [{ type: 'text', text: linha.text }] : []

      return { ...node, type, content }
    }),
  }
}

// Extrai linhas { style, text } de um TipTap doc para passar a detectarExcecoes.
// Nós de tabela são ignorados (não há exceções a verificar em células).
// paragrafLei acomoda tanto linhas de 'paragrafo' (§ / Parágrafo único.)
// quanto de 'texto-lei' (tudo o mais). O conteúdo do texto é usado para
// distinguir os dois casos e preservar a informação para as regras de exceção.
function tiptapDocParaLinhas(doc) {
  return (doc?.content ?? [])
    .filter(n => n.type !== 'table')
    .map(n => {
      const text = (n.content ?? []).map(c => {
        if (c.type === 'text') return c.text ?? ''
        if (c.type === 'hardBreak') return ' '
        return ''
      }).join('')
      let style = NODE_TO_STYLE[n.type] ?? 'texto-lei'
      if (n.type === 'paragrafLei' && !/^§|^Parágrafo único/.test(text)) {
        style = 'texto-lei'
      }
      return {
        style,
        text,
        content: n.content ? n.content.map(item => ({ ...item })) : [],
      }
    })
}

function executarEtapaIndividual(id, editor, estiloVadeMecum = false) {
  const docAtual = editor.getJSON()
  const linhas = tiptapDocParaLinhasRicas(docAtual)

  if (id === 4) {
    const r = aplicarContextuais(linhas)
    return { doc: aplicarLinhasNoDoc(docAtual, r.output), log: r.log }
  }
  if (id === 5) {
    const r = aplicarNBSP(linhas)
    return { doc: aplicarLinhasNoDoc(docAtual, r.output), log: r.log }
  }
  if (id === 6) {
    const r = aplicarMarcas(linhas, { estiloVadeMecum })
    return { doc: aplicarLinhasNoDoc(docAtual, r.output), log: r.log }
  }
  if (id === 7) {
    const r = corrigirPontuacaoEnumeracoes(linhas)
    return { doc: aplicarLinhasNoDoc(docAtual, r.output), log: r.log }
  }
  if (id === 8) {
    return aplicarCitacoes(docAtual)
  }
  if (id === 9) {
    const r = detectarExcecoes(tiptapDocParaLinhas(docAtual))
    return { excecoes: r.excecoes, log: [] }
  }

  throw new Error('Esta etapa depende da execução das etapas anteriores.')
}

// Executa uma etapa a partir do resultado da anterior e devolve o novo resultado
function executarEtapa(id, prev, inputHtml, tipoNorma = '', estiloVadeMecum = false) {
  switch (id) {
    case 0: {
      const r = parseHtmlInput(inputHtml)
      return { texto: r.textoPuro, blocos: r.blocos, log: r.log }
    }
    case 1: {
      const r = normalizarTexto(prev.texto ?? '', { tipoNorma })
      return { texto: r.output, blocos: prev.blocos, log: r.log }
    }
    case 2: {
      const r = normalizarPontuacao(prev.texto ?? '')
      return { texto: r.output, blocos: prev.blocos, log: r.log }
    }
    case 3: {
      const r = detectarEstrutura(prev.texto ?? '', { tipoNorma })
      return { linhas: r.output, blocos: prev.blocos, log: r.log }
    }
    case 4: {
      const r = aplicarContextuais(prev.linhas ?? [])
      return { linhas: r.output, blocos: prev.blocos, log: r.log }
    }
    case 5: {
      const r = aplicarNBSP(prev.linhas ?? [])
      return { linhas: r.output, blocos: prev.blocos, log: r.log }
    }
    case 6: {
      // Faz o merge com rich content (se havia HTML) e então aplica marcas.
      // Devolve blocos: null para que resultadoParaDoc não tente mesclar de novo.
      const linhasMerged = prev.blocos?.length > 0
        ? mergeComHtml(prev.blocos, prev.linhas ?? [])
        : (prev.linhas ?? [])
      const r = aplicarMarcas(linhasMerged, { estiloVadeMecum })
      return { linhas: r.output, blocos: null, log: r.log }
    }
    case 7: {
      const r = corrigirPontuacaoEnumeracoes(prev.linhas ?? [])
      return { linhas: r.output, blocos: prev.blocos, log: r.log }
    }
    case 8: {
      // Converte linhas classificadas em TipTap doc e aplica citações
      const docBase = linhasParaTiptap(prev.linhas ?? [])
      const { doc, log } = aplicarCitacoes(docBase)
      return { doc, log }
    }
    case 9: {
      // Detecta exceções sobre o TipTap doc final (pós-citações),
      // extraindo linhas { style, text } para compatibilidade com detectarExcecoes.
      const linhas = tiptapDocParaLinhas(prev.doc)
      const r = detectarExcecoes(linhas)
      return { doc: prev.doc, excecoes: r.excecoes, log: [] }
    }
    default:
      throw new Error(`Etapa desconhecida: ${id}`)
  }
}

// Converte o resultado de uma etapa em TipTap doc para exibir no editor.
function resultadoParaDoc(res, id) {
  if (!res) return null
  // Etapas 8-9: já é um TipTap doc completo (citações e exceções devolvem { doc })
  if (res.doc) return normalizarDocNotas(res.doc)
  if (res.linhas) {
    // Etapas 3-7: mescla rich content (blocos) de volta nas linhas classificadas
    const linhas = res.blocos?.length > 0
      ? mergeComHtml(res.blocos, res.linhas)
      : res.linhas
    return normalizarDocNotas(linhasParaTiptap(linhas))
  }
  // Etapas 00-02: usa blocos (preservam negrito/itálico/tabelas do HTML original).
  // Etapas 01-02 modificam apenas res.texto; os blocos carregam o rich content
  // e a estrutura tabular intactos da etapa 00. Para o preview intermediário
  // mostramos os blocos como estão (formatação preservada); a normalização de
  // texto é aplicada de fato nas etapas seguintes via mergeComHtml.
  if (res.blocos?.length > 0) return normalizarDocNotas(blocosParaDoc(res.blocos))
  if (res.texto) return normalizarDocNotas(textoParaDoc(res.texto))
  return null
}

export default function PainelRotinas({
  inputHtml,
  editor,
  tipoNorma = '',
  tags = [],
  autoExecutarKey = 0,
  onExcecoes,
  onModificado,
}) {
  const [resultados, setResultados] = useState([])  // indexed by step id
  const [rodando,    setRodando]    = useState(false)
  const ultimoAutoExecutarRef = useRef(0)

  // ── Rastreamento da seleção do editor ─────────────────────────
  const [selTexto,  setSelTexto]  = useState('')   // texto selecionado (vazio = sem seleção)
  const selRangeRef = useRef({ from: 0, to: 0 })  // posição da seleção (ref para snapshot)

  useEffect(() => {
    if (!editor) return
    const onSel = () => {
      const { from, to, empty } = editor.state.selection
      if (!empty) {
        selRangeRef.current = { from, to }
        setSelTexto(editor.state.doc.textBetween(from, to, '\n'))
      } else {
        setSelTexto('')
      }
    }
    editor.on('selectionUpdate', onSel)
    return () => editor.off('selectionUpdate', onSel)
  }, [editor])

  const modoSelecao  = !!selTexto
  const modoDocAtual = !modoSelecao && !inputHtml && !!editor
  const temInput     = modoSelecao || !!inputHtml || modoDocAtual
  const ultimaRodada = resultados.reduce((acc, r, i) => r != null ? i : acc, -1)
  const temTagVm     = (tags || []).some(t => String(t).toLowerCase() === 'vm')

  useEffect(() => {
    if (!autoExecutarKey || autoExecutarKey === ultimoAutoExecutarRef.current) return

    const timer = window.setTimeout(() => {
      ultimoAutoExecutarRef.current = autoExecutarKey
      rodarTodas()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoExecutarKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Executa uma única etapa ────────────────────────────────────
  function rodarEtapa(id) {
    if (rodando || !temInput || modoSelecao) return
    const podeRodarDireto = !!editor && ROTINAS_INDIVIDUAIS.has(id)
    const prev = id === 0 ? {} : resultados[id - 1]
    if (id > 0 && !prev && !podeRodarDireto) return

    let res
    try {
      if (podeRodarDireto && (modoDocAtual || !prev || prev.doc)) {
        res = executarEtapaIndividual(id, editor, temTagVm)
      } else if (id === 0 && modoDocAtual) {
        const docBlocos = getDocumentBlocos(editor)
        res = { texto: docBlocos.textoPuro, blocos: docBlocos.blocos, log: docBlocos.log }
      } else {
        res = executarEtapa(id, prev, inputHtml, tipoNorma, temTagVm)
      }
    } catch (err) {
      res = { erro: String(err), log: [] }
    }

    setResultados(ant => {
      const novo = [...ant]
      novo[id] = res
      for (let i = id + 1; i < DEFS.length; i++) novo[i] = undefined
      return novo
    })

    if (!res.erro) aplicarNoEditor(res, id)
  }

  // ── Executa todas as etapas em sequência ───────────────────────
  function rodarTodas() {
    if (rodando || !temInput) return

    // Captura seleção no momento do clique (pode mudar durante a execução)
    const range = modoSelecao ? { ...selRangeRef.current } : null

    setRodando(true)
    const novos = []

    try {
      if (modoSelecao) {
        // Etapa 00: lê os nós ProseMirror diretamente, converte link → nota
        // sem serializar para HTML (evita perda de marks pelo round-trip DOM).
        const selBlocos = getSelectionBlocos(editor, range.from, range.to)
        novos[0] = { texto: selBlocos.textoPuro, blocos: selBlocos.blocos, log: selBlocos.log }

        // Etapas 1–9 sobre o texto extraído da seleção
        let prev = novos[0]
        for (const def of DEFS.filter(d => d.id >= 1)) {
          const res = executarEtapa(def.id, prev, null, tipoNorma, temTagVm)
          novos[def.id] = res
          if (res.erro) break
          prev = res
        }
      } else if (modoDocAtual) {
        // Documento atual: usado para normas importadas de XML ou já abertas sem DOCX.
        const docBlocos = getDocumentBlocos(editor)
        novos[0] = { texto: docBlocos.textoPuro, blocos: docBlocos.blocos, log: docBlocos.log }

        let prev = novos[0]
        for (const def of DEFS.filter(d => d.id >= 1)) {
          const res = executarEtapa(def.id, prev, null, tipoNorma, temTagVm)
          novos[def.id] = res
          if (res.erro) break
          prev = res
        }
      } else {
        // Modo documento: fluxo original (etapas 0–9 sobre inputHtml)
        let prev = {}
        for (const def of DEFS) {
          const res = executarEtapa(def.id, prev, inputHtml, tipoNorma, temTagVm)
          novos[def.id] = res
          if (res.erro) break
          prev = res
        }
      }
    } catch (_) { /* erro inesperado: usa o que tiver */ }

    setResultados(novos)

    // Último resultado válido
    let ultimoIdx = -1, ultimo = null
    for (let i = novos.length - 1; i >= 0; i--) {
      if (novos[i] && !novos[i].erro) { ultimoIdx = i; ultimo = novos[i]; break }
    }

    if (ultimo) {
      let doc = resultadoParaDoc(ultimo, ultimoIdx)
      if (temTagVm && doc?.content?.length) {
        const { doc: docVM, relatorio } = aplicarNotasVadeMecum(doc)
        doc = docVM
        abrirRelatorioNotasVade(relatorio)
      }
      if (doc?.content?.length) {
        if (modoSelecao && range) {
          // Substitui apenas o trecho selecionado
          editor.commands.insertContentAt({ from: range.from, to: range.to }, doc.content)
        } else {
          // Substitui o documento inteiro
          editor.commands.setContent(doc, false)
        }
        onModificado?.()
      }
      if (ultimo.excecoes) onExcecoes?.(ultimo.excecoes)
    }

    setRodando(false)
  }

  // ── Rotina opcional: Notas Vade Mecum ─────────────────────────
  const [logVadeMecum, setLogVadeMecum] = useState(null)
  const [logEstiloVadeMecum, setLogEstiloVadeMecum] = useState(null)
  const [relatorioVadeMecum, setRelatorioVadeMecum] = useState([])
  const [modalRelatorioVade, setModalRelatorioVade] = useState(false)
  const [relatorioVadeAtivo, setRelatorioVadeAtivo] = useState(-1)

  function nomeRelatorioNotasVade() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
    return `relatorio_notas_vade_mecum_${stamp}.txt`
  }

  function formatarRelatorioNotasVade(relatorio = []) {
    const linhas = [
      'Relatorio de alteracoes - Notas Vade Mecum',
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      `Total de itens: ${relatorio.length}`,
      '',
    ]

    if (!relatorio.length) {
      linhas.push('Nenhuma nota alterada ou excluida.')
      return linhas.join('\r\n')
    }

    relatorio.forEach((item, idx) => {
      linhas.push(`Item ${idx + 1}`)
      linhas.push(`Tipo: ${item.tipo === 'excluida' ? 'Excluida' : 'Alterada'}`)
      linhas.push(`Paragrafo: ${item.paragrafoDepois || item.paragrafoAntes || 'Paragrafo removido'}`)
      linhas.push('Antes:')
      linhas.push(item.antes || '-')
      linhas.push('Depois:')
      linhas.push(item.depois || '-')
      linhas.push('')
    })

    return linhas.join('\r\n')
  }

  async function salvarRelatorioNotasVade(relatorio) {
    if (!relatorio?.length) return

    try {
      await window.legislator?.arquivos?.salvarTxt?.({
        filename: nomeRelatorioNotasVade(),
        conteudo: formatarRelatorioNotasVade(relatorio),
      })
    } catch (err) {
      console.error('Erro ao salvar relatorio de Notas Vade Mecum:', err)
    }
  }

  function abrirRelatorioNotasVade(relatorio) {
    const lista = relatorio || []
    setRelatorioVadeMecum(lista)
    setRelatorioVadeAtivo(-1)
    if (lista.length) {
      setModalRelatorioVade(true)
      salvarRelatorioNotasVade(lista)
    }
  }

  function rodarEstiloVadeMecum() {
    if (!editor || rodando) return
    const docAtual = editor.getJSON()
    const linhas = tiptapDocParaLinhasRicas(docAtual)
    const r = aplicarMarcas(linhas, { estiloVadeMecum: true, somenteEstiloVadeMecum: true })
    editor.commands.setContent(aplicarLinhasNoDoc(docAtual, r.output), false)
    setLogEstiloVadeMecum(r.log.length ? r.log : ['Nenhuma marca de Estilo Vade Mecum aplicada.'])
    onModificado?.()
  }

  function rodarNotasVadeMecum() {
    if (!editor || rodando) return
    const { doc, log, relatorio } = aplicarNotasVadeMecum(editor.getJSON())
    editor.commands.setContent(doc, false)
    setLogVadeMecum(log)
    abrirRelatorioNotasVade(relatorio)
    onModificado?.()
  }

  function posicaoDoBloco(index) {
    if (!editor || index == null || index < 0) return null
    let found = null
    editor.state.doc.forEach((node, offset, idx) => {
      if (idx === index) found = offset + (node.isTextblock ? 1 : 0)
    })
    return found
  }

  function rolarParaAlteracaoVade(item, idx) {
    if (!editor || !item) return
    const pos = posicaoDoBloco(item.targetIndex)
    if (pos == null) return

    setRelatorioVadeAtivo(idx)
    editor.chain().focus().setTextSelection(pos).run()
    requestAnimationFrame(() => {
      try {
        const { node } = editor.view.domAtPos(pos)
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        editor.commands.scrollIntoView()
      }
    })
  }

  // ── Substitui o documento inteiro (modo documento) ─────────────
  function aplicarNoEditor(res, id) {
    if (!editor) return
    const doc = resultadoParaDoc(res, id)
    if (doc) { editor.commands.setContent(doc, false); onModificado?.() }
    if (res.excecoes) onExcecoes?.(res.excecoes)
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="painel-rotinas">

      {/* Indicador de modo + botão executar todas */}
      <div className="rotinas-acoes">
        <div className={`rotinas-modo ${modoSelecao ? 'rotinas-modo-selecao' : 'rotinas-modo-doc'}`}>
          {modoSelecao
            ? `✂ Seleção (${selTexto.length} car.)`
            : inputHtml ? '📄 Documento importado' : '📄 Documento atual'}
        </div>
        <button
          className="btn-rotinas-todas"
          onClick={rodarTodas}
          disabled={!temInput || rodando}
        >
          {rodando ? '⏳ Executando…' : '▶▶ Executar todas'}
        </button>
      </div>

      {/* Lista de etapas */}
      <ul className="rotinas-steps">
        {DEFS.map(def => {
          const res        = resultados[def.id]
          const rodada     = res != null
          const temErro    = rodada && !!res.erro
          const podeRodarDireto = !!editor && !modoSelecao && ROTINAS_INDIVIDUAIS.has(def.id)
          const disponivel = temInput && (podeRodarDireto || def.id === 0 || resultados[def.id - 1] != null)
          const ehUltima   = def.id === ultimaRodada

          return (
            <li key={def.id} className={`rotina-step${ehUltima ? ' ativa' : ''}${temErro ? ' com-erro' : ''}`}>
              <div className="rotina-step-linha">
                <span className="rotina-step-status">
                  {temErro ? '✗' : rodada ? '✓' : '○'}
                </span>
                <span className="rotina-step-nome">{def.nome}</span>
                <button
                  className="btn-step-rodar"
                  onClick={() => rodarEtapa(def.id)}
                  disabled={!disponivel || rodando || modoSelecao}
                  title={
                    modoSelecao    ? 'Etapas individuais indisponíveis no modo seleção — use "Executar todas"' :
                    podeRodarDireto ? 'Executar esta rotina diretamente sobre o documento atual' :
                    !disponivel    ? 'Esta etapa depende da execução da etapa anterior' :
                                     'Executar esta etapa'
                  }
                >
                  ▶
                </button>
              </div>

              {/* Log resumido */}
              {rodada && !temErro && res.log?.length > 0 && (
                <ul className="rotina-step-log">
                  {res.log.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
              {temErro && (
                <div className="rotina-step-erro">{res.erro}</div>
              )}
            </li>
          )
        })}
      </ul>
      {/* Rotinas opcionais — não executadas pelo "Executar todas" */}
      <div className="rotinas-opcionais">
        <div className="rotinas-opcionais-titulo">Rotinas opcionais</div>

        <div className="rotina-opcional-item">
          <button
            className="btn-rotina-opcional"
            onClick={rodarEstiloVadeMecum}
            disabled={!editor || rodando}
            title={temTagVm
              ? 'A tag vm faz esta rotina entrar no fluxo normal; este botao reaplica apenas o Estilo Vade Mecum.'
              : 'Aplica negrito em marcadores de paragrafos/incisos e italico em alineas'}
          >
            Estilo Vade Mecum <strong>§ IV</strong> <em>a)</em>
          </button>

          {logEstiloVadeMecum && (
            <ul className="rotina-step-log">
              {logEstiloVadeMecum.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>

        <div className="rotina-opcional-item">
          <button
            className="btn-rotina-opcional"
            onClick={rodarNotasVadeMecum}
            disabled={!editor || rodando}
            title="Adapta notas para publicação em Vade Mecum"
          >
            📖 Notas Vade Mecum
          </button>

          {logVadeMecum && (
            <ul className="rotina-step-log">
              {logVadeMecum.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>

      </div>

      {modalRelatorioVade && (
        <div className="relatorio-vade-painel">
          <div className="relatorio-vade-card">
            <div className="relatorio-vade-topo">
              <h3>Alterações em notas Vade Mecum</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalRelatorioVade(false)}>x</button>
            </div>

            <div className="relatorio-vade-corpo">
              {relatorioVadeMecum.length === 0 ? (
                <p className="relatorio-vade-vazio">Nenhuma nota alterada ou excluída.</p>
              ) : (
                <ul className="relatorio-vade-lista">
                  {relatorioVadeMecum.map((item, idx) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`relatorio-vade-item${idx === relatorioVadeAtivo ? ' ativo' : ''}`}
                        onClick={() => rolarParaAlteracaoVade(item, idx)}
                      >
                        <span className={`relatorio-vade-tipo relatorio-vade-tipo-${item.tipo}`}>
                          {item.tipo === 'excluida' ? 'Excluída' : 'Alterada'}
                        </span>
                        <span className="relatorio-vade-contexto">
                          {item.paragrafoDepois || item.paragrafoAntes || 'Parágrafo removido'}
                        </span>
                        <span className="relatorio-vade-diff">
                          <span className="relatorio-vade-label">Antes</span>
                          <span className="relatorio-vade-texto">{item.antes || '—'}</span>
                        </span>
                        <span className="relatorio-vade-diff">
                          <span className="relatorio-vade-label">Depois</span>
                          <span className="relatorio-vade-texto">{item.depois || '—'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal-acoes relatorio-vade-acoes">
              <button type="button" className="btn-primary" onClick={() => setModalRelatorioVade(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
