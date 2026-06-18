/**
 * aplicarCitacoes.js
 * Etapa 08 — Aplicar estilo de citação ao documento TipTap.
 *
 * Recebe o doc já classificado (pós-linhasParaTiptap). As linhas de citação
 * já chegam com type 'citacao' porque a etapa 06 (aplicarMarcas) detecta
 * os blocos e reclassifica as linhas ANTES de aplicar marcas de caractere —
 * garantindo que identificadores (Art., §, incisos, alíneas, Parágrafo único)
 * nunca recebam negrito ou itálico dentro de citações.
 *
 * O que esta etapa faz:
 *   1. Reclassifica nós que a pipeline ainda não marcou como 'citacao'
 *      (ex.: nós que chegaram de mergeComHtml fora do fluxo normal)
 *   2. Remove as aspas de abertura e fechamento (+ anotação "(NR)" etc.)
 *   3. Substitui sequências de pontinhos (4+) por [...]
 *
 * Padrão reconhecido:
 *   — Artigo introdutor termina com ":"
 *   — Bloco citado abre com aspas ("  "  «)
 *   — Bloco citado fecha quando uma linha termina com aspas (" " »),
 *     opcionalmente seguidas de anotação ex.: (NR)
 *   — Múltiplos blocos seguidos são tratados como parte da mesma seção
 *     se aparecerem consecutivamente (sem parágrafo regular entre eles).
 */

// ── Extrai texto plano de um nó TipTap ────────────────────────────
function getNodeText(node) {
  if (!node?.content) return ''
  return node.content.map(n => {
    if (n.type === 'text') return n.text || ''
    if (n.type === 'hardBreak') return ' '
    return getNodeText(n)
  }).join('')
}

