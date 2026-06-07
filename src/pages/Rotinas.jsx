import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import mammoth from 'mammoth'
import { parseHtmlInput }    from '../services/limpeza/00_parseHtml.js'
import { normalizarTexto }   from '../services/limpeza/01_normalizarTexto.js'
import { normalizarPontuacao } from '../services/limpeza/02_normalizarPontuacao.js'
import { detectarEstrutura } from '../services/limpeza/03_detectarEstrutura.js'
import { aplicarContextuais } from '../services/limpeza/04_contextuais.js'
import { aplicarNBSP }       from '../services/limpeza/05_aplicarNBSP.js'
import { detectarExcecoes }  from '../services/limpeza/06_detectarExcecoes.js'

// ── Descrições das etapas ─────────────────────────────────────────
const ETAPAS = [
  { id: 0, nome: '00 — Extrair texto',        desc: 'Converte o HTML/DOCX em texto puro e separa blocos (tabelas, parágrafos).' },
  { id: 1, nome: '01 — Normalizar texto',      desc: 'Remove NBSP, tabs, alíneas isoladas, une rótulos de título.' },
  { id: 2, nome: '02 — Normalizar pontuação',  desc: 'Corrige datas, travessões, parênteses, espaçamento ao redor de pontuação.' },
  { id: 3, nome: '03 — Detectar estrutura',    desc: 'Classifica cada linha (epígrafe, artigo, inciso, alínea…).' },
  { id: 4, nome: '04 — Ajustes contextuais',   desc: 'Reclassifica linhas com base no contexto (vizinhos).' },
  { id: 5, nome: '05 — Espaços não-separáveis', desc: 'Aplica NBSP em abreviações, números ordinais, etc.' },
  { id: 6, nome: '06 — Detectar exceções',     desc: 'Lista trechos que precisam de revisão manual.' },
]

