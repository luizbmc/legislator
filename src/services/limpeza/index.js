import { parseHtmlInput }    from './00_parseHtml.js'
import { normalizarTexto }     from './01_normalizarTexto.js'
import { normalizarPontuacao } from './02_normalizarPontuacao.js'
import { detectarEstrutura }   from './03_detectarEstrutura.js'
import { aplicarContextuais }  from './04_contextuais.js'
import { aplicarNBSP, NBSP_REGRAS } from './05_aplicarNBSP.js'
import { detectarExcecoes }    from './06_detectarExcecoes.js'
import { aplicarMarcas }       from './07_aplicarMarcas.js'
import { corrigirPontuacaoEnumeracoes } from './08_corrigirPontuacaoEnumeracoes.js'
import { substituirTextoEmNota, RE_EMENDA_CONSTITUCIONAL_NOTA } from './substituirNota.js'
import { aplicarCitacoes } from '../aplicarCitacoes.js'
import { aplicarNotasVadeMecum } from '../notasVadeMecum.js'

/**
 * Mescla conteúdo rico (negrito/itálico) de volta nas linhas classificadas
 * e intercala tabelas nas posições originais.
 *
 * Mapeamento: cada bloco de texto não-vazio do HTML corresponde, em ordem,
 * a uma linha classificada pelo pipeline. Blocos vazios são ignorados
 * (foram descartados por normalizarTexto).
 */
