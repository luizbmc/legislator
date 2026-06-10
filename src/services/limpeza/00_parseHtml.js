/**
 * 00_parseHtml.js
 * Analisa o HTML colado pelo usuário e extrai:
 *   - blocos: lista ordenada de blocos (texto | tabela)
 *   - textoPuro: concatenação das linhas de texto, para a pipeline existente
 *
 * Executa no contexto do renderer (browser), portanto DOMParser está disponível.
 */

// ── Extrai texto plano de um elemento (br → espaço, não quebra) ───
// <br> dentro de parágrafo é layout — tratamos como espaço para não
// quebrar parágrafos em dois nós separados no pipeline.
function footnoteTargetId(anchor) {
  const href = anchor?.getAttribute?.('href') || ''
  if (!href || href.charAt(0) !== '#') return ''
  return href.slice(1)
}

function isMammothNoteId(id) {
  return /(?:^|-)footnote-\d+$|(?:^|-)endnote-\d+$/i.test(String(id || ''))
}

function normalizeNoteId(id) {
  return String(id || '').replace(/^#/, '').replace(/^_/, '')
}

function isMammothNoteRef(anchor, footnotes = {}) {
  const id = footnoteTargetId(anchor)
  return Boolean(id && (footnotes[id] || footnotes[normalizeNoteId(id)]))
}

function footnoteTextFromLi(li) {
  const clone = li.cloneNode(true)
  clone.querySelectorAll('a[href^="#"]').forEach(a => {
    const href = a.getAttribute('href') || ''
    if (/#.*(?:footnote|endnote)-ref-\d+$/i.test(href) || a.textContent.trim() === '↑') a.remove()
  })
  return String(clone.textContent || '').replace(/\s+/g, ' ').trim()
}

function buildMammothFootnoteMap(doc) {
  const footnotes = {}
  doc.querySelectorAll('li[id]').forEach(li => {
    const id = li.getAttribute('id') || ''
    if (!isMammothNoteId(id)) return
    const texto = footnoteTextFromLi(li)
    if (texto) footnotes[id] = { texto }
  })
  return footnotes
}

function noteTextFromWordBlock(block) {
  const clone = block.cloneNode(true)
  clone.querySelectorAll('a[href^="#"], a[name], a[id]').forEach(a => a.remove())
  return String(clone.textContent || '').replace(/\s+/g, ' ').trim()
}

function buildWordFootnoteMap(doc) {
  const footnotes = {}
  doc.querySelectorAll('[style*="mso-element:footnote"], [style*="mso-element:endnote"]').forEach(block => {
    const style = block.getAttribute('style') || ''
    if (/mso-element:\s*(?:footnote|endnote)-list/i.test(style)) return
    const id =
      block.getAttribute('id') ||
      block.querySelector('[name], [id]')?.getAttribute('name') ||
      block.querySelector('[name], [id]')?.getAttribute('id') ||
      ''
    const key = normalizeNoteId(id)
    const texto = noteTextFromWordBlock(block)
    if (key && texto) footnotes[key] = { texto }
  })
  return footnotes
}

function buildFootnoteMap(doc) {
  return {
    ...buildMammothFootnoteMap(doc),
    ...buildWordFootnoteMap(doc),
  }
}

function removeMammothFootnoteBlocks(doc, footnotes) {
  Object.keys(footnotes || {}).forEach(id => {
    const li = doc.getElementById(id)
    if (!li) return
    const parent = li.parentElement
    li.remove()
    if (parent && (parent.tagName === 'OL' || parent.tagName === 'UL') && !parent.textContent.trim()) parent.remove()
  })
  doc.querySelectorAll('[style*="mso-element:footnote"], [style*="mso-element:endnote"]').forEach(block => {
    block.remove()
  })
}

function getPlainText(node, footnotes = {}) {
  if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A' && isMammothNoteRef(node, footnotes)) {
    return '[nota]'
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.tagName === 'BR') return ' '
    let result = ''
    for (const child of node.childNodes) result += getPlainText(child, footnotes)
    return result
  }
  return ''
}

