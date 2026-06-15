import {
  encontrarCaracterePorHtml,
  encontrarParagrafoPorHtml,
  estilosParagrafoConfigurados,
} from './preferenciasEstilo.js'

const BLOCK_CLASS_TO_NODE = {
  'tit-subtit_epigrafe': 'epigrafe',
  'tit-subtit_epigrafe-quebra': 'epigrafe',
  'tit-subtit_epigrafe-emenda': 'epigrafe',
  'tit-substit_epigrafe-emenda': 'epigrafe',
  'tit-subtit_epigrafe-apelido': 'epigrafeApelido',
  'corpo-legis_nota-titulos': 'notaTitulo',
  'corpo-legis_nota-titulos-transp': 'notaTitulo',
  'corpo-legis_ementa': 'ementa',
  'corpo-legis_emenda-ementa': 'ementa',
  'corpo-legis_texto-lei-sem-indent': 'paragrafAbertura',
  'corpo-legis_texto-lei-faco-saber': 'paragrafFacoSaber',
  'tit-subtit_abertura-cap': 'aberturaCapitulo',
  'tit-subtit_abertura-cap-quebra': 'aberturaCapitulo',
  'tit-subtit_abertura-cap-nova-pq': 'aberturaCapitulo',
  'tit-subtit_parte-livro-tit-cap': 'partelivroTitCap',
  'tit-subtit_secao-subsecao': 'secaoSubsecao',
  'corpo-legis_art': 'artigo',
  'corpo-legis_art-tit-centro': 'artigoTitulo',
  'corpo-legis_artigo-titulo': 'artigoTitulo',
  'corpo-legis_corpo-tratado': 'corpoTratado',
  'corpo-legis_texto-lei-citacao': 'citacao',
  'corpo-legis_nome-juridico': 'nomeJuridico',
  'corpo-legis_ass-data': 'data',
  'corpo-legis_ass-nome': 'assinatura',
  'corpo-legis_ass-nome-espaco-ant': 'assinatura',
  'texto-comum_titulo': 'textoComumTitulo',
  'texto-comum_subtitulo': 'textoComumSubtitulo',
  'texto-comum_texto-corrido': 'textoComumCorrido',
  'texto-comum_texto-recuado': 'textoComumRecuado',
  'texto-comum_citacao': 'textoComumCitacao',
  'texto-comum_bullets': 'textoComumBullets',
  'texto-comum_assinatura': 'textoComumAssinatura',
  'texto-comum_assinatura-cargo': 'textoComumAssinaturaCargo',
}

function classList(el) {
  return Array.from(el?.classList || [])
}

function hasClass(el, name) {
  return el?.classList?.contains(name)
}

function firstMappedClass(el, map) {
  return classList(el).find(cls => Object.prototype.hasOwnProperty.call(map, cls))
}

function textOf(node) {
  return String(node?.textContent || '').replace(/\uFEFF/g, '')
}

function inferTextoLeiType(text) {
  const s = String(text || '').trim()
  if (/^Par[aá]grafo\s+único\b/i.test(s) || /^§/.test(s)) return 'paragrafLei'
  if (/^[IVXLCDM]+(?:-[A-Z])?\s*[\u2013\u2014-]\s/.test(s)) return 'inciso'
  if (/^[a-záéíóúâêôîûàèìòùãõç]\)\s/i.test(s)) return 'alinea'
  if (/^\d+[.)]\s/.test(s) || /^\d+\s*[\u2013\u2014-]\s/.test(s)) return 'item'
  return 'paragrafLei'
}

function blockTypeFor(el) {
  const mapped = firstMappedClass(el, BLOCK_CLASS_TO_NODE)
  if (mapped) return BLOCK_CLASS_TO_NODE[mapped]
  if (hasClass(el, 'corpo-legis_texto-lei')) return inferTextoLeiType(textOf(el))
  return null
}

function attrsEstiloCustom(estilo) {
  return {
    styleId: estilo.id,
    label: estilo.label,
    cssClass: estilo.cssClass,
    format: estilo.format,
  }
}

function estiloPorIdOuNode(valor) {
  if (!valor) return null
  return estilosParagrafoConfigurados().find(e => e.id === valor || e.node === valor) || null
}

function mappedStyleValue(el, blockClassMap = {}) {
  const classes = classList(el)
  for (const cls of classes) {
    if (Object.prototype.hasOwnProperty.call(blockClassMap, cls)) return blockClassMap[cls]
  }
  const joined = classes.join(' ')
  if (joined && Object.prototype.hasOwnProperty.call(blockClassMap, joined)) return blockClassMap[joined]
  return null
}

