/**
 * compararNorma.js
 * Compara dois documentos TipTap ao nível de parágrafo usando LCS.
 * Retorna um documento mesclado (para revisão no editor) e a lista de diffs.
 */

// ── Extração de texto de um nó TipTap ────────────────────────────
import { filtrarDocPorModoVadeMecum } from './filtrarModoVadeMecum.js'

export function getNodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (Array.isArray(node.content)) return node.content.map(getNodeText).join('')
  return ''
}

function nodeHasMark(node, markType) {
  return Array.isArray(node?.marks) && node.marks.some(mark => mark?.type === markType)
}

function getNodeTextSemMark(node, markType) {
  if (!node) return ''
  if (nodeHasMark(node, markType)) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (Array.isArray(node.content)) return node.content.map(child => getNodeTextSemMark(child, markType)).join('')
  return ''
}

function isNotaTituloNode(node) {
  return node?.type === 'notaTitulo'
}


// ── Normalização de texto para comparação ───────────────────────
// Cria uma função de normalização com as opções escolhidas pelo usuário.
// Sempre aplicadas: NBSP → espaço, ü → u.
// Opcionais: capitulação (case), acentuação, tipo de aspas.

const ACENTO_MAP = [
  [/[áàâãä]/g, 'a'], [/[ÁÀÂÃÄ]/g, 'A'],
  [/[éèêë]/g,  'e'], [/[ÉÈÊË]/g,  'E'],
  [/[íìîï]/g,  'i'], [/[ÍÌÎÏ]/g,  'I'],
  [/[óòôõö]/g, 'o'], [/[ÓÒÔÕÖ]/g, 'O'],
  [/[úùûü]/g,  'u'], [/[ÚÙÛÜ]/g,  'U'],
  [/[ç]/g,     'c'], [/[Ç]/g,     'C'],
]

const ASPAS_DUPLAS = new RegExp('[“”«»„‟]', 'g')
const ASPAS_SIMPLES = new RegExp('[‘’‹›`´]', 'g')

// Hífen entre letras — usado em duas formas:
//   join : co-proprietários → coproprietários   (prefixo colado)
//   space: não-pagamento   → não pagamento      (palavra composta com espaço)
const RE_HIFEN = /([a-záéíóúâêôîûàèìòùãõçA-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ])-([a-záéíóúâêôîûàèìòùãõçA-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ])/g

function _baseNorm(text, opcoes) {
  let s = text
    .replace(/ /g, ' ')   // NBSP → espaço normal
    .replace(/ü/g, 'u')   // trema germânico sem equivalente em pt-BR
  if (opcoes.ignorarCapitulacao) s = s.toLowerCase()
  if (opcoes.ignorarAcentuacao)  ACENTO_MAP.forEach(([re, rep]) => { s = s.replace(re, rep) })
  if (opcoes.ignorarAspas)       s = s.replace(ASPAS_DUPLAS, '"').replace(ASPAS_SIMPLES, "'")
  if (opcoes.ignorarEspacos)     s = s.replace(/[  ]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return s
}

// Forma primária: remove o hífen (junta as partes)
function criarNormalizador(opcoes = {}) {
  return function normalizeText(text) {
    let s = _baseNorm(text, opcoes)
    if (opcoes.ignorarHifens) s = s.replace(RE_HIFEN, '$1$2')
    return s
  }
}

// Forma secundária: substitui hífen por espaço
function criarNormalizadorHifenEspaco(opcoes = {}) {
  return function normalizeText(text) {
    let s = _baseNorm(text, opcoes)
    if (opcoes.ignorarHifens) s = s.replace(RE_HIFEN, '$1 $2')
    return s
  }
}

// ── Similaridade Dice (bigrams) ──────────────────────────────────
// Retorna valor entre 0 (totalmente diferente) e 1 (idêntico).
function similarity(a, b) {
  if (a === b) return 1.0
  if (!a || !b) return 0.0

  const bigrams = s => {
    const set = new Set()
    const limit = Math.min(s.length - 1, 120)
    for (let i = 0; i < limit; i++) set.add(s.slice(i, i + 2))
    return set
  }

  const aB = bigrams(a), bB = bigrams(b)
  if (!aB.size && !bB.size) return 1.0

  let inter = 0
  for (const x of aB) if (bB.has(x)) inter++
  return (2 * inter) / (aB.size + bB.size)
}

// ── Diff LCS (Myers) sobre arrays de strings ─────────────────────
// isEqual(i_old, j_new) → boolean
function lcsOps(m, n, isEqual) {
  // Tabela DP O(m×n) — para normas com ~500 parágrafos isso é rápido
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))

  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = isEqual(i - 1, j - 1)
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])

  const ops = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && isEqual(i - 1, j - 1)) {
      ops.unshift({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'insert', newIdx: j - 1 })
      j--
    } else {
      ops.unshift({ type: 'delete', oldIdx: i - 1 })
      i--
    }
  }
  return ops
}

