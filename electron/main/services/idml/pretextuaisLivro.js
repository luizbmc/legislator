/**
 * pretextuaisLivro.js — páginas pré-textuais do livro (pasta do livro, livroCompleto.js): Mesa
 * diretora, folha de rosto, folha técnica (créditos, informações editoriais, ficha catalográfica,
 * direitos e endereço) e colofão.
 *
 * Os textos ficam nos estilos do .indd: cada parágrafo é achado pelo estilo (com o grupo) e só o
 * texto muda — estilo de parágrafo, estilo de caractere e formatação local do parágrafo de origem
 * continuam. Nas listas (créditos), parágrafos novos copiam o estilo dos parágrafos da lista.
 *
 * lerPretextuaisDoLivro(zip) → valores atuais do livro (para preencher os formulários)
 * aplicarPretextuaisDoLivro(zip, { publicacao, institucional }) → troca os textos no IDML
 */

const NBSP = String.fromCharCode(0xa0)
const FEFF = String.fromCharCode(0xfeff)
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// Mesa: chave, cargo padrão e como reconhecer o cargo no livro ("3ª Secretária", "3a Secretária")
export const CARGOS_MESA = [
  ['presidente', 'Presidente', /^presidente$/i],
  ['vice1', '1º Vice-Presidente', /^1\s*[ºªoa°]?\s*vice/i],
  ['vice2', '2º Vice-Presidente', /^2\s*[ºªoa°]?\s*vice/i],
  ['sec1', '1º Secretário', /^1\s*[ºªoa°]?\s*secret/i],
  ['sec2', '2º Secretário', /^2\s*[ºªoa°]?\s*secret/i],
  ['sec3', '3º Secretário', /^3\s*[ºªoa°]?\s*secret/i],
  ['sec4', '4º Secretário', /^4\s*[ºªoa°]?\s*secret/i],
  ['sup1', '1º Suplente', /^1\s*[ºªoa°]?\s*suplente/i],
  ['sup2', '2º Suplente', /^2\s*[ºªoa°]?\s*suplente/i],
  ['sup3', '3º Suplente', /^3\s*[ºªoa°]?\s*suplente/i],
  ['sup4', '4º Suplente', /^4\s*[ºªoa°]?\s*suplente/i],
  ['sgm', 'Secretário-Geral da Mesa', /secret[áa]ri[oa]-geral da mesa/i],
  ['dg', 'Diretor-Geral', /^diretor[a]?-geral/i],
  ['pce', 'Presidente do Conselho Editorial', /conselho editorial/i],
]
const chaveDoCargo = t => CARGOS_MESA.find(([, , re]) => re.test(t.trim()))?.[0] || null

// ── estilos ──────────────────────────────────────────────────────

