/**
 * notasVadeMecum.js
 * Rotina opcional que adapta as notas legislativas para publicação em Vade Mecum.
 *
 * Regras:
 *  1. Nota isolada (dispositivo cujo conteúdo É a nota) → mantém
 *  2. Nota após texto real → remove
 *  3. Exceção à regra 2: nota que começa com "(Vide" → mantém
 *  4. Nota isolada com "revogado" → simplifica para
 *     "(Revogado/Revogada pelo/pela TIPO nº X, de Y)"
 */

// ── Utilidades ────────────────────────────────────────────────────

function hasNotaMark(node) {
  return node.type === 'text' && (node.marks || []).some(m => m.type === 'nota')
}

function withNotaMark(node) {
  if (!node || node.type !== 'text' || hasNotaMark(node)) return node
  return { ...node, marks: [...(node.marks || []), { type: 'nota' }] }
}

function getFullText(content) {
  return (content || []).filter(n => n.type === 'text').map(n => n.text).join('')
}

function getNotaText(content) {
  return (content || []).filter(hasNotaMark).map(n => n.text).join('')
}

function splitNotaParenteticos(content) {
  const result = []

  for (const node of content || []) {
    if (!hasNotaMark(node) || !/\)[ \u00A0\u202F]+(?=\()/g.test(node.text || '')) {
      result.push(node)
      continue
    }

    const re = /\)([ \u00A0\u202F]+)(?=\()/g
    let start = 0
    let match
    while ((match = re.exec(node.text)) !== null) {
      const end = match.index + 1
      const text = node.text.slice(start, end)
      if (text) result.push({ ...node, text })
      start = end
    }

    const rest = node.text.slice(start)
    if (rest) result.push({ ...node, text: rest })
  }

  return result
}

function getNodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) return node.content.map(getNodeText).join('')
  return ''
}

function getReportNoteText(node) {
  if (!node) return ''
  if (node.type === 'notaTitulo') return getNodeText(node).trim()
  return getNotaText(node.content || []).trim()
}

function snapshotNode(node, originalIndex) {
  return {
    id: node.__vmId,
    originalIndex,
    tipo: node.type,
    nota: getReportNoteText(node),
    paragrafo: getNodeText(node).replace(/\s+/g, ' ').trim(),
  }
}

function stripVadeMeta(node) {
  if (!node || typeof node !== 'object') return node
  const { __vmId, ...rest } = node
  if (!Array.isArray(rest.content)) return rest
  return { ...rest, content: rest.content.map(stripVadeMeta) }
}

function limparVmRole(node) {
  if (!node || typeof node !== 'object') return node
  const attrs = node.attrs ? { ...node.attrs } : null
  if (attrs) delete attrs.vmRole
  const next = attrs ? { ...node, attrs } : { ...node }
  if (next.attrs && Object.values(next.attrs).every(v => v == null)) delete next.attrs
  if (Array.isArray(next.content)) next.content = next.content.map(limparVmRole)
  return next
}

function jsonSemVmMeta(node) {
  return JSON.stringify(limparVmRole(stripVadeMeta(node)))
}

function indiceMarkNota(node) {
  return (node?.marks || []).findIndex(mark => mark.type === 'nota')
}

function textoRunNota(run) {
  return run.map(item => item.node.text || '').join('').replace(/\s+/g, ' ').trim()
}

function runsNota(content = []) {
  const runs = []
  let atual = null

  content.forEach((node, index) => {
    if (node?.type === 'text' && indiceMarkNota(node) >= 0) {
      if (!atual) atual = []
      atual.push({ node, index })
      return
    }
    if (atual) {
      runs.push(atual)
      atual = null
    }
  })

  if (atual) runs.push(atual)
  return runs
}

function markNotaComAttrs(mark, attrsExtras = {}) {
  const attrs = {
    ...(mark.attrs || {}),
    ...attrsExtras,
  }
  Object.keys(attrs).forEach(key => {
    if (attrs[key] == null || attrs[key] === false) delete attrs[key]
  })
  return Object.keys(attrs).length ? { ...mark, attrs } : { type: mark.type }
}