// ── Mescla blocos de delete+insert em "modified" (se similares) ──
// Trata sequências de N deletes seguidos de M inserts:
// emparelha cada delete com o insert de maior similaridade (acima
// do threshold). Isso resolve o caso de 2+ parágrafos modificados
// em sequência, onde o LCS gera del,del,...,ins,ins,...
function mergeModifiedOps(ops, oldTexts, newTexts, threshold = 0.35) {
  const result = []
  let i = 0

  while (i < ops.length) {
    if (ops[i].type !== 'delete') {
      result.push(ops[i++])
      continue
    }

    // Coleta bloco de deletes consecutivos
    const dels = []
    while (i < ops.length && ops[i].type === 'delete') dels.push(ops[i++])

    // Coleta inserts que vêm logo em seguida
    const ins = []
    while (i < ops.length && ops[i].type === 'insert') ins.push(ops[i++])

    if (ins.length === 0) {
      // Nenhum insert — todos são remoções puras
      result.push(...dels)
      continue
    }

    // Emparelha guloso: para cada delete, o insert com maior similaridade
    const pairedIns = new Set()   // índices de ins[] já usados
    const pairs     = new Map()   // índice de dels[] → índice de ins[]

    for (let d = 0; d < dels.length; d++) {
      let bestSim = threshold - Number.EPSILON
      let bestK   = -1
      for (let k = 0; k < ins.length; k++) {
        if (pairedIns.has(k)) continue
        const sim = similarity(oldTexts[dels[d].oldIdx], newTexts[ins[k].newIdx])
        if (sim > bestSim) { bestSim = sim; bestK = k }
      }
      if (bestK >= 0) { pairs.set(d, bestK); pairedIns.add(bestK) }
    }

    // Emite: deletes emparelhados → modified; restantes → delete/insert puro
    for (let d = 0; d < dels.length; d++) {
      if (pairs.has(d)) {
        result.push({ type: 'modified', oldIdx: dels[d].oldIdx, newIdx: ins[pairs.get(d)].newIdx })
      } else {
        result.push(dels[d])
      }
    }
    for (let k = 0; k < ins.length; k++) {
      if (!pairedIns.has(k)) result.push(ins[k])
    }
  }

  return result
}

// ── API pública ───────────────────────────────────────────────────

/**
 * Compara dois documentos TipTap e retorna:
 *   - mergedDoc : doc TipTap com nova versão + nós removidos intercalados
 *   - diffs     : lista de DiffItem descrevendo cada mudança
 *
 * DiffItem: {
 *   id         : string único
 *   type       : 'added' | 'removed' | 'modified'
 *   contentIdx : índice no mergedDoc.content (atualizado ao aceitar/recusar)
 *   oldNode    : nó original (para modified e removed)
 *   newNode    : nó novo (para added e modified)
 *   oldText    : texto original (para exibição no painel)
 *   newText    : texto novo    (para exibição no painel)
 *   resolved   : false (atualizado durante a revisão)
 * }
 */
