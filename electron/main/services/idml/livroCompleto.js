/**
 * livroCompleto.js — documento completo de um livro que reaproveita o InDesign da edição anterior
 * (ex.: CF). As pré-textuais, as partes mantidas (emendas anteriores, tratados, índice remissivo) e
 * os estilos ficam como no IDML do livro; as partes geradas vêm da paginação do Normando (o mesmo
 * plano do IDML ajustado), e as novas emendas entram no fim da parte das emendas.
 *
 * A ação de cada parte vem da "exportação" da norma correspondente, como em atualizarEdicao.js:
 *   • completa    → parte gerada pelo Normando (a abertura do livro fica no lugar da epígrafe);
 *   • atualizacao → o que ainda não está na parte é acrescentado no fim dela;
 *   • ignorar     → parte mantida (também as partes sem norma, como o índice).
 * As partes geradas têm de ser as primeiras do texto principal, em sequência.
 *
 * O plano tem de ser feito com os estilos do livro (`modeloDoLivro`), e os títulos das aberturas
 * entram na composição (`publicacaoDoLivro`): é o que garante que o plano vale para este documento.
 * O IDML não diz em que página cai cada parte: `paginasPartes` vem do InDesign.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { storyXml, paragrafosDaPublicacao, paragrafosXml, novoRelatorio } from './historia.js'
import { aplicarDecisoes } from './decisoesIdml.js'
import { prepararPublicacao } from './exportIdml.js'
import { filhos, attr, setAttr, normalizar, textoDoXml } from './atualizarEdicao.js'
import { aplicarPretextuaisDoLivro } from './pretextuaisLivro.js'
import { excecoesNoDesignmap } from '../pdf/hifenizacaoExcecoes.js'

const STORY = 'nmiolo'
const FOLGA_SPREADS = 208.3         // entre um spread e o seguinte no pasteboard
// caracteres por página do miolo (calibrado no legised 8ª ed., corpo 9,5/13,25 em 371 × 629 pt)
const CARACTERES_POR_PAGINA = 3950
const ABERTURA = /tit-subtit%3aabertura-cap/
// epígrafe de norma (livro sem aberturas): não o apelido nem a do anexo
const EPIGRAFE = /tit-subtit%3aepigrafe(-quebra)?(?=")/
const EPIGRAFE_ESTILO = /tit-subtit%3aepigrafe(-quebra)?$/
// títulos que podem ter entrada no sumário; no livro dividido pelas epígrafes (Regimento), também a
// epígrafe de cada norma
const ENTRADA_SUMARIO = /^tit-subtit:(abertura-cap|parte-livro-tit-cap|secao-subsecao)/
const ENTRADA_SUMARIO_EPIGRAFE = /^tit-subtit:(abertura-cap|parte-livro-tit-cap|secao-subsecao|epigrafe$|epigrafe-quebra$)/

const decodificar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

// BOM (U+FEFF) e caracteres de controle (marca de nota de rodapé) que o InDesign deixa nos títulos
const INVISIVEIS = new RegExp(`[${String.fromCharCode(0xfeff)}${String.fromCharCode(0)}-${String.fromCharCode(8)}]`, 'g')

/**
 * Partes de uma história: do parágrafo de abertura até o próximo. No modo epígrafe (livro sem
 * aberturas, como o Regimento), a parte começa na epígrafe de uma norma (`aceitar`): outras epígrafes
 * dentro da norma ("REGIMENTO INTERNO DA CÂMARA DOS DEPUTADOS", depois da resolução) ficam nela.
 */
function partesDaHistoria(xml, { modo = 'abertura', aceitar = () => true } = {}) {
  const iCorpo = xml.indexOf('>', xml.indexOf('<Story ')) + 1
  const fim = xml.lastIndexOf('</Story>')
  const psrs = filhos(xml, iCorpo, fim).filter(e => e.tag === 'ParagraphStyleRange')
  const tituloDe = k => decodificar(textoDoXml(xml.slice(psrs[k].inicio, psrs[k].fim))).replace(INVISIVEIS, '').split('\n').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const inicios = psrs.flatMap((p, k) => modo === 'abertura'
    ? (ABERTURA.test(p.abertura) ? [k] : [])
    : (EPIGRAFE_ESTILO.test(attr(p.abertura, 'AppliedParagraphStyle')) && aceitar(tituloDe(k)) ? [k] : []))
  if (inicios[0] !== 0) {
    throw new Error(modo === 'abertura' ? 'O texto principal do livro não começa numa abertura de parte.'
      : 'O texto principal do livro não começa na epígrafe de uma norma da publicação.')
  }
  const partes = inicios.map((k, n) => {
    const ate = n + 1 < inicios.length ? inicios[n + 1] : psrs.length
    const abertura = xml.slice(psrs[k].inicio, psrs[k].fim)
    return {
      titulo: decodificar(textoDoXml(abertura)).replace(/\uFEFF/g, '').split('\n').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      estilo: decodeURIComponent(attr(psrs[k].abertura, 'AppliedParagraphStyle').replace('ParagraphStyle/', '')),
      char: abertura.match(/AppliedCharacterStyle="CharacterStyle\/(parte1)"/)?.[1] ?? null,
      inicio: psrs[k].inicio,
      fim: psrs[ate - 1].fim,
    }
  })
  return { partes, iCorpo, fim }
}

/**
 * Texto do livro dividido nas aberturas de parte. O texto principal é a maior história; a CF de
 * bolso tem a Constituição numa história à parte, antes dele (some junto com as páginas geradas).
 * Sem aberturas (Regimento), as partes são as normas, pela epígrafe: `titulos` são as epígrafes das
 * normas da publicação (sem eles, toda epígrafe abre uma parte).
 */
async function lerPartes(zip, { titulos = null } = {}) {
  const designmap = await zip.file('designmap.xml').async('string')
  const historias = [], todas = []
  for (const m of designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)) {
    const xml = await zip.file(m[1]).async('string')
    todas.push({ arquivo: m[1], xml })
    if (ABERTURA.test(xml)) historias.push({ arquivo: m[1], xml })
  }
  let modo = 'abertura', aceitar
  if (!historias.length) {
    // livro sem aberturas: o texto principal é a maior história, dividido nas epígrafes das normas
    modo = 'epigrafe'
    const maior = todas.sort((a, b) => b.xml.length - a.xml.length)[0]
    if (!maior || !EPIGRAFE.test(maior.xml)) throw new Error('O IDML do livro não tem aberturas de parte (tit-subtit:abertura-cap…) nem epígrafes de norma.')
    historias.push(maior)
    const lista = titulos ? new Set(titulos.map(normalizar)) : null
    aceitar = t => !lista || lista.has(normalizar(t))
  }
  historias.sort((a, b) => b.xml.length - a.xml.length)
  const [principal, ...outras] = historias
  const { xml } = principal
  const { partes, iCorpo, fim } = partesDaHistoria(xml, { modo, aceitar })
  const antes = outras.flatMap(h => partesDaHistoria(h.xml).partes.map(p => ({ ...p, outraHistoria: true })))
  return { modo, designmap, principal, partes: [...antes, ...partes], cabeca: xml.slice(0, iCorpo), rabo: xml.slice(fim), id: xml.match(/<Story Self="([^"]+)"/)[1] }
}

