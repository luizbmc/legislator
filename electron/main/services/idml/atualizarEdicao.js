/**
 * atualizarEdicao.js — nova edição a partir do IDML da edição anterior (ex.: CF).
 *
 * Nas reedições, só algumas partes mudam (na CF: o corpo, o ADCT e a nova emenda). O resto
 * (emendas anteriores, tratados, índice remissivo) fica exatamente como no IDML anterior, com os
 * ajustes finos do diagramador. O texto principal da edição anterior é dividido nas partes
 * marcadas pelos parágrafos de abertura (tit-subtit:abertura-cap*); cada parte vira um texto
 * próprio, nas suas páginas. A ação de cada parte vem da "exportação" da norma correspondente na
 * publicação:
 *   • ignorar     → mantém a parte do IDML anterior (também partes sem norma, como o índice);
 *   • completa    → gera de novo a partir do Normando (a abertura da parte anterior fica);
 *   • atualizacao → acrescenta o conteúdo da norma no fim da parte (ex.: a nova emenda em
 *                   "Emendas Constitucionais"); o que já estiver na parte não é repetido.
 * Partes geradas ou acrescidas ganham páginas na proporção do texto novo, sempre em número par a
 * mais ou a menos, para as páginas mantidas não trocarem de lado.
 */

import JSZip from 'jszip'
import { prepararPublicacao } from './exportIdml.js'
import { paragrafosDaPublicacao, paragrafosXml, novoRelatorio } from './historia.js'
import { dataCurta, ultimaAlteracao } from './pretextuais.js'

const LARG = 481.8897637795001
const ESPACO_SPREADS = 931.1811023623