// ── Padrões de abertura e fechamento ─────────────────────────────
const ABRE_ASPAS  = /^["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]/
const FECHA_ASPAS = /["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]\s*(?:\([^)]{0,160}\))?\s*$/
const TERMINA_COM_DOIS_PONTOS_OU_NOTA = /:\s*(?:\([^)]{0,260}\)\s*)*$/

// ── Tipos que nunca são reclassificados como citação ──────────────
const TIPOS_FIXOS = new Set([
  'epigrafe', 'epigrafeApelido', 'ementa', 'notaTitulo',
  'paragrafAbertura', 'aberturaCapitulo', 'partelivroTitCap', 'secaoSubsecao',
  'corpoTratado',
  'data', 'assinatura', 'assinaturaData', 'assinaturaNome',
])

// ── Remoção de aspas de abertura (primeiro nó do bloco) ───────────
function removerAspasAbertura(node) {
  if (!node.content?.length) return node
  const content = [...node.content]
  for (let i = 0; i < content.length; i++) {
    const n = content[i]
    if (n.type !== 'text' || !n.text) continue
    const novo = n.text.replace(/^["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]\s*/, '')
    if (novo === n.text) break          // sem aspas no início — nada a fazer
    content[i] = novo ? { ...n, text: novo } : null
    return { ...node, content: content.filter(Boolean) }
  }
  return node
}

const RE_ASPA_FECHAMENTO_COM_NOTA = /\s*["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]\s*(\([^)]{0,160}\))?\s*$/
const RE_ASPA_FECHAMENTO_SOLTA = /["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u02BA]\s*$/
const RE_NOTA_FINAL = /^\s*\([^)]{0,160}\)\s*$/

// ── Remoção de aspas de fechamento, preservando eventual nota final ──
function removerAspasFechamento(node) {
  if (!node.content?.length) return node
  const content = [...node.content]
  let pulouNotaFinal = false
  let notaFinalIndex = -1
  for (let i = content.length - 1; i >= 0; i--) {
    const n = content[i]
    if (n.type !== 'text' || !n.text) continue

    if (!pulouNotaFinal && RE_NOTA_FINAL.test(n.text)) {
      pulouNotaFinal = true
      notaFinalIndex = i
      continue
    }

    const novo = n.text
      .replace(RE_ASPA_FECHAMENTO_COM_NOTA, (_, nota = '') => nota ? ` ${nota}` : '')
      .trimEnd()
    if (novo === n.text) break          // sem aspas no final — nada a fazer
    content[i] = novo ? { ...n, text: novo } : null
    if (notaFinalIndex >= 0 && content[notaFinalIndex] && !/^\s/.test(content[notaFinalIndex].text)) {
      content[notaFinalIndex] = { ...content[notaFinalIndex], text: ` ${content[notaFinalIndex].text}` }
    }
    return { ...node, content: content.filter(Boolean) }
  }
  return node
}

function limparAspasFinaisEmCitacao(node) {
  if (node.type !== 'citacao' || !node.content?.length) return node
  const content = [...node.content]
  let pulouNotaFinal = false
  let notaFinalIndex = -1
  let changed = false

  for (let i = content.length - 1; i >= 0; i--) {
    const n = content[i]
    if (n.type !== 'text' || !n.text) continue

    if (!pulouNotaFinal && RE_NOTA_FINAL.test(n.text)) {
      pulouNotaFinal = true
      notaFinalIndex = i
      continue
    }

    const novo = n.text
      .replace(RE_ASPA_FECHAMENTO_COM_NOTA, (_, nota = '') => nota ? ` ${nota}` : '')
      .replace(RE_ASPA_FECHAMENTO_SOLTA, '')
      .trimEnd()

    if (novo !== n.text) {
      content[i] = novo ? { ...n, text: novo } : null
      if (notaFinalIndex >= 0 && content[notaFinalIndex] && !/^\s/.test(content[notaFinalIndex].text)) {
        content[notaFinalIndex] = { ...content[notaFinalIndex], text: ` ${content[notaFinalIndex].text}` }
      }
      changed = true
    }
    break
  }

  return changed ? { ...node, content: content.filter(Boolean) } : node
}

// ── Substituição de pontinhos (4+) por [...] ─────────────────────
// Garante espaço antes de [...] se o caractere anterior não for espaço.
function substituirPontos(nodes) {
  let count = 0
  const result = nodes.map(node => {
    if (node.type !== 'citacao' || !node.content?.length) return node
    let changed = false
    const content = node.content.map(n => {
      if (n.type !== 'text') return n
      const novo = n.text.replace(/\.{4,}/g, (_, offset, str) => {
        const antes = offset > 0 ? str[offset - 1] : ''
        return /\S/.test(antes) ? ' [...]' : '[...]'
      })
      if (novo === n.text) return n
      changed = true
      return { ...n, text: novo }
    })
    if (!changed) return node
    count++
    return { ...node, content }
  })
  return { result, count }
}

/**
 * Aplica o estilo "citação" ao documento TipTap.
 * @param {object} doc  — resultado de linhasParaTiptap() (etapa 08)
 * @returns {{ doc: object, log: string[] }}
 */
export function aplicarCitacoes(doc) {
  const nodes = doc.content || []
  let reclassificados = 0

  const result      = []
  const blockStarts = []   // índices em result[] que abrem um bloco
  const blockEnds   = []   // índices em result[] que fecham um bloco

  let emCitacao         = false
  let prevFoiCitFechada = false
  let prevNaoVazio      = null

  for (const node of nodes) {
    const text = getNodeText(node).trim()

    if (!text) {
      result.push(node)
      continue
    }

    if (!emCitacao) {
      const abre = ABRE_ASPAS.test(text)
      const prevTexto = prevNaoVazio ? getNodeText(prevNaoVazio).trimEnd() : ''
      const prevTerminouComDoisPontos = TERMINA_COM_DOIS_PONTOS_OU_NOTA.test(prevTexto)

      if (abre && (prevTerminouComDoisPontos || prevFoiCitFechada)) {
        emCitacao         = true
        prevFoiCitFechada = false
        blockStarts.push(result.length)   // próximo push é o nó de abertura
      } else {
        prevFoiCitFechada = false
      }
    }

    if (emCitacao) {
      let novoNode
      if (TIPOS_FIXOS.has(node.type)) {
        novoNode = node
      } else if (node.type !== 'citacao') {
        reclassificados++
        novoNode = { ...node, type: 'citacao' }
      } else {
        novoNode = node
      }

      result.push(novoNode)

      if (FECHA_ASPAS.test(text)) {
        blockEnds.push(result.length - 1)  // nó recém-inserido é o de fechamento
        emCitacao         = false
        prevFoiCitFechada = true
      }
    } else {
      result.push(node)
    }

    prevNaoVazio = node
  }

  // Se a citação não fechou (documento truncado), o último nó é o fechamento
  if (emCitacao && result.length > 0) {
    blockEnds.push(result.length - 1)
  }

  // ── Remove aspas dos limites de cada bloco ───────────────────────
  for (const idx of blockStarts) {
    if (result[idx]) result[idx] = removerAspasAbertura(result[idx])
  }
  for (const idx of blockEnds) {
    if (result[idx]) result[idx] = removerAspasFechamento(result[idx])
  }

  // ── Substitui sequências de pontinhos por [...] ──────────────────
  const { result: resultComPontos, count: pontosSub } = substituirPontos(result)
  const resultFinal = resultComPontos.map(limparAspasFinaisEmCitacao)

  // ── Log ──────────────────────────────────────────────────────────
  const log = []
  if (reclassificados) log.push(`${reclassificados} parágrafo(s) reclassificado(s) como citação`)
  else log.push('Nenhuma citação detectada')
  if (pontosSub) log.push(`[...] aplicado em ${pontosSub} parágrafo(s)`)

  return { doc: { ...doc, content: resultFinal }, log }
}
