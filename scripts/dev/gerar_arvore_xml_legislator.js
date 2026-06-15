const fs = require('fs')
const path = require('path')

const TAGS_ESTRUTURAIS = {
  Divisao: true,
  Secao: true,
  AberturaCapitulo: true,
  NotaTitulo: true,
  Artigo: true,
  ArtigoTitulo: true,
  Paragrafo: true,
  Inciso: true,
  Alinea: true,
  Item: true,
  CorpoTratado: true,
}

const TAGS_IGNORADAS_TEXTO = {
  Nota: true,
  NotaRodape: true,
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function normalizeSpaces(value) {
  return String(value || '')
    .replace(/[\u0004\uFEFF\uFFFC]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeForMatch(value) {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function stripNotasForIdentifier(xml) {
  return String(xml || '')
    .replace(/<NotaRodape\b[^>]*>[\s\S]*?<\/NotaRodape>/gi, '')
    .replace(/<Nota\b[^>]*>[\s\S]*?<\/Nota>/gi, '')
}

function textFromInnerXml(innerXml, options = {}) {
  let value = String(innerXml || '')
  if (options.ignorarNotas) value = stripNotasForIdentifier(value)
  value = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|tr|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  return normalizeSpaces(decodeXml(value))
}

function parseAttributes(attrText) {
  const attrs = {}
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g
  let match
  while ((match = re.exec(String(attrText || '')))) {
    attrs[match[1].replace(/^.*:/, '')] = decodeXml(match[2])
  }
  return attrs
}

function isModified(attrs) {
  return String(attrs?.alterado || '').toLowerCase() === 'modificado'
}

function headingLevel(tag, text) {
  const norm = normalizeForMatch(text)
  if (tag === 'Divisao') {
    if (/^PARTE\b/.test(norm)) return 1
    if (/^LIVRO\b/.test(norm)) return 2
    if (/^TITULO\b/.test(norm)) return 3
    if (/^CAPITULO\b/.test(norm)) return 4
    return 4
  }
  if (tag === 'AberturaCapitulo') return 4
  if (tag === 'Secao') {
    if (/^SUBSECAO\b/.test(norm)) return 6
    if (/^SECAO\b/.test(norm)) return 5
    return 5
  }
  return 0
}

function articleLabel(text) {
  const match = String(text || '').match(/\bArt(?:\.|igo)?\s*[\u00a0\s]*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)\s*([\u00ba\u00aa\u00b0])?/i)
  if (!match) return ''
  return `Art. ${match[1]}${match[2] || ''}`
}

function deviceLabel(tag, text) {
  const raw = String(text || '')
  const norm = normalizeForMatch(raw)
  let match

  if (!['Paragrafo', 'Inciso', 'Alinea', 'Item', 'CorpoTratado'].includes(tag)) return ''
  if (/^PARAGRAFO UNICO\b/.test(norm)) return 'Parágrafo único'

  match = raw.match(/^§\s*\d+\s*[ºª°]?(?:-[A-Z])?/i)
  if (match) return normalizeSpaces(match[0])

  match = raw.match(/^([IVXLCDM]+(?:-[A-Z])?)\s*[–—-]\s/i)
  if (match) return String(match[1]).toUpperCase()

  match = raw.match(/^([a-zà-ÿ])\)\s/i)
  if (match) return `${String(match[1]).toLowerCase()})`

  match = raw.match(/^(\d+(?:\.\d+)?)(?:[.)]|\s*[–—-])\s/i)
  if (match) return String(match[1])

  return ''
}

function indent(text, depth) {
  return `${'  '.repeat(Math.max(0, depth))}${text}`
}

function currentHeadingPath(headings) {
  return headings.map(item => item.text).join(' > ')
}

function markLabel(label, modified) {
  return modified ? `${label} [modificado]` : label
}

function finishArticle(article, headings, lines, markedLines, modifiedEntries) {
  if (!article) return null
  const suffix = article.devices.length ? ` {${article.devices.join('; ')}};` : '.'
  const markedSuffix = article.markedDevices.length ? ` {${article.markedDevices.join('; ')}};` : '.'
  lines.push(indent(`${article.label}${suffix}`, headings.length))
  markedLines.push(indent(`${markLabel(article.label, article.modified)}${markedSuffix}`, headings.length))
  if (article.modified) {
    modifiedEntries.push({
      kind: 'artigo',
      tag: article.tag,
      path: article.path,
      label: article.label,
      text: article.text,
    })
  }
  return null
}

function addModifiedEntry(modifiedEntries, kind, tag, path, label, text) {
  modifiedEntries.push({ kind, tag, path, label, text })
}

function addDevice(article, tag, text, modified, modifiedEntries, fullText) {
  const label = deviceLabel(tag, text)
  let fullLabel
  const entryText = fullText || text
  if (!article || !label) return

  if (tag === 'Paragrafo') {
    article.currentParagraph = label
    article.currentInciso = ''
    article.currentAlinea = ''
    article.devices.push(label)
    article.markedDevices.push(markLabel(label, modified))
    if (modified) addModifiedEntry(modifiedEntries, 'dispositivo', tag, `${article.path} > ${article.label} > ${label}`, label, entryText)
    return
  }

  if (tag === 'Inciso' || tag === 'CorpoTratado') {
    article.currentInciso = label
    article.currentAlinea = ''
    fullLabel = article.currentParagraph ? `${article.currentParagraph} > ${label}` : label
    article.devices.push(fullLabel)
    article.markedDevices.push(markLabel(fullLabel, modified))
    if (modified) addModifiedEntry(modifiedEntries, 'dispositivo', tag, `${article.path} > ${article.label} > ${fullLabel}`, fullLabel, entryText)
    return
  }

  if (tag === 'Alinea') {
    article.currentAlinea = label
    fullLabel = [article.currentParagraph, article.currentInciso, label].filter(Boolean).join(' > ')
    article.devices.push(fullLabel)
    article.markedDevices.push(markLabel(fullLabel, modified))
    if (modified) addModifiedEntry(modifiedEntries, 'dispositivo', tag, `${article.path} > ${article.label} > ${fullLabel}`, fullLabel, entryText)
    return
  }

  if (tag === 'Item') {
    fullLabel = [article.currentParagraph, article.currentInciso, article.currentAlinea, label].filter(Boolean).join(' > ')
    article.devices.push(fullLabel)
    article.markedDevices.push(markLabel(fullLabel, modified))
    if (modified) addModifiedEntry(modifiedEntries, 'dispositivo', tag, `${article.path} > ${article.label} > ${fullLabel}`, fullLabel, entryText)
  }
}

function structuralBlocks(xmlText) {
  const xml = String(xmlText || '').replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '')
  const blocks = []
  const names = Object.keys(TAGS_ESTRUTURAIS).join('|')
  const re = new RegExp(`<(${names})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'g')
  let match

  while ((match = re.exec(xml))) {
    const tag = match[1].replace(/^.*:/, '')
    const attrs = parseAttributes(match[2])
    if (!TAGS_ESTRUTURAIS[tag]) continue
    blocks.push({
      tag,
      attrs,
      modified: isModified(attrs),
      text: textFromInnerXml(match[3]),
      identifierText: textFromInnerXml(match[3], { ignorarNotas: true }),
    })
  }

  return blocks
}

function buildTreeFromXml(xmlText) {
  const blocks = structuralBlocks(xmlText)
  const lines = []
  const markedLines = []
  const modifiedEntries = []
  let headings = []
  let article = null
  let seenHeading = false

  for (const block of blocks) {
    if (!block.text) continue
    const level = headingLevel(block.tag, block.identifierText || block.text)
    if (level) {
      seenHeading = true
      article = finishArticle(article, headings, lines, markedLines, modifiedEntries)
      headings = headings.filter(item => item.level < level)
      headings.push({ level, text: block.text })
      lines.push(indent(block.text, headings.length - 1))
      markedLines.push(indent(markLabel(block.text, block.modified), headings.length - 1))
      if (block.modified) {
        modifiedEntries.push({
          kind: 'heading',
          tag: block.tag,
          path: currentHeadingPath(headings),
          label: block.text,
          text: block.text,
        })
      }
      continue
    }

    if (!seenHeading) continue
    if (block.tag === 'NotaTitulo') continue

    if (block.tag === 'Artigo' || block.tag === 'ArtigoTitulo') {
      article = finishArticle(article, headings, lines, markedLines, modifiedEntries)
      const label = articleLabel(block.identifierText || block.text)
      if (!label) continue
      article = {
        tag: block.tag,
        label,
        text: block.text,
        path: currentHeadingPath(headings),
        modified: block.modified,
        devices: [],
        markedDevices: [],
        currentParagraph: '',
        currentInciso: '',
        currentAlinea: '',
      }
      continue
    }

    addDevice(article, block.tag, block.identifierText || block.text, block.modified, modifiedEntries, block.text)
  }

  article = finishArticle(article, headings, lines, markedLines, modifiedEntries)
  return {
    lines,
    markedLines,
    text: lines.join('\n'),
    markedText: markedLines.join('\n'),
    modifiedEntries,
    totalBlocks: blocks.length,
  }
}

function formatModifiedEntries(entries) {
  if (!entries.length) return 'Nenhum dispositivo com alterado="modificado" encontrado.\n'
  return entries.map((entry, index) => {
    return [
      `#${index + 1}`,
      `tipo: ${entry.kind}`,
      `tag: ${entry.tag}`,
      `local: ${entry.path || entry.label}`,
      `rotulo: ${entry.label}`,
      `texto: ${entry.text}`,
    ].join('\n')
  }).join('\n\n') + '\n'
}