// ── Regras prontas para debug (espelham o pipeline) ───────────────
const REGRAS_DEBUG = {
  // ── 00: Extrair texto ──────────────────────────────────────────────────────
  0: [
    { desc: 'Hyperlink nota — começa com "("',  pat: '^\\(',                      flags: 'm',  rep: '' },
    { desc: 'Linha em branco',                  pat: '^\\s*$',                    flags: 'gm', rep: '' },
    { desc: 'NBSP no texto extraído',           pat: ' ',                        flags: 'g',  rep: ' ' },
    { desc: 'Múltiplos espaços',                pat: '  +',                         flags: 'g',  rep: ' ' },
  ],

  // ── 01: Normalizar texto ───────────────────────────────────────────────────
  1: [
    { desc: 'NBSP → espaço',                    pat: ' ',                                    flags: 'g',  rep: ' ' },
    { desc: 'Tabs múltiplos → 1 tab',           pat: '\\t+',                                  flags: 'g',  rep: '\\t' },
    { desc: 'Alínea com tab: \\ta)\\t',     pat: '^\\t([a-záéíóúâêôîûàèìòùãõç]\\))\\t', flags: 'gm', rep: '$1 ' },
    { desc: 'Item numerado: \\t1.\\t',      pat: '^\\t(\\d+\\.)\\t',               flags: 'gm', rep: '$1 ' },
    { desc: 'Quebra após vírgula',              pat: ',[ \\t]?\\n',                         flags: 'g',  rep: ', ' },
    { desc: 'Frase partida no meio (minúsc)',   pat: '([^.;:!?\\n])\\n(?![a-záéíóúâêôîûàèìòùãõç]\\s*\\))([a-záéíóúâêôîûàèìòùãõç])', flags: 'g', rep: '$1 $2' },
    { desc: '3+ quebras → 2',                  pat: '(\\n[ \\t]*){3,}',                    flags: 'g',  rep: '\\n\\n' },
    { desc: 'Duplos espaços / tabs',            pat: '[ \\t]{2,}',                            flags: 'g',  rep: ' ' },
    { desc: 'Espaço antes de quebra de linha',  pat: '[ \\t]+(?=\\n)',                      flags: 'g',  rep: '' },
    { desc: 'Espaço no início de linha',        pat: '^ +',                                     flags: 'gm', rep: '' },
    { desc: 'Alínea isolada + (MAIÚSC)',        pat: '^([a-záéíóúâêôîûàèìòùãõç]\\))\\n+(\\([A-Z])', flags: 'gm', rep: '$1 $2' },
    { desc: 'Alínea isolada + 2 minúsculas',   pat: '^([a-záéíóúâêôîûàèìòùãõç]\\))\\n+([a-záéíóúâêôîûàèìòùãõç]{2})', flags: 'gm', rep: '$1 $2' },
    { desc: 'TÍTULO/CAP/etc + Nº + texto → " – "',  pat: '^((?:TÍTULO|CAPÍTULO|LIVRO|PARTE|SUBTÍTULO)\\s+(?:[IVXLCDM]+|\\d+[ºª]?|ÚNICO)[^\\n]*)\\n(?!\\n)([^\\n]+)', flags: 'gm', rep: '$1 – $2' },
    { desc: 'Seção/Subseção + Nº + texto → " – "',  pat: '^((?:Se[çc][aã]o|Subse[çc][aã]o)\\s+(?:[IVXLCDM]+|\\d+[ºª]?)[^\\n]*)\\n(?!\\n)([^\\n]+)', flags: 'gm', rep: '$1 – $2' },
  ],

  // ── 02: Normalizar pontuação ───────────────────────────────────────────────
  2: [
    { desc: '"01/" → "1º/"',                   pat: '\\b01\\/(?=\\d{1,2}\\/\\d{3,4}\\b)', flags: 'g', rep: '1º/' },
    { desc: 'Zero à esq. em dia',              pat: '\\b0([1-9])\\/(?=\\d{1,2}\\/\\d{3,4}\\b)', flags: 'g', rep: '$1/' },
    { desc: 'Zero à esq. em mês',             pat: '\\/0([1-9])\\/(?=\\d{3,4}\\b)',         flags: 'g', rep: '/$1/' },
    { desc: '"éia" → "eia"',                   pat: '\\b([a-záéíóúâêôîûàèìòùãõç]*)éia\\b',      flags: 'gi', rep: '$1eia' },
    { desc: '" - " → " – "',                  pat: ' - ',                                             flags: 'g', rep: ' – ' },
    { desc: '§ § → §§',                       pat: '§ §',                                            flags: 'g', rep: '§§' },
    { desc: 'n° → nº',                        pat: 'n°',                                             flags: 'g', rep: 'nº' },
    { desc: '.) → )',                          pat: '\\.\\)',                                       flags: 'g', rep: ')' },
    { desc: '(Vetado). → (Vetado)',            pat: '\\(Vetado\\)[.;]',                           flags: 'gi', rep: '(Vetado)' },
    { desc: 'VETADO → Vetado',                pat: '\\bVETADO\\b',                               flags: 'g', rep: 'Vetado' },
    { desc: '"1. 2" → "1.2"',                 pat: '(\\d)\\. (\\d)',                           flags: 'g', rep: '$1.$2' },
    { desc: '"1, 2" → "1,2"',                 pat: '(\\d), (\\d)',                               flags: 'g', rep: '$1,$2' },
    { desc: '"1: 2" → "1:2"',                 pat: '(\\d): (\\d)',                               flags: 'g', rep: '$1:$2' },
    { desc: 'Espaço antes de ,.:;)]',         pat: ' ([,.:;)\\]])',                                flags: 'g', rep: '$1' },
    { desc: 'Espaço após ( [',                pat: '([([]) ',                                         flags: 'g', rep: '$1' },
    { desc: 'Espaço após )%º + letra',        pat: '([)\\]%ºª°])([A-Za-záéíóúâêôîûàèìòùãõç])',   flags: 'g', rep: '$1 $2' },
    { desc: 'Espaço após ; :',                pat: '([;:])([A-Za-záéíóúâêôîûàèìòùãõç])',            flags: 'g', rep: '$1 $2' },
    { desc: 'Duplos espaços',                 pat: '  +',                                             flags: 'g', rep: ' ' },
    { desc: 'Espaço no início de linha',      pat: '^ ',                                              flags: 'gm', rep: '' },
    { desc: 'Espaço no final de linha',       pat: ' $',                                              flags: 'gm', rep: '' },
  ],

  // ── 03: Detectar estrutura (regras de classificação) ──────────────────────
  3: [
    { desc: 'Epígrafe: lei/decreto/resolução + nº', pat: '^(Lei|Lei\\s+Complementar|Decreto(?:-[Ll]ei)?|Resolução|Emenda\\s+Constitucional|Ato\\s+da\\s+Mesa|Portaria|Instrução\\s+Normativa|Estatuto|Código|Tratado)\\b.+n[oº°ª]', flags: 'im', rep: '' },
    { desc: 'Parte/Livro/Título/Capítulo',          pat: '^(LIVRO|PARTE|SUBTÍTULO|TÍTULO|CAPÍTULO|Livro|Parte|Subtítulo|Título|Capítulo)\\b', flags: 'm', rep: '' },
    { desc: 'Seção / Subseção',                     pat: '^(Se[çc][aã]o|Subse[çc][aã]o)\\b',       flags: 'im', rep: '' },
    { desc: 'Ementa (Dispõe/Estabelece/Altera…)',   pat: '^(Dispõe|Disciplina|Estatui|Define|Regula|Estabelece|Cria|Institui|Altera|Revoga|Autoriza|Denomina|Fixa|Aprova|Concede|Proíbe|Veda)\\b', flags: 'im', rep: '' },
    { desc: 'Abertura de lei (Faço saber / O Presidente)', pat: '^(Faço\\s+saber|O\\s+Presidente|A\\s+Presidente|O\\s+Vice-Presidente|O\\s+Governador|A\\s+Governadora|PRESIDEN|A\\s+MESA)', flags: 'im', rep: '' },
    { desc: 'Artigo por extenso (Artigo N)',        pat: '^(Artigo|ARTIGO)\\s+\\d+',              flags: 'm', rep: '' },
    { desc: 'Artigo abreviado (Art. N)',             pat: '^Arts?\\.\\s*\\d',                   flags: 'm', rep: '' },
    { desc: 'Parágrafo (§ N ou Parágrafo único)',   pat: '^§\\s*\\d|^Parágrafo\\s+único',       flags: 'im', rep: '' },
    { desc: 'Inciso (romano/sufixo + travessão)',    pat: '^[IVXLCDM]+(?:-[A-Z])?\\s*[–—\\-]\\s', flags: 'm', rep: '' },
    { desc: 'Alínea (letra minúscula + ) )',        pat: '^[a-záéíóúâêôîûàèìòùãõç]\\)\\s',        flags: 'm', rep: '' },
    { desc: 'Item (número + ponto + espaço)',        pat: '^\\d+\\.\\s',                         flags: 'm', rep: '' },
    { desc: 'Nota de título (Publicad/Vigência…)',  pat: '^\\((Publicad|Vigência|Redação\\s+dada|Incluíd|Revogad|NR\\b)', flags: 'im', rep: '' },
    { desc: 'Data de assinatura (Brasília,)',        pat: '^Brasíl[i]?a,',                             flags: 'im', rep: '' },
    { desc: 'Maiúsculas — não classificadas (texto-lei)', pat: '^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ\\s]{10,}$', flags: 'm', rep: '' },
  ],

  // ── 04: Ajustes contextuais ────────────────────────────────────────────────
  4: [
    { desc: 'Epígrafe-apelido: entre dois nós epígrafe + nota-título', pat: '^(?!Lei\\b|Decreto|Resolução|Emenda|Portaria|Instrução|Código|Estatuto|Tratado|Ato\\b)', flags: 'im', rep: '' },
    { desc: 'Artigo pós-título: Art. logo após "Artigo N"',            pat: '^Arts?\\.\\s*\\d',   flags: 'm', rep: '' },
    { desc: 'Data de assinatura (gatilho da seção de assinatura)',     pat: '^Brasíl[i]?a,',            flags: 'im', rep: '' },
    { desc: 'Assinatura-nome: texto-lei após data (não Art/§/inciso)', pat: '^(?![IVXLCDM]+(?:-[A-Z])?\\s*[–—-]|§|Arts?\\.|[a-z]\\))', flags: 'm', rep: '' },
  ],

  // ── 05: NBSP ───────────────────────────────────────────────────────────────
  5: [
    { desc: '§ com espaço comum (deve ter NBSP)',    pat: '§ ',                                         flags: 'g', rep: '§ ' },
    { desc: 'art. N com espaço comum',               pat: '\\bart\\. (\\d)',                      flags: 'g', rep: 'art. $1' },
    { desc: 'arts. N com espaço comum',              pat: '\\barts\\. (\\d)',                     flags: 'g', rep: 'arts. $1' },
    { desc: 'Art. N com espaço comum',               pat: '\\bArt\\. (\\d)',                      flags: 'g', rep: 'Art. $1' },
    { desc: 'Arts. N com espaço comum',              pat: '\\bArts\\. (\\d)',                     flags: 'g', rep: 'Arts. $1' },
    { desc: 'inciso I com espaço comum',             pat: '\\binciso ([IVXLCDM])',                     flags: 'g', rep: 'inciso $1' },
    { desc: 'alínea a com espaço comum',             pat: '\\balínea ([a-záéíóúâêôîûàèìòùãõç])',      flags: 'g', rep: 'alínea $1' },
    { desc: 'nº N com espaço comum',                 pat: '\\bnº (\\d)',                            flags: 'g', rep: 'nº $1' },
    { desc: 'n. N com espaço comum',                 pat: '\\bn\\. (\\d)',                        flags: 'g', rep: 'n. $1' },
    { desc: 'dígito ( com espaço comum',             pat: '(\\d) \\(',                              flags: 'g', rep: '$1 (' },
  ],

  // ── 06: Detectar exceções (padrões que geram alertas) ─────────────────────
  6: [
    { desc: 'Ordinal antigo: 1o, 2a — use 1º, 2ª',      pat: '\\b\\d+[oa]\\b',                  flags: 'g', rep: '' },
    { desc: 'Traço simples em inciso — use travessão',    pat: '^[IVXLCDM]+(?:-[A-Z])? - ',                        flags: 'm', rep: '' },
    { desc: 'Artigo sem símbolo º (Art. 1X)',             pat: '^Arts?\\.\\s+\\d+[^º°o\\s,.]', flags: 'm', rep: '' },
    { desc: 'Parágrafo sem símbolo º (§ 1X)',             pat: '^§\\s*\\d+[^º°o\\s]',            flags: 'm', rep: '' },
    { desc: 'Possível alínea sem parêntese',              pat: '^[a-z]\\s+[^)]',                      flags: 'm', rep: '' },
    { desc: 'Parênteses desbalanceados',                  pat: '\\([^)]*$|^[^(]*\\)',               flags: 'm', rep: '' },
    { desc: 'Linha toda em maiúsc não reconhecida',       pat: '^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ\\s\\-]{15,}$', flags: 'm', rep: '' },
  ],
}