// ── Inline: converte nó DOM em array de TipTap inline nodes ───────
function parseInline(domNode, footnotes = {}) {
  const result = []

  for (const child of domNode.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = String(child.textContent || '').replace(/[\r\n\t]+/g, ' ')
      if (text) result.push({ type: 'text', text })
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const tag = child.tagName.toUpperCase()
    const inner = parseInline(child, footnotes)

    if (tag === 'BR') {
      result.push({ type: 'hardBreak' })
      continue
    }

    // Hiperlinks que começam com "(" → mark "nota" (sem itálico)
    if (tag === 'A') {
      if (isMammothNoteRef(child, footnotes)) {
        const id = footnoteTargetId(child)
        const note = footnotes[id] || footnotes[normalizeNoteId(id)]
        result.push({
          type: 'text',
          text: '[nota]',
          marks: [{ type: 'notaRodape', attrs: { texto: note.texto } }],
        })
        continue
      }
      const inner = parseInline(child, footnotes)
      if (child.textContent.trimStart().startsWith('(')) {
        for (const node of inner) {
          const marks = (node.marks || []).filter(m => m.type !== 'italic')
          marks.push({ type: 'nota' })
          result.push({ ...node, marks })
        }
      } else {
        result.push(...inner)
      }
      continue
    }

    // Determina as marks a adicionar a partir da tag e do style inline.
    // Negritos importados de Word/HTML sao descartados; os negritos
    // legislativos legitimos sao recriados depois em 07_aplicarMarcas.
    const marks = []
    if (tag === 'EM'     || tag === 'I') marks.push({ type: 'italic' })

    const st = child.style || {}
    if (!marks.some(m => m.type === 'italic') && st.fontStyle === 'italic') {
      marks.push({ type: 'italic' })
    }

    if (marks.length === 0) {
      // Nó sem mark: simplesmente desce (span, a, font, etc.)
      result.push(...inner)
    } else {
      // Adiciona as marks a todos os text-nodes filhos
      for (const node of inner) {
        if (node.type !== 'text' && node.type !== 'hardBreak') {
          result.push(node)
        } else {
          result.push({
            ...node,
            marks: [...(node.marks || []), ...marks],
          })
        }
      }
    }
  }

  return result
}

// ── Tabela: converte <table> em nó TipTap ─────────────────────────
function parseTable(tableEl, footnotes = {}) {
  const rows = []

  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = []
    for (const cell of tr.children) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue

      const isHeader = cell.tagName === 'TH'
      const colspan  = parseInt(cell.getAttribute('colspan') || '1')
      const rowspan  = parseInt(cell.getAttribute('rowspan') || '1')

      const inlineContent = parseInline(cell, footnotes)
      cells.push({
        type: isHeader ? 'tableHeader' : 'tableCell',
        attrs: { colspan, rowspan, colwidth: null },
        content: [{ type: 'paragraph', content: inlineContent }],
      })
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }

  return { type: 'table', content: rows }
}

