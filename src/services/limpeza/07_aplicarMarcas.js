import { applyTextNota, fillNotaGaps } from './00_parseHtml.js'
import { substituirTextoEmNota, RE_EMENDA_CONSTITUCIONAL_NOTA, RE_PARENTESE_INTERMEDIARIO_NOTA, RE_VETADO_CAIXA_ALTA_NOTA } from './substituirNota.js'

/**
 * Etapa 07 — Aplicar marcas de caractere
 *
 * Opera sobre as linhas já mescladas com rich content (pós-mergeComHtml).
 * Antes de aplicar as marcas, detecta blocos de citação e reclassifica
 * as linhas correspondentes para style 'citacao', garantindo que seus
 * identificadores (Art., §, incisos, alíneas, Parágrafo único) nunca
 * recebam negrito ou itálico.
 *
 * Regras de marcas implementadas:
 *
 *   boldArtigo — rótulo de artigo no início de linhas `artigo`
 *     Ex.: "Art. 1º", "Art. 1.", "Art. 1º-A.", "Arts. 2º a 5."
 *
 *   bold — rótulos em maiúsculas seguidos de travessão, "Pena –" e
 *          marcadores de parágrafo (§)
 *     Ex.: "CAPÍTULO I –", "SEÇÃO II –", "Pena –", "§ 1º", "§ 2º-A."
 */

// ── Detecção de blocos de citação (pré-processamento) ────────────
//
// Executada ANTES da aplicação de marcas para que identificadores dentro
// de citações (Art., §, incisos, alíneas, Parágrafo único) nunca recebam
// negrito ou itálico.

const ABRE_ASPAS_CIT  = /^["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]/
const FECHA_ASPAS_CIT = /["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]\s*(?:\([^)]{0,160}\))?\s*$/
const TERMINA_COM_DOIS_PONTOS_OU_NOTA_CIT = /:\s*(?:\([^)]{0,260}\)\s*)*$/

// Estilos que nunca são reclassificados como citação (equivalente ao
// TIPOS_FIXOS do aplicarCitacoes.js, mas com os nomes de style do pipeline)
const ESTILOS_FIXOS_CIT = new Set([
  'epigrafe', 'epigrafe-apelido', 'nota-titulo', 'ementa',
  'paragrafo-abertura', 'abertura-capitulo', 'parte-livro-tit-cap', 'secao-subsecao',
  'data', 'assinatura', 'assinatura-data', 'assinatura-nome',
])

/**
 * Percorre as linhas e reclassifica para style 'citacao' aquelas que
 * pertencem a blocos de citação — mesma lógica de detecção de aplicarCitacoes.js.
 */
function reclassificarCitacoes(linhas) {
  let emCitacao         = false
  let prevFoiCitFechada = false
  let prevNaoVazioText  = ''

  return linhas.map(linha => {
    if (linha.isTable) return linha
    const text = (linha.text ?? '').trim()
    if (!text) return linha

    if (!emCitacao) {
      const abre = ABRE_ASPAS_CIT.test(text)
      const prevTerminouComDoisPontos = TERMINA_COM_DOIS_PONTOS_OU_NOTA_CIT.test(prevNaoVazioText)

      if (abre && (prevTerminouComDoisPontos || prevFoiCitFechada)) {
        emCitacao         = true
        prevFoiCitFechada = false
      } else {
        prevFoiCitFechada = false
      }
    }

    let resultado = linha
    if (emCitacao && !ESTILOS_FIXOS_CIT.has(linha.style)) {
      resultado = { ...linha, style: 'citacao' }
    }

    if (emCitacao && FECHA_ASPAS_CIT.test(text)) {
      emCitacao         = false
      prevFoiCitFechada = true
    }

    prevNaoVazioText = text
    return resultado
  })
}

// ── Estilos que nunca devem ter marcas de caractere ─────────────
// O visual desses nós é controlado inteiramente pelo CSS do nó.
const ESTILOS_SEM_MARCAS = new Set(['epigrafe', 'epigrafe-apelido'])

// ── Padrões de marcas de caractere ───────────────────────────────

// Rótulo de artigo: "Art. 1º", "Art. 1.", "Art. 1º-A.", "Arts. 2º a 5."
const RE_BOLD_ARTIGO = /^Arts?\.?\s\d[\d.]*[ºª]?(-[A-Z])?\.?(\sa\s\d[\d.]*\.?)?/

// Rótulos com bold normal — três alternativas:
//   1. Uma ou mais letras maiúsculas, com sufixo opcional "-X" ou "-1",
//      seguidas de espaço + travessão
//      Ex.: "VII –", "VII-A –", "CAPÍTULO –", "SEÇÃO –"
//   2. "Pena –" (cláusula penal)
//   3. Marcador de parágrafo "§ Nº" com opcionais: ponto, ordinal, sufixo letra
//      Ex.: "§ 1º", "§ 2.", "§ 10º-A."
const RE_BOLD_NORMAL = /^(?:\p{Lu}+(-[\p{Lu}\d]+)?\s–|Pena\s–|§\s\d+\.?[ºª]?(?:-\p{Lu}\.?)?)/u

// Rótulo de alínea: letra minúscula seguida de parêntese fechado
// Ex.: "a)", "b)", "z)"
// \p{Ll} = qualquer letra minúscula Unicode (inclui letras acentuadas)
const RE_ITALIC_ALINEA = /^\p{Ll}\)/u