export default function Rotinas() {
  const nav = useNavigate()
  const fileRef = useRef(null)

  const [nomeArq,    setNomeArq]    = useState('')
  const [inputHtml,  setInputHtml]  = useState('')

  const [resultados,   setResultados]   = useState([])
  const [etapaRodada,  setEtapaRodada]  = useState(-1)
  const [vizEtapa,     setVizEtapa]     = useState(0)    // etapa selecionada (regras L/S)
  const [outputEtapa,  setOutputEtapa]  = useState(null) // etapa cujo resultado é exibido

  // ── Estado do Localizar/Substituir ────────────────────────────
  const [lsPat,       setLsPat]       = useState('')
  const [lsRep,       setLsRep]       = useState('')
  const [lsFlags,     setLsFlags]     = useState('g')
  const [lsStatus,    setLsStatus]    = useState(null)    // { count, current?, erro }
  const [lsMatches,   setLsMatches]   = useState([])      // [{start,end}] posições globais
  const [lsMatchIdx,  setLsMatchIdx]  = useState(-1)      // ocorrência ativa (-1 = nenhuma)

  // ── Upload DOCX ───────────────────────────────────────────────
  async function handleArquivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const arrayBuffer = await file.arrayBuffer()
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
    setInputHtml(html)
    setNomeArq(file.name)
    setResultados([])
    setEtapaRodada(-1)
    setVizEtapa(0)
    setOutputEtapa(null)
    setLsStatus(null)
    setLsMatches([])
    setLsMatchIdx(-1)
    e.target.value = ''
  }

  // ── Executa uma etapa ─────────────────────────────────────────
  function rodar(id) {
    const prev = id === 0 ? null : resultados[id - 1]
    let novoResultado
    try {
      switch (id) {
        case 0: {
          const r = parseHtmlInput(inputHtml)
          novoResultado = { texto: r.textoPuro, blocos: r.blocos, log: r.log }
          break
        }
        case 1: {
          const r = normalizarTexto(prev?.texto ?? '')
          novoResultado = { texto: r.output, blocos: prev?.blocos, log: r.log }
          break
        }
        case 2: {
          const r = normalizarPontuacao(prev?.texto ?? '')
          novoResultado = { texto: r.output, blocos: prev?.blocos, log: r.log }
          break
        }
        case 3: {
          const r = detectarEstrutura(prev?.texto ?? '')
          novoResultado = { linhas: r.output, blocos: prev?.blocos, log: r.log }
          break
        }
        case 4: {
          const r = aplicarContextuais(prev?.linhas ?? [])
          novoResultado = { linhas: r.output, blocos: prev?.blocos, log: r.log }
          break
        }
        case 5: {
          const r = aplicarNBSP(prev?.linhas ?? [])
          novoResultado = { linhas: r.output, blocos: prev?.blocos, log: r.log }
          break
        }
        case 6: {
          const r = detectarExcecoes(prev?.linhas ?? [])
          novoResultado = { excecoes: r.excecoes, linhas: prev?.linhas, blocos: prev?.blocos, log: [] }
          break
        }
        default: return
      }
    } catch (err) {
      novoResultado = { erro: String(err), log: [] }
    }

    setResultados(prev => {
      const cópia = [...prev]
      cópia[id] = novoResultado
      for (let i = id + 1; i < ETAPAS.length; i++) cópia[i] = undefined
      return cópia
    })
    setEtapaRodada(id)
    setVizEtapa(id)
    setOutputEtapa(id)
    setLsStatus(null)
    setLsMatches([])
    setLsMatchIdx(-1)
  }

  // ── Helpers de L/S ───────────────────────────────────────────
  // Texto completo de um resultado (para computar posições globais de matches)
  function getTextoStr(r) {
    if (!r) return ''
    if (r.texto  != null) return r.texto
    if (r.linhas != null) return r.linhas.map(l => l.text).join('\n')
    return ''
  }

  // Todas as posições de match no texto completo
  function findAllMatches(texto, pat, flags) {
    if (!pat.trim()) return []
    const matches = []
    let regex
    try {
      const f = flags.includes('g') ? flags : flags + 'g'
      regex = new RegExp(pat, f)
    } catch { return [] }
    let m
    while ((m = regex.exec(texto)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) { regex.lastIndex++; if (regex.lastIndex > texto.length) break }
    }
    return matches
  }

  // Reseta todas as informações de match (ao trocar padrão/flags/etapa)
  function resetMatches() {
    setLsMatches([])
    setLsMatchIdx(-1)
    setLsStatus(null)
  }

  // Salva resultado modificado na etapa vizEtapa
  function salvarModificado(modificado) {
    setResultados(prev => {
      const cópia = [...prev]
      cópia[vizEtapa] = modificado
      for (let i = vizEtapa + 1; i < ETAPAS.length; i++) cópia[i] = undefined
      return cópia
    })
    setEtapaRodada(id => Math.max(id, vizEtapa))
    setOutputEtapa(vizEtapa)
  }

  // Base para operações L/S: resultado da etapa atual (se rodada) ou da anterior
  function getBase() {
    return resultados[vizEtapa] ?? (vizEtapa > 0 ? resultados[vizEtapa - 1] : null)
  }

  // Aplica substituição a um resultado e retorna o resultado modificado
  function aplicarSubst(base, regex, repProcessado) {
    if (base.texto != null) {
      return { ...base, texto: base.texto.replace(regex, repProcessado) }
    }
    if (base.linhas != null) {
      return {
        ...base,
        linhas: base.linhas.map(l => ({ ...l, text: l.text.replace(regex, repProcessado) }))
      }
    }
    return null
  }

  // ── Ações L/S ────────────────────────────────────────────────
  function testar() {
    if (!lsPat.trim()) { setLsStatus({ erro: 'Digite um padrão para buscar.' }); return }
    const base = getBase()
    if (!base) {
      setLsStatus({ erro: vizEtapa === 0 ? 'Execute a etapa 00 primeiro.' : 'Execute a etapa anterior primeiro.' })
      return
    }
    const matches = findAllMatches(getTextoStr(base), lsPat, lsFlags)
    try { new RegExp(lsPat, lsFlags) } catch (e) { setLsStatus({ erro: `Regex inválida: ${e.message}` }); return }
    setLsMatches(matches)
    setLsMatchIdx(-1)
    setLsStatus({ count: matches.length, current: null, erro: null })
  }

  function localizar() {
    if (!lsPat.trim()) { setLsStatus({ erro: 'Digite um padrão para buscar.' }); return }
    const base = getBase()
    if (!base) {
      setLsStatus({ erro: vizEtapa === 0 ? 'Execute a etapa 00 primeiro.' : 'Execute a etapa anterior primeiro.' })
      return
    }
    // Recomputa matches (pode ter mudado após Aplicar/Substituir)
    const matches = findAllMatches(getTextoStr(base), lsPat, lsFlags)
    try { new RegExp(lsPat, lsFlags) } catch (e) { setLsStatus({ erro: `Regex inválida: ${e.message}` }); return }
    setLsMatches(matches)
    if (matches.length === 0) {
      setLsMatchIdx(-1)
      setLsStatus({ count: 0, current: null, erro: null })
      return
    }
    const nextIdx = lsMatchIdx < 0 ? 0 : (lsMatchIdx + 1) % matches.length
    setLsMatchIdx(nextIdx)
    setLsStatus({ count: matches.length, current: nextIdx + 1, erro: null })
  }

  function substituirUm() {
    if (lsMatchIdx < 0 || lsMatches.length === 0) return
    const base = getBase()
    if (!base) return

    // Precisa de 'g' para o replace-callback contar todas as ocorrências
    let regex
    try {
      const f = lsFlags.includes('g') ? lsFlags : lsFlags + 'g'
      regex = new RegExp(lsPat, f)
    } catch (e) { setLsStatus({ erro: `Regex inválida: ${e.message}` }); return }

    const repFinal = lsRep.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    const targetIdx = lsMatchIdx

    // Expande $1 $2 $& no template usando os grupos capturados pelo replace callback.
    // O callback do replace recebe: (fullMatch, g1, g2, ..., offset, string)
    // → fullMatch = cbArgs[0], grupos = cbArgs.slice(1, cbArgs.length - 2)
    function expandRep(...cbArgs) {
      const fullMatch = cbArgs[0]
      const captures  = cbArgs.slice(1, cbArgs.length - 2)
      return repFinal
        .replace(/\$&/g,    fullMatch)
        .replace(/\$(\d+)/g, (_, n) => captures[+n - 1] ?? '')
    }

    // Substitui apenas a ocorrência cujo índice (contado globalmente) é targetIdx
    function replaceNth(texto) {
      let count = 0
      return texto.replace(regex, (...cbArgs) =>
        count++ === targetIdx ? expandRep(...cbArgs) : cbArgs[0]
      )
    }

    let modificado
    if (base.texto != null) {
      modificado = { ...base, texto: replaceNth(base.texto) }
    } else if (base.linhas != null) {
      // Conta matches globalmente através de todas as linhas
      let globalCount = 0
      const novasLinhas = base.linhas.map(l => ({
        ...l,
        text: l.text.replace(regex, (...cbArgs) =>
          globalCount++ === targetIdx ? expandRep(...cbArgs) : cbArgs[0]
        )
      }))
      modificado = { ...base, linhas: novasLinhas }
    } else { return }

    salvarModificado(modificado)

    // Recomputa matches no novo texto e avança para o próximo
    const newMatches = findAllMatches(getTextoStr(modificado), lsPat, lsFlags)
    setLsMatches(newMatches)
    if (newMatches.length === 0) {
      setLsMatchIdx(-1)
      setLsStatus({ count: 0, current: null, erro: null })
    } else {
      const nextIdx = Math.min(lsMatchIdx, newMatches.length - 1)
      setLsMatchIdx(nextIdx)
      setLsStatus({ count: newMatches.length, current: nextIdx + 1, erro: null })
    }
  }

  function aplicarTodos() {
    if (vizEtapa == null) return
    const base = getBase()
    if (!base) return
    let regex
    try { regex = new RegExp(lsPat, lsFlags) }
    catch (e) { setLsStatus({ erro: `Regex inválida: ${e.message}` }); return }
    const repProcessado = lsRep.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    const modificado = aplicarSubst(base, regex, repProcessado)
    if (!modificado) return
    salvarModificado(modificado)
    setLsMatches([])
    setLsMatchIdx(-1)
    setLsStatus(null)
  }

  function toggleFlag(f) {
    setLsFlags(fl => fl.includes(f) ? fl.replace(f, '') : fl + f)
    resetMatches()
  }

  function preencherRegra(regra) {
    setLsPat(regra.pat)
    setLsRep(regra.rep)
    setLsFlags(regra.flags)
    resetMatches()
  }

  // ── Auto-scroll para ocorrência ativa ────────────────────────
  useEffect(() => {
    if (lsMatchIdx >= 0) {
      document.getElementById('ls-active-match')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [lsMatchIdx])

  // ── Render ────────────────────────────────────────────────────
  const res = outputEtapa != null ? resultados[outputEtapa] : null
  const resLS = (() => {
    if (vizEtapa == null) return null
    if (resultados[vizEtapa]     != null) return resultados[vizEtapa]
    if (vizEtapa > 0 && resultados[vizEtapa - 1] != null) return resultados[vizEtapa - 1]
    return null
  })()
  const regrasEtapa = REGRAS_DEBUG[vizEtapa] ?? []
  const temPat = lsPat.trim().length > 0

  return (
    <div className="rotinas-page">

      {/* ── Topbar ──────────────────────────────────────────────── */}
      <header className="editor-topbar">
        <button className="btn-ghost btn-voltar" onClick={() => nav('/')}>← Início</button>
        <div className="editor-titulo">
          <span className="editor-tipo">Diagnóstico</span>
          <span className="editor-epigrafe">Painel de Rotinas</span>
        </div>
        <div />
      </header>

      <div className="rotinas-layout">

        {/* ── Painel esquerdo: upload + lista de etapas ─────────── */}
        <aside className="rotinas-sidebar">

          {/* Upload */}
          <div
            className="rotinas-upload"
            onClick={() => fileRef.current?.click()}
            title="Selecionar arquivo .docx"
          >
            <input ref={fileRef} type="file" accept=".docx" style={{ display: 'none' }} onChange={handleArquivo} />
            {nomeArq
              ? <><span>📄</span><span className="rotinas-upload-nome">{nomeArq}</span></>
              : <><span>📂</span><span className="rotinas-upload-dica">Selecionar .docx</span></>
            }
          </div>

          {/* Lista de etapas */}
          <ul className="rotinas-lista">
            {ETAPAS.map(et => {
              const rodada    = etapaRodada >= et.id && resultados[et.id] != null
              const disponivel = inputHtml && (et.id === 0 || (resultados[et.id - 1] != null))
              const ativa     = vizEtapa === et.id
              const temErro   = resultados[et.id]?.erro != null

              return (
                <li
                  key={et.id}
                  className={`rotina-item${ativa ? ' ativa' : ''}${temErro ? ' erro' : ''}`}
                >
                  <div className="rotina-cabecalho">
                    <span className="rotina-status">
                      {temErro ? '✗' : rodada ? '✓' : '○'}
                    </span>
                    <button
                      className="rotina-nome"
                      onClick={() => setVizEtapa(et.id)}
                      title={et.desc}
                    >
                      {et.nome}
                    </button>
                    <button
                      className={`btn-rotina-rodar${disponivel ? '' : ' desabilitado'}`}
                      onClick={() => disponivel && rodar(et.id)}
                      disabled={!disponivel}
                      title={disponivel ? 'Executar esta etapa' : 'Carregue o arquivo primeiro'}
                    >
                      ▶
                    </button>
                  </div>
                  {rodada && !temErro && resultados[et.id]?.log?.length > 0 && (
                    <ul className="rotina-log">
                      {resultados[et.id].log.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )}
                  {temErro && (
                    <div className="rotina-erro">{resultados[et.id].erro}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </aside>

        {/* ── Área central: saída + L/S ─────────────────────────── */}
        <div className="rotinas-centro">

          {/* Saída da etapa selecionada */}
          <main className="rotinas-output">
            {vizEtapa == null || res == null ? (
              <div className="rotinas-vazio">
                {inputHtml
                  ? 'Execute uma etapa para ver o resultado.'
                  : 'Carregue um arquivo .docx para começar.'}
              </div>
            ) : res.erro ? (
              <div className="rotinas-erro-bloco">
                <strong>Erro na etapa {vizEtapa}</strong>
                <pre>{res.erro}</pre>
              </div>
            ) : res.excecoes != null ? (
              <ExcecoesView excecoes={res.excecoes} />
            ) : res.linhas != null ? (
              <LinhasView linhas={res.linhas} lsMatches={lsMatches} lsMatchIdx={lsMatchIdx} />
            ) : res.texto != null ? (
              <TextoView texto={res.texto} etapa={outputEtapa} lsMatches={lsMatches} lsMatchIdx={lsMatchIdx} />
            ) : null}
          </main>

          {/* ── Painel Localizar/Substituir ────────────────────── */}
          <div className="ls-painel">
            <div className="ls-titulo">🔍 Localizar / Substituir</div>

            <div className="ls-campos">
              <div className="ls-linha">
                <label className="ls-label">Localizar (regex)</label>
                <input
                  className="ls-input"
                  value={lsPat}
                  onChange={e => { setLsPat(e.target.value); resetMatches() }}
                  placeholder="ex: \b01\/(?=\d)"
                  spellCheck={false}
                />
              </div>
              <div className="ls-linha">
                <label className="ls-label">Substituir</label>
                <input
                  className="ls-input"
                  value={lsRep}
                  onChange={e => setLsRep(e.target.value)}
                  placeholder='ex: 1º/ (use \n para quebra, \t para tab)'
                  spellCheck={false}
                />
              </div>
              <div className="ls-linha ls-flags-linha">
                <label className="ls-label">Flags</label>
                <div className="ls-flags">
                  {['g', 'i', 'm'].map(f => (
                    <button
                      key={f}
                      className={`ls-flag${lsFlags.includes(f) ? ' ativa' : ''}`}
                      onClick={() => toggleFlag(f)}
                      title={{ g: 'global (todas ocorrências)', i: 'case-insensitive', m: 'multiline (^ e $ por linha)' }[f]}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Botões de ação */}
            <div className="ls-acoes-bloco">
              <button className="ls-btn-testar"   onClick={testar}       disabled={!temPat}>Testar</button>
              <button className="ls-btn-proxima"  onClick={localizar}    disabled={!temPat}>→ Próxima</button>
              <button className="ls-btn-subst1"   onClick={substituirUm} disabled={!temPat || lsMatchIdx < 0}>Substituir</button>
              <button className="ls-btn-aplicar"  onClick={aplicarTodos} disabled={!temPat || resLS == null}>Aplicar todos</button>
            </div>

            {/* Status */}
            {lsStatus && (
              <div className={`ls-status${lsStatus.erro ? ' ls-status-erro' : lsStatus.count === 0 ? ' ls-status-zero' : ' ls-status-ok'}`}>
                {lsStatus.erro
                  ? `⚠ ${lsStatus.erro}`
                  : lsStatus.count === 0
                    ? '○ Nenhuma ocorrência encontrada'
                    : lsStatus.current != null
                      ? `${lsStatus.current} / ${lsStatus.count} ocorrência(s)`
                      : `✓ ${lsStatus.count} ocorrência(s) encontrada(s)`}
              </div>
            )}

            {/* Regras prontas da etapa atual */}
            {regrasEtapa.length > 0 && (
              <div className="ls-regras">
                <div className="ls-regras-titulo">Regras desta etapa — clique para pré-preencher:</div>
                <ul className="ls-regras-lista">
                  {regrasEtapa.map((r, i) => (
                    <li key={i}>
                      <button className="ls-regra-btn" onClick={() => preencherRegra(r)}>
                        <span className="ls-regra-desc">{r.desc}</span>
                        <code className="ls-regra-pat">/{r.pat}/{r.flags}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Highlight helper ──────────────────────────────────────────────
// Recebe o texto do segmento, o offset global onde ele começa,
// todos os matches globais e o índice do match ativo.
// Devolve partes [{t, hl, active, globalIdx}].
function highlightSegment(text, lineStart, matches, activeIdx) {
  if (!matches || matches.length === 0) return [{ t: text, hl: false }]
  const lineEnd = lineStart + text.length
  const relevant = matches
    .map((m, gi) => ({ ...m, gi }))
    .filter(m => m.end > lineStart && m.start < lineEnd)
  if (relevant.length === 0) return [{ t: text, hl: false }]

  const parts = []
  let pos = 0
  for (const m of relevant) {
    const s = Math.max(0, m.start - lineStart)
    const e = Math.min(text.length, m.end - lineStart)
    if (s > pos) parts.push({ t: text.slice(pos, s), hl: false })
    parts.push({ t: text.slice(s, e) || '​', hl: true, active: m.gi === activeIdx })
    pos = e
  }
  if (pos < text.length) parts.push({ t: text.slice(pos), hl: false })
  return parts
}

// ── Visualizadores ────────────────────────────────────────────────

function TextoView({ texto, etapa, lsMatches, lsMatchIdx }) {
  const linhas = texto.split('\n')
  let lineOffset = 0
  return (
    <div className="rotinas-texto-wrap">
      <div className="rotinas-output-cabec">
        {etapa === 0 ? 'Texto puro extraído' : 'Texto após normalização'}
        <span className="rotinas-contagem">{linhas.length} linha(s)</span>
      </div>
      <pre className="rotinas-pre">
        {linhas.map((l, i) => {
          const lo = lineOffset
          lineOffset += l.length + 1
          const parts = lsMatches.length > 0 ? highlightSegment(l || ' ', lo, lsMatches, lsMatchIdx) : null
          return (
            <div key={i} className={`rotinas-linha${l.trim() === '' ? ' vazia' : ''}`}>
              <span className="rotinas-num">{i + 1}</span>
              <span className="rotinas-conteudo">
                {parts
                  ? parts.map((p, j) => p.hl
                      ? <mark key={j} id={p.active ? 'ls-active-match' : undefined}
                              className={`ls-mark${p.active ? ' ls-mark-active' : ''}`}>{p.t}</mark>
                      : <span key={j}>{p.t}</span>)
                  : (l || ' ')}
              </span>
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function LinhasView({ linhas, lsMatches, lsMatchIdx }) {
  let lineOffset = 0
  return (
    <div className="rotinas-texto-wrap">
      <div className="rotinas-output-cabec">
        Linhas classificadas
        <span className="rotinas-contagem">{linhas.length} linha(s)</span>
      </div>
      <table className="rotinas-tabela-linhas">
        <thead>
          <tr>
            <th>#</th>
            <th>Estilo</th>
            <th>Texto</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => {
            const lo = lineOffset
            lineOffset += l.text.length + 1
            const parts = lsMatches.length > 0 ? highlightSegment(l.text, lo, lsMatches, lsMatchIdx) : null
            return (
              <tr key={i} className={`estilo-${l.style}`}>
                <td className="rotinas-num">{i + 1}</td>
                <td className="rotinas-estilo">{l.style}</td>
                <td className="rotinas-conteudo">
                  {parts
                    ? parts.map((p, j) => p.hl
                        ? <mark key={j} id={p.active ? 'ls-active-match' : undefined}
                                className={`ls-mark${p.active ? ' ls-mark-active' : ''}`}>{p.t}</mark>
                        : <span key={j}>{p.t}</span>)
                    : l.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExcecoesView({ excecoes }) {
  if (excecoes.length === 0) {
    return <div className="rotinas-vazio">✓ Nenhuma exceção detectada.</div>
  }
  return (
    <div className="rotinas-texto-wrap">
      <div className="rotinas-output-cabec">
        Exceções detectadas
        <span className="rotinas-contagem rotinas-contagem-warn">{excecoes.length} item(ns)</span>
      </div>
      <table className="rotinas-tabela-linhas">
        <thead>
          <tr><th>Tipo</th><th>Texto</th></tr>
        </thead>
        <tbody>
          {excecoes.map((ex, i) => (
            <tr key={i}>
              <td className="rotinas-estilo">{ex.tipo}</td>
              <td className="rotinas-conteudo">{ex.texto ?? ex.descricao ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