function canonicalLine(line) {
  return normalizeForMatch(line)
}

function countMap(lines) {
  const map = new Map()
  for (const line of lines) {
    const key = canonicalLine(line)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return map
}

function diffMultiset(base, compare) {
  const map = countMap(compare)
  const missing = []
  for (const line of base) {
    const key = canonicalLine(line)
    const count = map.get(key) || 0
    if (count > 0) {
      map.set(key, count - 1)
    } else {
      missing.push(line)
    }
  }
  return missing
}

function firstLineDiff(a, b) {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (canonicalLine(a[i] || '') !== canonicalLine(b[i] || '')) {
      return { index: i, a: a[i] || '', b: b[i] || '' }
    }
  }
  return null
}

function compareTrees(indesignText, xmlTree) {
  const indesignLines = String(indesignText || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean)
  const xmlLines = xmlTree.lines
  const missingInXml = diffMultiset(indesignLines, xmlLines)
  const missingInIndesign = diffMultiset(xmlLines, indesignLines)
  const firstDiff = firstLineDiff(indesignLines, xmlLines)
  const report = []

  report.push(`Linhas arvore InDesign: ${indesignLines.length}`)
  report.push(`Linhas arvore XML: ${xmlLines.length}`)
  report.push(`Blocos estruturais XML analisados: ${xmlTree.totalBlocks}`)
  report.push(`Dispositivos/entradas XML com alterado="modificado": ${xmlTree.modifiedEntries.length}`)
  report.push(`Entradas do InDesign ausentes na arvore XML: ${missingInXml.length}`)
  report.push(`Entradas do XML ausentes na arvore InDesign: ${missingInIndesign.length}`)
  report.push('')

  if (firstDiff) {
    report.push(`Primeira diferenca por ordem na linha ${firstDiff.index + 1}:`)
    report.push(`InDesign: ${firstDiff.a}`)
    report.push(`XML     : ${firstDiff.b}`)
    report.push('')
  } else {
    report.push('Nenhuma diferenca por ordem encontrada.')
    report.push('')
  }

  if (missingInXml.length) {
    report.push('No InDesign, mas nao no XML:')
    missingInXml.slice(0, 80).forEach(line => report.push(`- ${line}`))
    if (missingInXml.length > 80) report.push(`... ${missingInXml.length - 80} restantes`)
    report.push('')
  }

  if (missingInIndesign.length) {
    report.push('No XML, mas nao no InDesign:')
    missingInIndesign.slice(0, 80).forEach(line => report.push(`- ${line}`))
    if (missingInIndesign.length > 80) report.push(`... ${missingInIndesign.length - 80} restantes`)
    report.push('')
  }

  return report.join('\n')
}

