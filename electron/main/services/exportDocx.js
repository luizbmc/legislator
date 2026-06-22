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
import { aplicarEstiloVadeMecumDoc } from '../../../src/services/estiloVadeMecum.js'

// ── Mapa: node TipTap → configuração Word ────────────────────────
const FONT_FAMILY = 'Cambria'
const SPACING_TITULO = { before: 120, after: 80 }
const SPACING_ASSINATURA = { before: 120, after: 80 }

const NODE_CONFIG = {
  epigrafe:           { style: 'NormandoEpigrafe', align: AlignmentType.CENTER, bold: true, allCaps: true, outlineLevel: 0, spacing: SPACING_TITULO },
  epigrafeApelido:    { style: 'NormandoEpigrafeApelido', align: AlignmentType.CENTER },
  ementa:             { style: 'NormandoEmenta', align: AlignmentType.JUSTIFIED, italic: true },
  notaTitulo:         { style: 'NormandoNotaTitulo', align: AlignmentType.CENTER, bold: true, size: 18 },
  paragrafAbertura:   { style: 'NormandoAberturaLei', align: AlignmentType.JUSTIFIED },
  paragrafFacoSaber:  { style: 'NormandoAberturaLei', align: AlignmentType.JUSTIFIED },
  aberturaCapitulo:   { style: 'NormandoAberturaCapitulo', align: AlignmentType.CENTER, italic: true, outlineLevel: 0, spacing: SPACING_TITULO },
  partelivroTitCap:   { style: 'NormandoTituloCap', align: AlignmentType.CENTER, allCaps: true, outlineLevel: 0, spacing: SPACING_TITULO },
  secaoSubsecao:      { style: 'NormandoSecao', align: AlignmentType.CENTER, bold: true, outlineLevel: 1, spacing: SPACING_TITULO },
  artigo:             { style: 'NormandoArtigo', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0) } },
  artigoTitulo:       { style: 'NormandoArtigoTitulo', align: AlignmentType.CENTER, bold: true, spacing: SPACING_TITULO },
  corpoTratado:       { style: 'NormandoCorpoTratado', align: AlignmentType.JUSTIFIED },
  paragrafLei:        { style: 'NormandoParagrafo', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.4) } },
  nomeJuridico:       { style: 'NormandoNomeJuridico', align: AlignmentType.JUSTIFIED },
  inciso:             { style: 'NormandoInciso', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.7) } },
  alinea:             { style: 'NormandoAlinea', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0) } },
  item:               { style: 'NormandoItem', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.3) } },
  citacao:            { style: 'NormandoCitacao', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } },
  data:               { style: 'NormandoData', align: AlignmentType.CENTER, spacing: SPACING_ASSINATURA },
  assinatura:         { style: 'NormandoAssinatura', align: AlignmentType.CENTER, bold: true, spacing: SPACING_ASSINATURA },
  assinaturaData:     { style: 'NormandoData', align: AlignmentType.CENTER, spacing: SPACING_ASSINATURA },
  assinaturaNome:     { style: 'NormandoAssinatura', align: AlignmentType.CENTER, bold: true, spacing: SPACING_ASSINATURA },
  textoComumTitulo:   { style: 'NormandoTextoTitulo', align: AlignmentType.CENTER, bold: true, outlineLevel: 0, spacing: SPACING_TITULO },
  textoComumSubtitulo:{ style: 'NormandoTextoSubtitulo', align: AlignmentType.CENTER, bold: true, outlineLevel: 1, spacing: SPACING_TITULO },
  textoComumCorrido:  { style: 'NormandoTextoCorrido', align: AlignmentType.JUSTIFIED },
  textoComumRecuado:  { style: 'NormandoTextoRecuado', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.4) } },
  textoComumCitacao:  { style: 'NormandoTextoCitacao', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } },
  textoComumBullets:  { style: 'NormandoTextoBullets', align: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) } },
  textoComumAssinatura: { style: 'NormandoTextoAssinatura', align: AlignmentType.CENTER, spacing: SPACING_ASSINATURA },
  textoComumAssinaturaCargo: { style: 'NormandoTextoAssinaturaCargo', align: AlignmentType.CENTER, italic: true, spacing: SPACING_ASSINATURA },
}

const DEFAULT_CONFIG = { style: 'Normal', align: AlignmentType.JUSTIFIED }

function publicacaoUsaVadeMecum(pub) {
  return String(pub?.titulo || '').trimStart().toLocaleLowerCase('pt-BR').startsWith('vade')
}

function paragraphStyle(id, name, paragraph = {}, run = {}) {
  return {
    id,
    name,
    basedOn: 'Normal',
    next: id,
    quickFormat: true,
    paragraph: { spacing: { after: 0 }, ...paragraph },
    run,
  }
}