function aplicarAttrsNota(node, attrsExtras) {
  const idx = indiceMarkNota(node)
  if (idx < 0) return node
  const marks = [...(node.marks || [])]
  marks[idx] = markNotaComAttrs(marks[idx], attrsExtras)
  return { ...node, marks }
}

function anotarRunComVm(content, run, textoVm) {
  const next = [...content]
  run.forEach((item, idx) => {
    if (idx === 0 && textoVm) {
      next[item.index] = aplicarAttrsNota(next[item.index], { vmText: textoVm, vmHidden: null })
    } else {
      next[item.index] = aplicarAttrsNota(next[item.index], { vmText: null, vmHidden: true })
    }
  })
  return next
}

function anotarNotasVm(original, vm) {
  const out = limparVmRole(stripVadeMeta(original))
  if (!Array.isArray(out.content)) return out

  let content = out.content.map(limparVmRole)
  const origRuns = runsNota(content)
  const vmRuns = runsNota(vm?.content || [])
  let mudou = false

  origRuns.forEach((run, idx) => {
    const textoOriginal = textoRunNota(run)
    const textoVm = vmRuns[idx] ? textoRunNota(vmRuns[idx]) : ''
    if (textoOriginal === textoVm) return
    mudou = true
    content = anotarRunComVm(content, run, textoVm)
  })

  if (!origRuns.length && vmRuns.length) {
    mudou = true
    vmRuns.forEach(run => {
      const textoVm = textoRunNota(run)
      if (!textoVm) return
      if (content.length) content.push({ type: 'text', text: ' ' })
      content.push({ type: 'text', text: textoVm, marks: [{ type: 'nota' }] })
    })
  }

  return mudou ? { ...out, content } : out
}

function prepararConteudoBaseParaVm(doc) {
  return (doc.content || [])
    .filter(node => node?.attrs?.vmRole !== 'vm')
    .map(limparVmRole)
}

function calcularNotasVadeMecum(doc) {
  let removidas = 0
  let simplificadas = 0
  let datasFormatadas = 0
  let cfAbreviadas = 0
  let nrRemovidos = 0
  let assinaturasRemovidas = 0

  function onLog(tipo, n = 1) {
    if (tipo === 'removida')     removidas++
    if (tipo === 'simplificada') simplificadas++
    if (tipo === 'data')         datasFormatadas += n
    if (tipo === 'cf')           cfAbreviadas += n
    if (tipo === 'nr')           nrRemovidos += n
    if (tipo === 'assinatura')   assinaturasRemovidas += n
  }

  const contentInicial = prepararConteudoBaseParaVm(doc).map((node, index) => ({ ...node, __vmId: `vm-${index}` }))
  const beforeItems = contentInicial.map((node, index) => snapshotNode(node, index))

  let newContent = contentInicial.map(node => processarNo(node, onLog)).filter(Boolean)
  newContent = formatarDataNoDoc(newContent, onLog)
  newContent = abreviarCFNoDoc(newContent, onLog)
  newContent = removerNrNoDoc(newContent, onLog)
  newContent = manterPrimeiraAssinatura(newContent, onLog)
  newContent = normalizarEspacosConteudo(newContent)
  newContent = limparParagrafos(newContent)

  const relatorio = montarRelatorioNotasVade(beforeItems, newContent)
  const log = []
  if (removidas)      log.push(`${removidas} nota(s) após texto removida(s)`)
  if (simplificadas)  log.push(`${simplificadas} nota(s) de revogação simplificada(s)`)
  if (datasFormatadas) log.push(`data abreviada em ${datasFormatadas} parágrafo(s)`)
  if (cfAbreviadas)   log.push(`"Constituição Federal" abreviada em ${cfAbreviadas} parágrafo(s)`)
  if (nrRemovidos)    log.push(`"nº" removido antes de número em ${nrRemovidos} parágrafo(s)`)
  if (assinaturasRemovidas) log.push(`${assinaturasRemovidas} assinatura(s) excedente(s) removida(s)`)
  if (!removidas && !simplificadas && !datasFormatadas && !cfAbreviadas && !nrRemovidos && !assinaturasRemovidas)
    log.push('Nenhuma nota alterada')

  return { contentInicial, newContent, log, relatorio }
}