// ── Regex: nota editorial em texto puro (sem hyperlink) ──────────
// Gatilho: "(" seguido de uma palavra-chave característica de notas
// de rodapé legislativas, como "Vide", "Revogado", "Incluído", etc.
export const NOTA_SEM_LINK_RE =
  /\((Vide|Revogad[oa]|Incluíd[oa]|Acrescid[oa]|Renumerad[oa]|Redação dada|Com redação|Alterações compiladas|Regulamentad[oa]|Vigência|(?:Artigo|Inciso|Alínea|Alinea|Item|Parágrafo|Paragrafo)\s+(?:revogad[oa]|incluíd[oa]|incluid[oa]|acrescid[oa]|renumerad[oa]))/i

/**
 * Detecta notas editoriais em texto puro (sem hyperlink) e aplica a marca "nota".
 * Quando o padrão é encontrado no meio de um nó de texto, divide-o em dois:
 *   – a parte anterior ao "(" fica sem marca
 *   – a partir do "(" recebe a marca "nota" (itálico removido)
 * Deve ser chamada ANTES de fillNotaGaps para que a propagação funcione.
 */
export function applyTextNota(nodes) {
  const result = []
  for (const node of nodes) {
    // Nós que não são texto, ou que já têm "nota", passam direto
    if (node.type !== 'text' || node.marks?.some(m => m.type === 'nota')) {
      result.push(node)
      continue
    }
    const match = NOTA_SEM_LINK_RE.exec(node.text)
    if (!match) {
      result.push(node)
      continue
    }
    // Texto anterior ao "(" permanece sem nota
    if (match.index > 0) {
      result.push({ ...node, text: node.text.slice(0, match.index) })
    }
    // A partir do "(" recebe nota; itálico é removido (padrão da marca)
    result.push({
      ...node,
      text:  node.text.slice(match.index),
      marks: [...(node.marks || []).filter(m => m.type !== 'italic'), { type: 'nota' }],
    })
  }
  return result
}

// ── Propaga marca "nota" de parêntese aberto até parêntese fechado ──
//
// Situação típica: o texto entre parênteses tem dois ou mais hyperlinks
// separados por texto comum, ex.:
//   <a>(Inciso acrescido pela Lei nº 10.709, de 31/7/2003</a>
//   , e
//   <a>com nova redação dada pela Lei nº 14.862, de 27/5/2024)</a>
//
// O parseInline já marca o primeiro <a> como nota (começa com "("), mas
// os nós intermediários e o segundo <a> ficam sem a marca.
// Esta função varre o array de nós inline e aplica nota a todos eles
// enquanto houver parênteses sem fechar.
export function fillNotaGaps(nodes) {
  let depth = 0      // parênteses abertos sem fechar (contados a partir do "(" inicial)
  let inside = false // true: estamos dentro de um parêntese aberto com nota

  let cursor = 0
  const starts = nodes.map(node => {
    const start = cursor
    if (node.type === 'text') cursor += node.text.length
    return start
  })
  const joined = nodes.map(node => node.type === 'text' ? node.text : '').join('')
  const continuaNotaWord = closeIndex =>
    /^\)[\s ]+e[\s ]+(?=[^)]*\d{1,2}\/\d{1,2}\/\d{4}\))/.test(joined.slice(closeIndex))

  return nodes.map((node, nodeIndex) => {
    if (node.type !== 'text') return node

    const hasNota = node.marks?.some(m => m.type === 'nota')
    const nodeStart = starts[nodeIndex]
    const contarParenteses = startIndex => {
      for (let k = startIndex; k < node.text.length; k++) {
        if (node.text[k] === '(') depth++
        if (node.text[k] === ')') {
          depth--
          // O Word pode quebrar uma mesma nota em dois hyperlinks:
          // "(... 21/5/1956)" + " e " + "transformado ... 21/6/1965)".
          // Nesse caso, o primeiro ")" é intermediário e a nota continua.
          if (depth <= 0 && continuaNotaWord(nodeStart + k)) depth = 1
        }
      }
    }

    if (!inside) {
      // Aguarda o primeiro nó com nota que contenha "(" para começar a rastrear.
      // Conta parênteses APENAS a partir desse "(" — ignora o que vem antes
      // (ex.: o ")" do rótulo "a)" não deve decrementar o contador).
      if (hasNota) {
        const openIdx = node.text.indexOf('(')
        if (openIdx >= 0) {
          contarParenteses(openIdx)
          if (depth > 0) inside = true
        }
      }
      return node
    }

    // Dentro de um parêntese com nota: conta todos os parênteses do nó
    contarParenteses(0)

    // Aplica nota ao nó atual (se ainda não tem)
    const novoNodo = hasNota
      ? node
      : {
          ...node,
          marks: [...(node.marks || []).filter(m => m.type !== 'italic'), { type: 'nota' }],
        }

    // Se todos os parênteses fecharam, sai do modo "dentro"
    if (depth <= 0) { inside = false; depth = 0 }

    return novoNodo
  })
}

// ── Tags de bloco raiz ────────────────────────────────────────────
const BLOCO_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'LI',
])