export function compararNormas(oldDoc, newDoc, opcoes = {}) {
  oldDoc = filtrarDocPorModoVadeMecum(oldDoc, !!opcoes.modoVadeMecum)
  newDoc = filtrarDocPorModoVadeMecum(newDoc, !!opcoes.modoVadeMecum)

  // Separa tabelas e nós de texto (tabelas são preservadas sem diff)
  const oldNodes = (oldDoc.content || [])
  const newNodes = (newDoc.content || [])

  const oldTexts = oldNodes.map(getNodeText)
  const newTexts = newNodes.map(getNodeText)

  // Textos normalizados usados apenas para comparação
  const normalizeText = criarNormalizador(opcoes)
  const oldNorm = oldTexts.map(normalizeText)
  const newNorm = newTexts.map(normalizeText)
  const ignorarAlteracoesNota = !!opcoes.ignorarAlteracoesNota
  const oldTextsSemNota = ignorarAlteracoesNota ? oldNodes.map(node => getNodeTextSemMark(node, 'nota')) : []
  const newTextsSemNota = ignorarAlteracoesNota ? newNodes.map(node => getNodeTextSemMark(node, 'nota')) : []
  const oldNormSemNota = ignorarAlteracoesNota ? oldTextsSemNota.map(normalizeText) : []
  const newNormSemNota = ignorarAlteracoesNota ? newTextsSemNota.map(normalizeText) : []

  // Quando ignorarHifens está ativo, usa dupla comparação:
  //   forma join  (co-prop → coprop)  e forma space (não-pag → não pag).
  // Dois parágrafos são iguais se coincidirem em qualquer uma das formas.
  let isEqual
  if (opcoes.ignorarHifens) {
    const normAlt = criarNormalizadorHifenEspaco(opcoes)
    const oldNormAlt = oldTexts.map(normAlt)
    const newNormAlt = newTexts.map(normAlt)
    const oldNormSemNotaAlt = ignorarAlteracoesNota ? oldTextsSemNota.map(normAlt) : []
    const newNormSemNotaAlt = ignorarAlteracoesNota ? newTextsSemNota.map(normAlt) : []
    isEqual = (i, j) =>
      oldNorm[i] === newNorm[j] ||
      oldNormAlt[i] === newNormAlt[j] ||
      (ignorarAlteracoesNota && (
        oldNormSemNota[i] === newNormSemNota[j] ||
        oldNormSemNotaAlt[i] === newNormSemNotaAlt[j]
      ))
  } else {
    isEqual = (i, j) =>
      oldNorm[i] === newNorm[j] ||
      (ignorarAlteracoesNota && oldNormSemNota[i] === newNormSemNota[j])
  }

  const rawOps = lcsOps(oldNorm.length, newNorm.length, isEqual)
  const ops    = mergeModifiedOps(rawOps, oldNorm, newNorm)

  let diffId = 0
  const mergedContent = []
  const diffs = []

  for (const op of ops) {
    const contentIdx = mergedContent.length

    if (op.type === 'equal') {
      // Se os textos brutos são literalmente iguais, usa o novo (preserva
      // eventuais atualizações de formatação no novo doc).
      // Se a igualdade foi induzida pelas opções de comparação (ex.: ignorar
      // hífen faz "cointeressados" = "co-interessados"), mantém o original —
      // o usuário sinalizou que prefere a grafia do documento atual.
      const rawEqual = oldTexts[op.oldIdx] === newTexts[op.newIdx]
      mergedContent.push(rawEqual ? newNodes[op.newIdx] : oldNodes[op.oldIdx])

    } else if (op.type === 'modified') {
      // subtype: 'format' se só a formatação mudou; 'text' se o conteúdo mudou
      const subtype = oldNorm[op.oldIdx] === newNorm[op.newIdx] ? 'format' : 'text'
      mergedContent.push(newNodes[op.newIdx])
      diffs.push({
        id: `diff-${diffId++}`,
        type: 'modified',
        subtype,
        contentIdx,
        oldNode: oldNodes[op.oldIdx],
        newNode: newNodes[op.newIdx],
        oldText: oldTexts[op.oldIdx],
        newText: newTexts[op.newIdx],
        resolved: false,
      })

    } else if (op.type === 'insert') {
      if (ignorarAlteracoesNota && isNotaTituloNode(newNodes[op.newIdx])) continue

      mergedContent.push(newNodes[op.newIdx])
      diffs.push({
        id: `diff-${diffId++}`,
        type: 'added',
        subtype: 'text',
        contentIdx,
        newNode: newNodes[op.newIdx],
        newText: newTexts[op.newIdx],
        resolved: false,
      })

    } else if (op.type === 'delete') {
      // Insere o nó removido no local correto para que o usuário possa vê-lo
      mergedContent.push(oldNodes[op.oldIdx])
      diffs.push({
        id: `diff-${diffId++}`,
        type: 'removed',
        subtype: 'text',
        contentIdx,
        oldNode: oldNodes[op.oldIdx],
        oldText: oldTexts[op.oldIdx],
        resolved: false,
      })
    }
  }

  return {
    mergedDoc: { type: 'doc', content: mergedContent },
    diffs,
  }
}