function characterStyle(id, name, run = {}) {
  return {
    id,
    name,
    basedOn: 'DefaultParagraphFont',
    quickFormat: true,
    run,
  }
}

const DOCUMENT_STYLES = {
  default: {
    document: {
      run: { font: FONT_FAMILY, size: 24 },
    },
  },
  paragraphStyles: [
    paragraphStyle('NormandoEpigrafe', 'Normando - Epigrafe', { alignment: AlignmentType.CENTER, outlineLevel: 0, spacing: SPACING_TITULO }, { bold: true, allCaps: true }),
    paragraphStyle('NormandoEpigrafeApelido', 'Normando - Apelido da epigrafe', { alignment: AlignmentType.CENTER }),
    paragraphStyle('NormandoEmenta', 'Normando - Ementa', { alignment: AlignmentType.JUSTIFIED }, { italics: true }),
    paragraphStyle('NormandoNotaTitulo', 'Normando - Nota titulo', { alignment: AlignmentType.CENTER }, { bold: true, size: 18, color: '666666' }),
    paragraphStyle('NormandoAberturaLei', 'Normando - Abertura de lei', { alignment: AlignmentType.JUSTIFIED }),
    paragraphStyle('NormandoAberturaCapitulo', 'Normando - Abertura capitulo', { alignment: AlignmentType.CENTER, outlineLevel: 0, spacing: SPACING_TITULO }, { italics: true, size: 40 }),
    paragraphStyle('NormandoTituloCap', 'Normando - Titulo/Cap', { alignment: AlignmentType.CENTER, outlineLevel: 0, spacing: SPACING_TITULO }, { allCaps: true }),
    paragraphStyle('NormandoSecao', 'Normando - Secao', { alignment: AlignmentType.CENTER, outlineLevel: 1, spacing: SPACING_TITULO }, { bold: true }),
    paragraphStyle('NormandoArtigo', 'Normando - Artigo', { alignment: AlignmentType.JUSTIFIED }),
    paragraphStyle('NormandoArtigoTitulo', 'Normando - Artigo titulo', { alignment: AlignmentType.CENTER, spacing: SPACING_TITULO }, { bold: true }),
    paragraphStyle('NormandoCorpoTratado', 'Normando - Corpo tratado', { alignment: AlignmentType.JUSTIFIED }),
    paragraphStyle('NormandoParagrafo', 'Normando - Paragrafo', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.4) } }),
    paragraphStyle('NormandoNomeJuridico', 'Normando - Nome juridico', { alignment: AlignmentType.JUSTIFIED }),
    paragraphStyle('NormandoInciso', 'Normando - Inciso', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.7) } }),
    paragraphStyle('NormandoAlinea', 'Normando - Alinea', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0) } }),
    paragraphStyle('NormandoItem', 'Normando - Item', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.3) } }),
    paragraphStyle('NormandoCitacao', 'Normando - Citacao', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } }),
    paragraphStyle('NormandoData', 'Normando - Data', { alignment: AlignmentType.CENTER, spacing: SPACING_ASSINATURA }),
    paragraphStyle('NormandoAssinatura', 'Normando - Assinatura', { alignment: AlignmentType.CENTER, spacing: SPACING_ASSINATURA }, { bold: true }),
    paragraphStyle('NormandoTextoTitulo', 'Normando - Texto comum titulo', { alignment: AlignmentType.CENTER, outlineLevel: 0, spacing: SPACING_TITULO }, { bold: true, size: 32 }),
    paragraphStyle('NormandoTextoSubtitulo', 'Normando - Texto comum subtitulo', { alignment: AlignmentType.CENTER, outlineLevel: 1, spacing: SPACING_TITULO }, { bold: true, size: 28 }),
    paragraphStyle('NormandoTextoCorrido', 'Normando - Texto comum corrido', { alignment: AlignmentType.JUSTIFIED }),
    paragraphStyle('NormandoTextoRecuado', 'Normando - Texto comum recuado', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.4) } }),
    paragraphStyle('NormandoTextoCitacao', 'Normando - Texto comum citacao', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } }),
    paragraphStyle('NormandoTextoBullets', 'Normando - Texto comum bullets', { alignment: AlignmentType.JUSTIFIED, indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) } }),
    paragraphStyle('NormandoTextoAssinatura', 'Normando - Texto comum assinatura', { alignment: AlignmentType.CENTER, spacing: SPACING_ASSINATURA }),
    paragraphStyle('NormandoTextoAssinaturaCargo', 'Normando - Texto comum assinatura-cargo', { alignment: AlignmentType.CENTER, spacing: SPACING_ASSINATURA }, { italics: true }),
  ],
  characterStyles: [
    characterStyle('NormandoBold', 'Normando - Negrito', { bold: true }),
    characterStyle('NormandoItalico', 'Normando - Italico', { italics: true }),
    characterStyle('NormandoBoldArtigo', 'Normando - Bold artigo', { bold: true }),
    characterStyle('NormandoNota', 'Normando - Nota', { color: '666666', size: 20 }),
    characterStyle('NormandoNotaItalico', 'Normando - Nota italico', { color: '666666', italics: true, size: 20 }),
    characterStyle('NormandoNotaSobrescrito', 'Normando - Nota sobrescrito', { color: '666666', superScript: true, size: 16 }),
    characterStyle('NormandoRegular', 'Normando - Regular', { italics: false }),
  ],
}

