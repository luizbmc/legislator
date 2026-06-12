import { useState, useEffect, useMemo, useRef } from 'react'
import {
  BUSCAS_SALVAS_EVENT,
  buildRegexBuscaSalva,
  carregarBuscasSalvas,
  coletarOcorrenciasBuscaSalva,
  excluirBuscaSalva,
  salvarBuscaSalva,
} from '../../services/buscasSalvas.js'
import {
  estiloAtivoNoTipo,
  estilosParagrafoConfigurados,
} from '../../services/preferenciasEstilo.js'

// ── Legenda de símbolos regex ─────────────────────────────────────
const REGEX_LEGEND = [
  {
    grupo: 'Quantificadores',
    itens: [
      { simbolo: '.',      desc: 'Qualquer caractere (exceto quebra de linha)' },
      { simbolo: '*',      desc: 'Zero ou mais vezes' },
      { simbolo: '+',      desc: 'Uma ou mais vezes' },
      { simbolo: '?',      desc: 'Zero ou uma vez (opcional)' },
      { simbolo: '{n}',    desc: 'Exatamente n vezes' },
      { simbolo: '{n,m}',  desc: 'Entre n e m vezes' },
      { simbolo: '*?',     desc: 'Zero ou mais vezes (não-guloso)' },
      { simbolo: '+?',     desc: 'Uma ou mais vezes (não-guloso)' },
    ],
  },
  {
    grupo: 'Âncoras',
    itens: [
      { simbolo: '^',   desc: 'Início do texto / linha' },
      { simbolo: '$',   desc: 'Fim do texto / linha' },
      { simbolo: '\\b', desc: 'Fronteira de palavra' },
      { simbolo: '\\B', desc: 'Fora de fronteira de palavra' },
    ],
  },
  {
    grupo: 'Classes de caractere',
    itens: [
      { simbolo: '[abc]',   desc: 'a, b ou c' },
      { simbolo: '[^abc]',  desc: 'Qualquer coisa exceto a, b ou c' },
      { simbolo: '[a-z]',   desc: 'Intervalo de a até z' },
      { simbolo: '\\d',     desc: 'Dígito  [0-9]' },
      { simbolo: '\\D',     desc: 'Não-dígito' },
      { simbolo: '\\w',     desc: 'Alfanumérico + sublinhado  [a-zA-Z0-9_]' },
      { simbolo: '\\W',     desc: 'Não-alfanumérico' },
      { simbolo: '\\s',     desc: 'Espaço em branco (espaço, tab, etc.)' },
      { simbolo: '\\S',     desc: 'Não-espaço em branco' },
    ],
  },
  {
    grupo: 'Grupos e alternância',
    itens: [
      { simbolo: '(abc)',    desc: 'Grupo de captura' },
      { simbolo: '(?:abc)',  desc: 'Grupo sem captura' },
      { simbolo: 'a|b',      desc: 'a  ou  b' },
      { simbolo: '(?=abc)',  desc: 'Lookahead positivo — seguido de "abc"' },
      { simbolo: '(?!abc)',  desc: 'Lookahead negativo — não seguido de "abc"' },
    ],
  },
  {
    grupo: 'Substituição  ($1, $2…)',
    itens: [
      { simbolo: '$1, $2…', desc: 'Conteúdo do grupo de captura 1, 2…' },
      { simbolo: '$&',       desc: 'Correspondência completa' },
    ],
  },
  {
    grupo: 'Escape',
    itens: [
      { simbolo: '\\',     desc: 'Escapa o próximo caractere especial' },
      { simbolo: '\\.',    desc: 'Ponto literal (não "qualquer char")' },
      { simbolo: '\\(',    desc: 'Parêntese literal' },
      { simbolo: '\\n',    desc: 'Quebra de linha' },
      { simbolo: '\\t',    desc: 'Tabulação' },
    ],
  },
]