export function mergeComHtml(blocos, classifiedLinhas) {
  const result = []

  // Extrai só letras e dígitos (minúsculas) — imune a mudanças de pontuação entre
  // o texto bruto dos blocos (etapa 00) e o texto normalizado das linhas (etapas 01-02).
  function alphanum(t) {
    return (t || '')
      .replace(/ /g, ' ')                   // NBSP → espaço
      .toLowerCase()
      .replace(/ü/g, 'u')                   // ü → u (mesma normalização da etapa 01)
      .replace(/[^a-z0-9áéíóúâêôîûàèìòùãõç]/g, '') // remove tudo exceto letras/dígitos
  }

  // Retorna true se os primeiros N caracteres alfanuméricos coincidem.
  // N = min(30, comprimento do menor) — resistente a transformações de pontuação.
  function prefixMatch(blocoText, classText) {
    const a = alphanum(blocoText)
    const b = alphanum(classText)
    const len = Math.min(a.length, b.length, 30)
    return len >= 4 && a.slice(0, len) === b.slice(0, len)
  }

  // Aplica as normalizações de texto (etapas 01-02) aos nós de texto dentro do content
  // do bloco, para que traços, NBSP etc. fiquem consistentes com o classified.text.
  function normalizeContent(content) {
    if (!content) return content
    const normalizado = content.map(node => {
      if (node.type !== 'text' || !node.text) return node
      // Etapas 01-02: normaliza o texto do bloco HTML para igualar o texto classificado
      let t = node.text
        .replace(/ /g, ' ')    // NBSP → espaço normal (etapa 01)
        .replace(/ - /g, ' – ')       // hífen com espaços → travessão (etapa 02)
        .replace(/n°/g, 'nº')         // n° → nº (etapa 02)
        .replace(/§ §/g, '§§')        // § § → §§ (etapa 02)
      // Etapa 05: reaplica NBSP onde necessário (mesmo conteúdo rico)
      t = NBSP_REGRAS.reduce((s, [pat, rep]) => s.replace(pat, rep), t)
      return t === node.text ? node : { ...node, text: t }
    })

    // O texto puro da pipeline remove a indentacao visual importada do Word/HTML.
    // Faz o mesmo no conteudo rico sem perder marks como italico ou negrito.
    const semRecuoInicial = [...normalizado]
    for (let i = 0; i < semRecuoInicial.length; i++) {
      const node = semRecuoInicial[i]
      if (node.type !== 'text') break

      const text = node.text.replace(/^[ \t\u00a0\r\n]+/, '')
      if (text) {
        if (text !== node.text) semRecuoInicial[i] = { ...node, text }
        break
      }

      semRecuoInicial.splice(i, 1)
      i--
    }

    return semRecuoInicial
  }

  // Insere na saída todas as tabelas que aparecem em blocos[ptr..upTo)
  let blocoPtr = 0
  function drainTables(upTo) {
    while (blocoPtr < upTo) {
      if (blocos[blocoPtr].type === 'table') {
        result.push({ isTable: true, style: '_table', text: '', tableNode: blocos[blocoPtr].node })
      }
      blocoPtr++
    }
  }

  for (const classified of classifiedLinhas) {
    // Busca o bloco cujo texto é prefixo da linha classificada,
    // avançando no máximo 5 blocos de texto sem match (os que foram fundidos pela pipeline)
    let matchIdx = -1
    let textosVistos = 0

    for (let i = blocoPtr; i < blocos.length && textosVistos <= 5; i++) {
      const bloco = blocos[i]
      if (bloco.type === 'table') continue           // tabelas não consomem slot de texto
      if (!bloco.text?.trim()) continue              // blocos vazios ignorados
      if (prefixMatch(bloco.text, classified.text)) {
        matchIdx = i
        break
      }
      textosVistos++
    }

    if (matchIdx >= 0) {
      drainTables(matchIdx)      // insere tabelas que aparecem antes do bloco encontrado
      blocoPtr = matchIdx + 1
      const bloco = blocos[matchIdx]
      const temMarca = bloco.content?.some(n => n.marks?.length)

      let content
      if (temMarca) {
        const normalizedContent = normalizeContent(bloco.content)
        // Verifica se a linha classificada é mais longa que o bloco rico —
        // isso indica que a etapa 01 fundiu o bloco com a linha seguinte.
        // Nesse caso, o conteúdo do bloco cobre apenas uma parte do texto
        // classificado; acrescentamos o sufixo como nó de texto simples para
        // evitar que o texto fundido ("Seção I – Da Carteira...") apareça truncado.
        const richAlpha  = alphanum(normalizedContent.map(n => n.text || '').join(''))
        const classAlpha = alphanum(classified.text)
        if (classAlpha.length > richAlpha.length + 3) {
          // Localiza o separador " – " após o trecho coberto pelo bloco rico
          const dashIdx = classified.text.indexOf(' – ', Math.max(0, bloco.text.length - 5))
          const sufixo  = dashIdx >= 0 ? classified.text.slice(dashIdx) : ''
          content = sufixo
            ? [...normalizedContent, { type: 'text', text: sufixo, marks: [] }]
            : undefined   // sem separador: usa o texto classificado puro como fallback
        } else {
          content = normalizedContent
        }
      }

      result.push({ ...classified, content })
    } else {
      // Nenhum bloco correspondente (linha surgiu de merge) — sem rich content
      result.push(classified)
    }
  }

  // Insere tabelas remanescentes no final do documento
  while (blocoPtr < blocos.length) {
    if (blocos[blocoPtr].type === 'table') {
      result.push({ isTable: true, style: '_table', text: '', tableNode: blocos[blocoPtr].node })
    }
    blocoPtr++
  }

  return result
}

function normalizarTextoNota(nodes) {
  RE_EMENDA_CONSTITUCIONAL_NOTA.lastIndex = 0
  return substituirTextoEmNota(nodes, RE_EMENDA_CONSTITUCIONAL_NOTA, 'EC').content
}

export function normalizarDocNotas(doc) {
  function walk(node) {
    if (!node?.content?.length) return node
    // Substitui "Emenda Constitucional" → "EC" nos nós inline deste nível
    // (cobrindo matches que atravessam a fronteira entre nós nota), e então
    // desce recursivamente para os blocos filhos.
    RE_EMENDA_CONSTITUCIONAL_NOTA.lastIndex = 0
    const content = substituirTextoEmNota(node.content, RE_EMENDA_CONSTITUCIONAL_NOTA, 'EC')
      .content
      .map(walk)
    return { ...node, content }
  }

  return walk(doc)
}

/**
 * Executa a pipeline completa de limpeza e classificação.
 * @param {string} input — HTML ou texto puro colado pelo usuário
 * @returns {{ linhas, excecoes, etapas }}
 */