function montarRelatorioNotasVade(beforeItems, finalContent) {
  const afterById = {}
  const finalIndexById = {}

  finalContent.forEach((node, index) => {
    if (!node.__vmId) return
    afterById[node.__vmId] = snapshotNode(node, index)
    finalIndexById[node.__vmId] = index
  })

  const surviving = Object.keys(finalIndexById)
    .map(id => {
      const before = beforeItems.find(item => item.id === id)
      return before ? { id, originalIndex: before.originalIndex, finalIndex: finalIndexById[id] } : null
    })
    .filter(Boolean)

  function nearestTargetIndex(originalIndex) {
    let best = null
    for (const item of surviving) {
      if (item.originalIndex <= originalIndex && (!best || item.originalIndex > best.originalIndex)) best = item
    }
    if (best) return best.finalIndex
    for (const item of surviving) {
      if (item.originalIndex > originalIndex && (!best || item.originalIndex < best.originalIndex)) best = item
    }
    return best ? best.finalIndex : -1
  }

  return beforeItems
    .filter(before => before.nota)
    .map(before => {
      const after = afterById[before.id] || null
      const depois = after?.nota || ''
      if (before.nota === depois) return null

      const nodeFoiExcluido = !after
      return {
        id: `nota-vm-${before.originalIndex}-${before.id}`,
        tipo: nodeFoiExcluido || !depois ? 'excluida' : 'alterada',
        antes: before.nota,
        depois,
        paragrafoAntes: before.paragrafo,
        paragrafoDepois: after?.paragrafo || '',
        originalIndex: before.originalIndex,
        targetIndex: nodeFoiExcluido ? nearestTargetIndex(before.originalIndex) : finalIndexById[before.id],
      }
    })
    .filter(Boolean)
}

// ── Detecção de nota isolada ──────────────────────────────────────

// Padrões de rótulo: o que precede o conteúdo real do dispositivo
const LABEL_RE = /^(?:Arts?\.\s+[\d][^\s]*(?:\s+[ae]\s+[\d][^\s]*)?\s*\.?\s*|§{1,2}\s+[\d][^\s]*\.?\s*|Parágrafo\s+único\.?\s*|[IVXLCDM]+(?:-[A-Z])?\s*[–—\-]\s*|[a-záéíóúâêôîûàèìòùãõç]\)\s*|\d+\.\s*)/

function stripLabel(text) {
  const m = text.match(LABEL_RE)
  return m ? text.slice(m[0].length) : text
}

/**
 * Retorna true quando o conteúdo do parágrafo, após o rótulo,
 * começa diretamente com "(" — ou seja, a nota É o conteúdo do dispositivo.
 */
function isIsolatedNote(fullText) {
  return stripLabel(fullText).trimStart().startsWith('(')
}

// ── Simplificação de nota de revogação (regra 4) ─────────────────

// Tipos de ato normativo em ordem decrescente de especificidade
// (Lei Complementar antes de Lei, Decreto-Lei antes de Decreto, etc.)
const TIPOS_ATOS =
  'Lei\\s+Complementar|Lei\\s+Orgânica|Lei\\s+Delegada|' +
  'Decreto-Lei|Decreto\\s+Legislativo|Decreto\\s+Presidencial|Decreto|' +
  'Medida\\s+Provisória|Emenda\\s+Constitucional|' +
  'Resolução|Portaria|Instrução\\s+Normativa|Lei'

