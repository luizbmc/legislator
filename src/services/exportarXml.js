import {
  tagExportacaoCaractere,
  tagExportacaoParagrafo,
} from './preferenciasEstilo.js'
import { filtrarDocPorModoVadeMecum } from './filtrarModoVadeMecum.js'

/**
 * exportarXml.js
 * Converte o JSON do TipTap para XML legislativo e dispara o download.
 *
 * Estrutura gerada:
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <Norma xmlns="http://legislator.app/schema/1.0" tipo="Lei" ...>
 *     <Epigrafe>LEI Nº 1.234...</Epigrafe>
 *     <Ementa>Dispõe sobre...</Ementa>
 *     <Artigo numero="1">Art. 1º  Texto.</Artigo>
 *     <Paragrafo>§ 1º  Texto.</Paragrafo>
 *     ...
 *   </Norma>
 */

// ── Escape de caracteres especiais XML ───────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Marks inline → tags XML ──────────────────────────────────────
// Ordem das tags respeita a especificidade: bold > italic > marcas customizadas
const MARK_TAG = {
  bold:        'b',
  italic:      'i',
  boldArtigo:  'Rotulo',
  nota:        'Nota',
  notaSobrescrito: 'NotaSobrescrito',
  italicoLight:'i',
  regular:     'Regular',
  superscript: 'sup',
  subscript:   'sub',
  underline:   'u',
  strike:      's',
  // link tratado separadamente em marksParaTags
}

function proximaChamadaNotaRodape(opcoes = {}) {
  opcoes.__notaRodapeSeq = Number(opcoes.__notaRodapeSeq || 1)
  return String(opcoes.__notaRodapeSeq++)
}

function marksParaTags(marks = [], opcoes = {}) {
  // Deduplica (ex.: italicoLight e italic ambos geram <i>)
  const vistos = new Set()
  const openParts  = []
  const closeParts = []

  for (const m of marks) {
    if (m.type === 'notaRodape') {
      const chamada = esc(proximaChamadaNotaRodape(opcoes))
      const texto = esc(m.attrs?.texto ?? '')
      openParts.push(`<NotaRodape chamada="${chamada}">`)
      closeParts.unshift(texto ? `${texto}</NotaRodape>` : '</NotaRodape>')
      continue
    }
    if (m.type === 'link') {
      const href = esc(m.attrs?.href ?? '')
      if (href && !vistos.has('a')) {
        vistos.add('a')
        openParts.push(`<a href="${href}">`)
        closeParts.unshift('</a>')
      }
      continue
    }
    const tag = tagExportacaoCaractere(m) || MARK_TAG[m.type]
    if (tag && !vistos.has(tag)) {
      vistos.add(tag)
      openParts.push(`<${tag}>`)
      closeParts.unshift(`</${tag}>`)
    }
  }

  return {
    open:  openParts.join(''),
    close: closeParts.join(''),
  }
}

// ── Converte nós inline (text / hardBreak) para XML ──────────────
function inlineParaXml(nos = [], opcoes = {}) {
  return nos.map(no => {
    if (no.type === 'hardBreak') return '<br/>'
    if (no.type !== 'text')      return ''

    const notaRodape = no.marks?.find(m => m.type === 'notaRodape')
    if (notaRodape) {
      const chamada = esc(proximaChamadaNotaRodape(opcoes))
      const texto = esc(notaRodape.attrs?.texto ?? no.text ?? '')
      return `<NotaRodape chamada="${chamada}">${texto}</NotaRodape>`
    }

    const texto = esc(no.text || '')
    if (!no.marks?.length) return texto

    const { open, close } = marksParaTags(no.marks, opcoes)
    return `${open}${texto}${close}`
  }).join('')
}