/**
 * Normas da publicação que estão no livro, quando ele é dividido pelas epígrafes (Regimento): só
 * elas são geradas; as outras ficam de fora (o livro de bolso tem só as normas principais).
 * `modo` 'abertura' (CF): a escolha é por tipo de norma (livroBase.js).
 */
export async function normasDoLivro(baseBytes, publicacao) {
  const zip = await JSZip.loadAsync(baseBytes)
  const normas = normasDe(publicacao)
  const { modo, partes } = await lerPartes(zip, { titulos: normas.map(n => n.epigrafe).filter(Boolean) })
  const noLivro = new Set(partes.map(p => normalizar(p.titulo)))
  return { modo, ids: new Set(normas.filter(n => noLivro.has(normalizar(n.epigrafe))).map(n => n.id)) }
}

/** Parte do livro que corresponde a uma norma: título igual ganha; senão, o maior começo em comum. */
function parteDaNorma(partes, titulo) {
  const t = normalizar(titulo)
  let melhor = null, pontos = 0
  for (const p of partes) {
    const x = normalizar(p.titulo)
    const pt = x === t ? 1e4 : t.startsWith(x) || x.startsWith(t) ? Math.min(x.length, t.length) : 0
    if (pt > pontos && pt >= 8) { pontos = pt; melhor = p }
  }
  return melhor
}

const normasDe = publicacao => (publicacao.secoes || []).flatMap(s => s.normas || [])

/**
 * Publicação só com o que o Normando gera: as normas "completa", com a abertura do livro no lugar
 * da epígrafe, para o plano compor o mesmo título, no mesmo estilo. `parte` fica na norma.
 */
export async function publicacaoDoLivro(baseBytes, publicacao, { paginasPartes = null } = {}) {
  const titulos = normasDe(publicacao).filter(n => n.exportacao === 'completa').map(n => n.epigrafe).filter(Boolean)
  const zipLivro = await JSZip.loadAsync(baseBytes)
  const { partes, modo, principal } = await lerPartes(zipLivro, { titulos })
  // livro dividido pelas epígrafes (Regimento): cabeço como no livro — o texto em `parte1` de cada
  // norma e, na página ímpar, o artigo ou o título conforme a mestra da página onde a norma começa
  const comArtigo = modo === 'epigrafe' && paginasPartes ? await cabecoArtigoPorPagina(zipLivro) : null
  // página do livro onde começa cada norma da publicação
  const inicios = normasDe(publicacao).filter(n => n.exportacao === 'completa').map(n => {
    const p = parteDaNorma(partes, n.epigrafe)
    return p ? Number(paginasPartes?.find(x => normalizar(x.titulo) === normalizar(p.titulo))?.pagina) : NaN
  }).filter(Number.isFinite)
  const secoes = (publicacao.secoes || []).map(secao => ({
    ...secao,
    normas: (secao.normas || []).flatMap(norma => {
      if (norma.exportacao !== 'completa') return []
      const parte = parteDaNorma(partes, norma.epigrafe)
      if (!parte) throw new Error(`"${norma.epigrafe}" não corresponde a nenhuma parte do livro.`)
      const doc = JSON.parse(norma.conteudo_doc || '{}')
      const i = (doc.content || []).findIndex(b => b.type === 'epigrafe')
      if (i >= 0 && modo === 'epigrafe') {
        // a epígrafe é a da própria norma; do livro vem só o estilo (ex.: epigrafe-quebra)
        const pagina = paginasPartes?.find(x => normalizar(x.titulo) === normalizar(parte.titulo))?.pagina
        // a mestra da maioria das páginas da norma (da 1ª até a véspera da norma seguinte): a página
        // onde ela começa pode ser ainda a do fim da norma anterior, com a mestra dela
        let cabModo = null
        if (comArtigo && pagina != null) {
          const ini = Number(pagina)
          // (a norma seguinte da publicação — não a parte seguinte do livro: o título "Código de Ética"
          // é uma parte dentro da Resolução nº 25 de 2001)
          const prox = Math.min(...inicios.filter(p => p > ini), Infinity)
          let sim = 0, nao = 0
          for (let p = ini; p < Math.min(prox, ini + 2000); p++) { if (!comArtigo.has(p)) break; if (comArtigo.get(p)) sim++; else nao++ }
          cabModo = sim === nao ? (comArtigo.get(ini) ? 'artigo' : 'titulo') : sim > nao ? 'artigo' : 'titulo'
        }
        doc.content[i] = { ...doc.content[i], attrs: { ...doc.content[i].attrs, estiloIdml: parte.estilo, ...(cabModo ? { cabModo } : {}) } }
        marcarParte1(doc, parte1DoLivro(principal.xml.slice(parte.inicio, parte.fim)))
      } else if (i >= 0) {
        doc.content[i] = {
          ...doc.content[i],
          attrs: { ...doc.content[i].attrs, estiloIdml: parte.estilo },
          content: [{ type: 'text', text: parte.titulo, char: parte.char }],
        }
      }
      return [{ ...norma, conteudo_doc: JSON.stringify(doc) }]
    }),
  }))
  return { ...publicacao, secoes }
}