function main() {
  const root = path.resolve(__dirname, '..', '..')
  const xmlPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'src', 'resolu-o-n-17-de-1989-legacy.xml')
  const indesignTreePath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'src', 'arvore.txt')
  const outTreePath = process.argv[4] ? path.resolve(process.argv[4]) : path.join(root, 'src', 'arvore-xml.txt')
  const outReportPath = process.argv[5] ? path.resolve(process.argv[5]) : path.join(root, 'src', 'comparacao-arvores.txt')
  const outMarkedTreePath = path.join(path.dirname(outTreePath), `${path.basename(outTreePath, path.extname(outTreePath))}-marcada.txt`)
  const outModifiedPath = path.join(path.dirname(outTreePath), 'alterados-xml.txt')

  const xmlText = fs.readFileSync(xmlPath, 'utf8')
  const xmlTree = buildTreeFromXml(xmlText)
  fs.writeFileSync(outTreePath, `${xmlTree.text}\n`, 'utf8')
  fs.writeFileSync(outMarkedTreePath, `${xmlTree.markedText}\n`, 'utf8')
  fs.writeFileSync(outModifiedPath, formatModifiedEntries(xmlTree.modifiedEntries), 'utf8')

  if (fs.existsSync(indesignTreePath)) {
    const indesignTreeText = fs.readFileSync(indesignTreePath, 'utf8')
    fs.writeFileSync(outReportPath, compareTrees(indesignTreeText, xmlTree), 'utf8')
  }

  console.log(`Arvore XML: ${outTreePath}`)
  console.log(`Arvore XML marcada: ${outMarkedTreePath}`)
  console.log(`Alterados XML: ${outModifiedPath}`)
  if (fs.existsSync(indesignTreePath)) console.log(`Comparacao: ${outReportPath}`)
  console.log(`Entradas XML: ${xmlTree.lines.length}`)
  console.log(`Alterados XML: ${xmlTree.modifiedEntries.length}`)
}

if (require.main === module) main()

module.exports = {
  buildTreeFromXml,
  compareTrees,
}