// Captura: (1) revogad[ao]  (2) pel[ao]  (3) tipo + "nº X, de DD/MM/AAAA"
const REV_RE = new RegExp(
  `(revogad[ao])\\s+(pel[ao])\\s+((${TIPOS_ATOS})\\s+n[oº°ª]\\s+[\\d.]+,\\s+de\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{4})`,
  'gi'
)

/**
 * Simplifica o texto de uma nota de revogação para a forma curta.
 * Usa o ÚLTIMO "revogado" encontrado (a revogação mais recente).
 * Retorna null se o padrão não for detectado.
 */
function simplificarRevogado(notaText) {
  REV_RE.lastIndex = 0
  let match = null, last = null
  while ((match = REV_RE.exec(notaText)) !== null) last = match
  if (!last) return null

  const rev = last[1].charAt(0).toUpperCase() + last[1].slice(1) // Revogado | Revogada
  return `(${rev} ${last[2]} ${last[3]})`
}

// ── Processamento de notas isoladas (regras 1 e 4) ───────────────

function trimTrailingNos(nos) {
  // Remove nós inteiramente brancos do final
  let result = [...nos]
  while (result.length > 0 && result[result.length - 1].type === 'text' && !result[result.length - 1].text.trim()) {
    result.pop()
  }
  // Apara espaço/NBSP final do último nó com conteúdo
  if (result.length > 0) {
    const last = result[result.length - 1]
    if (last.type === 'text') {
      const trimmed = last.text.replace(/[  ]+$/, '')
      result[result.length - 1] = trimmed ? { ...last, text: trimmed } : result.pop() || last
      if (!trimmed) result.pop()
    }
  }
  return result
}

function processarNotaIsolada(content, onLog) {
  const notaText = getNotaText(content)
  if (!/revogad[ao]/i.test(notaText)) return { content, changed: false }

  const simplified = simplificarRevogado(notaText)
  if (!simplified) return { content, changed: false }

  // Preserva nós sem nota (rótulo), remove espaços extras do final,
  // e coloca exatamente um espaço de separação antes da nota simplificada.
  const semNota = trimTrailingNos(content.filter(n => !hasNotaMark(n)))
  const separador = semNota.length > 0 ? [{ type: 'text', text: ' ' }] : []
  onLog('simplificada')
  return {
    content: [...semNota, ...separador, { type: 'text', text: simplified, marks: [{ type: 'nota' }] }],
    changed: true,
  }
}

// ── Processamento de notas após texto (regras 2 e 3) ─────────────

function processarNotaAposTexto(content, onLog) {
  const result = []
  const contentParticionado = splitNotaParenteticos(content)
  let i = 0
  let changed = false

  while (i < contentParticionado.length) {
    const n = contentParticionado[i]

    if (!hasNotaMark(n)) {
      result.push(n)
      i++
      continue
    }

    // Coleta o grupo de nós que formam um parentético de nota.
    // A coleta para quando todos os parênteses abertos se fecham.
    const group = []
    let depth = 0

    while (i < contentParticionado.length) {
      const curr = contentParticionado[i]
      const currHasNota = hasNotaMark(curr)
      const dentroDoParentetico = group.length > 0 && depth > 0 && curr.type === 'text'

      if (!currHasNota && !dentroDoParentetico) break

      group.push(currHasNota ? curr : withNotaMark(curr))
      for (const ch of curr.text) {
        if (ch === '(') depth++
        if (ch === ')') depth--
      }
      i++
      // Para ao fechar o parêntese (desde que já tenha aberto um)
      if (depth <= 0 && group.some(g => g.text.includes('('))) break
    }

    // Regra 3: mantém grupos "(Vide…" e notas com decisões de inconstitucionalidade
    const firstText = (group[0]?.text || '').trimStart()
    const groupText = group.map(g => g.text).join('')
    if (firstText.startsWith('(Vide') || /inconstitucional|\bADI\b/.test(groupText)) {
      result.push(...group)
    } else {
      changed = true
      onLog('removida')
      // Descarta nós inteiramente brancos imediatamente anteriores ao grupo
      while (result.length > 0) {
        const prev = result[result.length - 1]
        if (prev.type === 'text' && !hasNotaMark(prev) && !prev.text.trim()) {
          result.pop()
        } else break
      }
      // Apara espaço/NBSP final do último nó de texto com conteúdo
      if (result.length > 0) {
        const last = result[result.length - 1]
        if (last.type === 'text' && !hasNotaMark(last)) {
          const trimmed = last.text.replace(/[  ]+$/, '')
          if (trimmed !== last.text) {
            if (trimmed) result[result.length - 1] = { ...last, text: trimmed }
            else result.pop()
          }
        }
      }
    }
  }

  return { content: result, changed }
}

