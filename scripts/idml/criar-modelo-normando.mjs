// Cria o modelo IDML da saída "IDML" do Normando a partir de um livro já diagramado.
//
//   node scripts/idml/criar-modelo-normando.mjs "<pasta do livro>" [arquivo.idml]
//
// Base usada: "PDF output/Pasta legised setembro 26" (tem os estilos artigos:* das
// coletâneas além dos de legislação). O resultado vai para build/modelo-normando/:
//   modelo.idml   – estilos, mestras, variáveis de cabeço e pré-textuais, SEM o miolo;
//   modelo.json   – onde está cada coisa (stories das pré-textuais, mestra do miolo…);
//   Links/, Document fonts/ – copiados do livro, para acompanhar cada exportação.
//
// O que sai do livro: as páginas do miolo (da 1ª página com a mestra do miolo até a
// penúltima; a última, do colofão, fica e o exportador põe o miolo antes dela), a story do miolo, a story de teste no pasteboard, o conteúdo do sumário
// (fica só o título; o sumário é refeito no InDesign), hyperlinks e marcadores do
// sumário antigo e os artigos de EPUB.

import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const pastaLivro = process.argv[2]
if (!pastaLivro) {
  console.error('uso: node scripts/idml/criar-modelo-normando.mjs "<pasta do livro>" [arquivo.idml]')
  process.exit(1)
}
const arquivoIdml = process.argv[3]
  || path.join(pastaLivro, fs.readdirSync(pastaLivro).find(n => n.toLowerCase().endsWith('.idml')))
const SAIDA = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'build', 'modelo-normando')

// stories das pré-textuais no livro de base (legised, setembro de 2026)
const PRETEXTUAIS = {
  mesa: 'u36d',
  conselho: 'u7953d',
  rosto: 'u881c3',
  creditos: 'u3b6',
  ficha: 'u3e2',
  direitos: 'u7f65a',
  colofao: 'u828e1',
  sumario: 'u3cc',
}
const STORY_MIOLO = 'u90b'
const STORY_TESTE = 'u86a5a'   // parágrafos de teste esquecidos no pasteboard da p. 1
const MESTRA_MIOLO = 'ub7'     // A-Miolo

const zip = await JSZip.loadAsync(fs.readFileSync(arquivoIdml))
const ler = n => zip.file(n).async('string')
const gravar = (n, s) => zip.file(n, s)

let designmap = await ler('designmap.xml')
const spreads = [...designmap.matchAll(/<idPkg:Spread src="([^"]+)"\s*\/>/g)].map(m => m[1])

// 1ª página do miolo: a primeira com a mestra do miolo
let corte = -1, paginaCorte = null
for (let i = 0; i < spreads.length && corte < 0; i++) {
  const xml = await ler(spreads[i])
  const m = [...xml.matchAll(/<Page Self="([^"]+)"[^>]*AppliedMaster="([^"]+)"/g)].find(p => p[2] === MESTRA_MIOLO)
  if (m) { corte = i; paginaCorte = m[1] }
}
if (corte < 0) throw new Error('Não achei página com a mestra do miolo.')

// spread do corte: fica só com as páginas anteriores (ex.: p. 10, último quadro do sumário)
{
  let xml = await ler(spreads[corte])
  xml = removerElemento(xml, 'Page', paginaCorte)
  for (const tf of [...xml.matchAll(/<TextFrame Self="([^"]+)" ParentStory="([^"]+)"/g)]) {
    if (tf[2] === STORY_MIOLO) xml = removerElemento(xml, 'TextFrame', tf[1])
  }
  const paginas = (xml.match(/<Page /g) || []).length
  xml = xml.replace(/(<Spread [^>]*?)PageCount="\d+"/, `$1PageCount="${paginas}"`)
  gravar(spreads[corte], xml)
}
// último spread (colofão): fica, sem o quadro do miolo; o exportador põe o miolo antes dele
const spreadFinal = spreads[spreads.length - 1]
{
  let xml = await ler(spreadFinal)
  for (const tf of [...xml.matchAll(/<TextFrame Self="([^"]+)" ParentStory="([^"]+)"/g)]) {
    if (tf[2] === STORY_MIOLO) xml = removerElemento(xml, 'TextFrame', tf[1])
  }
  gravar(spreadFinal, xml)
}
// spreads do miolo: saem
for (const s of spreads.slice(corte + 1, -1)) {
  zip.remove(s)
  designmap = designmap.replace(new RegExp(`\\s*<idPkg:Spread src="${esc(s)}"\\s*/>`), '')
}
const ultimoSpread = spreads[corte]