export const normalizar = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const textoDoXml = xml => [...xml.matchAll(/<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g)].map(m => m[1] ?? '\n').join('')
  .replace(/<\?[^>]*\?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Elementos de nível superior de um trecho XML: [{ tag, inicio, fim, abertura }] */
export function filhos(xml, de = 0, ate = xml.length) {
  const out = []
  const re = /<(\/?)([A-Za-z][\w:]*)\b[^>]*?(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g
  re.lastIndex = de
  let nivel = 0, atual = null, m
  while ((m = re.exec(xml)) && m.index < ate) {
    if (!m[2]) continue
    if (m[1]) { if (--nivel === 0 && atual) { atual.fim = re.lastIndex; out.push(atual); atual = null } continue }
    if (nivel === 0) atual = { tag: m[2], inicio: m.index, abertura: m[0] }
    if (m[3]) { if (nivel === 0) { atual.fim = re.lastIndex; out.push(atual); atual = null } } else nivel++
  }
  return out
}
export const attr = (tag, nome) => tag.match(new RegExp(`\\s${nome}="([^"]*)"`))?.[1]
export const setAttr = (tag, nome, valor) => new RegExp(`\\s${nome}="[^"]*"`).test(tag)
  ? tag.replace(new RegExp(`(\\s${nome}=")[^"]*(")`), `$1${valor}$2`)
  : tag.replace(/^(<[\w:]+)/, `$1 ${nome}="${valor}"`)

/**
 * @param baseBytes   IDML da edição anterior
 * @param publicacao  publicação (secoes[].normas[] com conteudo_doc e exportacao)
 * @param opcoes      { pretextuais }
 */
export async function atualizarEdicaoIdml(baseBytes, publicacao, opcoes = {}) {
  const zip = await JSZip.loadAsync(baseBytes)
  const ler = n => zip.file(n).async('string')
  const rel = { ...novoRelatorio(), partes: [], avisos: [], pretextuais: [] }
  let designmap = await ler('designmap.xml')

  // ── texto principal e sumário ─────────────────────────────────
  const arquivosStory = [...designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)].map(m => m[1])
  let principal = null, sumario = null
  for (const n of arquivosStory) {
    const xml = await ler(n)
    const aberturas = (xml.match(/AppliedParagraphStyle="ParagraphStyle\/tit-subtit%3aabertura-cap/g) || []).length
    if (aberturas && (!principal || xml.length > principal.xml.length)) principal = { n, xml }
    if (/<Story [^>]*AppliedTOCStyle="(?!n")/.test(xml)) sumario = { n, xml }
  }
  if (!principal) throw new Error('O IDML anterior não tem aberturas de parte (tit-subtit:abertura-cap…).')
  const idPrincipal = principal.xml.match(/<Story Self="([^"]+)"/)[1]

  // partes: do parágrafo de abertura até o próximo
  const iStory = principal.xml.indexOf('<Story ')
  const iCorpo = principal.xml.indexOf('>', iStory) + 1
  const fStory = principal.xml.lastIndexOf('</Story>')
  const cabecaStory = principal.xml.slice(0, iCorpo)
  const rabo = principal.xml.slice(fStory)
  const elementos = filhos(principal.xml, iCorpo, fStory)
  const preambulo = elementos.filter(e => e.tag !== 'ParagraphStyleRange').map(e => principal.xml.slice(e.inicio, e.fim)).join('\n')
  const psrs = elementos.filter(e => e.tag === 'ParagraphStyleRange')
  const inicios = psrs.map((p, k) => /tit-subtit%3aabertura-cap/.test(p.abertura) ? k : -1).filter(k => k >= 0)
  if (inicios[0] !== 0) inicios.unshift(0)
  const partes = inicios.map((k, n) => {
    const fimK = n + 1 < inicios.length ? inicios[n + 1] : psrs.length
    const xml = psrs.slice(k, fimK).map(p => principal.xml.slice(p.inicio, p.fim)).join('\n')
    const abertura = principal.xml.slice(psrs[k].inicio, psrs[k].fim)
    return { titulo: textoDoXml(abertura).split('\n').filter(Boolean).join(' ').trim(), abertura, xml }
  })

  // página de abertura de cada parte: pelo sumário da edição anterior
  const entradas = []
  if (sumario) {
    let buf = ''
    for (const m of sumario.xml.matchAll(/<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g)) {
      if (m[1] == null) { entradas.push(buf); buf = ''; continue }
      buf += m[1]
    }
    entradas.push(buf)
  }
  const doSumario = entradas.map(e => {
    const t = e.replace(/<\?ACE 8\?>/g, '\t').replace(/<\?[^>]*\?>/g, '')
    const pg = t.match(/\t\s*(\d+)\s*$/) || t.match(/(\d+)\s*$/)
    return pg ? { t: normalizar(t.replace(/\t?\s*\d+\s*$/, '')), pg: Number(pg[1]) } : null
  }).filter(Boolean)
  // correspondência de títulos: idêntico ganha; senão, o maior começo em comum (mín. 8 letras) —
  // "Emendas Constitucionais" não pode casar com "Emendas Constitucionais de Revisão"
  const pontos = (a, b) => {
    const x = normalizar(a), y = normalizar(b)
    if (x === y) return 10000
    let k = 0
    while (k < x.length && k < y.length && x[k] === y[k]) k++
    if (k < 8) return 0
    // um é começo do outro: vale se o mais curto tem pelo menos 30 letras (títulos truncados)
    if (k === Math.min(x.length, y.length) && k < 30) return 0
    return k
  }
  const melhor = (lista, titulo, campo) => {
    let m = null, pm = 0
    for (const x of lista) { const pt = pontos(campo(x), titulo); if (pt > pm) { pm = pt; m = x } }
    return m
  }
  const casa = (a, b) => pontos(a, b) > 0
  for (const p of partes) {
    const e = melhor(doSumario, p.titulo, x => x.t)
    p.pagina = e?.pg ?? null
    if (!p.pagina) throw new Error(`A parte "${p.titulo}" não aparece no sumário do IDML anterior. Atualize o sumário no InDesign e exporte o IDML de novo.`)
  }

  // ── páginas ───────────────────────────────────────────────────
  const arquivosSpread = [...designmap.matchAll(/<idPkg:Spread src="([^"]+)"/g)].map(m => m[1])
  const paginas = []        // em ordem: { xml, lado: 'e'|'d', itens: [xml], spread, quadros: [ids] }
  const spreadsXml = {}
  for (const s of arquivosSpread) {
    const xml = await ler(s)
    spreadsXml[s] = xml
    const iSp = xml.indexOf('<Spread ')
    const iC = xml.indexOf('>', iSp) + 1
    const fC = xml.lastIndexOf('</Spread>')
    const els = filhos(xml, iC, fC)
    const pags = els.filter(e => e.tag === 'Page').map(e => {
      const pxml = xml.slice(e.inicio, e.fim)
      const tx = Number((attr(e.abertura, 'ItemTransform') || '1 0 0 1 0 0').split(' ')[4])
      return { xml: pxml, lado: tx < -1 ? 'e' : 'd', itens: [], spread: s }
    })
    for (const e of els) {
      if (e.tag === 'Page' || e.tag === 'FlattenerPreference') continue
      const ixml = xml.slice(e.inicio, e.fim)
      // página do item: pelo centro horizontal (lombada em x = 0)
      const t = (attr(e.abertura, 'ItemTransform') || '1 0 0 1 0 0').split(' ').map(Number)
      const xs = [...ixml.matchAll(/Anchor="([-\d.e]+) ([-\d.e]+)"/g)].map(a => Number(a[1]) * t[0] + t[4])
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : t[4]
      const alvo = pags.length === 1 ? pags[0] : (pags.find(p => (cx < 0) === (p.lado === 'e')) || pags[0])
      alvo.itens.push(ixml)
    }
    paginas.push(...pags)
  }
  const quadroPrincipal = ixml => /^<TextFrame\b/.test(ixml) && attr(ixml.slice(0, ixml.indexOf('>')), 'ParentStory') === idPrincipal
  const ultimaComTexto = paginas.reduce((u, p, i) => p.itens.some(quadroPrincipal) ? i : u, -1)
  partes.forEach((p, n) => {
    p.de = p.pagina - 1
    p.ate = (n + 1 < partes.length ? partes[n + 1].pagina - 1 : ultimaComTexto + 1) - 1
    p.paginas = paginas.slice(p.de, p.ate + 1)
  })

  // ── normas ↔ partes e ação de cada parte ──────────────────────
  const pub = prepararPublicacao(publicacao)
  const normas = pub.secoes.flatMap(s => s.normas)
  const tituloNorma = n => {
    const b = n.doc?.content?.find(x => x.type === 'epigrafe')
    return b ? (b.content || []).map(c => c.text || '').join('') : n.epigrafe
  }
  for (const n of publicacao.secoes.flatMap(s => s.normas || [])) {
    const livres = partes.filter(p => !p.norma)
    const parte = melhor(livres, n.epigrafe, p => p.titulo)
      || melhor(livres, tituloNorma(normas.find(x => x.id === n.id) || n), p => p.titulo)
    if (!parte) {
      if (n.exportacao !== 'ignorar') rel.avisos.push(`"${n.epigrafe}" não corresponde a nenhuma parte da edição anterior: ficou de fora (inclua-a no IDML anterior ou gere a publicação inteira).`)
      continue
    }
    parte.norma = normas.find(x => x.id === n.id) || n
    parte.acao = n.exportacao === 'atualizacao' ? 'acrescentar' : n.exportacao === 'ignorar' || parte.norma.pular ? 'manter' : 'regenerar'
  }

  // conteúdo novo de cada parte
  let seq = 0
  for (const p of partes) {
    p.acao = p.acao || 'manter'
    const textoAntes = textoDoXml(p.xml)
    if (p.acao === 'manter') { p.novoXml = p.xml; rel.partes.push({ titulo: p.titulo, acao: 'mantida', paginas: p.paginas.length }); continue }
    let doc = p.norma.doc || { content: [] }
    if (p.acao === 'regenerar') {
      // a abertura da edição anterior fica no lugar da epígrafe da norma
      const blocos = [...(doc.content || [])]
      while (blocos.length && /^(epigrafe|epigrafeApelido)$/.test(blocos[0].type)) blocos.shift()
      doc = { ...doc, content: blocos }
    } else {
      // acrescentar: só o que ainda não está na parte (pela epígrafe de cada emenda)
      const ja = normalizar(textoAntes)
      const grupos = []
      for (const b of doc.content || []) {
        if (b.type === 'epigrafe' || !grupos.length) grupos.push([])
        grupos[grupos.length - 1].push(b)
      }
      const novos = grupos.filter(g => {
        const ep = g[0]?.type === 'epigrafe' ? normalizar((g[0].content || []).map(c => c.text || '').join('')) : ''
        const repetida = ep && ja.includes(ep)
        if (repetida) rel.avisos.push(`"${(g[0].content || []).map(c => c.text || '').join('')}" já está na edição anterior: não foi repetida.`)
        return !repetida
      })
      doc = { ...doc, content: novos.flat() }
    }
    const miniPub = { secoes: [{ titulo: '', normas: [{ ...p.norma, doc, pular: false }] }] }
    const pars = doc.content.length ? paragrafosDaPublicacao(miniPub, { cabecalho: 'secao' }, rel) : []
    const ultimaParte = p === partes[partes.length - 1]
    const xmlNovo = pars.length ? paragrafosXml(pars, { rel, terminarComBr: !ultimaParte || p.acao === 'acrescentar' }) : ''
    p.novoXml = p.acao === 'regenerar' ? p.abertura + '\n' + xmlNovo : p.xml + (xmlNovo ? '\n' + xmlNovo : '')
    // páginas na proporção do texto (+1 de folga), com diferença par
    const antes = textoAntes.length || 1
    const depois = textoDoXml(p.novoXml).length
    let alvo = Math.max(1, Math.ceil(p.paginas.length * depois / antes) + (depois !== antes ? 1 : 0))
    if ((alvo - p.paginas.length) % 2) alvo++
    p.alvo = alvo
    rel.partes.push({ titulo: p.titulo, acao: p.acao === 'regenerar' ? 'gerada de novo' : 'acrescida', paginasAntes: p.paginas.length, paginas: alvo, paragrafos: pars.length })
    seq++
  }

  // ── novas páginas das partes alteradas ───────────────────────
  let dup = 0
  const duplicar = pagina => {
    const sufixo = `n${(++dup).toString(36)}`
    const novoId = (xml) => xml.replace(/\sSelf="([^"]+)"/g, (m, id) => ` Self="${id}${sufixo}"`)
    return {
      xml: setAttr(novoId(pagina.xml).replace(/^<Page\b[^>]*>/, t => setAttr(t, 'OverrideList', '')), 'OverrideList', ''),
      lado: pagina.lado,
      itens: pagina.itens.filter(quadroPrincipal).map(novoId),
      spread: pagina.spread,
    }
  }
  const novaLista = []
  let cursor = 0
  for (const p of partes) {
    novaLista.push(...paginas.slice(cursor, p.de))
    cursor = p.ate + 1
    let pags = [...p.paginas]
    if (p.alvo && p.alvo !== pags.length) {
      if (p.alvo < pags.length) pags = pags.slice(0, p.alvo)
      else {
        // modelos de página esquerda e direita: as últimas da parte
        const modelo = { e: [...pags].reverse().find(x => x.lado === 'e') || pags[pags.length - 1], d: [...pags].reverse().find(x => x.lado === 'd') || pags[pags.length - 1] }
        while (pags.length < p.alvo) {
          const lado = pags[pags.length - 1].lado === 'e' ? 'd' : 'e'
          pags.push(duplicar(modelo[lado]))
        }
      }
    }
    p.novasPaginas = pags
    novaLista.push(...pags)
  }
  novaLista.push(...paginas.slice(cursor))

  // ── stories das partes e encadeamento dos quadros ────────────
  const arquivosNovos = {}
  partes.forEach((p, n) => {
    const id = `${idPrincipal}p${n}`
    p.id = id
    const cabeca = cabecaStory.replace(/<Story Self="[^"]+"/, `<Story Self="${id}"`).replace(/StoryTitle="[^"]*"/, `StoryTitle="${p.titulo.replace(/["<>&]/g, ' ').slice(0, 60)}"`)
    arquivosNovos[`Stories/Story_${id}.xml`] = cabeca + (n === 0 && preambulo ? preambulo + '\n' : '') + p.novoXml + '\n' + rabo
    // quadros do texto principal nas páginas da parte, em ordem
    const quadros = []
    for (const pg of p.novasPaginas) {
      pg.itens = pg.itens.map(ix => {
        if (!quadroPrincipal(ix) && !(new RegExp(`ParentStory="${idPrincipal}"`).test(ix.slice(0, ix.indexOf('>'))))) return ix
        quadros.push({ pg, ix })
        return ix
      })
    }
    quadros.forEach((q, k) => {
      const self = attr(q.ix.slice(0, q.ix.indexOf('>')), 'Self')
      const ant = k > 0 ? attr(quadros[k - 1].ix.slice(0, quadros[k - 1].ix.indexOf('>')), 'Self') : 'n'
      const prox = k < quadros.length - 1 ? attr(quadros[k + 1].ix.slice(0, quadros[k + 1].ix.indexOf('>')), 'Self') : 'n'
      let tag = q.ix.slice(0, q.ix.indexOf('>') + 1)
      tag = setAttr(setAttr(setAttr(tag, 'ParentStory', id), 'PreviousTextFrame', ant), 'NextTextFrame', prox)
      const novo = tag + q.ix.slice(q.ix.indexOf('>') + 1)
      q.pg.itens[q.pg.itens.indexOf(q.ix)] = novo
      q.ix = novo
    })
    if (!quadros.length) rel.avisos.push(`A parte "${p.titulo}" ficou sem quadro de texto.`)
  })

  // ── spreads refeitos a partir do spread da 1ª página das partes ─
  const primeiraPg = partes[0].de
  const spreadInicial = paginas[primeiraPg].spread
  const iSpreadInicial = arquivosSpread.indexOf(spreadInicial)
  const pgsAntes = arquivosSpread.slice(0, iSpreadInicial).reduce((s, sp) => s + (spreadsXml[sp].match(/<Page /g) || []).length, 0)
  const refeitas = novaLista.slice(pgsAntes)
  const modeloSpread = spreadsXml[spreadInicial]
  const cabecaSpread = modeloSpread.slice(0, modeloSpread.indexOf('<Spread '))
  const tagSpread = modeloSpread.match(/<Spread [^>]*>/)[0]
  const flattener = (modeloSpread.match(/<FlattenerPreference[\s\S]*?<\/FlattenerPreference>|<FlattenerPreference[^>]*\/>/) || [''])[0]
  const yBase = Number((attr(tagSpread, 'ItemTransform') || '1 0 0 1 0 0').split(' ')[5])
  const grupos = []
  for (const pg of refeitas) {
    const g = grupos[grupos.length - 1]
    if (pg.lado === 'e' || !g || g.length === 2 || g[g.length - 1].lado === 'd') grupos.push([pg])
    else g.push(pg)
  }
  const novosSpreads = grupos.map((g, k) => {
    const id = `nsa${k.toString(36)}`
    let tag = setAttr(setAttr(setAttr(tagSpread, 'Self', id), 'PageCount', String(g.length)), 'ItemTransform', `1 0 0 1 0 ${yBase + k * ESPACO_SPREADS}`)
    tag = setAttr(tag, 'BindingLocation', g.length === 2 || g[0].lado === 'e' ? '1' : '0')
    const nome = `Spreads/Spread_${id}.xml`
    arquivosNovos[nome] = cabecaSpread + tag + '\n' + flattener + '\n' + g.map(p => p.xml).join('\n') + '\n' + g.flatMap(p => p.itens).join('\n') + '\n</Spread>\n</idPkg:Spread>\n'
    return nome
  })

  // ── designmap, preferências, sumário ─────────────────────────
  for (const s of arquivosSpread.slice(iSpreadInicial)) {
    zip.remove(s)
    designmap = designmap.replace(new RegExp(`\\s*<idPkg:Spread src="${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*/>`), '')
  }
  const ultimoAntes = arquivosSpread[iSpreadInicial - 1]
  const entradasSpread = novosSpreads.map(s => `<idPkg:Spread src="${s}" />`).join('\n\t')
  designmap = ultimoAntes
    ? designmap.replace(new RegExp(`(<idPkg:Spread src="${ultimoAntes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*/>)`), `$1\n\t${entradasSpread}`)
    : designmap.replace(/(<idPkg:MasterSpread [^>]*\/>)(?![\s\S]*<idPkg:MasterSpread)/, `$1\n\t${entradasSpread}`)
  zip.remove(principal.n)
  designmap = designmap.replace(new RegExp(`<idPkg:Story src="${principal.n}"\\s*/>`),
    partes.map(p => `<idPkg:Story src="Stories/Story_${p.id}.xml" />`).join('\n\t'))
  designmap = designmap.replace(/StoryList="([^"]*)"/, (_, l) => `StoryList="${l.split(' ').filter(x => x !== idPrincipal).concat(partes.map(p => p.id)).join(' ')}"`)
  const total = pgsAntes + refeitas.length
  designmap = designmap.replace(/(<Section [^>]*?)Length="\d+"/, `$1Length="${total}"`)
    .replace(/(<Section [^>]*?)AlternateLayoutLength="\d+"/, `$1AlternateLayoutLength="${total}"`)
  // sumário antigo: links e marcadores saem (o InDesign refaz em Layout › Atualizar sumário)
  for (const tag of ['Hyperlink', 'Bookmark', 'HyperlinkPageDestination', 'Article']) {
    designmap = designmap.replace(new RegExp(`\\s*<${tag} [^>]*?/>`, 'g'), '')
    // marcadores podem ser aninhados: remove de dentro para fora
    const interno = new RegExp(`\\s*<${tag} [^>]*?>(?:(?!<${tag}[\\s>])[\\s\\S])*?</${tag}>`, 'g')
    let antes
    do { antes = designmap; designmap = designmap.replace(interno, '') } while (designmap !== antes)
  }
  if (sumario) {
    zip.file(sumario.n, sumario.xml.replace(/<HyperlinkTextSource\b[^>]*>([\s\S]*?)<\/HyperlinkTextSource>/g, '$1'))
  }
  zip.file('designmap.xml', designmap)
  let pref = await ler('Resources/Preferences.xml')
  pref = pref.replace(/(<TextPreference [^>]*?)SmartTextReflow="[^"]*"/, '$1SmartTextReflow="true"')
    .replace(/(<TextPreference [^>]*?)AddPages="[^"]*"/, '$1AddPages="EndOfStory"')
    .replace(/(<TextPreference [^>]*?)LimitToMasterTextFrames="[^"]*"/, '$1LimitToMasterTextFrames="false"')
    .replace(/(<TextPreference [^>]*?)DeleteEmptyPages="[^"]*"/, '$1DeleteEmptyPages="false"')
  zip.file('Resources/Preferences.xml', pref)
  for (const [n, x] of Object.entries(arquivosNovos)) zip.file(n, x)

  // ── pré-textuais: número da edição e data de atualização ─────
  const numero = String(publicacao.edicao || '').match(/\d+/)?.[0]
  const pre = typeof opcoes.pretextuais === 'string' ? JSON.parse(opcoes.pretextuais || '{}') : (opcoes.pretextuais || {})
  const data = pre.atualizacao || dataCurta(ultimaAlteracao(pub))
  for (const n of arquivosStory) {
    if (n === principal.n || n === sumario?.n || !zip.file(n)) continue
    const xml = await ler(n)
    let novo = xml
    if (numero) {
      novo = novo.replace(/(\d+)(ª\s*(?:EDIÇÃO|edição|Edição))/g, (m, a, b) => a === numero ? m : (rel.pretextuais.push(`${a}${b} → ${numero}${b}`), numero + b))
        .replace(/(\s|>)(\d+)(\. ed\.)/g, (m, s, a, b) => a === numero ? m : (rel.pretextuais.push(`${a}${b} → ${numero}${b}`), s + numero + b))
    }
    if (data) novo = novo.replace(/(atualizada até\s*)([\d/﻿]+)/gi, (m, a, d) => d.replace(/﻿/g, '') === data ? m : (rel.pretextuais.push(`atualizada até ${d} → ${data}`), a + data))
    if (novo !== xml) zip.file(n, novo)
  }

  const saida = new JSZip()
  saida.file('mimetype', await ler('mimetype'), { compression: 'STORE' })
  for (const n of Object.keys(zip.files)) {
    if (n === 'mimetype' || zip.files[n].dir) continue
    saida.file(n, await zip.file(n).async('uint8array'))
  }
  rel.paginas = total
  const idml = await saida.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' })
  return { idml, relatorio: rel }
}