function nodeInfoForMappedStyle(el, blockClassMap = {}) {
  const valor = mappedStyleValue(el, blockClassMap)
  const estilo = estiloPorIdOuNode(valor)
  if (!estilo) return null
  if (estilo.custom) {
    return { type: 'estiloParagrafoCustom', attrs: attrsEstiloCustom(estilo) }
  }
  return { type: estilo.node, attrs: undefined }
}

function nodeInfoForBlock(el, blockClassMap = {}) {
  const mapped = nodeInfoForMappedStyle(el, blockClassMap)
  if (mapped) return mapped

  const estiloHtml = encontrarParagrafoPorHtml(el)
  if (estiloHtml?.custom) {
    return { type: 'estiloParagrafoCustom', attrs: attrsEstiloCustom(estiloHtml) }
  }
  if (estiloHtml?.node && estiloHtml.node !== 'paragrafLei') {
    return { type: estiloHtml.node, attrs: undefined }
  }

  const type = blockTypeFor(el)
  return type ? { type, attrs: undefined } : null
}

function sameMarks(a = [], b = []) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type) return false
    if ((a[i].attrs?.href || '') !== (b[i].attrs?.href || '')) return false
    if ((a[i].attrs?.texto || '') !== (b[i].attrs?.texto || '')) return false
    if ((a[i].attrs?.styleId || '') !== (b[i].attrs?.styleId || '')) return false
  }
  return true
}

function pushText(content, text, marks = []) {
  if (!text) return
  const last = content[content.length - 1]
  if (last?.type === 'text' && sameMarks(last.marks || [], marks)) {
    last.text += text
    return
  }
  const node = { type: 'text', text }
  if (marks.length) node.marks = marks.map(m => ({ ...m, attrs: m.attrs ? { ...m.attrs } : undefined }))
  content.push(node)
}

function addMark(marks, mark) {
  if (marks.some(m => m.type === mark.type)) return marks
  return [...marks, mark]
}

function footnoteTargetId(anchor) {
  const href = anchor.getAttribute('href') || ''
  const hashIndex = href.indexOf('#')
  return hashIndex >= 0 ? href.slice(hashIndex + 1) : ''
}

function footnoteTextFromLi(li) {
  const paragraph = li.querySelector('p') || li
  const clone = paragraph.cloneNode(true)
  const anchor = clone.querySelector('a._idFootnoteAnchor')
  if (anchor) anchor.remove()
  return textOf(clone).replace(/^\s+/, '').replace(/\s+$/g, '')
}

function buildFootnoteMap(doc) {
  const map = {}
  doc.querySelectorAll('section._idFootnotes li._idFootnote[id]').forEach(li => {
    const id = li.getAttribute('id')
    const label = textOf(li.querySelector('a._idFootnoteAnchor')).trim()
    map[id] = {
      chamada: label || id.replace(/^footnote-/, ''),
      texto: footnoteTextFromLi(li),
    }
  })
  return map
}

function marksForElement(el, marks) {
  const tag = el.tagName.toLowerCase()
  let next = marks

  if (tag === 'b' || tag === 'strong') next = addMark(next, { type: 'bold' })
  if (tag === 'em' || tag === 'i') {
    if (hasClass(el, 'italico-light')) {
      next = addMark(next, { type: 'nota' })
      next = addMark(next, { type: 'italic' })
    } else {
      next = addMark(next, { type: 'italic' })
    }
  }

  if (hasClass(el, 'bold-artigo')) next = addMark(next, { type: 'boldArtigo' })
  if (hasClass(el, 'nota-novo-formato') || hasClass(el, 'nota-titulos')) {
    next = addMark(next.filter(m => m.type !== 'italic'), { type: 'nota' })
  }
  if (hasClass(el, 'nota-sobrescrito') || hasClass(el, 'sobrescrito-nota') || hasClass(el, 'leg-nota-sobrescrito')) {
    next = addMark(next.filter(m => m.type !== 'italic'), { type: 'notaSobrescrito' })
  }
  const estiloCustom = encontrarCaracterePorHtml(el)
  if (estiloCustom?.custom) {
    next = addMark(next, {
      type: 'estiloCaractereCustom',
      attrs: {
        styleId: estiloCustom.id,
        label: estiloCustom.label,
        cssClass: estiloCustom.cssClass,
        format: estiloCustom.format,
      },
    })
  }

  return next
}

