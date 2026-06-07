/**
 * exportHtml.js
 * Converte o conteúdo_doc (JSON TipTap) de uma norma em HTML
 * com tags semânticas baseadas nos nomes dos nós.
 *
 * O HTML gerado tem classes CSS que correspondem 1-para-1 aos
 * estilos do InDesign, facilitando importação via plugin.
 */

// ── Mapa: node TipTap → tag + classe HTML ───────────────────────
const NODE_TAG = {
  epigrafe:           { tag: 'p', cls: 'epigrafe' },
  partelivroTitCap:   { tag: 'p', cls: 'parte-livro-tit-cap' },
  secaoSubsecao:      { tag: 'p', cls: 'secao-subsecao' },
  ementa:             { tag: 'p', cls: 'ementa' },
  paragrafAbertura:   { tag: 'p', cls: 'paragrafo-abertura' },
  aberturaCapitulo:   { tag: 'p', cls: 'abertura-capitulo' },
  artigo:             { tag: 'p', cls: 'artigo' },
  artigoTitulo:       { tag: 'p', cls: 'artigo-titulo' },
  corpoTratado:       { tag: 'p', cls: 'corpo-tratado' },
  paragrafLei:        { tag: 'p', cls: 'paragrafo-lei' },
  inciso:             { tag: 'p', cls: 'inciso' },
  alinea:             { tag: 'p', cls: 'alinea' },
  item:               { tag: 'p', cls: 'item' },
  citacao:            { tag: 'p', cls: 'citacao' },
  notaTitulo:         { tag: 'p', cls: 'nota-titulo' },
  assinaturaData:     { tag: 'p', cls: 'assinatura-data' },
  assinaturaNome:     { tag: 'p', cls: 'assinatura-nome' },
}

const DEFAULT_TAG = { tag: 'p', cls: 'texto-lei' }

// ── Escapa caracteres HTML especiais ─────────────────────────────
function esc(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Serializa marks de um nó texto em HTML ───────────────────────
function renderizarTexto(node) {
  let text = esc(node.text ?? '')
  const marks = node.marks ?? []

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':        text = `<strong>${text}</strong>`; break
      case 'italic':      text = `<em>${text}</em>`;         break
      case 'nota':        text = `<span class="nota">${text}</span>`; break
      case 'italicoLight':text = `<em class="italico-light">${text}</em>`; break
      case 'regular':     text = `<span class="regular">${text}</span>`; break
    }
  }
  return text
}

// ── Serializa o conteúdo inline de um nó bloco ───────────────────
function renderizarInline(node) {
  if (!node.content || node.content.length === 0) return '&#8203;' // zero-width space para p vazio
  return node.content.map(n => {
    if (n.type === 'text') return renderizarTexto(n)
    if (n.type === 'hardBreak') return '<br />'
    // Nós inline genéricos
    const inner = renderizarInline(n)
    return inner
  }).join('')
}

// ── Converte um nó bloco em string HTML ──────────────────────────
function renderizarBloco(node) {
  const { tag, cls } = NODE_TAG[node.type] ?? DEFAULT_TAG
  const inner = renderizarInline(node)
  return `<${tag} class="${cls}">${inner}</${tag}>`
}

// ── Folha de estilos inline ──────────────────────────────────────
const CSS = `
body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; max-width: 160mm; margin: 25mm auto; }
p { margin: 0 0 0 0; line-height: 1.5; text-align: justify; }
.epigrafe          { text-align: center; font-weight: bold; text-transform: uppercase; }
.parte-livro-tit-cap { text-align: center; font-weight: bold; text-transform: uppercase; font-size: 11pt; }
.secao-subsecao    { text-align: center; font-weight: bold; font-size: 10pt; }
.ementa            { font-style: italic; text-indent: 0; }
.paragrafo-abertura{ }
.abertura-capitulo { font-style: italic; margin-top: 2em; margin-bottom: .8em; }
.artigo            { }
.artigo-titulo     { text-align: center; font-weight: bold; }
.corpo-tratado     { text-align: justify; }
.paragrafo-lei     { padding-left: 2em; }
.inciso            { padding-left: 3.5em; }
.alinea            { padding-left: 5em; }
.item              { padding-left: 6.5em; }
.citacao           { padding-left: 4em; padding-right: 4em; font-size: 10pt; }
.nota-titulo       { text-align: center; font-weight: bold; font-size: 9pt; }
.assinatura-data   { text-align: center; }
.assinatura-nome   { text-align: center; font-weight: bold; }
.texto-lei         { }
.nota              { color: #555; }
.regular, .regular * { font-style: normal !important; }
`.trim()

// ── Entry point ──────────────────────────────────────────────────
export function gerarHtml(norma) {
  let doc
  try {
    doc = JSON.parse(norma.conteudo_doc)
  } catch {
    doc = { type: 'doc', content: [] }
  }

  const blocos = (doc.content ?? []).map(renderizarBloco).join('\n')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${esc(norma.epigrafe)}</title>
  <style>
${CSS}
  </style>
</head>
<body>
${blocos}
</body>
</html>`
}

// ── Publicação: combina todas as normas com separadores de seção ──
export function gerarHtmlPublicacao(pub, db) {
  const secaoCSS = `.secao-pub { text-align:center; font-weight:bold; text-transform:uppercase; font-size:14pt; margin:2em 0 1em; border-bottom:1px solid #999; padding-bottom:.3em; }`
  const blocos = []

  for (const secao of pub.secoes ?? []) {
    blocos.push(`<h2 class="secao-pub">${esc(secao.titulo)}</h2>`)
    for (const item of secao.normas ?? []) {
      const norma = db.prepare('SELECT conteudo_doc, epigrafe FROM normas WHERE id = ?').get(item.norma_id)
      if (!norma) continue
      let doc
      try   { doc = JSON.parse(norma.conteudo_doc) }
      catch { doc = { type: 'doc', content: [] } }
      blocos.push('<div class="norma">')
      blocos.push((doc.content ?? []).map(renderizarBloco).join('\n'))
      blocos.push('</div>')
    }
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${esc(pub.titulo)}</title>
  <style>
${CSS}
${secaoCSS}
.norma { margin-bottom: 3em; }
  </style>
</head>
<body>
${blocos.join('\n')}
</body>
</html>`
}