// ── Nós que não recebem o tratamento (estruturais / autônomos) ────

const TIPOS_IGNORADOS = new Set([
  'epigrafe', 'epigrafeApelido', 'ementa',
  'paragrafAbertura', 'aberturaCapitulo', 'partelivroTitCap', 'secaoSubsecao',
  'artigoTitulo', 'data', 'assinatura', 'assinaturaData', 'assinaturaNome',
])

// ── Processamento de nós "Nota título" (parágrafos autônomos de nota) ─

function processarNotaTitulo(node, onLog) {
  const fullText = getFullText(node.content || []).trimStart()

  // Só processa parágrafos que iniciam com "("
  if (!fullText.startsWith('(')) return node

  // Mantém notas "(Vide…" e notas com decisões de inconstitucionalidade
  if (fullText.startsWith('(Vide')) return node
  if (/inconstitucional|\bADI\b/.test(fullText)) return node

  // Simplifica notas de revogação
  if (/revogad[ao]/i.test(fullText)) {
    const simplified = simplificarRevogado(fullText)
    if (simplified) {
      onLog('simplificada')
      // Preserva as marks do primeiro nó nota, se houver; senão usa mark nota padrão
      const marks = node.content?.find(hasNotaMark)?.marks ?? [{ type: 'nota' }]
      return { ...node, content: [{ type: 'text', text: simplified, marks }] }
    }
    return node   // padrão não reconhecido — mantém
  }

  // Demais notas → remove o parágrafo inteiro
  onLog('removida')
  return null
}

function processarNo(node, onLog) {
  if (node.type === 'notaTitulo') return processarNotaTitulo(node, onLog)
  if (TIPOS_IGNORADOS.has(node.type)) return node
  if (!node.content?.length) return node

  const notaText = getNotaText(node.content)
  if (!notaText) return node

  const fullText = getFullText(node.content)

  if (isIsolatedNote(fullText)) {
    const { content, changed } = processarNotaIsolada(node.content, onLog)
    return changed ? { ...node, content } : node
  } else {
    const { content, changed } = processarNotaAposTexto(node.content, onLog)
    return changed ? { ...node, content } : node
  }
}

// ── Limpeza final de parágrafos ───────────────────────────────────
// Remove trailing whitespace de cada parágrafo e descarta parágrafos
// que ficaram vazios ou com apenas espaços após o processamento.

function limparParagrafos(docContent) {
  return docContent
    .map(node => {
      if (node.type === 'table') return node
      if (!node.content?.length) {
        // Parágrafo sem conteúdo → remove
        return null
      }
      // Trim trailing do content inline
      const content = trimTrailingNos(node.content)
      // Verifica se sobrou texto real
      const textoTotal = content.map(n => n.text || '').join('').trim()
      if (!textoTotal) return null
      return content === node.content ? node : { ...node, content }
    })
    .filter(Boolean)
}

// ── Normalização de espaços múltiplos em nós de texto ────────────