// ── Extrai blocos de um elemento (recursivo) ──────────────────────
function extrairBlocos(el, blocos, footnotes = {}) {
  for (const child of el.childNodes) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = child.tagName.toUpperCase()

    if (tag === 'TABLE') {
      blocos.push({ type: 'table', node: parseTable(child, footnotes) })
      continue
    }

    if (tag === 'UL' || tag === 'OL') {
      for (const li of child.children) {
        if (li.tagName !== 'LI') continue
        const text = getPlainText(li, footnotes).trim().replace(/\s+/g, ' ')
        if (text) {
          const content = fillNotaGaps(applyTextNota(parseInline(li, footnotes)))
          blocos.push({ type: 'text', text, content })
        }
      }
      continue
    }

    if (BLOCO_TAGS.has(tag)) {
      // Se o elemento contém tabela aninhada (ex.: <div> do Word com <table> dentro),
      // desce recursivamente para preservar a estrutura tabular.
      if (typeof child.querySelector === 'function' && child.querySelector('table')) {
        extrairBlocos(child, blocos, footnotes)
        continue
      }
      // <br> dentro do parágrafo é layout — getPlainText já converte para espaço
      const text    = getPlainText(child, footnotes).trim().replace(/\s+/g, ' ')
      const content = fillNotaGaps(applyTextNota(parseInline(child, footnotes)))
      if (text) blocos.push({ type: 'text', text, content })
      continue
    }

    // Contêiner genérico (section, article, main, etc.) — desce
    extrairBlocos(child, blocos, footnotes)
  }
}

// ── Limpeza de HTML do Word antes de exibir na área de colagem ───
// Chamada no evento paste — converte <br> em espaço, remove lixo
// do Office (tags de namespace, estilos mso, classes Mso*), preserva
// itálico e tabelas. Negritos sao descartados.
export function limparHtmlColado(html) {
  // Remove comentários condicionais do Word (<!--[if gte mso...]>...<![endif]-->)
  let s = html.replace(/<!--[\s\S]*?-->/g, '')
  // Remove tags de namespace Office/VML (o:p, w:sdt, v:shape, etc.)
  s = s.replace(/<\/?(?:o|v|w|m|st\d?):[^>]*>/gi, '')

  const doc = new DOMParser().parseFromString(s, 'text/html')
  const body = doc.body

  // Dentro de cada bloco, converte <br> em espaço (quebras de layout do Word)
  body.querySelectorAll('p, div, li, td, th').forEach(block => {
    block.querySelectorAll('br').forEach(br => br.replaceWith(' '))
  })

  // Simplifica estilos: mantem apenas font-style relevante.
  // font-weight do Word e descartado para evitar negritos herdados.
  body.querySelectorAll('[style]').forEach(el => {
    const fi = el.style.fontStyle
    const italic = fi === 'italic'
    el.removeAttribute('style')
    if (italic) el.style.fontStyle  = 'italic'
  })

  // Remove classes Mso* (Word) e lang
  body.querySelectorAll('[class]').forEach(el => {
    if (/\bMso/i.test(el.getAttribute('class') || '')) el.removeAttribute('class')
  })
  body.querySelectorAll('[lang]').forEach(el => el.removeAttribute('lang'))

  // Desembrulha spans sem formatação (ficaram depois da limpeza de style)
  // Precisa iterar de dentro para fora — usa Array.from para snapshot
  Array.from(body.querySelectorAll('span')).forEach(el => {
    if (!el.getAttribute('style')) el.replaceWith(...el.childNodes)
  })

  return body.innerHTML
}

/**
 * Sanitiza texto copiado de paginas da internet.
 * Preserva somente paragrafos e italico; links, negrito, classes, estilos,
 * cores, fontes e demais elementos de apresentacao sao descartados.
 */