/** Primeiro texto em `parte1` (o que a variável do cabeço lê) num trecho da história do livro. */
function parte1DoLivro(xml) {
  for (const m of xml.matchAll(/<CharacterStyleRange AppliedCharacterStyle="CharacterStyle\/parte1"[^>]*>([\s\S]*?)<\/CharacterStyleRange>/g)) {
    const t = decodificar([...m[1].matchAll(/<Content>([^<]*)<\/Content>/g)].map(c => c[1]).join('')).replace(INVISIVEIS, '').replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return null
}

/**
 * Põe `parte1` no trecho do título da norma que o livro usa no cabeço (ex.: "Código de Ética e
 * Decoro Parlamentar", sem os parênteses do apelido). Procura no apelido e nas epígrafes; sem o
 * trecho do livro, vale o apelido (sem parênteses) ou a 1ª epígrafe inteira.
 */
function marcarParte1(doc, alvo) {
  const blocos = (doc.content || []).filter(b => b.type === 'epigrafeApelido' || b.type === 'epigrafe')
  const textoDe = b => (b.content || []).map(n => n.type === 'text' ? n.text || '' : '').join('')
  const marcarTudo = b => {
    for (const n of b.content || []) if (n.type === 'text' && n.text?.trim()) n.char = 'parte1'
    // parênteses do apelido ficam fora do cabeço
    const nos = (b.content || []).filter(n => n.type === 'text')
    const ini = nos[0], fim = nos.at(-1)
    if (ini?.text?.startsWith('(')) { b.content.splice(b.content.indexOf(ini), 0, { type: 'text', text: '(' }); ini.text = ini.text.slice(1) }
    if (fim?.text?.endsWith(')')) { b.content.splice(b.content.indexOf(fim) + 1, 0, { type: 'text', text: ')' }); fim.text = fim.text.slice(0, -1) }
  }
  if (alvo) {
    const a = normalizar(alvo)
    for (const b of blocos) {
      if (normalizar(textoDe(b)) === a) { marcarTudo(b); return }
      // o trecho dentro de um texto do bloco ("Código de Ética e Decoro Parlamentar" no apelido)
      for (let k = 0; k < (b.content || []).length; k++) {
        const n = b.content[k]
        if (n.type !== 'text' || !n.text) continue
        const j = n.text.toLocaleLowerCase('pt-BR').indexOf(alvo.toLocaleLowerCase('pt-BR'))
        if (j < 0) continue
        const partes = [n.text.slice(0, j), n.text.slice(j, j + alvo.length), n.text.slice(j + alvo.length)]
        b.content.splice(k, 1, ...partes.map((t, q) => t ? { ...n, text: t, ...(q === 1 ? { char: 'parte1' } : {}) } : null).filter(Boolean))
        return
      }
    }
  }
  const apelido = blocos.find(b => b.type === 'epigrafeApelido')
  if (apelido || blocos[0]) marcarTudo(apelido || blocos[0])
}

/** Página (nome) → a mestra dela tem o cabeço do artigo (pg-mestra:cab-art). */
async function cabecoArtigoPorPagina(zip) {
  const designmap = await zip.file('designmap.xml').async('string')
  const mestrasComArtigo = new Set()
  for (const m of designmap.matchAll(/<idPkg:MasterSpread src="([^"]+)"/g)) {
    const xml = await zip.file(m[1]).async('string')
    for (const t of xml.matchAll(/<TextFrame Self="[^"]+" ParentStory="([^"]+)"/g)) {
      const historia = await zip.file(`Stories/Story_${t[1]}.xml`)?.async('string').catch(() => '') || ''
      if (/AppliedParagraphStyle="ParagraphStyle\/pg-mestra%3acab-art"/.test(historia)) mestrasComArtigo.add(xml.match(/<MasterSpread Self="([^"]+)"/)[1])
    }
  }
  const mapa = new Map()
  for (const m of designmap.matchAll(/<idPkg:Spread src="([^"]+)"/g)) {
    const s = lerSpread(m[1], await zip.file(m[1]).async('string'))
    for (const p of s.paginas) mapa.set(Number(p.nome), mestrasComArtigo.has(attr(p.xml.slice(0, p.xml.indexOf('>')), 'AppliedMaster')))
  }
  return mapa
}

/**
 * Pasta de modelo para o plano: o modelo do Normando com os estilos do livro por cima (o que o
 * livro não tem, como a nota de rodapé, fica como no modelo). O compositor lê os estilos daqui.
 */