function normalizarEspacosConteudo(docContent) {
  return docContent.map(node => {
    if (!node.content?.length) return node
    let changed = false
    const newInline = node.content.map(n => {
      if (n.type !== 'text') return n
      // Colapsa sequências de espaço regular e/ou NBSP para um único espaço regular
      const novo = n.text.replace(/[  ]{2,}/g, ' ')
      if (novo === n.text) return n
      changed = true
      return { ...n, text: novo }
    })
    return changed ? { ...node, content: newInline } : node
  })
}

// ── Formatação de data: "nº X, de DD/MM/AAAA" → "nº X/AAAA" ─────

const DATA_RE = /([\d][\d.]*),\s+de\s+\d{1,2}\/\d{1,2}\/(\d{4})/g

function formatarDataNota(content) {
  let changed = false
  const result = content.map(n => {
    if (!hasNotaMark(n)) return n
    const novo = n.text.replace(DATA_RE, '$1/$2')
    if (novo === n.text) return n
    changed = true
    return { ...n, text: novo }
  })
  return { content: result, changed }
}

function formatarDataNoDoc(docContent, onLog) {
  let total = 0
  const newContent = docContent.map(node => {
    if (!node.content?.length) return node
    const { content, changed } = formatarDataNota(node.content)
    if (changed) { total++; return { ...node, content } }
    return node
  })
  if (total) onLog('data', total)
  return newContent
}

// ── Abreviação de "Constituição Federal de AAAA" → "CF/AAAA" ─────
// Aplicada somente em nós com marca nota ou em parágrafos notaTitulo.

const CF_RE = /Constituição Federal de (\d{4})/g

function abreviarCFEmConteudo(node) {
  if (!node.content?.length) return node
  const isNotaTitulo = node.type === 'notaTitulo'
  let changed = false
  const content = node.content.map(n => {
    if (n.type !== 'text') return n
    // Aplica somente em nós nota, ou em qualquer nó de notaTitulo (parágrafo inteiro é nota)
    if (!isNotaTitulo && !hasNotaMark(n)) return n
    const novo = n.text.replace(CF_RE, 'CF/$1')
    if (novo === n.text) return n
    changed = true
    return { ...n, text: novo }
  })
  return changed ? { ...node, content } : node
}

function abreviarCFNoDoc(docContent, onLog) {
  let total = 0
  const newContent = docContent.map(node => {
    const novo = abreviarCFEmConteudo(node)
    if (novo !== node) { total++; return novo }
    return node
  })
  if (total) onLog('cf', total)
  return newContent
}

// ── Remoção de "nº" antes de números (somente em nós nota) ───────

const NR_RE = /nº\s+(?=\d)/g

function removerNrNota(content) {
  let changed = false
  const result = content.map(n => {
    if (!hasNotaMark(n)) return n
    const novo = n.text.replace(NR_RE, '')
    if (novo === n.text) return n
    changed = true
    return { ...n, text: novo }
  })
  return { content: result, changed }
}

function removerNrNoDoc(docContent, onLog) {
  let total = 0
  const newContent = docContent.map(node => {
    if (!node.content?.length) return node
    const { content, changed } = removerNrNota(node.content)
    if (changed) { total++; return { ...node, content } }
    return node
  })
  if (total) onLog('nr', total)
  return newContent
}

// ── Vade Mecum: mantém somente a primeira assinatura após a data ─────

const ASSINATURA_DATA_RE = /^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç.' -]+,\s+(?:em\s+)?\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç]+\s+de\s+\d{4}\b/i
const NOME_ASSINATURA_RE = /^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç.' -]{2,}$/

function isDataNode(node) {
  if (node.type === 'data' || node.type === 'assinaturaData') return true
  return ASSINATURA_DATA_RE.test(getFullText(node.content || []).trim())
}