// ── Catálogo de estilos de parágrafo ─────────────────────────────
const ESTILOS_PARAGRAFO = [
  // Identificação
  { id: 'epigrafe',        label: 'Epígrafe' },
  { id: 'epigrafeApelido', label: 'Ep. Apelido' },
  { id: 'notaTitulo',      label: 'Nota título' },
  { id: 'ementa',          label: 'Ementa' },
  { id: 'paragrafAbertura',label: 'Abert. lei' },
  { id: 'paragrafFacoSaber',label: 'Faço saber' },
  { id: 'aberturaCapitulo',label: 'Abert. cap.' },
  // Estrutura
  { id: 'partelivroTitCap',label: 'Parte/Livro/Cap.' },
  { id: 'secaoSubsecao',   label: 'Seção/Subseção' },
  // Articulação
  { id: 'artigo',          label: 'Artigo' },
  { id: 'artigoTitulo',    label: 'Art. Título' },
  { id: 'corpoTratado',    label: 'Corpo tratado' },
  { id: 'paragrafLei',     label: 'Parágrafo' },
  { id: 'nomeJuridico',    label: 'Nome jurídico' },
  { id: 'inciso',          label: 'Inciso' },
  { id: 'alinea',          label: 'Alínea' },
  { id: 'item',            label: 'Item' },
  { id: 'citacao',         label: 'Citação' },
  // Assinatura
  { id: 'data',            label: 'Data' },
  { id: 'assinatura',      label: 'Assinatura' },
  // Texto comum
  { id: 'textoComumTitulo',          label: 'Título' },
  { id: 'textoComumSubtitulo',       label: 'Subtítulo' },
  { id: 'textoComumCorrido',         label: 'Texto corrido' },
  { id: 'textoComumRecuado',         label: 'Texto recuado' },
  { id: 'textoComumCitacao',         label: 'Citação' },
  { id: 'textoComumBullets',         label: 'Bullets' },
  { id: 'textoComumAssinatura',      label: 'Assinatura' },
  { id: 'textoComumAssinaturaCargo', label: 'Assinatura-cargo' },
  // Outros
  { id: 'paragraph',       label: 'Parágrafo base' },
]

// ── Catálogo de estilos de caractere ─────────────────────────────
const ESTILOS_CHAR = [
  { id: 'bold',         label: 'Negrito' },
  { id: 'italic',       label: 'Itálico' },
  { id: 'superscript',  label: 'Sobrescrito' },
  { id: 'subscript',    label: 'Subscrito' },
  { id: 'nota',         label: 'Nota' },
  { id: 'notaSobrescrito', label: 'Nota sobrescrito' },
  { id: 'italicoLight', label: 'Itálico suave' },
  { id: 'boldArtigo',   label: 'Bold-Artigo' },
  { id: 'regular',      label: 'Regular' },
]

// ── Marcas que podem ser aplicadas via painel ────────────────────
const MARCAS_APLICAVEIS = [
  { id: 'bold',         label: 'Negrito' },
  { id: 'italic',       label: 'Itálico' },
  { id: 'boldArtigo',   label: 'Bold-Artigo' },
  { id: 'nota',         label: 'Nota' },
  { id: 'notaSobrescrito', label: 'Nota sobrescrito' },
  { id: 'italicoLight', label: 'Itálico suave' },
  { id: 'regular',      label: 'Regular' },
  { id: 'superscript',  label: 'Sobrescrito' },
  { id: 'subscript',    label: 'Subscrito' },
]

function normalizarEstiloAplicar(valor) {
  if (!valor) return ''
  if (/^(char|par|parcustom):/.test(valor)) return valor
  return `char:${valor}`
}

function tipoEstiloAplicar(valor) {
  const normalizado = normalizarEstiloAplicar(valor)
  if (normalizado.startsWith('char:')) return 'char'
  if (normalizado.startsWith('par:')) return 'par'
  if (normalizado.startsWith('parcustom:')) return 'parcustom'
  return ''
}

function idEstiloAplicar(valor) {
  return normalizarEstiloAplicar(valor).replace(/^(char|par|parcustom):/, '')
}

/**
 * Painel flutuante de Localizar/Substituir para o editor TipTap.
 * Posicionado no canto superior-direito do .editor-principal (position:relative).
 *
 * Props:
 *   editor    — instância TipTap
 *   aberto    — boolean
 *   onFechar  — callback para fechar
 */
