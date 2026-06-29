const editor = document.getElementById('editor')
const docxInput = document.getElementById('docxInput')
const runBtn = document.getElementById('runBtn')
const clearBtn = document.getElementById('clearBtn')
const pasteModeBtn = document.getElementById('pasteModeBtn')
const occurrencesEl = document.getElementById('occurrences')
const countBadge = document.getElementById('countBadge')
const filtersEl = document.getElementById('filters')
const dropZone = document.getElementById('dropZone')
const summaryEl = document.getElementById('summary')
const sourceModal = document.getElementById('sourceModal')
const sourceModalClose = document.getElementById('sourceModalClose')
const sourceModalCitation = document.getElementById('sourceModalCitation')
const sourceModalBody = document.getElementById('sourceModalBody')

let occurrences = []
let activeFilter = 'todos'
let activeOccurrenceId = null
let ultimoResultado = null

const YEAR_RE = /(?:19|20)\d{2}[a-z]?/i
const YEAR_GLOBAL_RE = /(?:19|20)\d{2}[a-z]?/gi

function escHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizarTexto(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”‘’"']/g, '')
    .replace(/\bet\s+al\.?/gi, ' et al')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizarParagrafoHtml(text) {
  const parts = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
  return parts.length
    ? parts.map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '<p></p>'
}

function blocosTexto() {
  return Array.from(editor.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6'))
}

function textoBloco(el) {
  return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
}

function stripMarks() {
  editor.querySelectorAll('span.ref-mark').forEach(mark => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''))
  })
  editor.querySelectorAll('.refs-heading').forEach(el => el.classList.remove('refs-heading'))
  editor.querySelectorAll('.ref-unused').forEach(el => {
    el.classList.remove('ref-unused', 'active')
    delete el.dataset.occurrenceId
  })
  editor.normalize()
  occurrences = []
  activeOccurrenceId = null
  ultimoResultado = null
  renderFilters()
  renderOccurrences()
  renderSummary(null)
}

function encontrarSecaoReferencias() {
  const blocks = blocosTexto()
  const headingIndex = blocks.findIndex(el => {
    const text = normalizarTexto(textoBloco(el))
    return /^(REFERENCIAS|REFERENCIAS BIBLIOGRAFICAS|BIBLIOGRAFIA|REFERENCES)$/.test(text)
  })
  return {
    blocks,
    headingIndex,
    bodyBlocks: headingIndex >= 0 ? blocks.slice(0, headingIndex) : blocks,
    referenceBlocks: headingIndex >= 0 ? blocks.slice(headingIndex + 1) : [],
    heading: headingIndex >= 0 ? blocks[headingIndex] : null,
  }
}

function pareceInicioReferencia(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ\s.'’-]+,\s+[A-ZÀ-Þ]/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ\s.'’-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ0-9\s.'’()&-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-Za-zÀ-ÿ.'’-]+,\s+[A-ZÀ-Þ]/.test(t)) return true
  return false
}

function montarReferencias(referenceBlocks) {
  const refs = []
  for (const block of referenceBlocks) {
    const text = textoBloco(block)
    if (!text) continue
    if (!refs.length || pareceInicioReferencia(text)) {
      refs.push({ text, element: block })
    } else {
      refs[refs.length - 1].text += ` ${text}`
    }
  }
  return refs.map((ref, index) => {
    const anos = Array.from(new Set((ref.text.match(YEAR_GLOBAL_RE) || []).map(ano => ano.toLowerCase())))
    const ano = anos[0] || ''
    const normal = normalizarTexto(ref.text)
    return {
      ...ref,
      index,
      ano,
      anos,
      normal,
      inicioNormal: normalizarTexto(ref.text.split('.')[0] || ref.text),
    }
  })
}

function normalizarQuebrasSoltas() {
  const blocks = blocosTexto()
  if (blocks.length !== 1) return
  const text = editor.innerText || editor.textContent || ''
  if (!/\n{2,}/.test(text)) return
  editor.innerHTML = normalizarParagrafoHtml(text)
}