function isAssinaturaNode(node) {
  if (node.type === 'assinatura' || node.type === 'assinaturaNome') return true
  if (node.type !== 'paragrafLei' && node.type !== 'paragraph') return false
  const text = getFullText(node.content || []).trim()
  if (!NOME_ASSINATURA_RE.test(text)) return false
  if (/^(Art\.|Arts\.|§|Parágrafo\s+único|[IVXLCDM]+(?:-[A-Z])?\s*[–—-]|[a-záéíóúâêôîûàèìòùãõç]\)|\d+[.)]\s)/i.test(text)) return false
  if (/[.;:]$/.test(text)) return false
  return true
}

function isBlankNode(node) {
  return !getFullText(node.content || []).trim()
}

function manterPrimeiraAssinatura(docContent, onLog) {
  const result = []
  let emBlocoAssinatura = false
  let assinaturaMantida = false
  let removidas = 0

  for (const node of docContent) {
    if (isDataNode(node)) {
      emBlocoAssinatura = true
      assinaturaMantida = false
      result.push(node)
      continue
    }

    if (emBlocoAssinatura && isBlankNode(node)) {
      result.push(node)
      continue
    }

    if (emBlocoAssinatura && isAssinaturaNode(node)) {
      if (!assinaturaMantida) {
        assinaturaMantida = true
        result.push(node)
      } else {
        removidas++
      }
      continue
    }

    if (emBlocoAssinatura) {
      emBlocoAssinatura = false
      assinaturaMantida = false
    }

    result.push(node)
  }

  if (removidas) onLog('assinatura', removidas)
  return result
}

// ── API pública ───────────────────────────────────────────────────

/**
 * Aplica as regras de Notas Vade Mecum ao documento TipTap.
 * @param {object} doc  — resultado de editor.getJSON()
 * @returns {{ doc: object, log: string[] }}
 */
export function aplicarNotasVadeMecum(doc) {
  const { newContent, log, relatorio } = calcularNotasVadeMecum(doc)
  const cleanContent = newContent.map(stripVadeMeta)

  return { doc: { ...doc, content: cleanContent }, log, relatorio }
}

/**
 * Aplica as regras de Notas Vade Mecum preservando a versão original.
 * As variações VM ficam vinculadas à própria marca de nota, sem duplicar o parágrafo.
 */
export function aplicarNotasVadeMecumAlternavel(doc) {
  const { contentInicial, newContent, log, relatorio } = calcularNotasVadeMecum(doc)
  const vmPorId = {}
  newContent.forEach(node => {
    if (node.__vmId) vmPorId[node.__vmId] = node
  })

  const alternado = []
  let alterados = 0

  for (const original of contentInicial) {
    const vm = vmPorId[original.__vmId] || null
    const originalClean = limparVmRole(stripVadeMeta(original))
    const vmClean = vm ? limparVmRole(stripVadeMeta(vm)) : null
    const mudou = !vmClean || jsonSemVmMeta(originalClean) !== jsonSemVmMeta(vmClean)

    if (!mudou) {
      alternado.push(originalClean)
      continue
    }

    alterados++
    alternado.push(anotarNotasVm(originalClean, vmClean))
  }

  const logFinal = alterados
    ? [...log, `${alterados} bloco(s) com versão original/VM alternável`]
    : log

  return {
    doc: { ...doc, content: alternado },
    log: logFinal,
    relatorio,
    alterados,
  }
}

export function normalizarNotasVadeMecumLegado(doc) {
  const content = doc?.content || []
  const normalizado = []
  let alterados = 0

  for (let i = 0; i < content.length; i++) {
    const node = content[i]
    const role = node?.attrs?.vmRole

    if (role === 'original') {
      const prox = content[i + 1]
      if (prox?.attrs?.vmRole === 'vm') {
        normalizado.push(anotarNotasVm(limparVmRole(node), limparVmRole(prox)))
        alterados++
        i++
        continue
      }
      normalizado.push(limparVmRole(node))
      continue
    }

    if (role === 'vm') {
      alterados++
      continue
    }

    normalizado.push(node)
  }

  return {
    doc: { ...(doc || { type: 'doc' }), content: normalizado },
    alterados,
  }
}