// "Parágrafo único." no início de linha com estilo paragrafLei
const RE_ITALIC_PAR_UNICO = /^Parágrafo único\./

// ── Helper ────────────────────────────────────────────────────────

/**
 * Aplica uma marca a um intervalo [from, to) dentro do array de nós
 * inline de TipTap. Divide nós de texto conforme necessário para inserir
 * a marca apenas no trecho correspondente.
 *
 * Formato de nó: { type: 'text', text: '...', marks?: [{type}] }
 */
function addMarkToContent(content, from, to, markType) {
  const newMark = { type: markType }
  const result  = []
  let pos = 0

  for (const node of content) {
    // Nós não-texto (inline widgets, etc.) — passa direto
    if (node.type !== 'text') {
      result.push(node)
      continue
    }

    const nodeStart = pos
    const nodeEnd   = pos + node.text.length
    pos = nodeEnd

    // Completamente fora do intervalo — mantém intacto
    if (nodeEnd <= from || nodeStart >= to) {
      result.push(node)
      continue
    }

    const marks      = node.marks ?? []
    const jaTemMarca = marks.some(m => m.type === markType)

    // Fatia anterior ao intervalo
    if (nodeStart < from) {
      result.push({ ...node, text: node.text.slice(0, from - nodeStart) })
    }

    // Fatia dentro do intervalo — recebe a nova marca
    const s = Math.max(nodeStart, from) - nodeStart
    const e = Math.min(nodeEnd,   to)   - nodeStart
    result.push({
      ...node,
      text:  node.text.slice(s, e),
      marks: jaTemMarca ? marks : [...marks, newMark],
    })

    // Fatia posterior ao intervalo
    if (nodeEnd > to) {
      result.push({ ...node, text: node.text.slice(to - nodeStart) })
    }
  }

  return result
}

// Remove aspas ao redor de “Caput” dentro de nós com marca nota.
function sameInlineContent(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Usa \uXXXX para evitar problemas de encoding do arquivo fonte:
//   “ = “   (reta)
//   “ = “   (inglesa esquerda)
//   ” = “   (inglesa direita)
//   « = «   (angular esquerda)
//   » = »   (angular direita)
//   ‘ = ‘   (simples esquerda)
//   ’ = ‘   (simples direita)
const RE_CAPUT_ASPAS = /["“”«»‘’]Caput["“”«»‘’]/g

/**
 * Em cada nó de texto com marca `nota`, substitui "Caput" (com aspas)
 * por Caput (sem aspas), preservando todas as outras marcas.
 */
function removeAspasCaputInNota(content) {
  if (!content?.length) return content
  let changed = false
  const novoContent = content.map(node => {
    if (node.type !== 'text') return node
    const hasNota = (node.marks ?? []).some(m => m.type === 'nota')
    if (!hasNota) return node
    const novoTexto = node.text.replace(RE_CAPUT_ASPAS, 'Caput')
    if (novoTexto === node.text) return node
    changed = true
    return { ...node, text: novoTexto }
  })
  return changed ? novoContent : content
}

// Palavras que devem receber itálico quando já estão dentro de nota.
const RE_KW_NOTA_ITALIC = /DOU|Caput/g
const RE_ASPAS_NOTA_ITALIC = /["“”«»‘’]([^"“”«»‘’]{1,120})["“”«»‘’]/g
const RE_ADIN_NOTA = /\bADIN\b/g
const RE_NOS_SOBRESCRITO = /\bn[\u00ba\u00b0]s\b/g

function hasMark(marks, type) {
  return (marks ?? []).some(mark => mark.type === type)
}

function addMark(marks, type) {
  return hasMark(marks, type) ? marks : [...(marks ?? []), { type }]
}

function textoDoContent(content) {
  return (content ?? []).map(node => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    return ''
  }).join('')
}