export default function PainelBusca({ editor, aberto, onFechar, onModificado, tipoNorma = '' }) {
  const [pat,     setPat]     = useState('')
  const [rep,     setRep]     = useState('')
  const [flagI,   setFlagI]   = useState(true)    // ignorar maiúsculas
  const [useReg,  setUseReg]  = useState(false)   // modo regex

  // Filtros
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [filtroParags,   setFiltroParags]   = useState(new Set()) // {} = todos
  const [filtroChars,    setFiltroChars]    = useState(new Set()) // {} = todos

  // Aplicar estilo de caractere
  const [estiloAplicar, setEstiloAplicar] = useState('')  // char:id, par:id, parcustom:id

  const [matches,    setMatches]    = useState([])  // [{from, to, fullMatch, groups, marks}]
  const [idx,        setIdx]        = useState(-1)
  const [status,     setStatus]     = useState('')
  const [modalRegex, setModalRegex] = useState(false)
  const [modalSalvarBusca, setModalSalvarBusca] = useState(false)
  const [nomeBuscaSalva, setNomeBuscaSalva] = useState('')
  const [buscasSalvas, setBuscasSalvas] = useState(() => carregarBuscasSalvas())
  const [prefsTick, setPrefsTick] = useState(0)

  const patInputRef = useRef(null)
  const estilosParagrafoBase = useMemo(
    () => estilosParagrafoConfigurados({ incluirInternos: true })
      .filter(e => !e.custom && estiloAtivoNoTipo(e, tipoNorma)),
    [tipoNorma, prefsTick]
  )
  const estilosParagrafoCustom = useMemo(
    () => estilosParagrafoConfigurados({ incluirInternos: true })
      .filter(e => e.custom && estiloAtivoNoTipo(e, tipoNorma)),
    [tipoNorma, prefsTick]
  )

  // Foca o campo ao abrir
  function salvarBuscaAtual() {
    if (!pat.trim()) {
      setStatus('Digite uma busca')
      return
    }
    if (!buildRegex(true)) {
      setStatus('Regex inválida')
      return
    }
    setNomeBuscaSalva('')
    setModalSalvarBusca(true)
  }

  function confirmarSalvarBuscaAtual(e) {
    e?.preventDefault?.()
    const nome = nomeBuscaSalva.trim()
    if (!nome) return

    salvarBuscaSalva({
      nome,
      pat,
      rep,
      flagI,
      useReg,
      estiloAplicar,
      filtrosAbertos,
      filtroParags: [...filtroParags],
      filtroChars: [...filtroChars],
    })
    setModalSalvarBusca(false)
    setNomeBuscaSalva('')
    setStatus('Busca salva')
  }

  function aplicarBuscaSalva(busca) {
    setPat(busca.pat ?? '')
    setRep(busca.rep ?? '')
    setFlagI(busca.flagI !== false)
    setUseReg(Boolean(busca.useReg))
    setEstiloAplicar(busca.estiloAplicar ?? '')
    setFiltroParags(new Set(busca.filtroParags ?? []))
    setFiltroChars(new Set(busca.filtroChars ?? []))
    setFiltrosAbertos(Boolean(
      busca.filtrosAbertos ||
      (busca.filtroParags ?? []).length ||
      (busca.filtroChars ?? []).length
    ))
    setMatches([])
    setIdx(-1)
    setStatus('Busca carregada')
  }

  function removerBuscaSalva(id) {
    excluirBuscaSalva(id)
    setBuscasSalvas(carregarBuscasSalvas())
    setStatus('Busca excluída')
  }

  useEffect(() => {
    if (aberto) {
      patInputRef.current?.focus()
      patInputRef.current?.select()
    } else {
      setMatches([])
      setIdx(-1)
      setStatus('')
    }
  }, [aberto])

  useEffect(() => {
    const recarregar = () => setBuscasSalvas(carregarBuscasSalvas())
    window.addEventListener(BUSCAS_SALVAS_EVENT, recarregar)
    window.addEventListener('storage', recarregar)
    return () => {
      window.removeEventListener(BUSCAS_SALVAS_EVENT, recarregar)
      window.removeEventListener('storage', recarregar)
    }
  }, [])

  useEffect(() => {
    const recarregarPrefs = () => setPrefsTick(t => t + 1)
    window.addEventListener('legislator:preferencias-estilo', recarregarPrefs)
    window.addEventListener('storage', recarregarPrefs)
    return () => {
      window.removeEventListener('legislator:preferencias-estilo', recarregarPrefs)
      window.removeEventListener('storage', recarregarPrefs)
    }
  }, [])

  // Reseta matches quando filtros mudam
  function resetMatches() {
    setMatches([])
    setIdx(-1)
    setStatus('')
  }

  // ── Toggle de chip de filtro ─────────────────────────────────────
  function toggleChip(setFn, id) {
    setFn(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    resetMatches()
  }

  // ── Construir regex ──────────────────────────────────────────────
  function buildRegex(global = true) {
    if (!pat) return null
    try {
      return buildRegexBuscaSalva({ pat, flagI, useReg }, global)
    } catch {
      return null
    }
  }

  // ── Coletar todas as ocorrências no doc ──────────────────────────
  function collectMatches() {
    if (!editor || !pat) {
      setMatches([])
      setIdx(-1)
      setStatus('')
      return []
    }
    const regex = buildRegex(true)
    if (!regex) {
      setStatus('Regex inválida')
      setMatches([])
      setIdx(-1)
      return []
    }

    const found = coletarOcorrenciasBuscaSalva(editor, {
      pat,
      flagI,
      useReg,
      filtroParags: [...filtroParags],
      filtroChars: [...filtroChars],
    })

    setMatches(found)
    return found
  }

  // ── Navegar para um match ────────────────────────────────────────
  function navTo(match) {
    if (!match || !editor) return

    // Foca o editor: sem foco a seleção aparece em cinza quase invisível.
    editor.chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .scrollIntoView()
      .run()

    // Scroll de segurança via DOM — garante visibilidade mesmo quando
    // o ProseMirror não detecta o container de overflow correto.
    requestAnimationFrame(() => {
      try {
        const domPos = editor.view.domAtPos(match.from)
        const node   = domPos?.node
        const el     = node instanceof Text    ? node.parentElement
                     : node instanceof Element ? node
                     : null
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      } catch {
        // posição fora do intervalo do doc — ignora silenciosamente
      }
    })
  }

  // ── Próxima ocorrência ───────────────────────────────────────────
  function proxima(ms) {
    const lista = ms ?? collectMatches()
    if (!lista.length) { setStatus('0 ocorrências'); setIdx(-1); return }
    const next = idx < 0 ? 0 : (idx + 1) % lista.length
    setIdx(next)
    navTo(lista[next])
    setStatus(`${next + 1} / ${lista.length}`)
  }

  // ── Ocorrência anterior ──────────────────────────────────────────
  function anterior() {
    const lista = collectMatches()
    if (!lista.length) { setStatus('0 ocorrências'); setIdx(-1); return }
    const prev = idx <= 0 ? lista.length - 1 : idx - 1
    setIdx(prev)
    navTo(lista[prev])
    setStatus(`${prev + 1} / ${lista.length}`)
  }

  // ── Expandir template de substituição ($1, $2, $&) ───────────────
  function expandRep(repTemplate, groups) {
    const [fullMatch, ...caps] = groups
    return repTemplate
      .replace(/\$&/g, fullMatch)
      .replace(/\$(\d+)/g, (_, n) => caps[+n - 1] ?? '')
  }

  function marcasParaSubstituicao(baseMarks = []) {
    if (tipoEstiloAplicar(estiloAplicar) !== 'char') return baseMarks
    const markType = editor?.state?.schema?.marks?.[idEstiloAplicar(estiloAplicar)]
    if (!markType) return baseMarks
    return [
      ...baseMarks.filter(mark => mark.type !== markType),
      markType.create(),
    ]
  }

  function attrsAlteracaoDoNo(node) {
    return {
      alterado: node?.attrs?.alterado ?? null,
      diffType: node?.attrs?.diffType ?? null,
      diffSubtype: node?.attrs?.diffSubtype ?? null,
    }
  }

  function posicaoBlocoEm(tr, pos) {
    if (!tr?.doc) return null
    const limite = Math.max(0, Math.min(pos, tr.doc.content.size))
    const $pos = tr.doc.resolve(limite)
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth)
      if (node?.isTextblock) {
        return { node, pos: depth === 0 ? 0 : $pos.before(depth) }
      }
    }
    return null
  }

  function aplicarEstiloParagrafoEm(tr, pos) {
    const tipo = tipoEstiloAplicar(estiloAplicar)
    if (tipo !== 'par' && tipo !== 'parcustom') return tr

    const bloco = posicaoBlocoEm(tr, pos)
    if (!bloco) return tr

    if (tipo === 'parcustom') {
      const estilo = estilosParagrafoCustom.find(e => e.id === idEstiloAplicar(estiloAplicar))
      const nodeType = editor?.state?.schema?.nodes?.estiloParagrafoCustom
      if (!estilo || !nodeType) return tr
      return tr.setNodeMarkup(bloco.pos, nodeType, {
        ...attrsAlteracaoDoNo(bloco.node),
        styleId: estilo.id,
        label: estilo.label,
        cssClass: estilo.cssClass,
        format: estilo.format,
      })
    }

    const nodeType = editor?.state?.schema?.nodes?.[idEstiloAplicar(estiloAplicar)]
    if (!nodeType) return tr
    return tr.setNodeMarkup(bloco.pos, nodeType, attrsAlteracaoDoNo(bloco.node))
  }

  function aplicarSubstituicaoMatch(tr, match, repText) {
    if (match?.tipo !== 'entreParagrafos') {
      if (repText) {
        tr = tr.replaceWith(match.from, match.to, editor.state.schema.text(repText, marcasParaSubstituicao(match.marks)))
        return aplicarEstiloParagrafoEm(tr, tr.mapping.map(match.from))
      }
      tr = tr.delete(match.from, match.to)
      return aplicarEstiloParagrafoEm(tr, tr.mapping.map(match.from))
    }

    const novoTexto = `${match.combined.slice(0, match.index)}${repText}${match.combined.slice(match.index + match.fullMatch.length)}`
    if (/\n/.test(novoTexto)) {
      throw new Error('A substituição entre parágrafos precisa resultar em um único parágrafo.')
    }

    const contentFrom = match.primeiro.pos + 1
    const contentTo = match.primeiro.pos + 1 + match.primeiro.contentSize
    const deleteFrom = match.primeiro.pos + match.primeiro.nodeSize
    const deleteTo = match.ultimo.pos + match.ultimo.nodeSize

    if (novoTexto) {
      tr = tr.replaceWith(
        tr.mapping.map(contentFrom),
        tr.mapping.map(contentTo),
        editor.state.schema.text(novoTexto, marcasParaSubstituicao(match.marks))
      )
    } else {
      tr = tr.delete(tr.mapping.map(contentFrom), tr.mapping.map(contentTo))
    }
    tr = tr.delete(tr.mapping.map(deleteFrom), tr.mapping.map(deleteTo))
    return aplicarEstiloParagrafoEm(tr, tr.mapping.map(match.primeiro.pos + 1))
  }

  // ── Substituir ocorrência atual ──────────────────────────────────
  function substituir() {
    if (!editor || matches.length === 0 || idx < 0) return
    const m = matches[idx]

    const repText = useReg ? expandRep(rep, m.groups) : rep

    let tr = editor.state.tr
    try {
      tr = aplicarSubstituicaoMatch(tr, m, repText)
    } catch (err) {
      setStatus(err.message || 'Substituição inválida')
      return
    }
    editor.view.dispatch(tr)
    onModificado?.()

    // Re-coletar e avançar para a próxima ocorrência
    setTimeout(() => {
      const nova = collectMatches()
      if (!nova.length) { setStatus('0 ocorrências'); setIdx(-1); return }
      const next = Math.min(idx, nova.length - 1)
      setIdx(next)
      navTo(nova[next])
      setStatus(`${next + 1} / ${nova.length}`)
    }, 0)
  }

  // ── Substituir todas ─────────────────────────────────────────────
  function substituirTodos() {
    if (!editor || !pat) return
    const lista = collectMatches()
    if (!lista.length) { setStatus('0 ocorrências'); return }

    // Processa de trás para frente para preservar posições
    let tr = editor.state.tr
    for (let i = lista.length - 1; i >= 0; i--) {
      const m = lista[i]
      const repText = useReg ? expandRep(rep, m.groups) : rep
      try {
        tr = aplicarSubstituicaoMatch(tr, m, repText)
      } catch (err) {
        setStatus(err.message || 'Substituição inválida')
        return
      }
    }
    editor.view.dispatch(tr)
    onModificado?.()

    const n = lista.length
    setMatches([])
    setIdx(-1)
    setStatus(`${n} substituiç${n !== 1 ? 'ões' : 'ão'}`)
  }

  // ── Aplicar marca ao match atual ────────────────────────────────
  function aplicarEstiloUm() {
    if (!editor || !estiloAplicar || idx < 0 || !matches.length) return
    const m       = matches[idx]

    if (tipoEstiloAplicar(estiloAplicar) !== 'char') {
      const tr = aplicarEstiloParagrafoEm(editor.state.tr, m.from)
      editor.view.dispatch(tr)
      onModificado?.()
      const next = (idx + 1) % matches.length
      setIdx(next)
      navTo(matches[next])
      setStatus(`${next + 1} / ${matches.length}`)
      return
    }

    const markType = editor.state.schema.marks[idEstiloAplicar(estiloAplicar)]
    if (!markType) return

    editor.view.dispatch(
      editor.state.tr.addMark(m.from, m.to, markType.create())
    )
    onModificado?.()

    // Avança para a próxima ocorrência
    const next = (idx + 1) % matches.length
    setIdx(next)
    navTo(matches[next])
    setStatus(`${next + 1} / ${matches.length}`)
  }

  // ── Aplicar marca a todas as ocorrências ─────────────────────────
  function aplicarEstiloTodos() {
    if (!editor || !estiloAplicar) return
    const lista = collectMatches()
    if (!lista.length) { setStatus('0 ocorrências'); return }

    let tr = editor.state.tr

    if (tipoEstiloAplicar(estiloAplicar) !== 'char') {
      const visitados = new Set()
      for (let i = lista.length - 1; i >= 0; i--) {
        const bloco = posicaoBlocoEm(tr, tr.mapping.map(lista[i].from))
        const chave = bloco ? String(bloco.pos) : ''
        if (!bloco || visitados.has(chave)) continue
        visitados.add(chave)
        tr = aplicarEstiloParagrafoEm(tr, bloco.pos + 1)
      }
      editor.view.dispatch(tr)
      onModificado?.()
      const n = visitados.size
      setStatus(`${n} parágrafo${n !== 1 ? 's' : ''} formatado${n !== 1 ? 's' : ''}`)
      return
    }

    const markType = editor.state.schema.marks[idEstiloAplicar(estiloAplicar)]
    if (!markType) return

    const mark = markType.create()
    // Aplica de trás para frente para preservar posições
    for (let i = lista.length - 1; i >= 0; i--) {
      tr = tr.addMark(lista[i].from, lista[i].to, mark)
    }
    editor.view.dispatch(tr)
    onModificado?.()

    const n = lista.length
    setStatus(`${n} trecho${n !== 1 ? 's' : ''} formatado${n !== 1 ? 's' : ''}`)
  }

  // ── Atalhos de teclado ───────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      if (!aberto) return
      if (e.key === 'Escape') { e.preventDefault(); onFechar(); return }
      if (e.key === 'Enter') {
        const dentroDopainel = document.activeElement?.closest?.('.busca-painel')
        if (!dentroDopainel) return
        e.preventDefault()
        e.shiftKey ? anterior() : proxima()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, onFechar, pat, flagI, useReg, filtroParags, filtroChars, matches, idx])

  if (!aberto) return null

  // Contagem de filtros ativos (para o badge)
  const nFiltros = filtroParags.size + filtroChars.size

  return (
    <div className="busca-painel" onKeyDown={e => e.stopPropagation()}>

      {/* ── Linha 1: Localizar ──────────────────────────────── */}
      <div className="busca-linha">
        <input
          ref={patInputRef}
          className="busca-input"
          placeholder="Localizar…"
          value={pat}
          onChange={e => { setPat(e.target.value); resetMatches() }}
          spellCheck={false}
        />

        <button
          className={`busca-flag${flagI ? ' ativa' : ''}`}
          onClick={() => { setFlagI(f => !f); resetMatches() }}
          title="Ignorar maiúsculas/minúsculas"
        >Aa</button>

        <button
          className={`busca-flag${useReg ? ' ativa' : ''}`}
          onClick={() => { setUseReg(f => !f); resetMatches() }}
          title="Usar expressão regular"
        >.*</button>

        <button
          className="busca-flag busca-regex-ajuda"
          onClick={() => setModalRegex(true)}
          title="Legenda de símbolos regex"
        >?</button>

        <button
          className="busca-flag busca-salvar"
          onClick={salvarBuscaAtual}
          disabled={!pat.trim()}
          title="Salvar estado atual do painel de busca"
        >Salvar</button>

        <button
          className="busca-nav"
          onClick={anterior}
          disabled={!pat}
          title="Ocorrência anterior (Shift+Enter)"
        >↑</button>

        <button
          className="busca-nav"
          onClick={() => proxima()}
          disabled={!pat}
          title="Próxima ocorrência (Enter)"
        >↓</button>

        {status && (
          <span className={`busca-status${status === '0 ocorrências' ? ' busca-status-zero' : ''}`}>
            {status}
          </span>
        )}

        <button className="busca-fechar" onClick={onFechar} title="Fechar (Esc)">×</button>
      </div>

      {/* ── Linha 2: Substituir ─────────────────────────────── */}
      <div className="busca-linha">
        <input
          className="busca-input"
          placeholder="Substituir… ($1, $2 para grupos)"
          value={rep}
          onChange={e => setRep(e.target.value)}
          spellCheck={false}
        />

        <button
          className="busca-btn-subst"
          onClick={substituir}
          disabled={!pat || matches.length === 0 || idx < 0}
          title="Substituir ocorrência atual"
        >
          Substituir
        </button>

        <button
          className="busca-btn-subst-todos"
          onClick={substituirTodos}
          disabled={!pat}
          title="Substituir todas as ocorrências"
        >
          Substituir todos
        </button>
      </div>

      {/* ── Linha 3: Aplicar estilo ─────────────────────────── */}
      <div className="busca-linha">
        <span className="busca-estilo-label">Aplicar estilo</span>
        <select
          className="busca-estilo-select"
          value={normalizarEstiloAplicar(estiloAplicar)}
          onChange={e => setEstiloAplicar(e.target.value)}
        >
          <option value="">— nenhum —</option>
          <optgroup label="Caractere">
            {MARCAS_APLICAVEIS.map(m => (
              <option key={m.id} value={`char:${m.id}`}>{m.label}</option>
            ))}
          </optgroup>
          <optgroup label="Parágrafo">
            {estilosParagrafoBase.map(e => (
              <option key={e.node} value={`par:${e.node}`}>{e.painelLabel || e.label}</option>
            ))}
          </optgroup>
          {estilosParagrafoCustom.length > 0 && (
            <optgroup label="Parágrafo personalizado">
              {estilosParagrafoCustom.map(e => (
                <option key={e.id} value={`parcustom:${e.id}`}>{e.painelLabel || e.label}</option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="busca-btn-subst"
          onClick={aplicarEstiloUm}
          disabled={!estiloAplicar || matches.length === 0 || idx < 0}
          title="Aplicar estilo à ocorrência atual"
        >
          Aplicar
        </button>
        <button
          className="busca-btn-subst-todos"
          onClick={aplicarEstiloTodos}
          disabled={!estiloAplicar || !pat}
          title="Aplicar estilo a todas as ocorrências"
        >
          Aplicar todos
        </button>
      </div>

      {/* ── Linha 4: Toggle de filtros ──────────────────────── */}
      <div className="busca-linha busca-linha-filtros">
        <button
          className={`busca-toggle-filtros${filtrosAbertos ? ' ativa' : ''}`}
          onClick={() => setFiltrosAbertos(f => !f)}
        >
          {filtrosAbertos ? '▲' : '▼'} Filtros
          {nFiltros > 0 && <span className="busca-filtros-badge">{nFiltros}</span>}
        </button>

        {nFiltros > 0 && (
          <button
            className="busca-limpar-filtros"
            onClick={() => { setFiltroParags(new Set()); setFiltroChars(new Set()); resetMatches() }}
            title="Limpar todos os filtros"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* ── Seção de filtros (colapsável) ───────────────────── */}
      {filtrosAbertos && (
        <div className="busca-filtros">

          <div className="busca-filtro-grupo">
            <span className="busca-filtro-label">Parágrafo</span>
            <div className="busca-chips">
              {estilosParagrafoBase.map(e => (
                <button
                  key={e.node}
                  className={`busca-chip${filtroParags.has(e.node) ? ' ativa' : ''}`}
                  onClick={() => toggleChip(setFiltroParags, e.node)}
                >
                  {e.painelLabel || e.label}
                </button>
              ))}
              {estilosParagrafoCustom.map(e => {
                const idFiltro = `custom:${e.id}`
                return (
                  <button
                    key={e.id}
                    className={`busca-chip${filtroParags.has(idFiltro) ? ' ativa' : ''}`}
                    onClick={() => toggleChip(setFiltroParags, idFiltro)}
                  >
                    {e.painelLabel || e.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="busca-filtro-grupo">
            <span className="busca-filtro-label">Caractere</span>
            <div className="busca-chips">
              {ESTILOS_CHAR.map(e => (
                <button
                  key={e.id}
                  className={`busca-chip${filtroChars.has(e.id) ? ' ativa' : ''}`}
                  onClick={() => toggleChip(setFiltroChars, e.id)}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      )}

      {buscasSalvas.length > 0 && (
        <div className="buscas-salvas">
          <div className="buscas-salvas-topo">
            <span>Buscas salvas</span>
          </div>
          <div className="buscas-salvas-lista">
            {buscasSalvas.map(busca => (
              <div key={busca.id} className="busca-salva-item">
                <button
                  className="busca-salva-carregar"
                  onClick={() => aplicarBuscaSalva(busca)}
                  title={`${busca.useReg ? 'Regex' : 'Texto'}: ${busca.pat}`}
                >
                  <span className="busca-salva-nome">{busca.nome}</span>
                  <span className="busca-salva-resumo">
                    {busca.useReg ? 'Regex' : 'Texto'}
                    {busca.rep ? ' · substituir' : ''}
                    {busca.estiloAplicar ? ' · estilo' : ''}
                    {((busca.filtroParags ?? []).length || (busca.filtroChars ?? []).length) ? ' · filtros' : ''}
                  </span>
                </button>
                <button
                  className="busca-salva-excluir"
                  onClick={() => removerBuscaSalva(busca.id)}
                  title="Excluir busca salva"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal: legenda de regex ──────────────────────────── */}
      {modalRegex && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setModalRegex(false) }}
        >
          <div
            className="modal-box regex-legenda-modal"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Legenda — Expressões regulares</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalRegex(false)}>✕</button>
            </div>
            <div className="regex-legenda-corpo">
              {REGEX_LEGEND.map(grupo => (
                <div key={grupo.grupo} className="regex-grupo">
                  <h4 className="regex-grupo-titulo">{grupo.grupo}</h4>
                  <table className="regex-tabela">
                    <tbody>
                      {grupo.itens.map(item => (
                        <tr key={item.simbolo}>
                          <td className="regex-simbolo"><code>{item.simbolo}</code></td>
                          <td className="regex-desc">{item.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalSalvarBusca && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setModalSalvarBusca(false) }}
        >
          <div
            className="modal-box salvar-busca-modal"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Salvar busca</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalSalvarBusca(false)}>×</button>
            </div>
            <form className="salvar-busca-form" onSubmit={confirmarSalvarBuscaAtual}>
              <div className="campo">
                <label>Nome da busca</label>
                <input
                  autoFocus
                  value={nomeBuscaSalva}
                  onChange={e => setNomeBuscaSalva(e.target.value)}
                  placeholder="Ex.: espaços no início"
                />
              </div>
              <div className="salvar-busca-preview">
                <span>{useReg ? 'Regex' : 'Texto'}</span>
                <code>{pat}</code>
              </div>
              <div className="modal-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModalSalvarBusca(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={!nomeBuscaSalva.trim()}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