/** "ParagraphStyle/folha-tecnica%3acargo" ou "edicao (folha-rosto)" → "folha-tecnica:cargo", "folha-rosto:edicao" */
export function nomeDoEstilo(self) {
  const n = decodeURIComponent(String(self || '').replace(/^ParagraphStyle\//, ''))
  const m = n.match(/^(.*?)\s*\(([^()]+)\)$/)
  return m ? `${m[2].trim()}:${m[1].trim()}` : n
}
const grupo = (estilo, g) => estilo.startsWith(g + ':')
const semAcento = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// folha de rosto: grupo "folha-rosto" (CF) ou "capa" (Regimento)
const doRosto = e => grupo(e, 'folha-rosto') || grupo(e, 'capa')
const nomeRosto = e => doRosto(e) ? semAcento(e.split(':').pop()) : null

// ── histórias: parágrafos e trechos ──────────────────────────────

const decodificar = s => s.replace(/<\?[^>]*\?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')
const codificar = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ehSobrescrito = r => /sobrescrito|superscript/i.test(r.char || '') || /Position="(OT)?Superscript"/.test(r.abre)

/**
 * História → { cabeca, rabo, pars: [{ abre, props, estilo, runs: [{ abre, props, char, bruto }], br }] }
 * (um parágrafo por <Br/>, mesmo quando o InDesign junta vários parágrafos no mesmo
 * ParagraphStyleRange). `bruto` é o conteúdo XML do trecho, sem <Content>.
 */
/**
 * Itens de dentro de um CharacterStyleRange: { texto } (conteúdo de <Content>), { br } ou { elemento }
 * (XML inteiro do elemento, com os aninhados do mesmo nome contados: um <Rectangle> ancorado com
 * <Properties>, <PDF>, <Link>… fica num item só).
 */
function itensDoTrecho(s) {
  const out = []
  let i = 0
  while (true) {
    const a = s.indexOf('<', i)
    if (a < 0) break
    if (s.startsWith('<Content>', a)) {
      const b = s.indexOf('</Content>', a)
      out.push({ texto: s.slice(a + 9, b) }); i = b + 10; continue
    }
    if (/^<Br\s*\/>/.test(s.slice(a, a + 8))) { out.push({ br: true }); i = s.indexOf('>', a) + 1; continue }
    if (s[a + 1] === '/' || s[a + 1] === '?' || s[a + 1] === '!') { i = s.indexOf('>', a) + 1; continue }
    const nome = s.slice(a + 1).match(/^[\w:]+/)?.[0]
    const fimTag = s.indexOf('>', a)
    if (!nome || fimTag < 0) break
    if (s[fimTag - 1] === '/') { out.push({ elemento: s.slice(a, fimTag + 1) }); i = fimTag + 1; continue }
    // fecho do mesmo elemento, contando os aninhados de mesmo nome
    const re = new RegExp(`<(/?)${nome}\\b[^>]*?(/?)>`, 'g')
    re.lastIndex = fimTag + 1
    let nivel = 1, m
    while (nivel && (m = re.exec(s))) { if (m[1]) nivel--; else if (!m[2]) nivel++ }
    const fim = m ? re.lastIndex : s.length
    out.push({ elemento: s.slice(a, fim) }); i = fim
  }
  return out
}

export function lerHistoria(xml) {
  const ini = xml.indexOf('<ParagraphStyleRange'), fim = xml.lastIndexOf('</ParagraphStyleRange>')
  if (ini < 0) return null
  // tabelas, notas têm parágrafos dentro de parágrafos: a história fica como está (um quadro ancorado
  // não: o texto dele é de outra história)
  if (/<(Table|Footnote|Note)\b/.test(xml)) return null
  const out = { cabeca: xml.slice(0, ini), rabo: xml.slice(fim + '</ParagraphStyleRange>'.length), pars: [] }
  for (const p of xml.slice(ini, fim + 22).matchAll(/(<ParagraphStyleRange\b[^>]*>)([\s\S]*?)<\/ParagraphStyleRange>/g)) {
    const abreP = p[1], corpoP = p[2]
    const propsP = corpoP.match(/^\s*(<Properties>[\s\S]*?<\/Properties>)/)?.[1] || ''
    const estilo = nomeDoEstilo(abreP.match(/AppliedParagraphStyle="([^"]+)"/)?.[1])
    let atual = { abre: abreP, props: propsP, estilo, runs: [], br: false }
    const novo = () => { out.pars.push(atual); atual = { abre: abreP, props: propsP, estilo, runs: [], br: false } }
    let vazio = true, ultimoCsr = null
    for (const c of corpoP.matchAll(/(<CharacterStyleRange\b[^>]*?)(\/>|>([\s\S]*?)<\/CharacterStyleRange>)/g)) {
      const abreC = c[1] + '>'
      const corpo = c[3] || ''
      const propsC = corpo.match(/^\s*(<Properties>[\s\S]*?<\/Properties>)/)?.[1] || ''
      ultimoCsr = { abre: abreC, props: propsC }
      const char = decodeURIComponent(abreC.match(/AppliedCharacterStyle="CharacterStyle\/([^"]+)"/)?.[1] || '')
      const semChar = /\[No character style\]/.test(char) ? '' : char
      for (const t of itensDoTrecho(corpo.slice(propsC ? corpo.indexOf(propsC) + propsC.length : 0))) {
        // a marca de fim de parágrafo fica no trecho em que estava (o corpo dela conta na entrelinha)
        if (t.br) { atual.br = true; atual.brRun = { abre: abreC, props: propsC }; novo(); vazio = true; continue }
        if (t.texto != null) atual.runs.push({ abre: abreC, props: propsC, char: semChar, bruto: t.texto })
        // objeto ancorado (ex.: logotipo no rosto do bolso) e outros elementos: inteiros, como estão
        else atual.runs.push({ abre: abreC, props: propsC, char: semChar, elemento: t.elemento })
        vazio = false
      }
    }
    if (!vazio || atual.runs.length) out.pars.push(atual)
    // parágrafo vazio no fim, só com a formatação (sem texto nem marca): fica, com o trecho dele
    else if (ultimoCsr && !corpoP.trimEnd().endsWith('<Br />\n</CharacterStyleRange>') && !/<Br\s*\/>\s*<\/CharacterStyleRange>\s*$/.test(corpoP)) out.pars.push({ ...atual, vazioCsr: ultimoCsr })
  }
  return out
}

export function escreverHistoria(h) {
  const SEM = '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">'
  const partes = h.pars.map(p => {
    const runs = p.runs.filter(r => r.elemento || r.bruto !== '')
    const csrs = runs.map(r => ({ abre: r.abre, props: r.props, dentro: r.elemento ?? `<Content>${r.bruto}</Content>` }))
    if (p.br) {
      const m = p.brRun || runs.at(-1) || { abre: SEM, props: '' }
      const ult = csrs.at(-1)
      // no mesmo trecho do fim do texto quando era assim no livro; senão, num trecho próprio
      if (ult && ult.abre === m.abre && ult.props === m.props) ult.dentro += '<Br />'
      else csrs.push({ abre: m.abre, props: m.props, dentro: '<Br />' })
    }
    if (!csrs.length) csrs.push({ abre: p.vazioCsr?.abre || SEM, props: p.vazioCsr?.props || '', dentro: '' })
    return `${p.abre}${p.props}${csrs.map(c => `${c.abre}${c.props}${c.dentro}</CharacterStyleRange>`).join('')}</ParagraphStyleRange>`
  })
  return h.cabeca + partes.join('\n') + h.rabo
}

/** Texto do parágrafo, com "ª/º" no lugar do sobrescrito ("n" + sobrescrito "os" → "nºs"). */
export function textoDoParagrafo(p) {
  return p.runs.map(r => {
    if (r.elemento) return ''
    const t = decodificar(r.bruto).split(FEFF).join('')
    return ehSobrescrito(r) ? t.replace(/^o/, 'º').replace(/^a/, 'ª') : t
  }).join('')
}

const trechoDe = (modelo, texto) => ({ abre: modelo.abre, props: modelo.props, char: modelo.char, bruto: codificar(texto) })

/**
 * Troca o texto do parágrafo. Rótulo em estilo próprio ("Diretoria-Geral:" em negrito): o novo
 * texto até o 1º ":" fica com o estilo do rótulo. Sobrescrito no original: os ordinais do texto
 * novo ("3ª", "nºs") também vão em sobrescrito. O resto fica com o trecho mais longo do original
 * (mantém o corpo local, ex.: histórico de edições em 6 pt).
 */
export function trocarTexto(p, novo) {
  const runs = p.runs.filter(r => !r.elemento)
  if (!runs.length) { p.runs = [{ abre: '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">', props: '', bruto: codificar(novo) }]; return }
  const textos = runs.map(r => decodificar(r.bruto))
  const sobre = runs.find(ehSobrescrito)
  const normais = runs.filter(r => !ehSobrescrito(r))
  let rotulo = null, resto = runs
  if (normais.length >= 2 && normais[0] === runs[0] && normais[0].abre !== normais[1].abre && /:\s*$/.test(textos[0])) {
    rotulo = runs[0]
    resto = runs.slice(1)
  }
  const corpo = (resto.filter(r => !ehSobrescrito(r)).sort((a, b) => decodificar(b.bruto).length - decodificar(a.bruto).length)[0]) || runs[0]
  const saida = []
  let texto = String(novo ?? '')
  if (rotulo) {
    const i = texto.indexOf(':')
    if (i >= 0) {
      const comEspaco = /:\s+$/.test(textos[0])
      saida.push(trechoDe(rotulo, texto.slice(0, i + 1) + (comEspaco ? ' ' : '')))
      texto = comEspaco ? texto.slice(i + 1).trimStart() : ' ' + texto.slice(i + 1).trimStart()
    }
  }
  if (sobre) {
    // ordinais: "3ª" → "3" + "a" sobrescrito; "nºs" → "n" + "os" sobrescrito
    const re = /(\d)([ºª])|\b(n)([ºª])(s?)(?=[\s\d]|$)/g
    let pos = 0, m
    while ((m = re.exec(texto))) {
      const ate = m.index + 1
      if (ate > pos) saida.push(trechoDe(corpo, texto.slice(pos, ate)))
      const letra = (m[2] || m[4]) === 'ª' ? 'a' : 'o'
      saida.push(trechoDe(sobre, letra + (m[5] || '')))
      pos = m.index + m[0].length
    }
    if (pos < texto.length) saida.push(trechoDe(corpo, texto.slice(pos)))
  } else if (texto) saida.push(trechoDe(corpo, texto))
  p.runs = saida.length ? saida : [trechoDe(corpo, '')]
}

const copiaDe = (modelo, texto) => {
  const p = { ...modelo, runs: modelo.runs.map(r => ({ ...r })), br: true }
  trocarTexto(p, texto)
  return p
}

// ── partes da folha técnica ──────────────────────────────────────

/** Onde está cada parte nos parágrafos de todas as histórias (na ordem do documento). */
function localizar(historias) {
  const pars = historias.flatMap(h => h.h.pars.map((p, k) => ({ p, k, h })))
  const L = { atualizadoFicha: null, mesa: [], legislatura: null, ementa: null, edicao: null, ano: null, atualizado: null, impresso: null, institucionais: [], publicacao: [], informacoes: [], ficha: [], copyright: [], endereco: [] }
  for (let i = 0; i < pars.length; i++) {
    const { p } = pars[i], e = p.estilo, t = textoDoParagrafo(p).trim()
    if (e === 'folha-tecnica:legislatura') L.legislatura = pars[i]
    else if (/^folha-tecnica:cargo/.test(e)) {
      const nome = pars[i + 1]?.p.estilo === 'folha-tecnica:nome' ? pars[i + 1] : null
      L.mesa.push({ cargo: pars[i], nome, chave: chaveDoCargo(t) })
    } else if (nomeRosto(e) === 'ementa' || e === 'capa:organizadores') L.ementa = pars[i]
    else if (nomeRosto(e) === 'edicao') L.edicao = pars[i]
    else if (nomeRosto(e) === 'ano') L.ano = pars[i]
    if (/atualizad[ao] até/i.test(t) && doRosto(e)) L.atualizado = pars[i]
    if (/atualizad[ao] até\s*\d/i.test(t) && grupo(e, 'ficha-cat')) L.atualizadoFicha = pars[i]
    if (/^Impresso em\b/i.test(t)) L.impresso = pars[i]
  }
  // créditos: depois de "Câmara dos Deputados" (nome-camara) da folha de créditos
  const k0 = pars.findIndex(x => /^folha-tecnica:creditos/.test(x.p.estilo))
  if (k0 >= 0) {
    let k = k0
    while (k < pars.length && pars[k].p.estilo === 'folha-tecnica:creditos') L.institucionais.push(pars[k++])
    // créditos da publicação: o 1º "separa" e os que vêm até o próximo "separa"
    if (k < pars.length && /^folha-tecnica:creditos-separa$/.test(pars[k].p.estilo)) {
      L.publicacao.push(pars[k++])
      while (k < pars.length && /^folha-tecnica:creditos(-quebra)?$/.test(pars[k].p.estilo)) L.publicacao.push(pars[k++])
    }
    // informações editoriais: nota do editor, edições anteriores, linha e série
    while (k < pars.length && /^folha-tecnica:(creditos-separa|edi)/.test(pars[k].p.estilo)) L.informacoes.push(pars[k++])
  }
  for (const x of pars) if (grupo(x.p.estilo, 'ficha-cat')) L.ficha.push(x)
  const end = pars.filter(x => /^folha-tecnica:endereco/.test(x.p.estilo))
  const corte = end.findIndex((x, i) => i > 0 && x.p.estilo === 'folha-tecnica:endereco-separa')
  L.copyright = corte < 0 ? end : end.slice(0, corte)
  L.endereco = corte < 0 ? [] : end.slice(corte)
  return L
}

const rotuloNome = t => { const i = t.indexOf(':'); return i < 0 ? { rotulo: '', nome: t.trim() } : { rotulo: t.slice(0, i).trim(), nome: t.slice(i + 1).trim() } }
const juntar = ({ rotulo, nome }) => rotulo ? `${rotulo}: ${nome || ''}`.trim() : String(nome || '').trim()

async function historiasDoLivro(zip) {
  const designmap = await zip.file('designmap.xml').async('string')
  const out = []
  for (const m of designmap.matchAll(/<idPkg:Story src="([^"]+)"/g)) {
    const xml = await zip.file(m[1])?.async('string')
    if (!xml || /AppliedTOCStyle="TOCStyle/.test(xml)) continue
    // só as histórias com estilos das páginas pré-textuais ou o colofão (o texto principal fica de fora)
    if (!/folha-tecnica|folha-rosto|ficha-cat|Impresso em|capa%3a(EDI|organizadores|atualizada)/.test(xml)) continue
    const h = lerHistoria(xml)
    if (h) out.push({ arquivo: m[1], self: xml.match(/<Story Self="([^"]+)"/)?.[1], xml, h })
  }
  return out
}

/** Valores das páginas pré-textuais como estão no livro (para preencher os formulários). */
export async function lerPretextuaisDoLivro(zip) {
  const L = localizar(await historiasDoLivro(zip))
  const tx = x => x ? textoDoParagrafo(x.p).trim() : null
  return {
    mesa: {
      legislatura: tx(L.legislatura),
      cargos: L.mesa.filter(m => m.chave).map(m => ({ chave: m.chave, cargo: tx(m.cargo), nome: tx(m.nome) || '' })),
    },
    rosto: { ementa: tx(L.ementa), edicao: tx(L.edicao), ano: tx(L.ano), atualizado: tx(L.atualizado) },
    folhaTecnica: {
      creditosInstitucionais: L.institucionais.map(x => rotuloNome(tx(x))),
      creditosPublicacao: L.publicacao.map(x => rotuloNome(tx(x))),
      informacoes: L.informacoes.map(tx),
      ficha: L.ficha.map(tx),
      copyright: L.copyright.map(tx),
      endereco: L.endereco.map(tx),
    },
    colofao: { impresso: tx(L.impresso) },
  }
}

// ── aplicação ────────────────────────────────────────────────────

const dataCurta = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : String(iso || '') }
const edicaoDoRosto = e => { const s = String(e || '').trim(); return /^\d+$/.test(s) ? `${s}ª edição` : s }
const lerJson = v => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v) || {} } catch { return {} } }