// story de teste no pasteboard da p. 1
{
  const s = spreads[0]
  let xml = await ler(s)
  const tf = xml.match(new RegExp(`<TextFrame Self="([^"]+)" ParentStory="${STORY_TESTE}"`))
  if (tf) { xml = removerElemento(xml, 'TextFrame', tf[1]); gravar(s, xml) }
}
for (const st of [STORY_MIOLO, STORY_TESTE]) {
  zip.remove(`Stories/Story_${st}.xml`)
  designmap = designmap.replace(new RegExp(`\\s*<idPkg:Story src="Stories/Story_${st}.xml"\\s*/>`), '')
  designmap = designmap.replace(/StoryList="([^"]*)"/, (_, l) => `StoryList="${l.split(' ').filter(x => x !== st).join(' ')}"`)
}

// sumário: só o título (o InDesign refaz em Layout › Atualizar sumário)
{
  const n = `Stories/Story_${PRETEXTUAIS.sumario}.xml`
  let xml = await ler(n)
  const ini = xml.indexOf('<ParagraphStyleRange')
  const fim = xml.lastIndexOf('</ParagraphStyleRange>') + '</ParagraphStyleRange>'.length
  xml = xml.slice(0, ini) +
    '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/sumario%3asum-titulo">' +
    '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">' +
    '<Content>Sumário</Content></CharacterStyleRange></ParagraphStyleRange>' + xml.slice(fim)
  gravar(n, xml)
}