// ── Tabelas ──────────────────────────────────────────────────────
function tabelaParaXml(no, ind, opcoes = {}) {
  const attrs = []
  if (opcoes.incluirAlterado !== false && no.attrs?.alterado != null) attrs.push(`alterado="${esc(no.attrs.alterado)}"`)
  if (opcoes.incluirLocal !== false && no.attrs?.local != null) attrs.push(`local="${esc(no.attrs.local)}"`)
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
  const linhas = (no.content || [])
    .filter(r => r.type === 'tableRow')
    .map(row => {
      const celulas = (row.content || []).map(cell => {
        const tag     = cell.type === 'tableHeader' ? 'Cabecalho' : 'Celula'
        const colspan = cell.attrs?.colspan > 1 ? ` colspan="${cell.attrs.colspan}"` : ''
        const rowspan = cell.attrs?.rowspan > 1 ? ` rowspan="${cell.attrs.rowspan}"` : ''
        // Concatena parágrafos internos separados por espaço
        const conteudo = (cell.content || [])
          .map(p => inlineParaXml(p.content || [], opcoes))
          .join(' ')
          .trim()
        return `${ind}    <${tag}${colspan}${rowspan}>${conteudo}</${tag}>`
      })
      return [`${ind}  <Linha>`, ...celulas, `${ind}  </Linha>`].join('\n')
    })

  return [`${ind}<Tabela${attrStr}>`, ...linhas, `${ind}</Tabela>`].join('\n')
}

function tabelaEmParagrafoParaXml(no, ind, opcoes = {}) {
  const attrs = []
  if (opcoes.incluirAlterado !== false && no.attrs?.alterado != null) attrs.push(`alterado="${esc(no.attrs.alterado)}"`)
  if (opcoes.incluirLocal !== false && no.attrs?.local != null) attrs.push(`local="${esc(no.attrs.local)}"`)
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
  return [
    `${ind}<Paragrafo${attrStr}>`,
    tabelaParaXml(no, ind + '  ', { ...opcoes, incluirAlterado: false, incluirLocal: false }),
    `${ind}</Paragrafo>`,
  ].join('\n')
}

// ── Mapeamento TipTap → elemento XML ────────────────────────────
const NO_PARA_XML = {
  epigrafe:         'Epigrafe',
  epigrafeApelido:  'EpigrafeApelido',
  notaTitulo:       'NotaTitulo',
  ementa:           'Ementa',
  paragrafAbertura: 'ParagrafoAbertura',
  paragrafFacoSaber:'ParagrafoFacoSaber',
  aberturaCapitulo: 'AberturaCapitulo',
  partelivroTitCap: 'Divisao',
  secaoSubsecao:    'Secao',
  artigo:           'Artigo',
  artigoTitulo:     'ArtigoTitulo',
  corpoTratado:     'CorpoTratado',
  paragrafLei:      'Paragrafo',
  nomeJuridico:     'NomeJuridico',
  inciso:           'Inciso',
  alinea:           'Alinea',
  item:             'Item',
  citacao:          'Citacao',
  data:             'Data',
  assinatura:       'Assinatura',
  assinaturaData:   'Data',
  assinaturaNome:   'Assinatura',
  textoComumTitulo: 'TextoTitulo',
  textoComumSubtitulo: 'TextoSubtitulo',
  textoComumCorrido: 'TextoCorrido',
  textoComumRecuado: 'TextoRecuado',
  textoComumCitacao: 'TextoCitacao',
  textoComumBullets: 'TextoBullets',
  textoComumAssinatura: 'TextoAssinatura',
  textoComumAssinaturaCargo: 'TextoAssinaturaCargo',
  // Parágrafo padrão do TipTap (em células de tabela)
  paragraph:        'p',
}

function noParaXml(no, ind = '  ', opcoes = {}) {
  // Tabela
  if (no.type === 'table') return tabelaEmParagrafoParaXml(no, ind, opcoes)

  const tag = tagExportacaoParagrafo(no.type, no.attrs || {}) || NO_PARA_XML[no.type]
  if (!tag) return null   // tipo desconhecido — ignora

  const conteudo = inlineParaXml(no.content || [], opcoes)

  // Atributos extras
  const attrs = []
  if (no.attrs?.numero   != null) attrs.push(`numero="${esc(no.attrs.numero)}"`)
  if (no.attrs?.rotulo   != null) attrs.push(`rotulo="${esc(no.attrs.rotulo)}"`)
  if (opcoes.incluirAlterado !== false && no.attrs?.alterado != null) attrs.push(`alterado="${esc(no.attrs.alterado)}"`)
  if (opcoes.incluirLocal !== false && no.attrs?.local != null) attrs.push(`local="${esc(no.attrs.local)}"`)
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''

  if (!conteudo) return `${ind}<${tag}${attrStr}/>`
  return `${ind}<${tag}${attrStr}>${conteudo}</${tag}>`
}