export function pipeline(input, { tipoNorma = '', estiloVadeMecum = false } = {}) {
  const etapas = []
  let blocos   = null   // null → entrada não era HTML

  // ── Etapa 0: parse HTML (se aplicável) ───────────────────────
  const isHtml = /<[a-zA-Z][\s\S]*?>/.test(input)
  let textoParaPipeline = input

  if (isHtml) {
    const parsed = parseHtmlInput(input)
    blocos = parsed.blocos
    textoParaPipeline = parsed.textoPuro
    if (parsed.log.length) {
      etapas.push({ nome: 'Análise do conteúdo colado', log: parsed.log })
    }
  }

  // ── Etapas 1–5 sobre texto puro ──────────────────────────────
  const e1 = normalizarTexto(textoParaPipeline, { tipoNorma })
  etapas.push({ nome: 'Normalização de texto',      log: e1.log })

  const e2 = normalizarPontuacao(e1.output)
  etapas.push({ nome: 'Normalização de pontuação',  log: e2.log })

  const e3 = detectarEstrutura(e2.output, { tipoNorma })
  etapas.push({ nome: 'Detecção de estrutura',      log: e3.log })

  const e4 = aplicarContextuais(e3.output)
  etapas.push({ nome: 'Ajustes contextuais',        log: e4.log })

  const e5 = aplicarNBSP(e4.output)
  etapas.push({ nome: 'Espaços não-separáveis',     log: e5.log })

  // ── Mescla rich content + tabelas (somente se veio de HTML) ──
  const merged = blocos
    ? mergeComHtml(blocos, e5.output)
    : e5.output

  // ── Etapa 6: marcas de caractere (bold-artigo etc.) ──────────
  const e6m = aplicarMarcas(merged, { estiloVadeMecum })
  etapas.push({ nome: 'Marcas de caractere', log: e6m.log })

  const e7p = corrigirPontuacaoEnumeracoes(e6m.output)
  etapas.push({ nome: 'Pontuação de enumerações', log: e7p.log })

  // ── Detecção de exceções (sobre texto puro) ───────────────────
  const { excecoes } = detectarExcecoes(e7p.output)

  return { linhas: e7p.output, excecoes, etapas }
}

export function pipelineDeBlocos(textoParaPipeline, blocos = null, { tipoNorma = '', estiloVadeMecum = false } = {}) {
  const etapas = []

  const e1 = normalizarTexto(textoParaPipeline, { tipoNorma })
  etapas.push({ nome: 'NormalizaÃ§Ã£o de texto', log: e1.log })

  const e2 = normalizarPontuacao(e1.output)
  etapas.push({ nome: 'NormalizaÃ§Ã£o de pontuaÃ§Ã£o', log: e2.log })

  const e3 = detectarEstrutura(e2.output, { tipoNorma })
  etapas.push({ nome: 'DetecÃ§Ã£o de estrutura', log: e3.log })

  const e4 = aplicarContextuais(e3.output)
  etapas.push({ nome: 'Ajustes contextuais', log: e4.log })

  const e5 = aplicarNBSP(e4.output)
  etapas.push({ nome: 'EspaÃ§os nÃ£o-separÃ¡veis', log: e5.log })

  const merged = blocos?.length
    ? mergeComHtml(blocos, e5.output)
    : e5.output

  const e6m = aplicarMarcas(merged, { estiloVadeMecum })
  etapas.push({ nome: 'Marcas de caractere', log: e6m.log })

  const e7p = corrigirPontuacaoEnumeracoes(e6m.output)
  etapas.push({ nome: 'PontuaÃ§Ã£o de enumeraÃ§Ãµes', log: e7p.log })

  const { excecoes } = detectarExcecoes(e7p.output)

  return { linhas: e7p.output, excecoes, etapas }
}

function tiptapFinalDeLinhas(linhas, excecoes, etapas, { notasVadeMecum = false } = {}) {
  const docBase = linhasParaTiptap(linhas)
  const { doc, log } = aplicarCitacoes(docBase)
  const etapasComCitacoes = [
    ...etapas,
    { nome: 'Aplicar citações', log },
  ]
  let docFinal = normalizarDocNotas(doc)

  if (notasVadeMecum) {
    const { doc: docVM, log: logVM } = aplicarNotasVadeMecum(docFinal)
    docFinal = normalizarDocNotas(docVM)
    etapasComCitacoes.push({ nome: 'Notas Vade Mecum', log: logVM })
  }

  return {
    doc: docFinal,
    excecoes,
    etapas: etapasComCitacoes,
  }
}