export async function modeloDoLivro(baseBytes, pastaModelo, destino, { paginasPreTextuais }) {
  const livro = await JSZip.loadAsync(baseBytes)
  const zip = await JSZip.loadAsync(readFileSync(join(pastaModelo, 'modelo.idml')))
  const estilosLivro = await livro.file('Resources/Styles.xml').async('string')
  let estilos = await zip.file('Resources/Styles.xml').async('string')
  const novos = []
  for (const tag of ['ParagraphStyle', 'CharacterStyle']) {
    for (const m of estilosLivro.matchAll(new RegExp(`<${tag} Self="([^"]+)"[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))) {
      const self = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const atual = new RegExp(`<${tag} Self="${self}"[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`)
      if (atual.test(estilos)) estilos = estilos.replace(atual, () => m[0])
      else if (tag === 'ParagraphStyle') novos.push(m[0])
    }
  }
  estilos = estilos.replace('</RootParagraphStyleGroup>', () => novos.join('\n') + '\n</RootParagraphStyleGroup>')
  // piso próprio do formato: só no plano; no IDML vai por parágrafo, para não mexer nas partes mantidas
  const f = await formatoDoLivro(baseBytes)
  if (f.espacoMinimo) estilos = estilos.replace(/<ParagraphStyle Self="ParagraphStyle\/corpo-legis[^>]*>/g, t => setAttr(t, 'MinimumWordSpacing', String(f.espacoMinimo)))
  zip.file('Resources/Styles.xml', estilos)
  mkdirSync(destino, { recursive: true })
  writeFileSync(join(destino, 'modelo.idml'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const cfg = JSON.parse(readFileSync(join(pastaModelo, 'modelo.json'), 'utf8'))
  writeFileSync(join(destino, 'modelo.json'), JSON.stringify({ ...cfg, paginasPreTextuais }, null, 2))
  for (const sub of ['Document fonts', 'Links']) {
    const de = join(pastaModelo, sub)
    if (existsSync(de)) cpSync(de, join(destino, sub), { recursive: true })
  }
  return destino
}

/**
 * Formato do livro, tirado do IDML: página, margens, corpo e entrelinha do texto e, quando a mestra
 * não é a do modelo, posição do fólio e dos cabeços (mestra da 1ª página do miolo).
 */
export async function formatoDoLivro(baseBytes) {
  const zip = await JSZip.loadAsync(baseBytes)
  const ler = n => zip.file(n).async('string')
  const pref = await ler('Resources/Preferences.xml')
  const dp = pref.match(/<DocumentPreference [^>]*>/)[0]
  const largura = Number(attr(dp, 'PageWidth')), altura = Number(attr(dp, 'PageHeight'))
  const estilos = await ler('Resources/Styles.xml')
  const estilo = nome => {
    const m = estilos.match(new RegExp(`<ParagraphStyle Self="ParagraphStyle/${nome}"([^>]*)>([\\s\\S]*?)</ParagraphStyle>`))
    return { corpo: Number(attr(m?.[1] || '', 'PointSize')) || null, tinta: Number(attr(m?.[1] || '', 'FillTint')) || null, tracking: Number(attr(m?.[1] || '', 'Tracking')) || 0, entrelinha: Number(m?.[2].match(/<Leading type="unit">([\d.]+)</)?.[1]) || null, baseado: m?.[2].match(/<BasedOn[^>]*>ParagraphStyle\/([^<]+)</)?.[1] }
  }
  const texto = estilo('corpo-legis%3atexto-lei')
  const designmap = await ler('designmap.xml')
  const mestras = [...designmap.matchAll(/<idPkg:MasterSpread src="([^"]+)"/g)].map(m => m[1])
  const xml = await ler(mestras[0])
  const margem = xml.match(/<MarginPreference [^>]*>/)[0]
  const f = { largura, altura, topo: Number(attr(margem, 'Top')), baixo: Number(attr(margem, 'Bottom')), dentro: Number(attr(margem, 'Left')), fora: Number(attr(margem, 'Right')), linha: texto.entrelinha || 13.25, corpo: texto.corpo || 9.5, cabeco: null }
  if (Math.abs(largura - 481.89) < 1) return f
  // versões de bolso: coluna estreita, mínimo menor na última linha (regra do usuário, sem exceção)
  if (largura < 400) {
    f.ultimaLinha = 5
    // última linha: ocupação mínima da largura (10–13% conforme o nº de linhas) e, se não der, os
    // caracteres, +1 quando são só de nota (corpo menor) (usuário, 2026-11-10)
    f.ultimaOcupacao = true
    f.notaMaisUm = true
    f.ultimaComplexa = 5
    // medido nas linhas "apertado leve" do diagramador: palavras em 78%, tracking até −16, espaço
    // visível a partir de 70%
    f.espacoMinimo = 78
    f.limiteAperto = 0.70
    f.apertada = 0.70
    f.ajustesExtra = [[-0.014, 97], [-0.016, 97]]
    // espaço visível do compositor (≈ 4 pontos mais folgado que o InDesign): 74% ≈ 70% no InDesign.
    // Com 74% uma linha do Regimento de bolso (Res. 1/2006-CN) não coube no InDesign e, sem página
    // mantida no meio para absorver, empurrou o resto do livro: 75% dá um ponto de folga (2026-11-10)
    f.visivelMinimo = 0.75
    f.soltarNbsp = true
    // epígrafe nova com menos de meia mancha livre na página: começa na página seguinte
    f.epigrafeMetade = true
  }
  // GREP dos estilos do texto (o que muda a largura das linhas)
  f.grep = {}
  for (const m of estilos.matchAll(/<ParagraphStyle Self="ParagraphStyle\/(corpo-legis[^"]+)"[^>]*>([\s\S]*?)<\/ParagraphStyle>/g)) {
    const lista = [...m[2].matchAll(/CharacterStyle\/([^<]*)<\/AppliedCharacterStyle>\s*<GrepExpression type="string">([^<]*)</g)]
      .filter(g => g[1] !== 'nao-hifenizar').map(g => ({ char: g[1], expressao: decodificar(g[2]) }))
    if (lista.length) f.grep[decodeURIComponent(m[1])] = lista
  }
  // quadros de fólio e cabeço de uma mestra, em coordenadas da página (origem no canto superior esquerdo)
  const quadrosDe = async xmlMestra => {
    const quadros = {}
    for (const t of xmlMestra.matchAll(/<TextFrame Self="[^"]+" ParentStory="([^"]+)"[^>]*>[\s\S]*?<\/TextFrame>/g)) {
      const historia = await ler(`Stories/Story_${t[1]}.xml`).catch(() => '')
      const nome = historia.match(/AppliedParagraphStyle="ParagraphStyle\/pg-mestra%3a([^"]+)"/)?.[1]
      if (!nome) continue
      const it = attr(t[0].slice(0, t[0].indexOf('>')), 'ItemTransform').split(' ').map(Number)
      const a = [...t[0].match(/<PathPointArray>[\s\S]*?<\/PathPointArray>/)[0].matchAll(/Anchor="([-\d.e]+) ([-\d.e]+)"/g)].map(m => [Number(m[1]) + it[4], Number(m[2]) + it[5]])
      const x0 = Math.min(...a.map(p => p[0])), x1 = Math.max(...a.map(p => p[0])), y0 = Math.min(...a.map(p => p[1])), y1 = Math.max(...a.map(p => p[1]))
      quadros[nome] = { x: x0 < 0 ? x0 + largura : x0, y: y0 + altura / 2, w: x1 - x0, h: y1 - y0 }
    }
    return quadros
  }
  const quadros = await quadrosDe(xml)
  // mestra das normas com cabeço de título (Regimento: "B", sem o quadro do artigo): o quadro do
  // título à direita é o dela — o "cab-dir" da 1ª mestra pode estar em outro lugar
  // (sem nenhum quadro de cabeço na ímpar, a página ímpar dessas normas fica sem cabeço)
  let quadroTitulo = null, tituloVazio = false
  for (const m of mestras.slice(1)) {
    const q = await quadrosDe(await ler(m))
    if (q['cab-art']) continue
    if (q['cab-dir']) { quadroTitulo = q['cab-dir']; break }
    tituloVazio = true
    break
  }
  const num = estilo('pg-mestra%3anum-par')
  const c = n => ({ ...estilo(`pg-mestra%3a${n}`), quadro: quadros[n] })
  f.cabeco = {
    folio: { corpo: num.corpo || 8, tinta: num.tinta || 70, impar: { ...quadros['num-impar'], alinhar: 'right' }, par: { ...quadros['num-par'], alinhar: 'left' } },
    esquerda: c('cab-esq'), artigo: c('cab-art'), direita: c('cab-dir'),
    ...(quadroTitulo ? { titulo: { ...estilo('pg-mestra%3acab-dir'), quadro: quadroTitulo } } : {}),
    ...(tituloVazio ? { tituloVazio: true } : {}),
  }
  return f
}

/** Última página (nome) com quadro da história `id`. */
async function ultimaPaginaDaHistoria(zip, designmap, id) {
  let ultima = null
  for (const m of designmap.matchAll(/<idPkg:Spread src="([^"]+)"/g)) {
    const s = lerSpread(m[1], await zip.file(m[1]).async('string'))
    for (const p of s.paginas) {
      if (p.itens.some(i => /^<TextFrame\b/.test(i) && attr(i.slice(0, i.indexOf('>')), 'ParentStory') === id)) ultima = Math.max(ultima ?? 0, Number(p.nome))
    }
  }
  if (ultima == null) throw new Error('O texto principal do livro não está em nenhuma página.')
  return ultima
}

/** Páginas e itens de um spread: páginas em ordem, cada item na página pelo centro horizontal. */
function lerSpread(arquivo, xml) {
  const iC = xml.indexOf('>', xml.indexOf('<Spread ')) + 1
  const els = filhos(xml, iC, xml.lastIndexOf('</Spread>'))
  const paginas = els.filter(e => e.tag === 'Page').map(e => {
    const tx = Number((attr(e.abertura, 'ItemTransform') || '1 0 0 1 0 0').split(' ')[4])
    return { arquivo, nome: Number(attr(e.abertura, 'Name')), xml: xml.slice(e.inicio, e.fim), lado: tx < -1 ? 'e' : 'd', itens: [] }
  })
  const outros = []
  for (const e of els) {
    if (e.tag === 'Page') continue
    const ixml = xml.slice(e.inicio, e.fim)
    if (e.tag === 'FlattenerPreference') { outros.push(ixml); continue }
    const t = (attr(e.abertura, 'ItemTransform') || '1 0 0 1 0 0').split(' ').map(Number)
    const xs = [...ixml.matchAll(/Anchor="([-\d.e]+) ([-\d.e]+)"/g)].map(a => Number(a[1]) * t[0] + t[4])
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : t[4]
    const alvo = paginas.length === 1 ? paginas[0] : (paginas.find(p => (cx < 0) === (p.lado === 'e')) || paginas[0])
    alvo.itens.push(ixml)
  }
  return { arquivo, cabeca: xml.slice(0, xml.indexOf('<Spread ')), tag: xml.match(/<Spread [^>]*>/)[0], outros, paginas }
}

const xmlSpread = (s, paginas) => {
  const tag = setAttr(setAttr(s.tag, 'PageCount', String(paginas.length)), 'BindingLocation', paginas.length === 2 || paginas[0].lado === 'e' ? '1' : '0')
  return s.cabeca + tag + '\n' + s.outros.join('\n') + '\n' + paginas.map(p => p.xml).join('\n') + '\n' + paginas.flatMap(p => p.itens).join('\n') + '\n</Spread>\n</idPkg:Spread>\n'
}

/**
 * @param baseBytes  IDML do livro (exportado do InDesign)
 * @param publicacao publicação inteira (secoes[].normas[] com conteudo_doc e exportacao)
 * @param opcoes     { sessao: paginação de publicacaoDoLivro, paginasPartes: [{ titulo, pagina, anterior }] }
 * @returns { idml, relatorio, paginacao: { primeiraPagina, paginas, paragrafos } }
 */
export async function gerarLivroCompleto(baseBytes, publicacao, opcoes) {
  const { sessao, paginasPartes } = opcoes
  const zip = await JSZip.loadAsync(baseBytes)
  const ler = n => zip.file(n).async('string')
  const rel = { ...novoRelatorio(), partes: [], avisos: [], pretextuais: [] }
  const base = await lerPartes(zip, { titulos: normasDe(publicacao).filter(n => n.exportacao !== 'ignorar').map(n => n.epigrafe).filter(Boolean) })
  let { designmap } = base
  const { partes, principal, id: idPrincipal } = base
  const versao = designmap.match(/DOMVersion="([^"]+)"/)?.[1] || '21.5'

  // ── ação de cada parte ────────────────────────────────────────
  const preparadas = prepararPublicacao(publicacao).secoes.flatMap(s => s.normas)
  for (const n of normasDe(publicacao)) {
    const parte = parteDaNorma(partes.filter(p => !p.norma), n.epigrafe)
    if (!parte) {
      if (n.exportacao !== 'ignorar') rel.avisos.push(`"${n.epigrafe}" não corresponde a nenhuma parte do livro: ficou de fora.`)
      continue
    }
    parte.norma = preparadas.find(x => x.id === n.id)
    parte.acao = n.exportacao === 'completa' ? 'gerar' : n.exportacao === 'atualizacao' ? 'acrescentar' : 'manter'
  }
  for (const p of partes) {
    p.acao ||= 'manter'
    p.pagina = paginasPartes.find(x => normalizar(x.titulo).startsWith(normalizar(p.titulo).slice(0, 40)))
    if (!p.pagina) throw new Error(`Sem a página da parte "${p.titulo}".`)
  }
  const geradas = partes.filter(p => p.acao === 'gerar')
  const nGeradas = geradas.length
  if (!nGeradas || partes.slice(0, nGeradas).some(p => p.acao !== 'gerar')) throw new Error('As partes geradas têm de ser as primeiras do texto principal.')
  // texto principal todo gerado (Regimento de bolso): depois dele, só as páginas finais (colofão)
  const todasGeradas = nGeradas === partes.length
  const primeira = Number(partes[0].pagina.pagina)
  const primeiraMantida = todasGeradas ? await ultimaPaginaDaHistoria(zip, designmap, idPrincipal) + 1 : Number(partes[nGeradas].pagina.pagina)
  if (primeira % 2 === 0) throw new Error('A 1ª parte gerada tem de começar em página ímpar.')
  const f = await formatoDoLivro(baseBytes)
  const LARG = f.largura, ALT = f.altura, ESPACO_SPREADS = ALT + FOLGA_SPREADS

  // ── plano e story do Normando ─────────────────────────────────
  const d = aplicarDecisoes(sessao)
  const estilosXml = await ler('Resources/Styles.xml')
  const existentes = new Set([...estilosXml.matchAll(/<ParagraphStyle Self="([^"]+)"/g)].map(m => m[1]))
  zip.file(`Stories/Story_${STORY}.xml`, storyXml(STORY, d.pars, { versao, estilosExistentes: existentes, rel }))
  // página do plano em que muda a mestra: a 2ª parte gerada em diante segue a mestra dela
  const inicioParte = geradas.slice(1).map(p => {
    const k = d.pars.findIndex(x => x.estilo === p.estilo && normalizar(x.runs?.map(r => r.texto ?? '').join('')) === normalizar(p.titulo))
    return d.esperado.find(e => e.par === k)?.pagina ?? null
  })
  // as páginas mantidas não trocam de lado: se preciso, uma página em branco no fim do plano
  const paginasPlano = d.paginas + (d.paginas + primeiraMantida - primeira) % 2

  // ── novas emendas no fim da parte ─────────────────────────────
  let acrescimo = null
  partes.forEach((p, i) => {
    if (p.acao !== 'acrescentar') { rel.partes.push({ titulo: p.titulo, acao: p.acao === 'gerar' ? 'gerada' : 'mantida' }); return }
    const ja = normalizar(textoDoXml(principal.xml.slice(p.inicio, p.fim)))
    const grupos = []
    for (const b of p.norma.doc?.content || []) {
      if (b.type === 'epigrafe' || !grupos.length) grupos.push([])
      grupos[grupos.length - 1].push(b)
    }
    const titulo = g => (g[0]?.content || []).map(c => c.text || '').join('')
    const novos = grupos.filter(g => g[0]?.type === 'epigrafe' && normalizar(titulo(g)) !== normalizar(p.titulo) && !ja.includes(normalizar(titulo(g))))
    const pars = paragrafosDaPublicacao({ secoes: [{ titulo: '', normas: [{ ...p.norma, doc: { ...p.norma.doc, content: novos.flat() }, pular: false }] }] }, { cabecalho: 'secao' }, rel)
    const xml = pars.length ? paragrafosXml(pars, { rel, estilosExistentes: existentes, terminarComBr: true }) : ''
    const seguinte = partes[i + 1]
    if (!seguinte) throw new Error(`A parte "${p.titulo}" é a última: não há como saber onde ela termina.`)
    const caracteres = textoDoXml(xml).length
    const porPagina = CARACTERES_POR_PAGINA * (f.largura - f.dentro - f.fora) / 371.3 * (9.5 / f.corpo) * (f.altura - f.topo - f.baixo) / 629.3 * (13.25 / f.linha)
    const paginas = Math.ceil(caracteres / porPagina / 2) * 2
    if (pars.length) acrescimo = { apos: Number(seguinte.pagina.anterior), fim: seguinte.pagina.fim ?? null, xml, paginas, posicao: p.fim, norma: p.norma, blocos: novos.flat(), titulo: p.titulo }
    rel.partes.push({ titulo: p.titulo, acao: 'acrescida', emendas: novos.map(titulo), paginas })
  })

  // ── texto mantido ─────────────────────────────────────────────
  // (texto todo gerado: a história do livro fica vazia e sai junto com os quadros dela)
  const inicioMantido = todasGeradas ? partes.at(-1).fim : partes[nGeradas].inicio
  // a parte depois do acréscimo tem de cair no mesmo lado do livro: os quadros seguintes são os dela
  const depois = acrescimo && principal.xml.slice(acrescimo.posicao, partes.at(-1).fim).replace(/<ParagraphStyleRange [^>]*>/, t => {
    const seguinte = partes.find(p => p.inicio >= acrescimo.posicao)
    return setAttr(t, 'StartParagraph', Number(seguinte.pagina.pagina) % 2 ? 'NextOddPage' : 'NextEvenPage')
  })
  const mantido = acrescimo
    ? principal.xml.slice(inicioMantido, acrescimo.posicao) + '\n' + acrescimo.xml + depois
    : principal.xml.slice(inicioMantido, partes.at(-1).fim)
  zip.file(principal.arquivo, base.cabeca + mantido + '\n' + base.rabo)

  // ── páginas ───────────────────────────────────────────────────
  const arquivos = [...designmap.matchAll(/<idPkg:Spread src="([^"]+)"/g)].map(m => m[1])
  const spreads = []
  for (const a of arquivos) spreads.push(lerSpread(a, await ler(a)))
  const paginaDe = n => spreads.flatMap(s => s.paginas).find(p => p.nome === n)
  const ehPrincipal = i => /^<TextFrame\b/.test(i) && attr(i.slice(0, i.indexOf('>')), 'ParentStory') === idPrincipal
  const ultimaGerada = primeiraMantida - 1

  // mestras: a da 1ª página de cada parte gerada; a camada e o modelo de página, do próprio livro
  const mestras = geradas.map(p => attr(paginaDe(Number(p.pagina.pagina)).xml.slice(0, paginaDe(Number(p.pagina.pagina)).xml.indexOf('>')), 'AppliedMaster'))
  const amostra = paginaDe(primeira)
  const camada = attr(amostra.itens.find(i => /^<TextFrame\b/.test(i)), 'ItemLayer')
  const margem = amostra.xml.match(/<MarginPreference [^>]*>/)[0]
  const ler1 = k => Number(margem.match(new RegExp(`\\b${k}="([^"]+)"`))[1])
  const geo = { top: ler1('Top'), bottom: ler1('Bottom'), dentro: ler1('Left'), fora: ler1('Right') }

  const novaPagina = (id, lado, mestra) => {
    const x = lado === 'd' ? 0 : -LARG
    let tag = amostra.xml.slice(0, amostra.xml.indexOf('>') + 1)
    tag = setAttr(setAttr(setAttr(setAttr(setAttr(tag, 'Self', id), 'ItemTransform', `1 0 0 1 ${x} -${ALT / 2}`), 'OverrideList', ''), 'AppliedMaster', mestra), 'Name', id)
    return tag + amostra.xml.slice(amostra.xml.indexOf('>') + 1)
  }
  const quadro = (id, lado, ant, prox, story) => {
    const y0 = -ALT / 2 + geo.top, y1 = ALT / 2 - geo.bottom
    const x0 = lado === 'd' ? geo.dentro : -LARG + geo.fora
    const x1 = lado === 'd' ? LARG - geo.fora : -geo.dentro
    const ponto = (x, y) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}" />`
    return `<TextFrame Self="${id}" ParentStory="${story}" PreviousTextFrame="${ant}" NextTextFrame="${prox}" ` +
      `ContentType="TextType" ItemLayer="${camada}" Locked="false" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" Visible="true" Name="$ID/" ItemTransform="1 0 0 1 0 0">` +
      `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>` +
      ponto(x0, y0) + ponto(x0, y1) + ponto(x1, y1) + ponto(x1, y0) +
      `</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
      `<TextFramePreference TextColumnCount="1" TextColumnFixedWidth="${x1 - x0}" TextColumnMaxWidth="0">` +
      `<Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties>` +
      `</TextFramePreference></TextFrame>`
  }

  // páginas do plano: k = 1…paginasPlano; a 1ª é ímpar
  const novas = []
  for (let k = 1; k <= paginasPlano; k++) {
    const lado = k % 2 === 1 ? 'd' : 'e'
    const iMestra = inicioParte.filter(p => p != null && k > p).length   // p conta de 0
    const pg = { lado, xml: novaPagina(`npg${k}`, lado, mestras[iMestra]), itens: [] }
    if (k <= d.paginas) pg.itens.push(quadro(`ntf${k}`, lado, k === 1 ? 'n' : `ntf${k - 1}`, k === d.paginas ? 'n' : `ntf${k + 1}`, STORY))
    novas.push(pg)
  }

  // spreads refeitos: o que tem páginas geradas sai; nas bordas, a página do livro fica
  const removidos = []
  const lista = []     // { arquivo, xml } em ordem
  let fila = [...novas]
  const modeloSpread = spreads.find(s => s.paginas.some(p => p.nome === primeira))
  let seq = 0
  const spreadNovo = paginas => {
    const s = { ...modeloSpread, outros: modeloSpread.outros, tag: setAttr(modeloSpread.tag, 'Self', `nls${(++seq).toString(36)}`) }
    return { arquivo: `Spreads/Spread_nls${seq.toString(36)}.xml`, novo: true, xml: xmlSpread(s, paginas) }
  }
  const entraMantida = primeiraMantida
  let ligada = null
  for (const s of spreads) {
    const fica = s.paginas.filter(p => !(p.nome >= primeira && p.nome <= ultimaGerada))
    const saem = s.paginas.filter(p => p.nome >= primeira && p.nome <= ultimaGerada)
    removidos.push(...saem.flatMap(p => p.itens))
    if (!saem.length) {
      lista.push({ spread: s, paginas: s.paginas, arquivo: s.arquivo })
      continue
    }
    if (s.paginas.some(p => p.nome === primeira)) {
      // 1ª página do plano no spread da última pré-textual
      lista.push({ spread: s, paginas: [...fica, fila.shift()], arquivo: s.arquivo })
      while (fila.length > 1) lista.push(spreadNovo(fila.splice(0, 2)))
      continue
    }
    if (fica.length) {
      // última página do plano (à esquerda) com a 1ª mantida
      lista.push({ spread: s, paginas: [fila.shift(), ...fica], arquivo: s.arquivo })
      continue
    }
    zip.remove(s.arquivo)
    designmap = designmap.replace(new RegExp(`\\s*<idPkg:Spread src="${s.arquivo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*/>`), '')
  }
  if (fila.length) throw new Error('Sobrou página do plano: o livro não tem spread para a última página.')

  // 1ª página mantida: o quadro do texto principal perde o anterior (texto todo gerado: não há)
  const paginaMantida = paginaDe(entraMantida)
  const iQuadro = paginaMantida ? paginaMantida.itens.findIndex(ehPrincipal) : -1
  if (iQuadro >= 0) {
    ligada = paginaMantida.itens[iQuadro]
    paginaMantida.itens[iQuadro] = setAttr(ligada.slice(0, ligada.indexOf('>') + 1), 'PreviousTextFrame', 'n') + ligada.slice(ligada.indexOf('>') + 1)
  }

  // páginas das novas emendas, depois da última página da parte
  if (acrescimo?.paginas) {
    const ultima = paginaDe(acrescimo.apos)
    if (ultima.lado !== 'd') throw new Error('A parte acrescida termina em página par: ainda não previsto.')
    const iU = ultima.itens.findIndex(ehPrincipal)
    const self = attr(ultima.itens[iU].slice(0, ultima.itens[iU].indexOf('>')), 'Self')
    const prox = attr(ultima.itens[iU].slice(0, ultima.itens[iU].indexOf('>')), 'NextTextFrame')
    const mestra = attr(ultima.xml.slice(0, ultima.xml.indexOf('>')), 'AppliedMaster')
    const extras = []
    for (let k = 1; k <= acrescimo.paginas; k++) {
      const lado = k % 2 === 1 ? 'e' : 'd'
      extras.push({ lado, xml: novaPagina(`nem${k}`, lado, mestra),
        itens: [quadro(`nef${k}`, lado, k === 1 ? self : `nef${k - 1}`, k === acrescimo.paginas ? prox : `nef${k + 1}`, idPrincipal)] })
    }
    ultima.itens[iU] = setAttr(ultima.itens[iU].slice(0, ultima.itens[iU].indexOf('>') + 1), 'NextTextFrame', 'nef1') + ultima.itens[iU].slice(ultima.itens[iU].indexOf('>') + 1)
    for (const p of spreads.flatMap(s => s.paginas)) {
      const i = p.itens.findIndex(x => ehPrincipal(x) && attr(x.slice(0, x.indexOf('>')), 'Self') === prox)
      if (i >= 0) p.itens[i] = setAttr(p.itens[i].slice(0, p.itens[i].indexOf('>') + 1), 'PreviousTextFrame', `nef${acrescimo.paginas}`) + p.itens[i].slice(p.itens[i].indexOf('>') + 1)
    }
    const i = lista.findIndex(x => x.paginas?.includes(ultima))
    const pares = []
    while (extras.length) pares.push(spreadNovo(extras.splice(0, 2)))
    lista.splice(i + 1, 0, ...pares)
  }

  // grava os spreads na ordem final, com a posição vertical refeita
  const y0 = Number(attr(spreads[0].tag, 'ItemTransform').split(' ')[5])
  const finais = lista.map((x, k) => {
    let xml = x.xml ?? xmlSpread(x.spread, x.paginas)
    xml = xml.replace(/<Spread [^>]*>/, t => setAttr(t, 'ItemTransform', `1 0 0 1 0 ${y0 + k * ESPACO_SPREADS}`))
    zip.file(x.arquivo, xml)
    return x
  })
  for (const x of finais.filter(x => x.novo)) {
    const i = finais.indexOf(x)
    const ant = finais[i - 1].arquivo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    designmap = designmap.replace(new RegExp(`(<idPkg:Spread src="${ant}"\\s*/>)`), `$1\n\t<idPkg:Spread src="${x.arquivo}" />`)
  }

  // ── histórias sem quadro e designmap ──────────────────────────
  const emUso = new Set()
  for (const x of finais) for (const m of (await ler(x.arquivo)).matchAll(/ParentStory="([^"]+)"/g)) emUso.add(m[1])
  for (const m of designmap.matchAll(/<idPkg:MasterSpread src="([^"]+)"/g)) for (const q of (await ler(m[1])).matchAll(/ParentStory="([^"]+)"/g)) emUso.add(q[1])
  const orfas = [...new Set(removidos.flatMap(i => [...i.matchAll(/ParentStory="([^"]+)"/g)].map(m => m[1])))].filter(s => !emUso.has(s))
  for (const s of orfas) {
    zip.remove(`Stories/Story_${s}.xml`)
    designmap = designmap.replace(new RegExp(`\\s*<idPkg:Story src="Stories/Story_${s}\\.xml"\\s*/>`), '')
  }
  designmap = designmap.replace(/(<idPkg:BackingStory [^>]*\/>)/, `<idPkg:Story src="Stories/Story_${STORY}.xml" />\n\t$1`)
  designmap = designmap.replace(/StoryList="([^"]*)"/, (_, l) => `StoryList="${l.split(' ').filter(x => !orfas.includes(x)).concat(STORY).join(' ')}"`)
  const total = spreads.flatMap(s => s.paginas).length - (ultimaGerada - primeira + 1) + paginasPlano + (acrescimo?.paginas || 0)
  designmap = designmap.replace(/(<Section [^>]*?)Length="\d+"/, `$1Length="${total}"`)
    .replace(/(<Section [^>]*?)AlternateLayoutLength="\d+"/, `$1AlternateLayoutLength="${total}"`)
  // links do sumário e marcadores apontam para o texto que saiu: o sumário é refeito no InDesign
  for (const tag of ['Hyperlink', 'Bookmark', 'HyperlinkPageDestination']) {
    designmap = designmap.replace(new RegExp(`\\s*<${tag} [^>]*?/>`, 'g'), '')
    const interno = new RegExp(`\\s*<${tag} [^>]*?>(?:(?!<${tag}[\\s>])[\\s\\S])*?</${tag}>`, 'g')
    let antes
    do { antes = designmap; designmap = designmap.replace(interno, '') } while (designmap !== antes)
  }
  for (const m of [...designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)]) {
    const xml = await ler(m[1])
    if (xml.includes('<HyperlinkTextSource')) {
      zip.file(m[1], xml.replace(/<HyperlinkTextSource\b[^>]*>([\s\S]*?)<\/HyperlinkTextSource>/g, '$1')
        .replace(/<Properties>\s*<AlternativeDestination [^>]*\/>\s*<\/Properties>/g, ''))
    }
  }
  // exceções de hifenização do usuário no dicionário do documento (o InDesign divide igual ao Normando)
  zip.file('designmap.xml', excecoesNoDesignmap(designmap))
  const pref = (await ler('Resources/Preferences.xml'))
    .replace(/(<TextPreference [^>]*?)SmartTextReflow="[^"]*"/, '$1SmartTextReflow="true"')
    .replace(/(<TextPreference [^>]*?)AddPages="[^"]*"/, '$1AddPages="EndOfStory"')
    .replace(/(<TextPreference [^>]*?)LimitToMasterTextFrames="[^"]*"/, '$1LimitToMasterTextFrames="false"')
    .replace(/(<TextPreference [^>]*?)DeleteEmptyPages="[^"]*"/, '$1DeleteEmptyPages="false"')
  zip.file('Resources/Preferences.xml', pref)

  // ── sumário: o texto fica como no livro (o diagramador acerta caixa e entradas à mão); só as
  // páginas mudam — geradas pelo plano, mantidas pelo deslocamento
  const titulos = d.pars.flatMap((p, k) => {
    if (!(base.modo === 'epigrafe' ? ENTRADA_SUMARIO_EPIGRAFE : ENTRADA_SUMARIO).test(p.estilo)) return []
    const pagina = d.esperado.find(e => e.par === k)?.pagina
    return pagina == null ? [] : [{ t: normalizar((p.runs || []).map(r => r.texto ?? '').join('')), pagina: pagina + primeira, usado: false }]
  })
  const deslocamento = paginasPlano - (primeiraMantida - primeira)
  const numerosSumario = []
  // entradas do sumário (título, estilo, página nova): marcadores e links do PDF (pdfLivroCompleto.js)
  const entradasSumario = []
  const paginaNova = n => n + deslocamento + (acrescimo && n > acrescimo.apos ? acrescimo.paginas : 0)
  for (const m of [...designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)]) {
    const xml = await ler(m[1])
    if (!/<Story [^>]*AppliedTOCStyle="TOCStyle/.test(xml)) continue
    // cada entrada vai de <Br/> a <Br/>, em vários trechos; o número fica depois da tabulação
    // (<?ACE 8?>), no mesmo trecho do título ou num trecho próprio
    let cursor = 0, entrada = [], novoXml = '', copiado = 0
    // estilo de parágrafo do sumário no ponto `i` do XML (nível do marcador do PDF)
    const estiloEm = i => {
      const k = xml.lastIndexOf('<ParagraphStyleRange ', i)
      return k < 0 ? '' : decodeURIComponent(xml.slice(k, xml.indexOf('>', k)).match(/AppliedParagraphStyle="ParagraphStyle\/([^"]+)"/)?.[1] || '')
    }
    const fechar = () => {
      const k8 = entrada.findIndex(c => c.texto.includes('<?ACE 8?>'))
      // toda entrada com texto vai para os marcadores do PDF; a página vem do número (ou da seguinte)
      if (entrada.length) {
        const titulo = decodificar(entrada.map(c => c.texto).join('').split('<?ACE 8?>')[0].replace(/<\?[^>]*\?>/g, '')).replace(INVISIVEIS, '').replace(/\s+/g, ' ').trim()
        if (titulo) entradasSumario.push({ titulo, estilo: estiloEm(entrada[0].inicio), numerada: false, pagina: null })
      }
      if (k8 >= 0) {
        const fim = entrada[k8].texto.split('<?ACE 8?>')[1]
        const alvoNum = /^\d+$/.test(fim) ? { c: entrada[k8], de: entrada[k8].texto.length - fim.length } : /^\d+$/.test(entrada[k8 + 1]?.texto || '') ? { c: entrada[k8 + 1], de: 0 } : null
        if (alvoNum) {
          const antiga = Number(alvoNum.c.texto.slice(alvoNum.de))
          const titulo = decodificar(entrada.slice(0, k8 + 1).map(c => c.texto).join('').split('<?ACE 8?>')[0].replace(/<\?[^>]*\?>/g, ''))
          let nova = null
          if (antiga >= primeiraMantida) nova = paginaNova(antiga)
          else {
            const k = titulos.findIndex((x, i) => i >= cursor && x.t === normalizar(titulo))
            if (k < 0) rel.avisos.push(`Sumário: "${titulo}" não foi encontrado no texto gerado.`)
            else { cursor = k + 1; titulos[k].usado = true; nova = titulos[k].pagina }
          }
          numerosSumario.push(nova ?? antiga)
          const ultimaEntrada = entradasSumario.at(-1)
          if (ultimaEntrada) Object.assign(ultimaEntrada, { numerada: true, pagina: nova ?? antiga })
          if (nova != null) {
            const p0 = alvoNum.c.inicio + alvoNum.de
            novoXml += xml.slice(copiado, p0) + nova
            copiado = alvoNum.c.inicio + alvoNum.c.texto.length
          }
        }
      }
      entrada = []
    }
    for (const c of xml.matchAll(/<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g)) {
      if (c[1] == null) fechar()
      else entrada.push({ texto: c[1], inicio: c.index + '<Content>'.length })
    }
    fechar()
    zip.file(m[1], novoXml + xml.slice(copiado))
  }
  for (const x of titulos) if (!x.usado) rel.avisos.push(`Sumário: "${x.t}" (p. ${x.pagina}) não tem entrada no sumário do livro.`)

  // ── pré-textuais: Mesa (Configurações), rosto e folha técnica (publicação), nos estilos do livro ──
  const { historias: pretextuaisTrocados } = await aplicarPretextuaisDoLivro(zip, { publicacao, institucional: opcoes.institucional })

  // ── pré-textuais: última emenda no texto de apresentação ──────
  const ultimaEmenda = (rel.partes.find(p => p.emendas?.length)?.emendas || []).at(-1)?.match(/N[ºo°]\s*(\d+),\s*DE\s*(\d{4})/i)
  const trocadosEmenda = new Set()
  if (ultimaEmenda) {
    for (const m of [...designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)]) {
      if (m[1] === principal.arquivo || m[1].endsWith(`Story_${STORY}.xml`)) continue
      const xml = await ler(m[1])
      const novo = xml.replace(/(1\/1992 a\s*\uFEFF?)\d+\/\d{4}/, (t, a) => {
        rel.pretextuais.push(`${t.replace(/\uFEFF/g, '')} → ${a.replace(/\uFEFF/g, '')}${ultimaEmenda[1]}/${ultimaEmenda[2]}`)
        return `${a}${ultimaEmenda[1]}/${ultimaEmenda[2]}`
      })
      if (novo !== xml) { zip.file(m[1], novo); trocadosEmenda.add(xml.match(/<Story Self="([^"]+)"/)?.[1]) }
    }
  }

  // "Source Sans 3 (TT)" é o nome que o InDesign dá à fonte quando há duas instalações da família: em
  // outra máquina ela falta, o texto recompõe com fonte substituta e o plano perde o sentido
  for (const n of Object.keys(zip.files)) {
    if (!/^(Stories|MasterSpreads|Spreads|Resources)\/.*\.xml$/.test(n)) continue
    const xml = await ler(n)
    if (xml.includes('Source Sans 3 (TT)')) zip.file(n, xml.split('Source Sans 3 (TT)').join('Source Sans 3'))
  }

  const saida = new JSZip()
  saida.file('mimetype', await ler('mimetype'), { compression: 'STORE' })
  for (const n of Object.keys(zip.files)) {
    if (n === 'mimetype' || zip.files[n].dir) continue
    saida.file(n, await zip.file(n).async('uint8array'))
  }
  rel.paginas = total
  rel.paginasPlano = d.paginas
  const idml = await saida.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' })
  // última página com texto do livro: até ela há fólio
  const quadros = spreads.flatMap(s => s.paginas.map(p => [p, p.itens.filter(ehPrincipal)]))
  const ultimaTexto = quadros.find(([, q]) => q.some(i => attr(i.slice(0, i.indexOf('>')), 'NextTextFrame') === 'n'))?.[0].nome ?? null
  return {
    idml, relatorio: rel,
    paginacao: { primeiraPagina: primeira, paginas: d.paginas, ultimaLinha: f.ultimaLinha ?? 8, ultimaComplexa: f.ultimaComplexa ?? 7, ultimaOcupacao: !!f.ultimaOcupacao, notaMaisUm: !!f.notaMaisUm, espacoMinimo: f.espacoMinimo ?? 82, limiteAperto: f.limiteAperto ?? 0.76, paragrafos: d.esperado },
    mapa: { primeira, primeiraMantida, paginasPlano, paginasGeradas: d.paginas, ultimaTexto, acrescimo, paginaNova, sumario: numerosSumario, entradasSumario, pretextuais: [...new Set([...pretextuaisTrocados, ...trocadosEmenda])].filter(Boolean), zip, ultimaEmenda: ultimaEmenda ? `${ultimaEmenda[1]}/${ultimaEmenda[2]}` : null },
  }
}