/** Troca uma lista de parágrafos (créditos) por itens novos: o 1º com o estilo do 1º da lista, os demais com o do 2º. */
function trocarLista(lista, itens, mudou) {
  if (!lista.length || !Array.isArray(itens)) return
  const novos = itens.map(juntar).filter(Boolean)
  if (novos.join('\n') === lista.map(x => textoDoParagrafo(x.p).trim()).join('\n')) return
  const h = lista[0].h.h
  const primeiro = lista[0].p, demais = (lista[1] || lista[0]).p
  const ultimo = lista.at(-1).p
  const pars = novos.map((t, i) => copiaDe(i === 0 ? primeiro : demais, t))
  if (pars.length) pars.at(-1).br = ultimo.br
  const ini = h.pars.indexOf(primeiro), fim = h.pars.indexOf(ultimo)
  h.pars.splice(ini, fim - ini + 1, ...pars)
  mudou.add(lista[0].h)
}

/** Troca parágrafo a parágrafo (vazio mantém o do livro). */
function trocarCada(lista, textos, mudou) {
  if (!Array.isArray(textos)) return
  lista.forEach((x, i) => {
    const t = textos[i]
    if (t == null || !String(t).trim()) return
    if (String(t).trim() === textoDoParagrafo(x.p).trim()) return
    trocarTexto(x.p, String(t).trim())
    mudou.add(x.h)
  })
}