export function processarEntradaParaTiptap(input, { tipoNorma = '', estiloVadeMecum = false, notasVadeMecum = false } = {}) {
  const { linhas, excecoes, etapas } = pipeline(input, { tipoNorma, estiloVadeMecum })
  return tiptapFinalDeLinhas(linhas, excecoes, etapas, { notasVadeMecum })
}

export function processarBlocosParaTiptap({ textoPuro = '', blocos = [] } = {}, { tipoNorma = '', estiloVadeMecum = false, notasVadeMecum = false } = {}) {
  const { linhas, excecoes, etapas } = pipelineDeBlocos(textoPuro, blocos, { tipoNorma, estiloVadeMecum })
  return tiptapFinalDeLinhas(linhas, excecoes, etapas, { notasVadeMecum })
}

// ── Mapeamento nó TipTap ────────────────────────────────────────
const STYLE_TO_NODE = {
  'epigrafe':                   'epigrafe',
  'epigrafe-apelido':           'epigrafeApelido',
  'nota-titulo':                'notaTitulo',
  'ementa':                     'ementa',
  'paragrafo-abertura':         'paragrafAbertura',
  'paragrafo-faco-saber':       'paragrafFacoSaber',
  'texto-lei-faco-saber':       'paragrafFacoSaber',
  'abertura-capitulo':          'aberturaCapitulo',
  'parte-livro-tit-cap':        'partelivroTitCap',
  'secao-subsecao':             'secaoSubsecao',
  'artigo':                     'artigo',
  'artigo-titulo':              'artigoTitulo',
  'corpo-tratado':              'corpoTratado',
  'artigo-pos-titulo':          'artigo',
  'paragrafo':                  'paragrafLei',
  'nome-juridico':              'nomeJuridico',
  'inciso':                     'inciso',
  'alinea':                     'alinea',
  'item':                       'item',
  'citacao':                    'citacao',
  'data':                       'data',
  'assinatura':                 'assinatura',
  'assinatura-data':            'data',
  'assinatura-nome':            'assinatura',
  'assinatura-nome-espaco-ant': 'assinatura',
  'texto-lei':                  'paragrafLei',
}

// ── Trim de trailing whitespace em content inline ────────────────
function trimInlineTrailing(nodes) {
  const result = [...nodes]
  // Remove nós inteiramente brancos do final
  while (result.length > 0) {
    const last = result[result.length - 1]
    if (last.type === 'text' && !last.text?.trim()) result.pop()
    else break
  }
  // Apara espaço/NBSP final do último nó com conteúdo
  if (result.length > 0) {
    const last = result[result.length - 1]
    if (last.type === 'text') {
      const trimmed = last.text.replace(/[  ]+$/, '')
      if (trimmed !== last.text)
        result[result.length - 1] = trimmed ? { ...last, text: trimmed } : result.splice(-1, 1)[0]
      if (!trimmed) result.pop()
    }
  }
  return result
}

/**
 * Converte o array de linhas classificadas em JSON do TipTap.
 * Suporta linhas com `isTable: true` (preservadas do HTML original)
 * e linhas com `content` (negrito/itálico preservados).
 */
export function linhasParaTiptap(linhas) {
  return {
    type: 'doc',
    content: linhas
      .filter(l => l.isTable || (l.style !== 'vazio' && l.text && l.text.trim()))
      .map(l => {
        // Tabela → emite o nó TipTap diretamente
        if (l.isTable) return l.tableNode

        const nodeType = STYLE_TO_NODE[l.style] ?? 'paragrafLei'

        // Rich content (com marks) se disponível, senão texto puro
        let content = (l.content && l.content.length > 0)
          ? normalizarTextoNota(trimInlineTrailing(l.content))
          : l.text ? [{ type: 'text', text: l.text.replace(/[  ]+$/, '') }] : []

        // Descarta linha se ficou sem conteúdo após trim
        if (!content.length) return null

        return { type: nodeType, content }
      })
      .filter(Boolean),
  }
}