// ── API pública ──────────────────────────────────────────────────

/**
 * Converte o doc JSON do TipTap para string XML.
 * @param {object} doc       - Resultado de editor.getJSON()
 * @param {object} metadados - { tipo, epigrafe } da norma (opcionais)
 */
function textoNode(no) {
  if (!no) return ''
  if (no.type === 'text') return no.text || ''
  if (no.type === 'hardBreak') return '\n'
  return (no.content || []).map(textoNode).join('')
}

function normalizarLocatorTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
}

function numeroArtigo(no) {
  const texto = normalizarLocatorTexto(textoNode(no)).toUpperCase()
  const m = texto.match(/(?:^|[^A-Z])ART\.?\s*([0-9]+(?:\s*-\s*[A-Z])?)/)
  return m ? String(m[1]).replace(/\s+/g, '').toUpperCase() : ''
}

function flagInfo(valor) {
  if (!valor) return null
  if (typeof valor === 'string') return { alterado: valor }
  if (typeof valor === 'object') return valor.alterado ? valor : null
  return null
}

function diffInfoPorIndice(diffs = []) {
  const mapa = {}
  for (const d of diffs || []) {
    if (typeof d?.contentIdx !== 'number') continue
    if (!d.type) continue
    mapa[d.contentIdx] = {
      diffType: d.type,
      subtype: d.subtype,
    }
  }
  return mapa
}

function infoAlteracaoDoNo(no, idx, alteracoes, diffPorIndice) {
  const doMapa = flagInfo(alteracoes[idx])
  if (doMapa) return doMapa
  if (!no?.attrs?.alterado) return null
  const doDiff = diffPorIndice[idx] || {}
  return {
    alterado: no.attrs.alterado,
    diffType: no.attrs.diffType || doDiff.diffType,
    subtype: no.attrs.diffSubtype || doDiff.subtype,
  }
}

function clonarNoComAttrs(no, attrsExtras = {}) {
  return {
    ...no,
    attrs: {
      ...(no.attrs || {}),
      ...attrsExtras,
    },
  }
}

function limparAttrsInternos(no) {
  if (Array.isArray(no)) return no.map(limparAttrsInternos)
  if (!no || typeof no !== 'object') return no
  const out = { ...no }
  if (out.attrs) {
    const attrs = { ...out.attrs }
    delete attrs.local
    delete attrs.vmRole
    if (Object.keys(attrs).length) out.attrs = attrs
    else delete out.attrs
  }
  if (out.content) out.content = out.content.map(limparAttrsInternos)
  return out
}

function prepararDocModoVadeMecum(doc, modoVadeMecum = false) {
  return filtrarDocPorModoVadeMecum(doc, modoVadeMecum)
}

function prepararDocAtualizacao(doc, alteracoes = {}, diffs = []) {
  const origem = doc?.content || []
  const operacoes = []
  const diffPorIndice = diffInfoPorIndice(diffs)
  let artigoAtual = ''
  let artigoInicio = 0

  for (let idx = 0; idx < origem.length;) {
    const no = origem[idx]
    const art = no?.type === 'artigo' ? numeroArtigo(no) : ''
    if (art) {
      artigoAtual = art
      artigoInicio = idx
    }

    const info = infoAlteracaoDoNo(no, idx, alteracoes, diffPorIndice)
    if (!info?.alterado) {
      idx++
      continue
    }

    const contextoInicio = idx > artigoInicio ? artigoInicio : Math.max(0, idx - 1)
    const contexto = origem.slice(contextoInicio, idx).map(limparAttrsInternos)

    if (info.alterado === 'remocaoApos') {
      operacoes.push({
        tipo: 'removerProximo',
        alterado: info.alterado,
        contexto,
        novos: [],
      })
      idx++
      continue
    }

    if (info.diffType === 'added') {
      const novos = []
      let j = idx
      while (j < origem.length) {
        const itemInfo = infoAlteracaoDoNo(origem[j], j, alteracoes, diffPorIndice)
        if (!itemInfo || itemInfo.alterado !== 'modificado' || itemInfo.diffType !== 'added') break
        novos.push(clonarNoComAttrs(limparAttrsInternos(origem[j]), { alterado: 'modificado' }))
        j++
      }
      operacoes.push({
        tipo: 'inserirApos',
        alterado: 'modificado',
        contexto,
        novos,
      })
      idx = j
      continue
    }

    operacoes.push({
      tipo: 'substituirProximo',
      alterado: info.alterado,
      contexto,
      novos: [clonarNoComAttrs(limparAttrsInternos(no), { alterado: info.alterado })],
    })
    idx++
  }

  return { operacoes }
}