// pré-textuais: o texto variável vira campos {{…}} (preenchidos na exportação — ver
// electron/main/services/idml/pretextuais.js). Rosto, ficha e colofão: troca só o texto
// (mantém os ajustes locais do diagramador); Mesa e créditos: listas geradas por inteiro.
{
  const trocar = async (id, pares) => {
    const n = `Stories/Story_${id}.xml`
    let xml = await ler(n)
    for (const [de, para] of pares) {
      const antes = xml
      xml = typeof de === 'string' ? xml.split(de).join(para) : xml.replace(de, para)
      if (xml === antes) throw new Error(`campo não aplicado em ${id}: ${de}`)
    }
    gravar(n, xml)
  }
  const C = t => `<Content>${t}</Content>`
  await trocar(PRETEXTUAIS.rosto, [
    [C('LEGISLAÇÃO'), C('{{titulo_linha1}}')],
    [C('SOBRE'), C('{{titulo_linha2}}')],
    [C('EDUCAÇÃO'), C('{{titulo_linha3}}')],
    [C('8ª EDIÇÃO '), C('{{edicao_rosto}} ')],
    [C('Ana Valeska Amaral Gomes '), C('{{organizadores}}')],
    // 2º parágrafo das organizadoras: sai (a lista inteira vai no campo acima)
    [/<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle\/capa%3aLEIS">\s*<CharacterStyleRange[^>]*>\s*<Content>Tatiana[\s\S]*?<\/ParagraphStyleRange>\s*/, ''],
    [/<Content>Edição atualizada até [^<]*<\/Content>/, C('{{atualizacao_rosto}}')],
  ])
  await trocar(PRETEXTUAIS.ficha, [
    [C('Série Legislação'), C('{{serie}}')],
    [C('n. 9'), C('{{serie_numero}}')],
    [/<Content>Bibliotecária: [^<]*<\/Content>/, C('{{bibliotecaria}}')],
    [C('Brasil. Congresso Nacional. Câmara dos Deputados.'), C('{{ficha_entrada}}')],
    [/<Content>Regimento Interno da Câmara dos Deputados : [^<]*<\/Content>/, C('{{ficha_descricao}}')],
    [/<Content>\d+ p\. -- [^<]*<\/Content>/, C('{{ficha_paginas}}')],
    [/<Content>“Edição atualizada até [^<]*<\/Content>/, C('“Edição atualizada até {{atualizacao}}”.')],
    [/<Content>Disponível, também, em formato digital \(e-book\)\.<\/Content>\s*<Br \/>\s*<Content>ISBN [^<]*<\/Content>/, C('{{ficha_ebook}}')],
    [/<Content>1\. Brasil\. Congresso Nacional\.[^<]*<\/Content>/, C('{{ficha_assuntos}}')],
    [/<Content>CDU [^<]*<\/Content>/, C('CDU {{ficha_cdu}}')],
    [/<Content>ISBN [^<]*\(papel\)<\?ACE 8\?>ISBN [^<]*\(e-book\)<\/Content>/, C('{{isbn_rodape}}')],
  ])
  await trocar(PRETEXTUAIS.colofao, [[/<Content>Impresso em [^<]*<\/Content>/, C('Impresso em {{mes_impressao}}')]])
  // Mesa: nome da Câmara fica; legislatura + lista de cargos/nomes geradas
  await trocarCorpo(PRETEXTUAIS.mesa, 1, [psr('folha-tecnica:legislatura', '{{legislatura}}'), psr('folha-tecnica:cargo', '{{mesa}}')])
  // créditos: nome da Câmara fica; o resto em campos
  await trocarCorpo(PRETEXTUAIS.creditos, 1, [
    psr('folha-tecnica:creditos', '{{creditos_institucionais}}'),
    psr('folha-tecnica:creditos', '{{equipe}}'),
    psr('folha-tecnica:creditos-separa', '{{nota_editor}}'),
    psr('folha-tecnica:edições', '{{historico_edicoes}}'),
    psr('folha-tecnica:creditos-separa', '{{linha_serie}}', true),
  ])
}

// hyperlinks, marcadores e destinos do sumário antigo; artigos de EPUB
for (const tag of ['Hyperlink', 'Bookmark', 'HyperlinkPageDestination', 'HyperlinkURLDestination', 'Article']) {
  designmap = designmap.replace(new RegExp(`\\s*<${tag} [^>]*?/>`, 'g'), '')
  designmap = designmap.replace(new RegExp(`\\s*<${tag} [^>]*?>[\\s\\S]*?</${tag}>`, 'g'), '')
}

// seção única: o tamanho é refeito a cada exportação
const paginasPre = await contarPaginas(spreads.slice(0, corte + 1))
const paginasFinais = await contarPaginas([spreadFinal])
designmap = designmap.replace(/(<Section [^>]*?)Length="\d+"/, `$1Length="${paginasPre + paginasFinais}"`)
  .replace(/(<Section [^>]*?)AlternateLayoutLength="\d+"/, `$1AlternateLayoutLength="${paginasPre + paginasFinais}"`)
gravar('designmap.xml', designmap)

// preferências: reflow inteligente acrescenta páginas no fim da story e apaga as vazias
{
  let pref = await ler('Resources/Preferences.xml')
  pref = pref.replace(/(<TextPreference [^>]*?)LimitToMasterTextFrames="[^"]*"/, '$1LimitToMasterTextFrames="false"')
    .replace(/(<TextPreference [^>]*?)DeleteEmptyPages="[^"]*"/, '$1DeleteEmptyPages="true"')
  gravar('Resources/Preferences.xml', pref)
}

fs.mkdirSync(SAIDA, { recursive: true })
const ordenado = new JSZip()
ordenado.file('mimetype', await ler('mimetype'), { compression: 'STORE' })
for (const n of Object.keys(zip.files)) if (n !== 'mimetype' && !zip.files[n].dir) ordenado.file(n, await zip.file(n).async('uint8array'))
fs.writeFileSync(path.join(SAIDA, 'modelo.idml'), await ordenado.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' }))

fs.writeFileSync(path.join(SAIDA, 'modelo.json'), JSON.stringify({
  origem: path.basename(arquivoIdml),
  criadoEm: new Date().toISOString(),
  mestraMiolo: MESTRA_MIOLO,
  camada: (await ler(ultimoSpread)).match(/ItemLayer="([^"]+)"/)?.[1] || null,
  ultimoSpread,
  spreadFinal,
  paginasPreTextuais: paginasPre,
  paginasFinais,
  pretextuais: PRETEXTUAIS,
}, null, 2))

// só fontes de licença livre (OFL) vão no modelo — e, com ele, no instalador do app. Minion Pro
// (Adobe), Wingdings e Segoe UI Emoji (Microsoft) já estão nas máquinas com Windows e InDesign.
const FONTE_LIVRE = /^(SourceSans3|Montserrat)-.*\.(otf|ttf)$/i
for (const sub of ['Links', 'Document fonts']) {
  const de = path.join(pastaLivro, sub)
  if (!fs.existsSync(de)) continue
  fs.rmSync(path.join(SAIDA, sub), { recursive: true, force: true })
  fs.mkdirSync(path.join(SAIDA, sub), { recursive: true })
  for (const f of fs.readdirSync(de)) {
    if (/\.lst$/i.test(f) || (sub === 'Document fonts' && !FONTE_LIVRE.test(f))) continue
    fs.copyFileSync(path.join(de, f), path.join(SAIDA, sub, f))
  }
}
// fontes: também as dos outros livros da mesma pasta (faces que faltam neste, ex.: Bold Italic)
const irmaos = path.dirname(path.resolve(pastaLivro))
for (const livro of fs.readdirSync(irmaos)) {
  const de = path.join(irmaos, livro, 'Document fonts')
  if (!fs.existsSync(de) || path.resolve(de) === path.resolve(pastaLivro, 'Document fonts')) continue
  for (const f of fs.readdirSync(de)) {
    if (!FONTE_LIVRE.test(f)) continue
    const para = path.join(SAIDA, 'Document fonts', f)
    if (!fs.existsSync(para)) fs.copyFileSync(path.join(de, f), para)
  }
}
console.log(`modelo criado em ${SAIDA} (${paginasPre} páginas pré-textuais; miolo começava na página ${paginasPre + 1})`)

// ── utilidades ───────────────────────────────────────────────────
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function psr(estilo, texto, ultimo = false) {
  return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${estilo.replace(/:/g, '%3a')}">` +
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${texto}</Content>${ultimo ? '' : '<Br />'}</CharacterStyleRange></ParagraphStyleRange>`
}

/** Mantém os `manter` primeiros parágrafos (PSR) da story e troca o resto por `novos`. */
async function trocarCorpo(id, manter, novos) {
  const n = `Stories/Story_${id}.xml`
  const xml = await ler(n)
  const psrs = [...xml.matchAll(/<ParagraphStyleRange[\s\S]*?<\/ParagraphStyleRange>/g)]
  const corte = psrs[manter - 1].index + psrs[manter - 1][0].length
  const fim = psrs[psrs.length - 1].index + psrs[psrs.length - 1][0].length
  gravar(n, xml.slice(0, corte) + '\n' + novos.join('\n') + xml.slice(fim))
}

/** Remove <Tag Self="id" …>…</Tag> (ou auto-fechado), respeitando aninhamento do mesmo tag. */
function removerElemento(xml, tag, self) {
  const ini = xml.search(new RegExp(`<${tag} Self="${esc(self)}"[\\s>]`))
  if (ini < 0) return xml
  const abre = xml.indexOf('>', ini)
  if (xml[abre - 1] === '/') return cortar(xml, ini, abre + 1)
  const re = new RegExp(`<(/?)${tag}[\\s>]`, 'g')
  re.lastIndex = abre + 1
  let nivel = 1, m
  while ((m = re.exec(xml))) {
    if (m[1]) { if (--nivel === 0) return cortar(xml, ini, xml.indexOf('>', m.index) + 1) }
    else if (xml[xml.indexOf('>', m.index) - 1] !== '/') nivel++
  }
  throw new Error(`fim de <${tag} ${self}> não encontrado`)
}
function cortar(xml, a, b) {
  while (a > 0 && /[ \t]/.test(xml[a - 1])) a--
  if (xml[b] === '\r') b++
  if (xml[b] === '\n') b++
  return xml.slice(0, a) + xml.slice(b)
}
async function contarPaginas(lista) {
  let n = 0
  for (const s of lista) n += ((await ler(s)).match(/<Page /g) || []).length
  return n
}