function limparAutoria(raw) {
  return String(raw || '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\b(?:apud|cf|ver|vide)\b\.?/gi, '')
    .replace(/\b(?:p|pp)\.\s*[\d–—-]+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
}

function autoresDaCitacao(raw) {
  const autoria = limparAutoria(raw)
  const temEtAl = /\bet\s+al\.?/i.test(raw)
  const normal = normalizarTexto(autoria)
  if (!normal) return []

  if (temEtAl) {
    return [normal.split(/\s+/)[0]].filter(Boolean)
  }

  const partes = autoria
    .split(/\s*;\s*|\s*,\s*(?=[A-ZÀ-Ý][A-Za-zÀ-ÿ]+(?:\s|$))/)
    .map(p => normalizarTexto(p))
    .filter(Boolean)

  return partes.length ? partes : [normal]
}

function ehParenteseNaoBibliografico(text) {
  const cleaned = String(text || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^\d{4}\s*[-\u2013\u2014]\s*\d{4}$/.test(cleaned)) return true

  const legalText = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (/\/\s*(?:19|20)\d{2}\b/.test(legalText)) return true
  if (/^(?:lei|leis|lei complementar|decreto|decreto lei|medida provisoria|emenda constitucional|resolucao)\b.*\b\d{1,5}(?:[\.\s]?\d{3})*\/(?:19|20)\d{2}\b/.test(legalText)) {
    return true
  }

  return false
}

function extrairUnidadesCitacao(text) {
  if (ehParenteseNaoBibliografico(text)) return []
  const cleaned = String(text || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^\d{4}\s*[-–—]\s*\d{4}$/.test(cleaned)) return []
  const units = []
  let cursor = 0
  let match
  YEAR_GLOBAL_RE.lastIndex = 0
  while ((match = YEAR_GLOBAL_RE.exec(cleaned))) {
    const rawAuthors = cleaned.slice(cursor, match.index).replace(/^[;\s]+/, '').replace(/[,;\s]+$/, '')
    const ano = match[0].toLowerCase()
    const after = cleaned.slice(match.index + match[0].length)
    const pagina = (after.match(/^\s*,?\s*p\.?\s*[\d–—-]+(?:\s*-\s*\d+)?/i) || [''])[0]
    if (rawAuthors && !/^\d+$/.test(rawAuthors) && !/(?:^|[\s,;])de$/i.test(rawAuthors)) {
      units.push({
        raw: `${rawAuthors}, ${ano}${pagina}`.replace(/\s+/g, ' ').trim(),
        authorsRaw: rawAuthors,
        authors: autoresDaCitacao(rawAuthors),
        ano,
      })
    }
    const nextSeparator = after.search(/\s*;\s*/)
    cursor = nextSeparator === 0
      ? match.index + match[0].length + (after.match(/^\s*;\s*/) || [''])[0].length
      : match.index + match[0].length
  }
  return units
}

function encontrarAutorAntes(text, start) {
  const before = text.slice(0, start)
  const match = before.match(/(?:^|[\s,.;:])([A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+(?:\s+(?:de|da|do|das|dos|e|Jr\.?|Junior|Filho|Neto|Sobrinho|et\s+al\.?|[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+)){0,8})\s*$/)
  if (!match) return null
  const original = match[1].trim()
  const author = original
    .replace(/^(?:Segundo|Para|Conforme|Cf\.?|Ver|Vide|Apud)\s+/i, '')
    .trim()
  const deslocamento = original.length - author.length
  const authorStart = start - original.length + deslocamento - (before.slice(-1) === ' ' ? 1 : 0)
  return {
    text: author,
    start: Math.max(0, authorStart + (before.slice(authorStart, authorStart + 1) === ' ' ? 1 : 0)),
  }
}

function temIndicadorCitacaoAntes(text, authorStart) {
  const contexto = text.slice(Math.max(0, authorStart - 80), authorStart)
  return /(?:^|[\s,.;:])(?:segundo|conforme|para|apud|cf\.?|ver|vide|destaca|afirma|afirmam|aponta|apontam|observa|observam|sustenta|sustentam|defende|defendem|explica|explicam|assinala|assinalam|ressalta|ressaltam|a pesquisadora|o pesquisador|a autora|o autor|as autoras|os autores|de acordo com)\s+$/i
    .test(contexto)
}

function autorAnoExisteNaLista(authorText, ano, referencias) {
  if (!authorText || !ano) return false
  const unit = {
    authorsRaw: authorText,
    authors: autoresDaCitacao(authorText),
    ano: String(ano).toLowerCase(),
  }
  return referencias.some(ref => scoreReferencia(unit, ref, true) > 0)
}

function textNodesInside(root, limiteSet) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest('.ref-mark')) return NodeFilter.FILTER_REJECT
      const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6')
      if (!block || !limiteSet.has(block)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

function coletarCitacoes(bodyBlocks, referencias) {
  const matches = []
  const limiteSet = new Set(bodyBlocks)
  const nodes = textNodesInside(editor, limiteSet)

  for (const node of nodes) {
    const text = node.nodeValue
    const regex = /\(([^()\n]{0,220}(?:19|20)\d{2}[a-z]?(?:[^()\n]{0,120})?)\)/gi
    let match
    while ((match = regex.exec(text))) {
      const inside = match[1]
      if (ehParenteseNaoBibliografico(inside)) continue
      if (/^\s*\d{4}\s*[-–—]\s*\d{4}\s*$/.test(inside)) continue
      let units = extrairUnidadesCitacao(inside)
      let start = match.index
      let display = match[0]

      if (units.length <= 1 && /^[,;\s]*(?:19|20)\d{2}/i.test(inside)) {
        const autorAntes = encontrarAutorAntes(text, match.index)
        const ano = (inside.match(YEAR_RE) || [''])[0].toLowerCase()
        const aceitarAutorAntes = autorAntes?.text && (
          temIndicadorCitacaoAntes(text, autorAntes.start)
          || autorAnoExisteNaLista(autorAntes.text, ano, referencias)
        )
        if (aceitarAutorAntes) {
          units = [{
            raw: `${autorAntes.text} (${inside})`,
            authorsRaw: autorAntes.text,
            authors: autoresDaCitacao(autorAntes.text),
            ano,
          }]
          start = autorAntes.start
          display = text.slice(start, regex.lastIndex)
        }
      }

      if (!units.length) continue
      matches.push({
        node,
        start,
        end: regex.lastIndex,
        text: display,
        units,
      })
    }
  }

  return matches.sort((a, b) => {
    if (a.node === b.node) return b.start - a.start || b.end - a.end
    return 0
  })
}

function scoreReferencia(unit, ref, exigirAno) {
  const anoOk = unit.ano && ((ref.anos || []).includes(unit.ano) || ref.ano === unit.ano)
  if (exigirAno && !anoOk) return 0

  const autores = unit.authors || []
  if (!autores.length) return 0

  let hits = 0
  for (const author of autores) {
    const words = author.split(/\s+/).filter(w => w.length > 1)
    if (!words.length) continue
    const phraseHit = ref.normal.includes(author)
    const wordHits = words.filter(w => ref.normal.includes(w)).length
    if (phraseHit || wordHits >= Math.min(words.length, 2)) hits += 1
  }

  if (!hits) return 0
  return (anoOk ? 100 : 45) + hits * 10
}

function vincularUnidade(unit, referencias) {
  const comAno = referencias
    .map(ref => ({ ref, score: scoreReferencia(unit, ref, true) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]

  if (comAno) return { status: 'ok', ref: comAno.ref }

  const semAno = referencias
    .map(ref => ({ ref, score: scoreReferencia(unit, ref, false) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]

  if (semAno) return { status: 'warning', ref: semAno.ref }
  return { status: 'missing', ref: null }
}

function classeResultado(statuses) {
  if (statuses.includes('missing')) return 'missing'
  if (statuses.includes('warning')) return 'warning'
  return 'ok'
}

function textoStatus(status) {
  if (status === 'ok') return 'Encontrada'
  if (status === 'warning') return 'Ano divergente'
  if (status === 'unused') return 'Referência não citada'
  return 'Ausente'
}

function aplicarMarcacoes(matches, referencias) {
  const list = []
  const matchesByNode = new Map()

  matches.forEach((match, index) => {
    const resultados = match.units.map(unit => ({
      unit,
      ...vincularUnidade(unit, referencias),
    }))
    const status = classeResultado(resultados.map(r => r.status))
    const id = `ref-${Date.now()}-${index}`
    if (!matchesByNode.has(match.node)) matchesByNode.set(match.node, [])
    matchesByNode.get(match.node).push({ ...match, id, resultados, status })
  })

  matchesByNode.forEach((nodeMatches, node) => {
    if (!node.parentNode) return
    const text = node.nodeValue
    const ordered = nodeMatches
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .filter((match, index, arr) => index === 0 || match.start >= arr[index - 1].end)

    const fragment = document.createDocumentFragment()
    let cursor = 0

    ordered.forEach(match => {
      if (match.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))

      const span = document.createElement('span')
      span.className = `ref-mark ${match.status}`
      span.dataset.occurrenceId = match.id
      span.title = match.resultados.map(r => `${r.unit.raw}: ${textoStatus(r.status)}`).join('\n')
      span.textContent = text.slice(match.start, match.end)
      fragment.appendChild(span)

      list.push({
        id: match.id,
        text: span.textContent,
        status: match.status,
        resultados: match.resultados,
        element: span,
      })

      cursor = match.end
    })

    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  })

  return list
}

function anexarReferenciasNaoCitadas(list, referencias) {
  const usadas = new Set()
  const unidadesCitadas = []
  list.forEach(item => {
    ;(item.resultados || []).forEach(resultado => {
      if (resultado.unit) unidadesCitadas.push(resultado.unit)
      if (resultado.ref && resultado.status !== 'missing') {
        usadas.add(resultado.ref.index)
      }
    })
  })

  referencias.forEach(ref => {
    if (usadas.has(ref.index)) return
    if (unidadesCitadas.some(unit => scoreReferencia(unit, ref, true) > 0)) {
      usadas.add(ref.index)
    }
  })

  referencias.forEach(ref => {
    if (usadas.has(ref.index)) return
    const id = `unused-${Date.now()}-${ref.index}`
    if (ref.element?.isConnected) {
      ref.element.classList.add('ref-unused')
      ref.element.dataset.occurrenceId = id
    }
    list.push({
      id,
      text: ref.text,
      status: 'unused',
      resultados: [],
      referenceText: ref.text,
      element: ref.element,
    })
  })

  return list
}

function conferirReferencias() {
  stripMarks()
  normalizarQuebrasSoltas()
  const secao = encontrarSecaoReferencias()
  if (secao.heading) secao.heading.classList.add('refs-heading')

  const referencias = montarReferencias(secao.referenceBlocks)
  const citacoes = coletarCitacoes(secao.bodyBlocks, referencias)
  occurrences = anexarReferenciasNaoCitadas(aplicarMarcacoes(citacoes, referencias), referencias)
  ultimoResultado = { secao, referencias, citacoes, occurrences }
  renderFilters()
  renderOccurrences()
  renderSummary(ultimoResultado)
}

function renderSummary(resultado) {
  if (!resultado) {
    summaryEl.textContent = 'Importe ou cole um texto para começar.'
    countBadge.textContent = '0'
    return
  }
  const total = occurrences.length
  const ok = occurrences.filter(o => o.status === 'ok').length
  const warning = occurrences.filter(o => o.status === 'warning').length
  const missing = occurrences.filter(o => o.status === 'missing').length
  const unused = occurrences.filter(o => o.status === 'unused').length
  const refs = resultado.referencias.length
  const citacoes = resultado.citacoes.length
  const heading = resultado.secao.heading ? 'seção de referências encontrada' : 'seção de referências não encontrada'
  summaryEl.innerHTML = `
    <strong>${total}</strong> ocorrência(s): <strong>${citacoes}</strong> citação(ões) no texto, <strong>${refs}</strong> referência(s), ${heading}.<br>
    Encontradas: <strong>${ok}</strong> · Ano divergente: <strong>${warning}</strong> · Ausentes: <strong>${missing}</strong> · Não citadas: <strong>${unused}</strong>
  `
  countBadge.textContent = String(total)
}

function renderFilters() {
  const groups = [
    ['todos', 'Todos'],
    ['ok', 'Encontradas'],
    ['warning', 'Ano divergente'],
    ['missing', 'Ausentes'],
    ['unused', 'Não citadas'],
  ]
  filtersEl.innerHTML = groups.map(([id, label]) => (
    `<button type="button" class="filter${activeFilter === id ? ' active' : ''}" data-filter="${id}">${label}</button>`
  )).join('')
}

function filteredOccurrences() {
  return activeFilter === 'todos'
    ? occurrences
    : occurrences.filter(o => o.status === activeFilter)
}

function renderOccurrences() {
  const list = filteredOccurrences()
  if (!occurrences.length) {
    occurrencesEl.className = 'occurrences empty'
    occurrencesEl.textContent = 'Nenhuma ocorrência marcada.'
    countBadge.textContent = '0'
    return
  }

  occurrencesEl.className = 'occurrences'
  occurrencesEl.innerHTML = list.map(o => {
    const refs = o.status === 'unused'
      ? ''
      : o.resultados.map(r => {
      const refText = r.ref?.text || 'Referência não encontrada.'
      const detalharUnidade = o.resultados.length > 1
        || r.status !== o.status
        || o.status !== 'ok'
      return `
        ${detalharUnidade ? `<span>${escHtml(r.unit.raw)} — ${textoStatus(r.status)}</span>` : ''}
        <span class="reference">${escHtml(refText)}</span>
      `
    }).join('')
    return `
      <button type="button" class="occurrence ${o.status}${o.id === activeOccurrenceId ? ' active' : ''}" data-id="${o.id}">
        <strong>${textoStatus(o.status)}</strong>
        <span${o.status === 'unused' ? ' class="reference"' : ''}>${escHtml(o.text)}</span>
        ${refs}
      </button>
    `
  }).join('')
}

function focusOccurrence(id) {
  const item = occurrences.find(o => o.id === id)
  if (!item?.element?.isConnected) return

  document.querySelectorAll('.ref-mark.active, .ref-unused.active').forEach(el => el.classList.remove('active'))
  item.element.classList.add('active')
  activeOccurrenceId = id
  renderOccurrences()

  item.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const range = document.createRange()
  range.selectNodeContents(item.element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

function renderFonteReferencia(item) {
  if (!item) return ''
  if (item.status === 'unused') {
    return `
      <div class="source-item unused">
        <strong>${textoStatus(item.status)}</strong>
        <p>${escHtml(item.referenceText || item.text)}</p>
      </div>
    `
  }

  return (item.resultados || []).map(resultado => {
    const refText = resultado.ref?.text || 'Referência não encontrada na lista final.'
    return `
      <div class="source-item ${resultado.status}">
        <strong>${escHtml(resultado.unit?.raw || item.text)} — ${textoStatus(resultado.status)}</strong>
        <p>${escHtml(refText)}</p>
      </div>
    `
  }).join('')
}

function abrirModalFonte(id) {
  const item = occurrences.find(o => o.id === id)
  if (!item || !sourceModal) return
  sourceModalCitation.textContent = item.text || ''
  sourceModalBody.innerHTML = renderFonteReferencia(item)
  sourceModal.classList.remove('hidden')
}

function fecharModalFonte() {
  sourceModal?.classList.add('hidden')
}

async function importDocx(file) {
  if (!file) return
  stripMarks()
  dropZone.textContent = `Importando ${file.name}...`
  const arrayBuffer = await file.arrayBuffer()
  const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "b => strong",
      "i => em",
    ],
  })
  editor.innerHTML = result.value || '<p></p>'
  conferirReferencias()
  dropZone.innerHTML = `<strong>${escHtml(file.name)}</strong> importado. Clique em Conferir referências.`
  dropZone.innerHTML = `<strong>${escHtml(file.name)}</strong> importado. Conferencia executada automaticamente.`
}

docxInput.addEventListener('change', event => {
  const file = event.target.files?.[0]
  importDocx(file).catch(err => {
    console.error(err)
    alert(`Não foi possível importar o DOCX: ${err.message}`)
  })
})

runBtn.addEventListener('click', conferirReferencias)
clearBtn.addEventListener('click', stripMarks)

pasteModeBtn.addEventListener('click', async () => {
  stripMarks()
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) {
    editor.innerHTML = normalizarParagrafoHtml(text)
    dropZone.textContent = 'Texto colado. Clique em Conferir referências.'
  } else {
    alert('Não consegui ler a área de transferência. Cole diretamente na página.')
  }
})

filtersEl.addEventListener('click', event => {
  const btn = event.target.closest('[data-filter]')
  if (!btn) return
  activeFilter = btn.dataset.filter
  renderFilters()
  renderOccurrences()
})

occurrencesEl.addEventListener('click', event => {
  const btn = event.target.closest('[data-id]')
  if (!btn) return
  focusOccurrence(btn.dataset.id)
})

editor.addEventListener('click', event => {
  const mark = event.target.closest('.ref-mark, .ref-unused')
  if (!mark) return
  focusOccurrence(mark.dataset.occurrenceId)
  if (mark.classList.contains('ref-mark')) {
    abrirModalFonte(mark.dataset.occurrenceId)
  }
})

sourceModalClose?.addEventListener('click', fecharModalFonte)
sourceModal?.addEventListener('click', event => {
  if (event.target.closest('[data-source-close]')) fecharModalFonte()
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sourceModal?.classList.contains('hidden')) {
    fecharModalFonte()
  }
})

dropZone.addEventListener('dragover', event => {
  event.preventDefault()
  dropZone.classList.add('dragover')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover')
})

dropZone.addEventListener('drop', event => {
  event.preventDefault()
  dropZone.classList.remove('dragover')
  const file = Array.from(event.dataTransfer.files || []).find(f => /\.docx$/i.test(f.name))
  if (file) importDocx(file)
})

renderFilters()
renderOccurrences()