function alteracoesParaXml(operacoes, opcoes = {}) {
  if (!operacoes?.length) return ''
  const linhas = ['  <Atualizacoes>']
  for (const op of operacoes) {
    linhas.push(`    <Alteracao tipo="${esc(op.tipo)}" alterado="${esc(op.alterado)}">`)
    linhas.push('      <Contexto>')
    for (const bloco of op.contexto || []) {
      const xml = noParaXml(bloco, '        ', { ...opcoes, incluirAlterado: false, incluirLocal: false })
      if (xml !== null) linhas.push(xml)
    }
    linhas.push('      </Contexto>')
    if (op.novos?.length) {
      linhas.push('      <Novo>')
      for (const bloco of op.novos) {
        const xml = noParaXml(bloco, '        ', opcoes)
        if (xml !== null) linhas.push(xml)
      }
      linhas.push('      </Novo>')
    }
    linhas.push('    </Alteracao>')
  }
  linhas.push('  </Atualizacoes>')
  return linhas.join('\n')
}

/**
 * Converte o doc JSON do TipTap para string XML.
 * @param {object} doc       - Resultado de editor.getJSON()
 * @param {object} metadados - { tipo, epigrafe } da norma (opcionais)
 * @param {object} opcoes    - { modo, alteracoes, incluirAlterado, incluirLocal }
 */
export function tiptapParaXml(doc, metadados = {}, opcoes = {}) {
  const docModoVade = prepararDocModoVadeMecum(doc, opcoes.modoVadeMecum === true)
  const preparado = opcoes.modo === 'atualizacao'
    ? prepararDocAtualizacao(docModoVade, opcoes.alteracoes || {}, opcoes.diffs || [])
    : { doc: docModoVade, operacoes: [] }
  const docExport = preparado.doc || { type: 'doc', content: [] }

  const exportOptions = {
    incluirAlterado: opcoes.modo === 'atualizacao' ? true : opcoes.incluirAlterado === true,
    incluirLocal: opcoes.modo === 'atualizacao',
    __notaRodapeSeq: 1,
  }

  const nos    = docExport.content || []
  const corpo  = nos
    .map(n => noParaXml(n, '  ', exportOptions))
    .filter(linha => linha !== null)
    .join('\n')
  const atualizacoes = opcoes.modo === 'atualizacao'
    ? alteracoesParaXml(preparado.operacoes, exportOptions)
    : ''
  const conteudo = [corpo, atualizacoes].filter(Boolean).join('\n')

  const atributos = [
    'xmlns="http://legislator.app/schema/1.0"',
    metadados.tipo     ? `tipo="${esc(metadados.tipo)}"`         : null,
    metadados.epigrafe ? `epigrafe="${esc(metadados.epigrafe)}"` : null,
  ].filter(Boolean).join(' ')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Norma ${atributos}>`,
    conteudo,
    '</Norma>',
  ].join('\n')
}

/**
 * Gera o XML e dispara o download no navegador.
 * @param {object} doc       - editor.getJSON()
 * @param {object} metadados - { tipo, epigrafe } da norma
 * @param {string} nomeBase  - Nome do arquivo sem extensão
 */
export function baixarXml(doc, metadados = {}, nomeBase = 'norma', opcoes = {}) {
  const xml  = tiptapParaXml(doc, metadados, opcoes)
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${nomeBase}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