function normalizarNosSobrescrito(content) {
  if (!content?.length) return { content, count: 0 }
  const result = []
  let count = 0

  for (const node of content) {
    if (node.type !== 'text') {
      result.push(node)
      continue
    }

    RE_NOS_SOBRESCRITO.lastIndex = 0
    let lastIndex = 0
    let match
    let found = false

    while ((match = RE_NOS_SOBRESCRITO.exec(node.text)) !== null) {
      found = true
      count++
      if (match.index > lastIndex) {
        result.push({ ...node, text: node.text.slice(lastIndex, match.index) })
      }
      result.push({ ...node, text: 'n' })
      result.push({ ...node, text: 'os', marks: addMark(node.marks ?? [], 'superscript') })
      lastIndex = match.index + match[0].length
    }

    if (!found) {
      result.push(node)
    } else if (lastIndex < node.text.length) {
      result.push({ ...node, text: node.text.slice(lastIndex) })
    }
  }

  return { content: count ? result : content, count }
}

function semItalicEmNotaMarks(marks) {
  if (!hasMark(marks, 'nota')) return marks ?? []
  return (marks ?? []).filter(mark => mark.type !== 'italic')
}

function normalizarItalicoEmNota(content) {
  if (!content?.length) return content
  let changed = false
  const novoContent = content.map(node => {
    if (node.type !== 'text' || !hasMark(node.marks, 'nota')) return node
    const marks = semItalicEmNotaMarks(node.marks)
    if (marks.length === (node.marks ?? []).length) return node
    changed = true
    return marks.length ? { ...node, marks } : { type: 'text', text: node.text }
  })
  return changed ? novoContent : content
}

function addItalicMatchesInNotaNode(node, regex) {
  const marks = node.marks ?? []
  if (!hasMark(marks, 'nota')) return { nodes: [node], changed: false }

  regex.lastIndex = 0
  const result = []
  let lastIndex = 0
  let match
  let changed = false

  while ((match = regex.exec(node.text)) !== null) {
    const inicio = match.index + (match[1] !== undefined ? match[0].indexOf(match[1]) : 0)
    const fim = inicio + (match[1] !== undefined ? match[1].length : match[0].length)
    if (fim <= inicio) continue

    changed = true
    if (inicio > lastIndex) {
      result.push({ ...node, text: node.text.slice(lastIndex, inicio), marks })
    }
    result.push({ ...node, text: node.text.slice(inicio, fim), marks: addMark(marks, 'italic') })
    lastIndex = fim
  }

  if (!changed) return { nodes: [node], changed: false }
  if (lastIndex < node.text.length) {
    result.push({ ...node, text: node.text.slice(lastIndex), marks })
  }

  return { nodes: result, changed: true }
}

/**
 * Percorre os nós inline de uma linha e, nos nós que já têm a marca
 * `nota`, remove itálico herdado do Word e aplica `italic` apenas em
 * palavras-chave e termos entre aspas.
 */
function addItalicToKeywordsInNota(content) {
  if (!content?.length) return content
  const result = []
  let changed = false

  for (const node of content) {
    if (node.type !== 'text') { result.push(node); continue }

    if (!hasMark(node.marks, 'nota')) {
      result.push(node)
      continue
    }

    const aspas = addItalicMatchesInNotaNode(node, RE_ASPAS_NOTA_ITALIC)
    const partes = []
    for (const parte of aspas.nodes) {
      const keywords = addItalicMatchesInNotaNode(parte, RE_KW_NOTA_ITALIC)
      partes.push(...keywords.nodes)
      if (keywords.changed) changed = true
    }
    result.push(...partes)
    if (aspas.changed || !sameInlineContent(partes, [node])) {
      changed = true
    }
  }

  return changed ? result : content
}

// ── Exportação ────────────────────────────────────────────────────

/**
 * Aplica marcas de caractere às linhas mescladas.
 * @param {Array} linhas — saída de mergeComHtml ou e5.output
 * @returns {{ output: Array, log: string[] }}
 */