export function limparHtmlInternet(html, textoPuro = '') {
  const escapeTextoPuro = texto => String(texto || '')
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean)
    .map(linha => {
      const p = document.createElement('p')
      p.textContent = linha
      return p.outerHTML
    })
    .join('')

  if (!html?.trim()) return escapeTextoPuro(textoPuro)

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const BLOCK_SELECTOR = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,pre,li'

  function copiarInline(origem, destino, outDoc, italicoHerdado = false) {
    for (const child of origem.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const texto = outDoc.createTextNode(child.textContent || '')
        if (italicoHerdado) {
          const em = outDoc.createElement('em')
          em.appendChild(texto)
          destino.appendChild(em)
        } else {
          destino.appendChild(texto)
        }
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue

      const tag = child.tagName.toUpperCase()
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME'].includes(tag)) continue
      if (tag === 'BR') {
        destino.appendChild(outDoc.createTextNode(' '))
        continue
      }

      const fontStyle = child.style?.fontStyle || ''
      const classe = child.getAttribute('class') || ''
      const italico = fontStyle === 'normal'
        ? false
        : tag === 'I' || tag === 'EM' ||
          /^(italic|oblique)/i.test(fontStyle) ||
          /\b(?:italic|italico)\b/i.test(classe) ||
          italicoHerdado
      copiarInline(child, destino, outDoc, italico)
    }
  }

  function copiarTabela(origem, outDoc) {
    const table = outDoc.createElement('table')
    const tbody = outDoc.createElement('tbody')
    const rows = origem.querySelectorAll('tr')

    rows.forEach(rowOrigem => {
      const row = outDoc.createElement('tr')
      Array.from(rowOrigem.children).forEach(cellOrigem => {
        const tag = cellOrigem.tagName?.toUpperCase()
        if (tag !== 'TD' && tag !== 'TH') return
        const cell = outDoc.createElement(tag.toLowerCase())
        const colspan = cellOrigem.getAttribute('colspan')
        const rowspan = cellOrigem.getAttribute('rowspan')
        if (colspan) cell.setAttribute('colspan', colspan)
        if (rowspan) cell.setAttribute('rowspan', rowspan)
        copiarInline(cellOrigem, cell, outDoc)
        row.appendChild(cell)
      })
      if (row.children.length) tbody.appendChild(row)
    })

    if (!tbody.children.length) return null
    table.appendChild(tbody)
    return table
  }

  function coletarBlocos(origem, outDoc, destino) {
    for (const child of origem.children) {
      const tag = child.tagName?.toUpperCase()
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME'].includes(tag)) continue

      if (tag === 'TABLE') {
        const table = copiarTabela(child, outDoc)
        if (table) destino.appendChild(table)
        continue
      }

      if (tag === 'UL' || tag === 'OL') {
        Array.from(child.children).forEach(li => {
          if (li.tagName?.toUpperCase() !== 'LI') return
          const p = outDoc.createElement('p')
          copiarInline(li, p, outDoc)
          if (p.textContent?.trim()) destino.appendChild(p)
        })
        continue
      }

      if (BLOCK_SELECTOR.split(',').includes(tag?.toLowerCase())) {
        if (child.querySelector('table')) {
          coletarBlocos(child, outDoc, destino)
          continue
        }
        const p = outDoc.createElement('p')
        copiarInline(child, p, outDoc)
        if (p.textContent?.trim()) destino.appendChild(p)
        continue
      }

      coletarBlocos(child, outDoc, destino)
    }
  }

  const out = document.implementation.createHTMLDocument('')
  coletarBlocos(doc.body, out, out.body)

  return out.body.innerHTML || escapeTextoPuro(textoPuro)
}

// ── Entry point ───────────────────────────────────────────────────
export function parseHtmlInput(html) {
  const log = []

  const doc  = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  const footnotes = buildFootnoteMap(doc)
  removeMammothFootnoteBlocks(doc, footnotes)

  const blocos = []
  extrairBlocos(body, blocos, footnotes)

  // Fallback: HTML sem tags de bloco → trata como texto puro
  if (blocos.length === 0) {
    const text = body.textContent ?? ''
    text.split('\n').forEach(line => {
      if (line.trim()) blocos.push({ type: 'text', text: line.trim(), content: null })
    })
    log.push('Texto simples detectado (sem formatação HTML)')
  }

  const textBlocks = blocos.filter(b => b.type === 'text')
  const tableCount = blocos.filter(b => b.type === 'table').length
  const richCount  = textBlocks.filter(b =>
    b.content?.some(n => n.marks?.length)
  ).length

  const footnoteCount = Object.keys(footnotes).length

  if (tableCount) log.push(`${tableCount} tabela(s) preservada(s)`)
  if (footnoteCount) log.push(`${footnoteCount} nota(s) de rodape preservada(s)`)
  if (richCount)  log.push(`${richCount} parágrafo(s) com itálico preservado(s)`)
  log.push(`${textBlocks.length} parágrafo(s) de texto extraído(s)`)

  const textoPuro = textBlocks.map(b => b.text).join('\n')

  return { blocos, textoPuro, log }
}