function filtrarNoPorModoVadeMecum(no, modoVadeMecum = false) {
  if (!no || typeof no !== 'object') return no
  const role = no.attrs?.vmRole
  if (role === 'vm' && !modoVadeMecum) return null
  if (role === 'original' && modoVadeMecum) return null

  const out = { ...no }
  if (out.attrs) {
    const attrs = { ...out.attrs }
    delete attrs.vmRole
    if (Object.keys(attrs).length) out.attrs = attrs
    else delete out.attrs
  }
  if (Array.isArray(out.content)) {
    out.content = out.content
      .map(filho => filtrarNoPorModoVadeMecum(filho, modoVadeMecum))
      .filter(Boolean)
  }
  return out
}

function docPorModoVadeMecum(doc, modoVadeMecum = false) {
  return {
    ...(doc || { type: 'doc' }),
    content: (doc?.content || [])
      .map(no => filtrarNoPorModoVadeMecum(no, modoVadeMecum))
      .filter(Boolean),
  }
}

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
      const isBoldArtigo = marks.some(m => m.type === 'boldArtigo')
      const isNota   = marks.some(m => m.type === 'nota')
      const isNotaSobrescrito = marks.some(m => m.type === 'notaSobrescrito')
      const isSuperscript = marks.some(m => m.type === 'superscript')
      const charStyle = estiloCaractereWord(marks)

      runs.push(new TextRun({
        text:    n.text ?? '',
        style:   charStyle,
        bold:    configExtra.bold   || isBold || isBoldArtigo,
        italics: isRegular ? false : (configExtra.italic || isItalic),
        allCaps: configExtra.allCaps ?? false,
        size:    configExtra.size,
        color:   (isNota || isNotaSobrescrito) ? '666666' : undefined,
        superScript: isNotaSobrescrito || isSuperscript || undefined,
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

function estiloCaractereWord(marks = []) {
  const has = type => marks.some(m => m.type === type)
  if (has('notaSobrescrito')) return 'NormandoNotaSobrescrito'
  if (has('nota') && has('italic')) return 'NormandoNotaItalico'
  if (has('nota')) return 'NormandoNota'
  if (has('boldArtigo')) return 'NormandoBoldArtigo'
  if (has('regular')) return 'NormandoRegular'
  if (has('bold')) return 'NormandoBold'
  if (has('italic')) return 'NormandoItalico'
  return undefined
}

// ── Converte um nó bloco em Paragraph Word ───────────────────────
function nodeToParagraph(node) {
  const cfg = NODE_CONFIG[node.type] ?? DEFAULT_CONFIG

  return new Paragraph({
    style:     cfg.style,
    alignment: cfg.align,
    indent:    cfg.indent,
    outlineLevel: cfg.outlineLevel,
    children:  extrairRuns(node, cfg),
    spacing:   cfg.spacing ?? { after: 0 },
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
  doc = docPorModoVadeMecum(doc, norma.modoVadeMecum === true)

  const paragrafos = (doc.content ?? []).map(nodeToParagraph)

  const document = new Document({
    styles: DOCUMENT_STYLES,
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
  const forcarVadeMecum = publicacaoUsaVadeMecum(pub)

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
      if (forcarVadeMecum) doc = aplicarEstiloVadeMecumDoc(doc, true).doc
      doc = docPorModoVadeMecum(doc, forcarVadeMecum || item.modoVadeMecum === true)
      ;(doc.content ?? []).forEach(n => paragrafos.push(nodeToParagraph(n)))
      // Separador entre normas
      paragrafos.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }))
    }
  }

  const document = new Document({
    styles: DOCUMENT_STYLES,
    sections: [{ properties: { page: { margin: PAGE_MARGIN } }, children: paragrafos }],
  })
  return Packer.toBuffer(document)
}