export function aplicarMarcas(linhas, { estiloVadeMecum = false, somenteEstiloVadeMecum = false } = {}) {
  // Detecta blocos de citação e reclassifica as linhas correspondentes
  // para style 'citacao' ANTES de aplicar qualquer marca de caractere.
  // Isso garante que identificadores dentro de citações nunca recebam
  // negrito ou itálico.
  const linhasBase = reclassificarCitacoes(linhas)

  const log = []
  let countArtigo     = 0
  let countBold       = 0
  let countAlinea     = 0
  let countParUnico   = 0
  let countNotaItalic = 0
  let countAdinNota   = 0
  let countEcNota     = 0
  let countNosSup     = 0
  let countParentesesNota = 0
  let countVetadoNota = 0

  const output = linhasBase.map(linha => {
    if (linha.isTable || !linha.text) return linha

    let result = linha

    {
      const base = result.content?.length > 0
        ? result.content
        : [{ type: 'text', text: result.text }]
      const normalizado = normalizarNosSobrescrito(base)
      if (normalizado.count) {
        countNosSup += normalizado.count
        result = {
          ...result,
          text: textoDoContent(normalizado.content),
          content: normalizado.content,
        }
      }
    }

    // Linhas de citação não recebem marcas de identificador
    if (result.style === 'citacao') return result

    // Epígrafe e apelido: remove todas as marcas de caractere herdadas do HTML
    if (ESTILOS_SEM_MARCAS.has(result.style)) {
      if (!result.content?.length) return result
      return {
        ...result,
        content: result.content.map(n =>
          n.type === 'text' ? { type: 'text', text: n.text } : n
        ),
      }
    }

    // ── Regra 1: boldArtigo — rótulo de artigo ────────────────
    // Aplica somente em linhas classificadas como `artigo`.
    if (!somenteEstiloVadeMecum && result.style === 'artigo') {
      const m = RE_BOLD_ARTIGO.exec(result.text)
      if (m && m[0].length > 0) {
        const base    = result.content?.length > 0
          ? result.content
          : [{ type: 'text', text: result.text }]
        const content = addMarkToContent(base, 0, m[0].length, 'boldArtigo')
        result = { ...result, content }
        countArtigo++
      }
    }

    // ── Regra 2: bold — maiúsculas+travessão, "Pena –", "§ N" ──
    // Estilo Vade Mecum: uso explícito; não é mais acionado pela tag "vm".
    if (estiloVadeMecum) {
      const m = RE_BOLD_NORMAL.exec(result.text)
      if (m && m[0].length > 0) {
        const base    = result.content?.length > 0
          ? result.content
          : [{ type: 'text', text: result.text }]
        const content = addMarkToContent(base, 0, m[0].length, 'bold')
        result = { ...result, content }
        countBold++
      }
    }

    // ── Regra 3: italic — rótulo de alínea ("a)", "b)" …) ────
    // Estilo Vade Mecum: uso explícito; não é mais acionado pela tag "vm".
    if (estiloVadeMecum && result.style === 'alinea') {
      const m = RE_ITALIC_ALINEA.exec(result.text)
      if (m && m[0].length > 0) {
        const base    = result.content?.length > 0
          ? result.content
          : [{ type: 'text', text: result.text }]
        const content = addMarkToContent(base, 0, m[0].length, 'italic')
        result = { ...result, content }
        countAlinea++
      }
    }

    if (somenteEstiloVadeMecum) return result

    // ── Regra 4: italic — "Parágrafo único." em parágrafos ───
    // Aplica em linhas com style 'paragrafo' ou 'texto-lei'
    // (ambos mapeiam para o nó TipTap paragrafLei).
    if (result.style === 'paragrafo' || result.style === 'texto-lei') {
      const m = RE_ITALIC_PAR_UNICO.exec(result.text)
      if (m && m[0].length > 0) {
        const base    = result.content?.length > 0
          ? result.content
          : [{ type: 'text', text: result.text }]
        const content = addMarkToContent(base, 0, m[0].length, 'italic')
        result = { ...result, content }
        countParUnico++
      }
    }

    // ── Regra 5: nota itálico — "DOU" e "Caput" dentro de notas ─
    // Passo 5a: remove aspas de "Caput" dentro de nós nota.
    // Passo 5b: aplica itálico a DOU e Caput nos nós nota resultantes.
    {
      const baseContent = result.content?.length > 0
        ? result.content
        : [{ type: 'text', text: result.text }]
      const contentComNota = fillNotaGaps(applyTextNota(baseContent))
      const adinNormalizado = substituirTextoEmNota(contentComNota, RE_ADIN_NOTA, 'ADI')
      const ecNormalizada = substituirTextoEmNota(adinNormalizado.content, RE_EMENDA_CONSTITUCIONAL_NOTA, 'EC')
      const parentesesNormalizados = substituirTextoEmNota(
        ecNormalizada.content,
        RE_PARENTESE_INTERMEDIARIO_NOTA,
        (_match, data, conector) => `${data}${conector}`,
      )
      const vetadoNormalizado = substituirTextoEmNota(parentesesNormalizados.content, RE_VETADO_CAIXA_ALTA_NOTA, 'Vetado')
      countAdinNota += adinNormalizado.count
      countEcNota += ecNormalizada.count
      countParentesesNota += parentesesNormalizados.count
      countVetadoNota += vetadoNormalizado.count
      const semItalicoNota = normalizarItalicoEmNota(vetadoNormalizado.content)
      const semAspas   = removeAspasCaputInNota(semItalicoNota)
      const novoContent = addItalicToKeywordsInNota(semAspas)
      if (
        !sameInlineContent(novoContent, baseContent) ||
        adinNormalizado.content !== contentComNota ||
        ecNormalizada.content !== adinNormalizado.content ||
        parentesesNormalizados.content !== ecNormalizada.content ||
        vetadoNormalizado.content !== parentesesNormalizados.content ||
        semItalicoNota !== vetadoNormalizado.content
      ) {
        result = { ...result, content: novoContent }
        if (novoContent !== semAspas) countNotaItalic++
      }
    }

    return result
  })

  if (countArtigo) {
    log.push(
      `${countArtigo} rótulo${countArtigo !== 1 ? 's' : ''} de artigo ` +
      `marcado${countArtigo !== 1 ? 's' : ''} com bold-artigo`
    )
  }
  if (countBold) {
    log.push(
      `${countBold} rótulo${countBold !== 1 ? 's' : ''} ` +
      `(maiúsculas/Pena/§) marcado${countBold !== 1 ? 's' : ''} com negrito`
    )
  }
  if (countAlinea) {
    log.push(
      `${countAlinea} rótulo${countAlinea !== 1 ? 's' : ''} de alínea ` +
      `marcado${countAlinea !== 1 ? 's' : ''} com itálico`
    )
  }
  if (countParUnico) {
    log.push(
      `${countParUnico} "Parágrafo único." ` +
      `marcado${countParUnico !== 1 ? 's' : ''} com itálico`
    )
  }
  if (countNotaItalic) {
    log.push(
      `${countNotaItalic} linha${countNotaItalic !== 1 ? 's' : ''} com ` +
      `"DOU"/"Caput"/termos entre aspas marcado${countNotaItalic !== 1 ? 's' : ''} como nota itálico`
    )
  }

  if (countNosSup) {
    log.push(
      `${countNosSup} ocorrencia${countNosSup !== 1 ? 's' : ''} de "n\u00bas" ` +
      `substituida${countNosSup !== 1 ? 's' : ''} por "nos" com "os" sobrescrito`
    )
  }

  if (countAdinNota) {
    log.push(
      `${countAdinNota} ocorrÃªncia${countAdinNota !== 1 ? 's' : ''} de ADIN ` +
      `substituÃ­da${countAdinNota !== 1 ? 's' : ''} por ADI em nota`
    )
  }

  if (countEcNota) {
    log.push(
      `${countEcNota} ocorrencia${countEcNota !== 1 ? 's' : ''} de Emenda Constitucional ` +
      `substituida${countEcNota !== 1 ? 's' : ''} por EC em nota`
    )
  }

  if (countParentesesNota) {
    log.push(
      `${countParentesesNota} parêntese${countParentesesNota !== 1 ? 's' : ''} ` +
      `intermediário${countParentesesNota !== 1 ? 's' : ''} removido${countParentesesNota !== 1 ? 's' : ''} em nota`
    )
  }

  if (countVetadoNota) {
    log.push(
      `${countVetadoNota} ocorrencia${countVetadoNota !== 1 ? 's' : ''} de VETADO ` +
      `normalizada${countVetadoNota !== 1 ? 's' : ''} para Vetado em nota`
    )
  }

  return { output, log }
}