function trocarUm(x, t, mudou) {
  if (!x || t == null || !String(t).trim()) return
  if (String(t).trim() === textoDoParagrafo(x.p).trim()) return
  trocarTexto(x.p, String(t).trim())
  mudou.add(x.h)
}

/**
 * Aplica no IDML os dados da publicação e a Mesa (Configurações). Campo vazio mantém o texto do
 * livro. Devolve { historias: [Self das histórias trocadas], trocas: [descrições] }.
 * institucional: { legislatura, cargos: [{ chave, cargo, nome }] }
 * publicacao: descricao (ementa do rosto), edicao, lancado_em (ano do rosto e colofão), pretextuais
 *   ({ atualizadoAte, folhaTecnica: { creditosInstitucionais, creditosPublicacao, informacoes, ficha, copyright, endereco } })
 */
export async function aplicarPretextuaisDoLivro(zip, { publicacao = {}, institucional = {} } = {}) {
  const historias = await historiasDoLivro(zip)
  const L = localizar(historias)
  const mudou = new Set()
  const pre = lerJson(publicacao.pretextuais)
  const inst = lerJson(institucional)

  // Mesa: só os cargos que o livro já tem
  trocarUm(L.legislatura, inst.legislatura, mudou)
  const cargos = new Map((inst.cargos || []).map(c => [c.chave, c]))
  for (const m of L.mesa) {
    const c = m.chave && cargos.get(m.chave)
    if (!c) continue
    trocarUm(m.cargo, c.cargo, mudou)
    if (m.nome) trocarUm(m.nome, c.nome, mudou)
  }

  // folha de rosto
  trocarUm(L.ementa, publicacao.descricao, mudou)
  // a edição na caixa do livro ("31ª EDIÇÃO" no Regimento)
  if (L.edicao && publicacao.edicao) {
    const atual = textoDoParagrafo(L.edicao.p).trim(), nova = edicaoDoRosto(publicacao.edicao)
    trocarUm(L.edicao, atual === atual.toLocaleUpperCase('pt-BR') ? nova.toLocaleUpperCase('pt-BR') : nova, mudou)
  }
  const lancado = String(publicacao.lancado_em || '').match(/^(\d{4})-(\d{2})/)
  if (lancado) trocarUm(L.ano, lancado[1], mudou)
  // colofão: mês e ano do lançamento
  if (L.impresso && lancado) trocarUm(L.impresso, `Impresso em ${MESES[Number(lancado[2]) - 1]} de ${lancado[1]}`, mudou)

  // folha técnica
  const ft = pre.folhaTecnica || {}
  trocarLista(L.institucionais, ft.creditosInstitucionais, mudou)
  trocarLista(L.publicacao, ft.creditosPublicacao, mudou)
  trocarCada(L.informacoes, ft.informacoes, mudou)
  trocarCada(L.ficha, ft.ficha, mudou)
  trocarCada(L.copyright, ft.copyright, mudou)
  trocarCada(L.endereco, ft.endereco, mudou)

  // "Atualizado até": no rosto e na ficha, onde o livro já mostra a data
  if (pre.atualizadoAte) for (const x of [L.atualizado, L.atualizadoFicha]) {
    if (!x) continue
    const t = textoDoParagrafo(x.p).trim()
    trocarUm(x, t.replace(/(atualizad[ao] até\s*)\d{1,2}\/\d{1,2}\/\d{4}/i, `$1${dataCurta(pre.atualizadoAte)}`), mudou)
  }

  for (const x of mudou) zip.file(x.arquivo, escreverHistoria(x.h))
  return { historias: [...mudou].map(x => x.self) }
}

export const _teste = { localizar, historiasDoLivro, NBSP }
