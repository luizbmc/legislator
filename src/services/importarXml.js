import {
  encontrarCaracterePorTagImportacao,
  encontrarParagrafoPorTagImportacao,
} from './preferenciasEstilo.js'

const TAG_TO_NODE = {
  Epigrafe: 'epigrafe',
  EpigrafeApelido: 'epigrafeApelido',
  NotaTitulo: 'notaTitulo',
  Ementa: 'ementa',
  ParagrafoAbertura: 'paragrafAbertura',
  ParagrafoFacoSaber: 'paragrafFacoSaber',
  AberturaCapitulo: 'aberturaCapitulo',
  Divisao: 'partelivroTitCap',
  Secao: 'secaoSubsecao',
  Artigo: 'artigo',
  ArtigoTitulo: 'artigoTitulo',
  CorpoTratado: 'corpoTratado',
  NomeJuridico: 'nomeJuridico',
  Paragrafo: 'paragrafLei',
  Inciso: 'inciso',
  Alinea: 'alinea',
  Item: 'item',
  Citacao: 'citacao',
  Data: 'data',
  Assinatura: 'assinatura',
  AssinaturaData: 'data',
  AssinaturaNome: 'assinatura',
}

function localName(node) {
  return node?.localName || node?.nodeName?.replace(/^.*:/, '') || ''
}

function attrsFromElement(el) {
  const attrs = {}
  ;['alterado', 'numero', 'rotulo'].forEach(name => {
    const value = el.getAttribute(name)
    if (value != null && value !== '') attrs[name] = value
  })
  return attrs
}

function sameMarks(a = [], b = []) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type) return false
    if ((a[i].attrs?.href || '') !== (b[i].attrs?.href || '')) return false
    if ((a[i].attrs?.styleId || '') !== (b[i].attrs?.styleId || '')) return false
  }
  return true
}

function pushText(content, text, marks) {
  if (!text) return
  const last = content[content.length - 1]
  if (last?.type === 'text' && sameMarks(last.marks || [], marks || [])) {
    last.text += text
    return
  }
  const node = { type: 'text', text }
  if (marks?.length) node.marks = marks.map(m => ({ ...m }))
  content.push(node)
}

function addMarkForTag(tag, marks, el) {
  const estiloConfigurado = encontrarCaracterePorTagImportacao(tag)
  if (estiloConfigurado?.custom) {
    return [...marks, {
      type: 'estiloCaractereCustom',
      attrs: {
        styleId: estiloConfigurado.id,
        label: estiloConfigurado.label,
        cssClass: estiloConfigurado.cssClass,
        format: estiloConfigurado.format,
      },
    }]
  }
  if (estiloConfigurado?.id) {
    if (estiloConfigurado.id === 'bold') return [...marks, { type: 'bold' }]
    if (estiloConfigurado.id === 'italic') return [...marks, { type: 'italic' }]
    if (estiloConfigurado.id === 'nota') return [...marks, { type: 'nota' }]
    if (estiloConfigurado.id === 'notaSobrescrito') return [...marks, { type: 'notaSobrescrito' }]
    if (estiloConfigurado.id === 'boldArtigo') return [...marks, { type: 'boldArtigo' }]
    if (estiloConfigurado.id === 'regular') return [...marks, { type: 'regular' }]
    if (estiloConfigurado.id === 'superscript') return [...marks, { type: 'superscript' }]
    if (estiloConfigurado.id === 'subscript') return [...marks, { type: 'subscript' }]
  }
  if (tag === 'Rotulo') return [...marks, { type: 'boldArtigo' }]
  if (tag === 'b') return [...marks, { type: 'bold' }]
  if (tag === 'i') return [...marks, { type: 'italic' }]
  if (tag === 'Nota') return [...marks, { type: 'nota' }]
  if (tag === 'NotaSobrescrito') return [...marks, { type: 'notaSobrescrito' }]
  if (tag === 'Regular') return [...marks, { type: 'regular' }]
  if (tag === 'NotaRodape') {
    return [...marks, {
      type: 'notaRodape',
      attrs: {
        texto: el.textContent || '',
      },
    }]
  }
  if (tag === 'sup') return [...marks, { type: 'superscript' }]
  if (tag === 'sub') return [...marks, { type: 'subscript' }]
  if (tag === 'a') {
    const href = el.getAttribute('href') || ''
    return href ? [...marks, { type: 'link', attrs: { href } }] : marks
  }
  return marks
}

function inlineContent(el, marks = []) {
  const content = []
  el.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      pushText(content, child.nodeValue || '', marks)
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return

    const tag = localName(child)
    if (tag === 'br') {
      content.push({ type: 'hardBreak' })
      return
    }
    if (tag === 'NotaRodape') {
      pushText(content, '[nota]', addMarkForTag(tag, marks, child))
      return
    }

    const childContent = inlineContent(child, addMarkForTag(tag, marks, child))
    childContent.forEach(n => {
      if (n.type === 'text') pushText(content, n.text, n.marks || [])
      else content.push(n)
    })
  })
  return content
}

function tableNode(el) {
  const rows = Array.from(el.children)
    .filter(child => localName(child) === 'Linha')
    .map(row => ({
      type: 'tableRow',
      content: Array.from(row.children).map(cell => {
        const tag = localName(cell)
        const attrs = {}
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10)
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10)
        if (colspan > 1) attrs.colspan = colspan
        if (rowspan > 1) attrs.rowspan = rowspan
        return {
          type: tag === 'Cabecalho' ? 'tableHeader' : 'tableCell',
          attrs,
          content: [{ type: 'paragraph', content: inlineContent(cell) }],
        }
      }),
    }))
  return { type: 'table', content: rows }
}

function directChildByTag(el, tagName) {
  return Array.from(el.children || []).find(child => localName(child) === tagName) || null
}

function textWithoutDirectTable(el) {
  let text = ''
  el.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue || ''
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    if (localName(child) === 'Tabela') return
    text += child.textContent || ''
  })
  return text
}

function blockNode(el) {
  const tag = localName(el)
  if (tag === 'Tabela') return tableNode(el)
  if (tag === 'Paragrafo') {
    const tabela = directChildByTag(el, 'Tabela')
    if (tabela && !textWithoutDirectTable(el).trim()) return tableNode(tabela)
  }

  const estiloConfigurado = encontrarParagrafoPorTagImportacao(tag)
  const type = estiloConfigurado?.custom ? 'estiloParagrafoCustom' : (estiloConfigurado?.node || TAG_TO_NODE[tag])
  if (!type) return null

  const node = {
    type,
    content: inlineContent(el),
  }
  if (estiloConfigurado?.custom) {
    node.attrs = {
      styleId: estiloConfigurado.id,
      label: estiloConfigurado.label,
      cssClass: estiloConfigurado.cssClass,
      format: estiloConfigurado.format,
    }
  }
  const attrs = attrsFromElement(el)
  if (Object.keys(attrs).length) node.attrs = { ...(node.attrs || {}), ...attrs }
  return node
}

export function xmlParaTiptap(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('XML invalido ou malformado.')

  const root = doc.documentElement
  if (!root || localName(root) !== 'Norma') {
    throw new Error('O arquivo XML nao possui a raiz <Norma>.')
  }

  const content = Array.from(root.children)
    .map(blockNode)
    .filter(Boolean)

  return { type: 'doc', content }
}
