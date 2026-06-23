const editor = document.getElementById('editor')
const docxInput = document.getElementById('docxInput')
const runBtn = document.getElementById('runBtn')
const clearBtn = document.getElementById('clearBtn')
const pasteModeBtn = document.getElementById('pasteModeBtn')
const occurrencesEl = document.getElementById('occurrences')
const countBadge = document.getElementById('countBadge')
const filtersEl = document.getElementById('filters')
const dropZone = document.getElementById('dropZone')

let occurrences = []
let activeFilter = 'todas'
let activeOccurrenceId = null

function escHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeParagraphHtml(text) {
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

function stripMarks() {
  editor.querySelectorAll('span.prep-mark').forEach(mark => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''))
  })
  editor.normalize()
  occurrences = []
  activeOccurrenceId = null
  renderOccurrences()
}

function textNodesInside(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest('.prep-mark')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

function collectMatches() {
  const matches = []
  const nodes = textNodesInside(editor)
  for (const node of nodes) {
    const text = node.nodeValue
    for (const rule of window.PREPARATOR_RULES) {
      const regex = new RegExp(rule.regex, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`)
      let match
      while ((match = regex.exec(text))) {
        const found = match[0]
        if (!found) {
          regex.lastIndex += 1
          continue
        }
        matches.push({
          node,
          start: match.index,
          end: match.index + found.length,
          text: found,
          rule,
        })
      }
    }
  }

  matches.sort((a, b) => {
    if (a.node === b.node) return b.start - a.start || b.end - a.end
    return 0
  })

  return matches
}

function runRules() {
  stripMarks()
  const matches = collectMatches()
  const list = []
  const matchesByNode = new Map()

  matches.forEach((match, index) => {
    const id = `occ-${Date.now()}-${index}`
    if (!matchesByNode.has(match.node)) matchesByNode.set(match.node, [])
    matchesByNode.get(match.node).push({ ...match, id })
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
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))
      }

      const span = document.createElement('span')
      span.className = `prep-mark ${match.rule.severidade}`
      span.dataset.occurrenceId = match.id
      span.title = `${match.rule.titulo}: ${match.rule.descricao}`
      span.textContent = text.slice(match.start, match.end)
      fragment.appendChild(span)

      list.push({
        id: match.id,
        text: match.text,
        rule: match.rule,
        element: span,
      })

      cursor = match.end
    })

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)))
    }

    node.parentNode.replaceChild(fragment, node)
  })

  occurrences = list
  renderFilters()
  renderOccurrences()
}

function renderFilters() {
  const groups = ['todas', ...Array.from(new Set(occurrences.map(o => o.rule.grupo))).sort()]
  filtersEl.innerHTML = groups.map(group => (
    `<button type="button" class="filter${activeFilter === group ? ' active' : ''}" data-filter="${escHtml(group)}">${escHtml(group)}</button>`
  )).join('')
}

function filteredOccurrences() {
  return activeFilter === 'todas'
    ? occurrences
    : occurrences.filter(o => o.rule.grupo === activeFilter)
}

function renderOccurrences() {
  const list = filteredOccurrences()
  countBadge.textContent = String(occurrences.length)
  if (!occurrences.length) {
    occurrencesEl.className = 'occurrences empty'
    occurrencesEl.textContent = 'Nenhuma ocorrência marcada.'
    renderFilters()
    return
  }

  occurrencesEl.className = 'occurrences'
  occurrencesEl.innerHTML = list.map(o => `
    <button type="button" class="occurrence ${o.rule.severidade}${o.id === activeOccurrenceId ? ' active' : ''}" data-id="${o.id}">
      <strong>${escHtml(o.rule.titulo)}</strong>
      <span>${escHtml(o.text)}</span>
      <span>${escHtml(o.rule.descricao)}</span>
    </button>
  `).join('')
}

function focusOccurrence(id) {
  const item = occurrences.find(o => o.id === id)
  if (!item?.element?.isConnected) return

  document.querySelectorAll('.prep-mark.active').forEach(el => el.classList.remove('active'))
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
  dropZone.innerHTML = `<strong>${escHtml(file.name)}</strong> importado. Execute as marcações.`
}

docxInput.addEventListener('change', event => {
  const file = event.target.files?.[0]
  importDocx(file).catch(err => {
    console.error(err)
    alert(`Não foi possível importar o DOCX: ${err.message}`)
  })
})

runBtn.addEventListener('click', runRules)
clearBtn.addEventListener('click', stripMarks)

pasteModeBtn.addEventListener('click', async () => {
  stripMarks()
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) {
    editor.innerHTML = normalizeParagraphHtml(text)
    dropZone.textContent = 'Texto colado. Execute as marcações.'
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
  const mark = event.target.closest('.prep-mark')
  if (mark) focusOccurrence(mark.dataset.occurrenceId)
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
