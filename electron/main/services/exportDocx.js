/**
 * exportDocx.js
 * Converte o conteúdo_doc (JSON TipTap) de uma norma em um Buffer DOCX
 * usando a biblioteca `docx`.
 *
 * Cada tipo de nó TipTap mapeia para um estilo de parágrafo do Word.
 * Os estilos precisam existir no template ou são criados inline.
 */

import {
  Document, Packer, Paragraph, TextRun,
  AlignmentType,
  convertInchesToTwip,
} from 'docx'

// ── Mapa: node TipTap → configuração Word ────────────────────────
const NODE_CONFIG = {
  epigrafe:           { style: 'Heading1', align: AlignmentType.CENTER, bold: true, allCaps: true },
  partelivroTitCap:   { style: 'Heading2', align: AlignmentType.CENTER, bold: true, allCaps: true },
  secaoSubsecao:      { style: 'Heading3', align: AlignmentType.CENTER, bold: true },
  ementa:             { style: 'Normal',   align: AlignmentType.JUSTIFIED, italic: true },
  paragrafAbertura:   { style: 'Normal',   align: AlignmentType.JUSTIFIED },
  aberturaCapitulo:   { style: 'Normal',   align: AlignmentType.JUSTIFIED, italic: true },
  artigo:             { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0) } },
  artigoTitulo:       { style: 'Normal',   align: AlignmentType.CENTER, bold: true },
  corpoTratado:       { style: 'Normal',   align: AlignmentType.JUSTIFIED },
  paragrafLei:        { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.4) } },
  inciso:             { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.7) } },
  alinea:             { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0) } },
  item:               { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.3) } },
  citacao:            { style: 'Normal',   align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } },
  notaTitulo:         { style: 'Normal',   align: AlignmentType.CENTER, bold: true, size: 18 },
  assinaturaData:     { style: 'Normal',   align: AlignmentType.CENTER },
  assinaturaNome:     { style: 'Normal',   align: AlignmentType.CENTER, bold: true },
}

const DEFAULT_CONFIG = { style: 'Normal', align: AlignmentType.JUSTIFIED }

// ── Extrai texto plano de um nó TipTap ───────────────────────────
function extrairTexto(node) {
  if (node.type === 'text') return node.text ?? ''
  if (!node.content) return ''
  return node.content.map(extrairTexto).join('')
}

// ── Extrai TextRuns de um nó TipTap respeitando marks ───────────
function extrairRuns(node, configExtra = {}) {
  const runs = []

  function percorrer(n, marcas = {}) {
    if (n.type === 'text') {
      const marks = n.marks ?? []
      const isBold   = marcas.bold   || marks.some(m => m.type === 'bold')
      const isItalic = marcas.italic || marks.some(m => m.type === 'italic')
      const isRegular = marks.some(m => m.type === 'regular')
      const isNota   = marks.some(m => m.type === 'nota')

      runs.push(new TextRun({
        text:    n.text ?? '',
        bold:    configExtra.bold   || isBold,
        italics: isRegular ? false : (configExtra.italic || isItalic),
        allCaps: configExtra.allCaps ?? false,
        size:    configExtra.size,
        color:   isNota ? '666666' : undefined,
      }))
      return
    }
    if (n.content) {
      const novaMarcas = { ...marcas }
      n.content.forEach(filho => percorrer(filho, novaMarcas))
    }
  }

  if (node.content) node.content.forEach(n => percorrer(n))

  // nó vazio → parágrafo em branco
  if (runs.length === 0) runs.push(new TextRun({ text: '' }))
  return runs
}

// ── Converte um nó bloco em Paragraph Word ───────────────────────
function nodeToParagraph(node) {
  const cfg = NODE_CONFIG[node.type] ?? DEFAULT_CONFIG

  return new Paragraph({
    alignment: cfg.align,
    indent:    cfg.indent,
    children:  extrairRuns(node, cfg),
    spacing:   { after: 0 },
  })
}

// ── Entry point ──────────────────────────────────────────────────
export async function gerarDocx(norma) {
  let doc
  try {
    doc = JSON.parse(norma.conteudo_doc)
  } catch {
    doc = { type: 'doc', content: [] }
  }

  const paragrafos = (doc.content ?? []).map(nodeToParagraph)

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1.18),
            bottom: convertInchesToTwip(0.98),
            left:   convertInchesToTwip(1.18),
            right:  convertInchesToTwip(0.98),
          },
        },
      },
      children: paragrafos,
    }],
  })

  return Packer.toBuffer(document)
}

// ── Publicação: combina todas as normas com separadores de seção ──
export async function gerarDocxPublicacao(pub, db) {
  const PAGE_MARGIN = {
    top:    convertInchesToTwip(1.18),
    bottom: convertInchesToTwip(0.98),
    left:   convertInchesToTwip(1.18),
    right:  convertInchesToTwip(0.98),
  }

  const paragrafos = []

  for (const secao of pub.secoes ?? []) {
    // Cabeçalho da seção
    paragrafos.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 400, after: 200 },
      children: [new TextRun({ text: secao.titulo.toUpperCase(), bold: true, size: 28 })],
    }))

    for (const item of secao.normas ?? []) {
      const norma = db.prepare('SELECT conteudo_doc FROM normas WHERE id = ?').get(item.norma_id)
      if (!norma) continue
      let doc
      try   { doc = JSON.parse(norma.conteudo_doc) }
      catch { doc = { type: 'doc', content: [] } }
      ;(doc.content ?? []).forEach(n => paragrafos.push(nodeToParagraph(n)))
      // Separador entre normas
      paragrafos.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }))
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ properties: { page: { margin: PAGE_MARGIN } }, children: paragrafos }],
  })
  return Packer.toBuffer(document)
}