function inlineContent(el, footnotes, marks = []) {
  const content = []

  el.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      pushText(content, child.nodeValue || '', marks)
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return

    const tag = child.tagName.toLowerCase()
    if (tag === 'br') {
      content.push({ type: 'hardBreak' })
      return
    }

    if (tag === 'a' && hasClass(child, '_idFootnoteLink')) {
      const id = footnoteTargetId(child)
      const note = footnotes[id]
      if (note) {
        const display = '[nota]'
        pushText(content, display, addMark(marks, {
          type: 'notaRodape',
          attrs: { texto: note.texto },
        }))
      }
      return
    }

    if (tag === 'a' && child.getAttribute('id') && !child.getAttribute('href')) return

    const childMarks = marksForElement(child, marks)
    inlineContent(child, footnotes, childMarks).forEach(node => {
      if (node.type === 'text') pushText(content, node.text, node.marks || [])
      else content.push(node)
    })
  })

  return content
}

function tableCellNode(cell, footnotes, isFirstRow) {
  const attrs = {}
  const colspan = parseInt(cell.getAttribute('colspan') || '1', 10)
  const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10)
  if (colspan > 1) attrs.colspan = colspan
  if (rowspan > 1) attrs.rowspan = rowspan

  const paragraphs = Array.from(cell.querySelectorAll(':scope > p'))
  const content = paragraphs.length
    ? paragraphs.map(p => ({ type: 'paragraph', content: inlineContent(p, footnotes) }))
    : [{ type: 'paragraph', content: inlineContent(cell, footnotes) }]

  return {
    type: isFirstRow ? 'tableHeader' : 'tableCell',
    attrs,
    content,
  }
}

function tableNode(table, footnotes) {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr, rowIndex) => {
    const cells = Array.from(tr.children)
      .filter(cell => /^(td|th)$/i.test(cell.tagName))
      .map(cell => tableCellNode(cell, footnotes, rowIndex === 0 || cell.tagName.toLowerCase() === 'th'))
    return cells.length ? { type: 'tableRow', content: cells } : null
  }).filter(Boolean)

  return rows.length ? { type: 'table', content: rows } : null
}

function blockNode(el, footnotes, options = {}) {
  if (el.tagName.toLowerCase() === 'table') return tableNode(el, footnotes)

  const info = nodeInfoForBlock(el, options.blockClassMap)
  if (!info?.type) return null

  const content = inlineContent(el, footnotes)
  return content.length
    ? { type: info.type, attrs: info.attrs, content }
    : { type: info.type, attrs: info.attrs }
}

function classeDesconhecida(el) {
  const classes = classList(el).filter(cls => cls !== 'excluir')
  return classes[0] || el.tagName.toLowerCase()
}

function blocoImportavelParaAnalise(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'table') return false
  if (hasClass(el, '_idFootnotes') || el.matches('section._idFootnotes, hr')) return false
  if (!/^(p|h1|h2|h3|h4|h5|h6|div)$/i.test(tag)) return false
  return Boolean(textOf(el).trim())
}

export function analisarClassesHtmlInDesign(htmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlText, 'text/html')
  const container = doc.body.querySelector('div[id^="_idContainer"]') || doc.body
  const grupos = {}

  Array.from(container.children).forEach(el => {
    if (!blocoImportavelParaAnalise(el)) return
    if (nodeInfoForBlock(el)) return

    const classe = classeDesconhecida(el)
    if (!grupos[classe]) {
      grupos[classe] = {
        classe,
        tag: el.tagName.toLowerCase(),
        total: 0,
        exemplos: [],
      }
    }
    grupos[classe].total += 1
    if (grupos[classe].exemplos.length < 3) {
      grupos[classe].exemplos.push(textOf(el).trim().replace(/\s+/g, ' ').slice(0, 180))
    }
  })

  return Object.values(grupos).sort((a, b) => a.classe.localeCompare(b.classe))
}

export function htmlInDesignParaTiptap(htmlText, options = {}) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlText, 'text/html')
  const footnotes = buildFootnoteMap(doc)
  const container = doc.body.querySelector('div[id^="_idContainer"]') || doc.body
  const blocks = []

  Array.from(container.children).forEach(el => {
    if (hasClass(el, '_idFootnotes') || el.matches('section._idFootnotes, hr')) return
    const node = blockNode(el, footnotes, options)
    if (node) blocks.push(node)
  })

  if (!blocks.length) {
    throw new Error('O HTML do InDesign nao contem blocos importaveis.')
  }

  return { type: 'doc', content: blocks }
}
