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
const referencesListEl = document.getElementById('referencesList')
const referencesCountEl = document.getElementById('referencesCount')

let occurrences = []
let activeFilter = 'todos'
let activeOccurrenceId = null
let ultimoResultado = null

const YEAR_RE = /(?:19|20)\d{2}[a-z]?/i
const YEAR_GLOBAL_RE = /(?:19|20)\d{2}[a-z]?/gi
const MESES_ABNT_RE = /(?:jan\.|fev\.|mar\.|abr\.|maio|jun\.|jul\.|ago\.|set\.|out\.|nov\.|dez\.)/i
const ABNT_TIPOS = {
  livro: 'Livro/monografia',
  capitulo: 'Parte de monografia',
  artigoPeriodico: 'Artigo de periódico',
  jornal: 'Artigo de jornal',
  tese: 'Trabalho acadêmico',
  site: 'Documento online',
  legislacao: 'Documento jurídico',
  evento: 'Evento',
  audiovisual: 'Documento audiovisual',
  citacao: 'Citação',
  desconhecido: 'Tipo não classificado',
}

function escHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatIssueHtml(text) {
  return escHtml(text)
    .replace(/&lt;i&gt;/g, '<i>')
    .replace(/&lt;\/i&gt;/g, '</i>')
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

function normalizarEspacos(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  editor.querySelectorAll('.ref-format').forEach(el => {
    el.classList.remove('ref-format', 'active')
    delete el.dataset.occurrenceId
  })
  editor.normalize()
  occurrences = []
  activeOccurrenceId = null
  ultimoResultado = null
  renderFilters()
  renderOccurrences()
  renderReferencesPanel([])
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

function textoAntesDoPrimeiroNegrito(root) {
  if (!root) return ''
  let texto = ''
  let encontrouNegrito = false

  function visitar(node) {
    if (!node || encontrouNegrito) return
    if (node.nodeType === 3) {
      texto += node.nodeValue || ''
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'strong' || tag === 'b') {
      encontrouNegrito = true
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  return normalizarEspacos(texto).replace(/[.;\s]+$/g, '')
}

function trechosNegrito(root) {
  const trechos = []

  function visitar(node) {
    if (!node) return
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'strong' || tag === 'b') {
      const text = normalizarEspacos(node.textContent || '')
      if (text) trechos.push(text)
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  return trechos
}

function trechosItalico(root) {
  const trechos = []

  function visitar(node) {
    if (!node) return
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'em' || tag === 'i') {
      const text = normalizarEspacos(node.textContent || '')
      if (text) trechos.push(text)
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  return trechos
}

function ehBlocoNotaMammoth(el) {
  if (!el) return false
  if (el.closest?.('[id*="footnote"], [id*="endnote"]')) return true
  if (el.querySelector?.('a[href*="footnote-ref"], a[href*="endnote-ref"]')) return true
  const text = textoBloco(el)
  return /↑\s*$/.test(text) && !!el.closest?.('ol')
}

function montarReferencias(referenceBlocks) {
  const refs = []
  for (const block of referenceBlocks) {
    if (ehBlocoNotaMammoth(block)) break
    const text = textoBloco(block)
    if (!text) continue
    if (!refs.length || pareceInicioReferencia(text)) {
      refs.push({
        text,
        element: block,
        autoriaAntesDoNegrito: textoAntesDoPrimeiroNegrito(block),
        negritos: trechosNegrito(block),
        italicos: trechosItalico(block),
      })
    } else {
      refs[refs.length - 1].text += ` ${text}`
      refs[refs.length - 1].negritos = refs[refs.length - 1].negritos.concat(trechosNegrito(block))
      refs[refs.length - 1].italicos = refs[refs.length - 1].italicos.concat(trechosItalico(block))
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

function problemasEspacoIndicadores(text) {
  const t = String(text || '')
  const issues = []
  if (/\bp\.\d/i.test(t)) issues.push('Insira espaço entre "p." e o número da página.')
  if (/\bv\.\d/i.test(t)) issues.push('Insira espaço entre "v." e o número do volume.')
  if (/\bn\.\d/i.test(t)) issues.push('Insira espaço entre "n." e o número.')
  return issues
}

function capitalizarNomeCitacao(text) {
  return normalizarEspacos(text)
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, prefixo, letra) => prefixo + letra.toLocaleUpperCase('pt-BR'))
    .replace(/\bEt\s+Al\.?/gi, 'et al.')
}

function autoriaCitacaoEmCaixaAlta(text) {
  const autoria = normalizarEspacos(text)
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\b(?:apud|cf|ver|vide)\b\.?/gi, '')
    .replace(/[(),.;:]/g, ' ')
    .trim()
  const letras = autoria.replace(/[^\p{L}]/gu, '')
  if (letras.length < 3) return false
  return !/[a-zà-ÿ]/.test(autoria) && /[A-ZÀ-Ý]{3,}/.test(autoria)
}

function referenciaParecePessoaFisica(ref) {
  const text = normalizarEspacos(ref?.text || '')
  if (!text) return false
  const autorPessoa = /^[\p{Lu}][\p{Lu}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{Lu}\p{M}'’.-]+)*,\s+[^.;]{1,90}(?:\.|;)/u
  return autorPessoa.test(text)
}

function problemaCaixaAltaAutorCitacao(unit, ref) {
  if (!referenciaParecePessoaFisica(ref)) return ''
  if (!autoriaCitacaoEmCaixaAlta(unit?.authorsRaw || '')) return ''
  const sugestao = capitalizarNomeCitacao(unit.authorsRaw || '')
  return `Em citações de pessoa física, não use caixa alta no sobrenome do autor; prefira "${sugestao}" em vez de "${normalizarEspacos(unit.authorsRaw)}".`
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
  if (/\bapud\b/i.test(cleaned)) {
    const partesApud = cleaned.split(/\bapud\b/i)
    const fonteConsultada = partesApud[partesApud.length - 1]
    return extrairUnidadesCitacao(fonteConsultada).map(unit => ({
      ...unit,
      raw: `apud ${unit.raw}`.replace(/\s+/g, ' ').trim(),
      apud: true,
    }))
  }
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

function nodeEstaEmItalico(node) {
  return !!node?.parentElement?.closest('em, i')
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
      const issues = problemasEspacoIndicadores(inside)
      if (/\bapud\b/i.test(inside) && !nodeEstaEmItalico(node)) {
        issues.push('A expressão <i>apud</i> deve estar em itálico.')
      }
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
        issues,
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
    const inicioHit = ref.inicioNormal && ref.inicioNormal.includes(author)
    const palavrasDistintivas = words.filter(w => w.length >= 4)
    const autoriaComposta = words.length >= 3
    if (autoriaComposta && palavrasDistintivas.some(w => !ref.normal.includes(w))) continue
    const wordHits = words.filter(w => ref.normal.includes(w)).length
    if (phraseHit || inicioHit) {
      hits += inicioHit ? 3 : 2
    } else if (!autoriaComposta && wordHits >= Math.min(words.length, 2)) {
      hits += 1
    }
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
  if (status === 'format') return 'Checagem ABNT'
  return 'Ausente'
}

function classificarReferenciaAbnt(text) {
  const t = normalizarEspacos(text)
  const n = normalizarTexto(t)
  const temOnline = /\bDISPONI?VEL EM\b|\bDISPON\s+VEL EM\b|\bACESSO EM\b/.test(n) || /https?:\/\/|www\./i.test(t)
  const temVolumeOuNumero = /\bv\.\s*\d+[A-Za-z]?/i.test(t) || /\bn\.\s*\d+[A-Za-z]?/i.test(t)
  const temPeriodico = temVolumeOuNumero || /\bp\.\s*\d+/i.test(t)

  if (/^(BRASIL|[A-ZÀ-Ý ]{3,})\.\s+(?:CONSTITUICAO|CONSTITUIÇÃO|LEI|DECRETO|PORTARIA|RESOLUCAO|RESOLUÇÃO|MEDIDA PROVISORIA|MEDIDA PROVISÓRIA|JURISPRUDENCIA|JURISPRUDÊNCIA|ACORDAO|ACÓRDÃO)\b/.test(n)) return 'legislacao'
  if (/^(CONSTITUICAO|CONSTITUIÇÃO|LEI|DECRETO|PORTARIA|RESOLUCAO|RESOLUÇÃO|MEDIDA PROVISORIA|MEDIDA PROVISÓRIA|ACORDAO|ACÓRDÃO)\b/.test(n)) return 'legislacao'
  if (/\b(DISSERTACAO|DISSERTAÇÃO|TESE|MONOGRAFIA|TRABALHO DE CONCLUSAO|TRABALHO DE CONCLUSÃO)\b/.test(n)) return 'tese'
  if (/\b(YOUTUBE|VIMEO|VIDEO|VÍDEO|FILME|DOCUMENTARIO|DOCUMENTÁRIO|CANAL|PODCAST)\b/.test(n) || /\b\d+\s*(?:min|h)\b/i.test(t)) return 'audiovisual'
  if (/\bANAIS|CONGRESSO|SEMINARIO|SEMINÁRIO|ENCONTRO|SIMP[OÓ]SIO|CONFER[EÊ]NCIA\b/i.test(t)) return 'evento'
  if (/\bIn:\s/i.test(t) && temVolumeOuNumero) return 'artigoPeriodico'
  if (/\bIn:\s/i.test(t)) return 'capitulo'
  if (/\bv\.\s*\d+[A-Za-z]?/i.test(t) && /\bn\.\s*\d+[A-Za-z]?/i.test(t)) return 'artigoPeriodico'
  if (/\bn\.\s*\d+[A-Za-z]?/i.test(t) && /\bp\.\s*[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?/i.test(t)) return 'artigoPeriodico'
  if (temPeriodico && /\b(revista|journal|caderno|cadernos|ci[eê]ncia|sa[uú]de|educa[cç][aã]o|estudos|anais)\b/i.test(t)) return 'artigoPeriodico'
  if (/\b(jornal|folha|estado de|estad[aã]o|gazeta|correio|tribuna)\b/i.test(t)) return 'jornal'
  if (temOnline) return 'site'
  if (/:\s*[^,]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(t)) return 'livro'
  return 'desconhecido'
}

function temAutoresSeparadosPorPontoEVirgula(text) {
  const t = normalizarEspacos(text)
  if (/^[^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+\.\s+/.test(t)) return true
  const autor = "[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\\s+"
  return new RegExp(`^(?:${autor}[^;]+;\\s+)+${autor}.+?\\.\\s+`).test(t)
}

function temAutoriaAbnt(text) {
  const t = normalizarEspacos(text)
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý0-9 .,'’&()/-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+(?:\.\s*[A-Z]\.)?\s+et\s+al\.\s+/i.test(t)) return true
  if (temAutoresSeparadosPorPontoEVirgula(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.]+(?:\.\s*[A-Z]\.)?\s*;\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+/.test(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.]{2,}\.\s+/.test(t)) return true
  return false
}

function usaEtAl(text) {
  return /\bet\s+al\.?/i.test(text)
}

function etAlAbntIncorreto(text) {
  const t = normalizarEspacos(text)
  if (!usaEtAl(t)) return false
  return /\bet\s+al(?!\.)/i.test(t)
}

function extrairAutoriaChaveAbnt(refOrText) {
  const text = typeof refOrText === 'object' && refOrText ? refOrText.text : refOrText
  const t = normalizarEspacos(text)
  const autoresSeparados = t.match(/^([^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+)\.\s+/)
  if (autoresSeparados) return normalizarTexto(autoresSeparados[1])
  const sobrenome = "[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*"
  const autorComIniciais = `${sobrenome},\\s+(?:[A-Z]\\.\\s*)+`
  const autorComEtAl = `${sobrenome},\\s+[^.;]+?\\s+et\\s+al\\.`
  const autorComNome = `${sobrenome},\\s+[^.;]+\\.`
  const autor = `(?:${autorComEtAl}|${autorComIniciais}|${autorComNome})`
  const pessoais = t.match(new RegExp(`^(${autor}(?:\\s*;\\s*${autor})*)\\s+`, 'i'))
  if (pessoais) return normalizarTexto(pessoais[1])

  const autoriaNegrito = typeof refOrText === 'object' && refOrText
    ? normalizarTexto(refOrText.autoriaAntesDoNegrito || '')
    : ''
  if (autoriaNegrito) return autoriaNegrito

  const partes = t.split('.').map(parte => parte.trim()).filter(Boolean)
  if (!partes.length) return ''
  const primeira = normalizarTexto(partes[0])
  if (!primeira || primeira.includes(',')) return ''

  if (primeira === 'BRASIL' && partes.length >= 3) {
    const segundaTerceira = normalizarTexto(`${partes[1]}. ${partes[2]}`)
    if (/\b(MINISTERIO|SECRETARIA|CONSELHO|AGENCIA|INSTITUTO|FUNDACAO|UNIVERSIDADE)\b/.test(segundaTerceira)) {
      return normalizarTexto(partes.slice(0, 3).join('. '))
    }
  }

  return primeira
}

function extrairAnoReferenciaPrincipal(ref) {
  const text = String(ref?.text || '')
  const corteOnline = text.search(/Dispon\S*\s+em:?|Acesso\s+em:?|https?:\/\//i)
  const trechoPrincipal = corteOnline >= 0 ? text.slice(0, corteOnline) : text
  const anos = trechoPrincipal.match(/(?:18|19|20)\d{2}[a-z]?/gi) || text.match(/(?:18|19|20)\d{2}[a-z]?/gi) || []
  return anos.length ? anos[anos.length - 1].toLowerCase() : ''
}

function autoresMultiplosSemPontoEVirgula(text) {
  const t = normalizarEspacos(text)
  if (usaEtAl(t)) return false
  return /^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+(?:\.\s*[A-Z]\.)?,\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+/.test(t)
}

function contarAutoresExplícitos(text) {
  const t = normalizarEspacos(text)
  if (usaEtAl(t)) return 0
  const match = t.match(/^([^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+)\.\s+/)
  if (!match) return 0
  return match[1].split(/\s*;\s*/).filter(Boolean).length
}

function negritoPareceFonteSeriada(text, trecho, tipo) {
  const indice = text.indexOf(trecho)
  if (indice < 0) return false
  const depois = text.slice(indice + trecho.length)
  if (tipo === 'artigoPeriodico') {
    return /^,\s*[^,.;]{2,90},\s*(?:v\.|n\.|p\.|(?:18|19|20)\d{2})/i.test(depois)
      || /^,\s*(?:v\.|n\.|p\.)\s*/i.test(depois)
  }
  if (tipo === 'jornal') {
    return /^,\s*(?:[A-ZÀ-ÿ][^,.;]{2,80},\s*)?(?:\d{1,2}\s+|p\.|(?:18|19|20)\d{2})/i.test(depois)
  }
  return false
}

function termoEmItalico(ref, regex) {
  return (ref.italicos || []).some(trecho => regex.test(trecho))
}

function validarItalicosReferencia(ref) {
  const issues = []
  const text = normalizarEspacos(ref.text || '')
  if (/\bet\s+al\.?/i.test(text) && !termoEmItalico(ref, /\bet\s+al\.?/i)) {
    issues.push('A expressão "et al." deve estar em itálico.')
  }
  if (/\bIn:\s/i.test(text) && !termoEmItalico(ref, /^In:?$/i)) {
    issues.push('A expressão "In:" deve estar em itálico.')
  }
  return issues
}

function validarNegritoReferencia(ref, tipo) {
  const issues = []
  const text = normalizarEspacos(ref.text || '')
  const negritos = (ref.negritos || []).map(normalizarEspacos).filter(Boolean)
  const exigeNegrito = ['livro', 'artigoPeriodico', 'jornal', 'tese'].includes(tipo)
  const rotulos = {
    livro: 'Livro/e-book deve ter o título principal em negrito.',
    artigoPeriodico: 'Artigo de periódico deve ter o nome da revista ou periódico em negrito.',
    jornal: 'Artigo de jornal deve ter o nome do jornal em negrito.',
    tese: 'Trabalho acadêmico deve ter o título principal em negrito.',
  }

  if (exigeNegrito && !negritos.length) {
    issues.push(rotulos[tipo])
    return issues
  }

  negritos.forEach(trecho => {
    if (/[,:.;]$/.test(trecho)) {
      issues.push('O negrito não deve incluir sinais de pontuação próximos, como dois-pontos, vírgulas ou pontos finais.')
    }
    if (/:.+/.test(trecho)) {
      issues.push('O subtítulo não deve ficar em negrito; destaque apenas o título principal antes dos dois-pontos.')
    }
  })

  if ((tipo === 'artigoPeriodico' || tipo === 'jornal') && negritos.length) {
    const primeiroNegrito = negritos[0]
    const primeiroNegritoPareceFonte = negritoPareceFonteSeriada(text, primeiroNegrito, tipo)
    const antesDoPrimeiroNegrito = normalizarEspacos(ref.autoriaAntesDoNegrito || '')
    const textoSemNegritoInicial = normalizarTexto(antesDoPrimeiroNegrito)
    const autoria = extrairAutoriaChaveAbnt(ref)
    if (!primeiroNegritoPareceFonte && autoria && textoSemNegritoInicial && textoSemNegritoInicial === autoria) {
      issues.push(tipo === 'artigoPeriodico'
        ? 'Em artigo de periódico, o título do artigo não recebe negrito; o destaque deve ir no nome da revista ou periódico.'
        : 'Em artigo de jornal, o título da matéria não recebe negrito; o destaque deve ir no nome do jornal.')
    }

    const indiceNegrito = text.indexOf(primeiroNegrito)
    const indiceVolumeOuPagina = text.search(/\b(?:v\.|n\.|p\.)\s*/i)
    if (indiceVolumeOuPagina >= 0 && indiceNegrito > indiceVolumeOuPagina) {
      issues.push(tipo === 'artigoPeriodico'
        ? 'O nome da revista ou periódico deve aparecer em negrito antes dos dados de volume, número e páginas.'
        : 'O nome do jornal deve aparecer em negrito antes dos dados de data, seção ou página.')
    }
  }

  return Array.from(new Set(issues))
}

function auditarReferenciaAbnt(ref, avisosExtras) {
  const original = String(ref.text || '')
  const text = normalizarEspacos(original)
  const tipo = classificarReferenciaAbnt(text)
  const issues = []
  ;(avisosExtras || []).forEach(aviso => issues.push(aviso))
  const temUrl = /https?:\/\/|www\./i.test(text)
  const normal = normalizarTexto(text)
  const temDisponivel = /\bDISPONI?VEL EM\b|\bDISPON\s+VEL EM\b/.test(normal)
  const temAcesso = /\bACESSO EM\b/.test(normal)
  const ano = /(?:18|19|20)\d{2}|\[\d{4}\]|\[\d{2}--\]|\[20--\]|\[19--\]/.test(text)

  if (!text) return { tipo, issues: ['Referência vazia.'] }
  if (!/[.!?]$/.test(text)) issues.push('A referência deve terminar com ponto final.')
  if (/\s{2,}/.test(original.replace(/\u00a0/g, ' '))) issues.push('Há espaços duplicados na referência.')
  problemasEspacoIndicadores(text).forEach(issue => issues.push(issue))
  if (!ano) issues.push('Ano/data de publicação não identificado.')
  if (!temAutoriaAbnt(text) && tipo !== 'legislacao') {
    issues.push('Elemento de autoria não parece estar no formato SOBRENOME, Prenome. ou ENTIDADE.')
  }
  if (autoresMultiplosSemPontoEVirgula(text)) {
    issues.push('Autores múltiplos devem ser separados por ponto e vírgula: GOMES, A. C.; VECHI, C. A.')
  }
  if (etAlAbntIncorreto(text)) {
    issues.push('A expressão "et al." deve terminar com ponto.')
  }
  if (contarAutoresExplícitos(text) >= 4) {
    issues.push('Sugere-se utilizar <i>et al.</i> para quatro ou mais autores.')
  }
  validarItalicosReferencia(ref).forEach(issue => issues.push(issue))
  validarNegritoReferencia(ref, tipo).forEach(issue => issues.push(issue))

  if (temUrl || temDisponivel || temAcesso) {
    if (!temDisponivel) issues.push('Documento online deve trazer "Disponível em:".')
    if (!temAcesso) issues.push('Documento online deve trazer "Acesso em:".')
    const acessoComMaioAbreviado = /Acesso em:\s*\d{1,2}\s+mai\.\s+(?:18|19|20)\d{2}/i.test(text)
    if (acessoComMaioAbreviado) {
      issues.push('O mês de maio não deve ser abreviado na data de acesso: use "maio", não "mai.".')
    } else if (temAcesso && !new RegExp(`Acesso em:\\s*\\d{1,2}\\s+${MESES_ABNT_RE.source}\\s+(?:18|19|20)\\d{2}`, 'i').test(text)) {
      issues.push('Data de acesso deve seguir o padrão "Acesso em: 8 fev. 2018.".')
    }
  }

  if (/\bdoi\b/i.test(text) && !/https?:\/\/doi\.org\/|doi:\s*10\./i.test(text)) {
    issues.push('DOI deve estar em formato reconhecível, como https://doi.org/... ou doi: 10....')
  }

  if (tipo === 'livro') {
    if (!/:\s*[^,.;]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(text)) {
      issues.push('Livro/monografia deve indicar local, editora e ano no padrão "Local: Editora, ano.".')
    }
  } else if (tipo === 'capitulo') {
    if (!/\bIn:\s*[^.]+/i.test(text)) issues.push('Parte de monografia deve conter "In:".')
    if (!/:\s*[^,.;]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(text)) {
      issues.push('Parte de monografia deve indicar dados da obra no todo, com local, editora e ano.')
    }
  } else if (tipo === 'artigoPeriodico') {
    if (/\bIn:\s/i.test(text)) issues.push('Uso de "In:" inadequado para revista ou periódico.')
    if (!/\bp\.\s*[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?/i.test(text)) issues.push('Artigo de periódico deve indicar páginas com "p.".')
  } else if (tipo === 'tese') {
    if (!/\b(?:Tese|Disserta[cç][aã]o|Trabalho de Conclus[aã]o de Curso)\b/i.test(text)) issues.push('Trabalho acadêmico deve indicar o tipo do trabalho.')
    if (!/\((?:Mestrado|Doutorado|Bacharelado|Especializa[cç][aã]o|Gradua[cç][aã]o)/i.test(text)) issues.push('Trabalho acadêmico deve indicar grau/curso entre parênteses.')
  } else if (tipo === 'legislacao') {
    if (!/\b(?:BRASIL|[A-ZÀ-Ý][A-ZÀ-Ý ]+)\./.test(text)) issues.push('Documento jurídico deve iniciar pela jurisdição ou entidade responsável.')
  } else if (tipo === 'desconhecido') {
    issues.push('Não foi possível classificar automaticamente o tipo da referência.')
  }

  return { tipo, issues }
}

function aplicarMarcacoes(matches, referencias) {
  const list = []
  const matchesByNode = new Map()

  matches.forEach((match, index) => {
    const resultados = match.units.map(unit => ({
      unit,
      ...vincularUnidade(unit, referencias),
    }))
    const issues = Array.from(new Set(
      (match.issues || []).concat(
        resultados
          .map(resultado => problemaCaixaAltaAutorCitacao(resultado.unit, resultado.ref))
          .filter(Boolean),
      ),
    ))
    const status = classeResultado(resultados.map(r => r.status))
    const id = `ref-${Date.now()}-${index}`
    if (!matchesByNode.has(match.node)) matchesByNode.set(match.node, [])
    matchesByNode.get(match.node).push({ ...match, id, resultados, status, issues })
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

      if (match.issues?.length) {
        list.push({
          id: `${match.id}-abnt`,
          text: span.textContent,
          status: 'format',
          resultados: [],
          referenceText: span.textContent,
          referenceType: 'citacao',
          issues: match.issues,
          element: span,
        })
      }

      cursor = match.end
    })

    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  })

  return list
}

function anexarProblemasAbnt(list, referencias) {
  const gruposAutorAno = {}
  referencias.forEach(ref => {
    const autoria = extrairAutoriaChaveAbnt(ref)
    const ano = extrairAnoReferenciaPrincipal(ref)
    const anoBase = ano.replace(/[a-z]$/i, '')
    if (!autoria || !anoBase) return
    const chave = `${autoria}__${anoBase}`
    if (!gruposAutorAno[chave]) gruposAutorAno[chave] = []
    gruposAutorAno[chave].push({ ref, ano, anoBase })
  })

  const avisosPorReferencia = {}
  Object.keys(gruposAutorAno).forEach(chave => {
    const grupo = gruposAutorAno[chave]
    if (grupo.length < 2) return
    grupo.forEach((item, index) => {
      const letraEsperada = String.fromCharCode(97 + index)
      const anoEsperado = `${item.anoBase}${letraEsperada}`
      if (item.ano === anoEsperado) return
      if (!avisosPorReferencia[item.ref.index]) avisosPorReferencia[item.ref.index] = []
      avisosPorReferencia[item.ref.index].push(`Há mais de uma obra do mesmo autor em ${item.anoBase}; nesta posição da lista, o ano deve ser ${anoEsperado}.`)
    })
  })

  referencias.forEach(ref => {
    const audit = auditarReferenciaAbnt(ref, avisosPorReferencia[ref.index])
    if (!audit.issues.length) return

    const id = `format-${Date.now()}-${ref.index}`
    if (ref.element?.isConnected) {
      ref.element.classList.add('ref-format')
      ref.element.dataset.occurrenceId = id
      ref.element.title = audit.issues.join('\n')
    }
    list.push({
      id,
      text: ref.text,
      status: 'format',
      resultados: [],
      referenceText: ref.text,
      referenceType: audit.tipo,
      issues: audit.issues,
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
  occurrences = anexarProblemasAbnt(aplicarMarcacoes(citacoes, referencias), referencias)
  ultimoResultado = { secao, referencias, citacoes, occurrences }
  renderFilters()
  renderOccurrences()
  renderReferencesPanel(referencias)
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
  const format = occurrences.filter(o => o.status === 'format').length
  const refs = resultado.referencias.length
  const citacoes = resultado.citacoes.length
  const heading = resultado.secao.heading ? 'seção de referências encontrada' : 'seção de referências não encontrada'
  summaryEl.innerHTML = `
    <strong>${total}</strong> ocorrência(s): <strong>${citacoes}</strong> citação(ões) no texto, <strong>${refs}</strong> referência(s), ${heading}.<br>
    Encontradas: <strong>${ok}</strong> · Ano divergente: <strong>${warning}</strong> · Ausentes: <strong>${missing}</strong> · Checagem ABNT: <strong>${format}</strong>
  `
  countBadge.textContent = String(total)
}

function renderFilters() {
  const groups = [
    ['todos', 'Todos'],
    ['ok', 'Encontradas'],
    ['warning', 'Ano divergente'],
    ['missing', 'Ausentes'],
    ['format', 'Checagem ABNT'],
  ]
  filtersEl.innerHTML = groups.map(([id, label]) => (
    `<button type="button" class="filter ${id}${activeFilter === id ? ' active' : ''}" data-filter="${id}">${label}</button>`
  )).join('')
}

function citacoesDaReferencia(refIndex) {
  const links = []
  const vistos = new Set()
  occurrences.forEach(item => {
    if (!item?.element?.isConnected || item.status === 'format') return
    ;(item.resultados || []).forEach(resultado => {
      if (resultado.ref?.index !== refIndex) return
      const texto = normalizarEspacos(resultado.unit?.raw || item.text || '')
      const chave = `${item.id}__${texto}`
      if (!texto || vistos.has(chave)) return
      vistos.add(chave)
      links.push({
        id: item.id,
        text: texto,
        status: resultado.status,
      })
    })
  })
  return links
}

function renderReferencesPanel(referencias) {
  if (!referencesListEl || !referencesCountEl) return
  referencesCountEl.textContent = String(referencias.length || 0)
  if (!referencias.length) {
    referencesListEl.className = 'references-list empty'
    referencesListEl.textContent = 'A lista de referências aparecerá aqui após a conferência.'
    return
  }

  referencesListEl.className = 'references-list'
  referencesListEl.innerHTML = referencias.map(ref => {
    const citacoes = citacoesDaReferencia(ref.index)
    const links = citacoes.length
      ? citacoes.map(citacao => `
        <button type="button" class="reference-cite-link ${citacao.status}" data-cite-id="${citacao.id}">
          ${escHtml(citacao.text)}
        </button>
      `).join('')
      : '<span class="reference-cite-empty">Nenhuma citação vinculada.</span>'
    return `
      <article class="reference-item" data-ref-card="${ref.index}">
        <button type="button" class="reference-main" data-ref-index="${ref.index}">
          <strong>${String(ref.index + 1).padStart(2, '0')}</strong>
          <span>${escHtml(ref.text)}</span>
        </button>
        <div class="reference-citations">${links}</div>
      </article>
    `
  }).join('')
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
    if (o.status === 'format') {
      const tipo = ABNT_TIPOS[o.referenceType] || ABNT_TIPOS.desconhecido
      const issues = (o.issues || []).map(issue => `<li>${formatIssueHtml(issue)}</li>`).join('')
      return `
        <button type="button" class="occurrence ${o.status}${o.id === activeOccurrenceId ? ' active' : ''}" data-id="${o.id}">
          <strong>${textoStatus(o.status)}</strong>
          <span class="reference">${escHtml(o.text)}</span>
          <span class="abnt-type">${escHtml(tipo)}</span>
          <ul class="issue-list">${issues}</ul>
        </button>
      `
    }
    const refs = o.resultados.map(r => {
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
        <span>${escHtml(o.text)}</span>
        ${refs}
      </button>
    `
  }).join('')
}

function focusOccurrence(id) {
  const item = occurrences.find(o => o.id === id)
  if (!item?.element?.isConnected) return

  document.querySelectorAll('.ref-mark.active, .ref-format.active').forEach(el => el.classList.remove('active'))
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
  if (item.status === 'format') {
    const tipo = ABNT_TIPOS[item.referenceType] || ABNT_TIPOS.desconhecido
    const issues = (item.issues || []).map(issue => `<li>${formatIssueHtml(issue)}</li>`).join('')
    return `
      <div class="source-item format">
        <strong>${textoStatus(item.status)} — ${escHtml(tipo)}</strong>
        <p>${escHtml(item.referenceText || item.text)}</p>
        <ul class="issue-list">${issues}</ul>
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

referencesListEl?.addEventListener('click', event => {
  const citeBtn = event.target.closest('[data-cite-id]')
  if (citeBtn) {
    focusOccurrence(citeBtn.dataset.citeId)
    return
  }

  const btn = event.target.closest('[data-ref-index]')
  if (!btn || !ultimoResultado?.referencias) return
  const ref = ultimoResultado.referencias[Number(btn.dataset.refIndex)]
  if (!ref?.element?.isConnected) return

  document.querySelectorAll('.reference-item.active').forEach(el => el.classList.remove('active'))
  btn.closest('.reference-item')?.classList.add('active')
  ref.element.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const range = document.createRange()
  range.selectNodeContents(ref.element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
})

editor.addEventListener('click', event => {
  const mark = event.target.closest('.ref-mark, .ref-format')
  if (!mark) return
  focusOccurrence(mark.dataset.occurrenceId)
  if (mark.classList.contains('ref-mark') || mark.classList.contains('ref-format')) {
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
