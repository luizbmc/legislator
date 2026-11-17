/**
 * sumarioLivro.js — sumário do livro completo (livroCompleto.js) feito com as entradas do Normando.
 *
 * Segue o que o InDesign faz em Layout › Sumário, com o estilo de sumário do próprio livro
 * (TOCStyle): cada parágrafo do miolo cujo estilo está no estilo de sumário vira uma entrada, no
 * estilo de formatação dele (sum-…), com o número da página depois da tabulação de recuo à direita.
 * Depois, a caixa dos títulos como no script "Corrige a caixa de itens do sumário de legislação"
 * (caixaDoSumario).
 *
 * O que fica do sumário do livro: os parágrafos antes da 1ª entrada (título "Sumário"), as entradas
 * das páginas que o Normando não gera (antes do miolo gerado; depois dele, com a página deslocada) e
 * que tipos de entrada cada norma tem — o script do InDesign apaga à mão os títulos e capítulos "do
 * ponto do mouse em diante" (na CF, os dos tratados): uma norma só ganha as entradas dos tipos que já
 * tem no sumário do livro; norma que o livro não tem segue a anterior.
 */

import { lerHistoria, escreverHistoria } from './pretextuaisLivro.js'

const NBSP = String.fromCharCode(0xa0)
const LSEP = String.fromCharCode(0x2028)
const FEFF = String.fromCharCode(0xfeff)
const TAB_DIREITA = '<?ACE 8?>'
const SEM_CHAR = 'CharacterStyle/$ID/[No character style]'

const decodificar = s => String(s).replace(/<\?[^>]*\?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')
const codificar = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const selfPar = nome => 'ParagraphStyle/' + nome.replace(/%/g, '%25').replace(/:/g, '%3a')
const selfChar = nome => nome ? 'CharacterStyle/' + nome.replace(/%/g, '%25').replace(/:/g, '%3a') : SEM_CHAR
const nomeDeSelf = (self, tipo) => decodeURIComponent(String(self || '').replace(new RegExp(`^${tipo}/`), ''))
// chave de comparação de títulos: sem acento, caixa, pontuação e espaços
const chave = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Estilo de sumário do livro: { titulo, entradas: Map(estilo do miolo → { formato, nivel, numero,
 * separador, charNumero }) }. `story` é o XML da história do sumário (AppliedTOCStyle).
 */
export function lerEstiloSumario(stylesXml, story = '') {
  const aplicado = story.match(/<Story [^>]*AppliedTOCStyle="([^"]+)"/)?.[1]
  const estilos = [...stylesXml.matchAll(/<TOCStyle\b[^>]*>[\s\S]*?<\/TOCStyle>/g)].map(m => m[0])
  const xml = estilos.find(x => aplicado && x.includes(`Self="${aplicado}"`)) || estilos[0]
  if (!xml) return null
  const entradas = new Map()
  for (const m of xml.matchAll(/<TOCStyleEntry\b([^>]*)>([\s\S]*?)<\/TOCStyleEntry>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/\s([A-Za-z]+)="([^"]*)"/g)].map(x => [x[1], x[2]]))
    const formato = nomeDeSelf(m[2].match(/<FormatStyle[^>]*>([^<]*)</)?.[1], 'ParagraphStyle')
    const charNumero = m[2].match(/<PageNumberStyle[^>]*>([^<]*)</)?.[1] || ''
    const sep = a.Separator || '$ID/^y'
    // estilo de formatação em negrito (sum-epigrafe do Regimento): o número herda o negrito
    const iPs = stylesXml.indexOf(`<ParagraphStyle Self="${selfPar(formato)}"`)
    const psXml = iPs < 0 ? '' : stylesXml.slice(iPs, stylesXml.indexOf('>', iPs) + 1)
    entradas.set(a.Name, {
      formato,
      negrito: /FontStyle="[^"]*(Bold|Black|Semi)/i.test(psXml),
      nivel: Number(a.Level) || 1,
      numero: a.PageNumberPosition !== 'None',
      // ^y = tabulação de recuo à direita; ^t = tabulação
      separador: /\^y/.test(sep) ? TAB_DIREITA : /\^t/.test(sep) ? '\t' : decodificar(sep.replace(/^\$ID\//, '')),
      // estilo de caractere do número: "[Same Style]" = o da entrada; senão o indicado
      charNumero: /Same Style/.test(charNumero) ? null : /No character style/.test(charNumero) ? '' : nomeDeSelf(charNumero, 'CharacterStyle'),
    })
  }
  return { entradas }
}

// ── caixa dos títulos (script do InDesign) ───────────────────────

const PALAVRAS_MINUSCULAS = ['A', 'O', 'As', 'Os', 'Aos', 'Seu', 'Sua', 'Seus', 'Suas', 'Sem', 'De', 'Da', 'Do', 'Das', 'Dos', 'Na', 'No', 'Nas', 'Nos', 'Não', 'E', 'Ou', 'Com', 'Contra', 'Durante', 'Apenas', 'Perante', 'Entre', 'Mediante', 'Desde', 'Para', 'Ao', 'À', 'Que', 'Por', 'Em', 'Sobre', 'Pelo', 'Pela']
const RE_MINUSCULAS = new RegExp(`(?<!– )(?<=[ ${NBSP}])(${PALAVRAS_MINUSCULAS.join('|')})(?=[ ${NBSP}])`, 'g')
const ROTULOS = ['Parte', 'Livro', 'Título', 'Subtítulo', 'Capítulo']
const maiusc = t => t.toLocaleUpperCase('pt-BR')
const minusc = t => t.toLocaleLowerCase('pt-BR')
// "Title Case" do InDesign: 1ª letra de cada palavra maiúscula, o resto minúsculo (hífen separa palavras)
const tituloCase = t => minusc(t).replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (m, a, b) => a + maiusc(b))

/**
 * Caixa do texto de uma entrada, pelo estilo do sumário (sumario:sum-nivel1, sum-epigrafe…). As
 * trocas mantêm o tamanho do texto (os trechos com estilo de caractere continuam no lugar).
 */
export function caixaDoSumario(texto, formato) {
  let t = texto
  const nome = String(formato).split(':').pop()
  if (nome === 'sum-nivel1') {
    t = tituloCase(t)
    // número da parte, título, capítulo… em maiúsculas ("Título VI", "Capítulo IV-A")
    for (const r of ROTULOS) t = t.replace(new RegExp(`(?<=${r} ).+(?= –)`, 'g'), maiusc)
    // rótulo sem descrição ("Capítulo VI", "Título IV-A") e seção ("Seção II – …"): o número romano
    // em maiúsculas também
    for (const r of [...ROTULOS, 'Seção', 'Subseção']) t = t.replace(new RegExp(`(?<=${r} )[ivxlcdm]+(?:-\\p{L})?(?=[ ${NBSP}]–|$)`, 'giu'), maiusc)
    t = t.replace(RE_MINUSCULAS, minusc)
  }
  if (nome === 'sum-epigrafe') t = maiusc(t)
  t = t.replace(/(?<=Título )Vi+/g, maiusc).replace(/(?<=Título )Ix+/g, maiusc)
  return t.replace(/ÚNICO/g, 'Único')
}

/** Aplica uma troca que mantém o tamanho do texto aos trechos [{ texto, char }]. */
function trocarNosTrechos(trechos, f) {
  const todo = trechos.map(r => r.texto).join('')
  const novo = f(todo)
  if (novo.length !== todo.length) return [{ ...trechos[0], texto: novo }]
  let i = 0
  return trechos.map(r => { const t = novo.slice(i, i + r.texto.length); i += r.texto.length; return { ...r, texto: t } })
}

/**
 * Última linha da entrada com pelo menos `minimo` caracteres: os espaços do fim viram espaço sem
 * quebra até o trecho final ter esse tamanho (a quebra só pode vir antes dele).
 */
export function colarFinal(trechos, minimo = 8) {
  return trocarNosTrechos(trechos, t => {
    const c = [...t]
    for (let i = c.length - 1; i > 0; i--) {
      if (c[i] !== ' ') continue
      if (c.length - i - 1 >= minimo) break
      c[i] = NBSP
    }
    return c.join('')
  })
}

// ── entradas ─────────────────────────────────────────────────────

/** Trechos de um parágrafo do Normando (historia.js): sem notas, quebra de linha → " – ". */
function trechosDoParagrafo(p, temChar) {
  const out = []
  for (const r of p.runs || []) {
    if (r.nota || r.texto == null) continue
    const texto = String(r.texto).split(FEFF).join('').replace(new RegExp(`[\\n${LSEP}]`, 'g'), ' – ')
    if (!texto) continue
    out.push({ texto, char: r.char && temChar(r.char) ? r.char : null })
  }
  // espaços: duplos viram um; nada no começo e no fim
  let todo = out.map(r => r.texto).join('')
  if (!todo.trim()) return []
  const limpos = []
  let antesEspaco = true
  for (const r of out) {
    let t = ''
    for (const ch of r.texto.replace(new RegExp(NBSP + '(?=–)|(?<=–)' + NBSP, 'g'), ' ')) {
      const esp = ch === ' ' || ch === '\t'
      if (esp && antesEspaco) continue
      t += esp ? ' ' : ch
      antesEspaco = esp
    }
    if (t) limpos.push({ ...r, texto: t })
  }
  const ult = limpos.at(-1)
  if (ult) ult.texto = ult.texto.replace(/\s+$/, '')
  return limpos.filter(r => r.texto)
}

/**
 * Entradas do Normando: [{ formato, nivel, numero, separador, charNumero, trechos, pagina, origem }]
 * @param pars    parágrafos gerados (historia.js), na ordem
 * @param paginaDe (k) → página do livro do parágrafo k
 */
export function entradasDoNormando(pars, toc, paginaDe, temChar = () => true) {
  const out = []
  pars.forEach((p, k) => {
    const e = toc.entradas.get(p.estilo)
    if (!e) return
    let trechos = trechosDoParagrafo(p, temChar)
    if (!trechos.length) return
    trechos = trocarNosTrechos(trechos, t => caixaDoSumario(t, e.formato))
    // epígrafe: sem os estilos "parte 1"/"parte 2" do miolo
    if (/sum-epigrafe$/.test(e.formato)) trechos = trechos.map(r => (/^parte ?[12]$/i.test(r.char || '') ? { ...r, char: null } : r))
    out.push({ ...e, trechos, pagina: e.numero ? paginaDe(k) : null, origem: p.estilo })
  })
  return out
}

/** Entradas da história do sumário do livro: { cabeca: [pars antes da 1ª entrada], entradas: [{ formato, texto, numero, par }] }. */
function entradasDoLivro(h, formatos) {
  const cabeca = [], entradas = []
  for (const p of h.pars) {
    const formato = p.estilo
    const bruto = p.runs.map(r => r.bruto || '').join('')
    if (!entradas.length && !formatos.has(formato)) { cabeca.push(p); continue }
    if (!bruto.replace(/<[^>]*>/g, '').trim()) continue
    const [antes, depois] = bruto.split(TAB_DIREITA)
    const numero = depois != null && /^\s*\d+\s*$/.test(decodificar(depois)) ? Number(decodificar(depois)) : null
    entradas.push({ formato, texto: decodificar(antes).replace(/\s+/g, ' ').trim(), numero, par: p })
  }
  return { cabeca, entradas }
}

// entrada que abre uma norma (epígrafe, separador): nível 1 com número de página
const ehCabecaDeNorma = (e, toc) => [...toc.entradas.values()].some(x => x.formato === e.formato && x.nivel === 1 && x.numero)

/** Grupos de entradas por norma: [{ chave, tipos: Set(formato) }] (o 1º, antes de qualquer cabeça, com chave null). */
function grupos(entradas, toc, texto) {
  const out = [{ chave: null, tipos: new Set(), entradas: [] }]
  for (const e of entradas) {
    if (ehCabecaDeNorma(e, toc)) out.push({ chave: chave(texto(e)), tipos: new Set(), entradas: [e] })
    else { out.at(-1).tipos.add(e.formato); out.at(-1).entradas.push(e) }
  }
  return out
}

/**
 * Sumário novo.
 * @param storyXml  história do sumário do livro
 * @param normando  entradasDoNormando(...)
 * @param faixa     { primeira, primeiraMantida, paginaNova }: páginas geradas pelo Normando e o
 *                  deslocamento das mantidas depois delas; numeroRegular: estilo de caractere do
 *                  número quando ele sairia em negrito (Regimento: "regular")
 * @returns { xml, entradas: [{ titulo, estilo, numerada, pagina }], avisos }
 */
export function montarSumario(storyXml, toc, normando, { primeira, primeiraMantida, paginaNova, numeroRegular = null }) {
  const h = lerHistoria(storyXml)
  if (!h) return null
  const formatos = new Set([...toc.entradas.values()].map(e => e.formato))
  const livro = entradasDoLivro(h, formatos)
  const avisos = []

  // entradas do livro fora das páginas do Normando: antes (como estão) e depois (página deslocada);
  // entrada sem número vai com a numerada seguinte
  const paginaSeguinte = i => { for (let j = i; j < livro.entradas.length; j++) if (livro.entradas[j].numero != null) return livro.entradas[j].numero; return null }
  const antes = [], depois = []
  livro.entradas.forEach((e, i) => {
    const pg = paginaSeguinte(i)
    if (pg != null && pg < primeira) antes.push(e)
    else if (pg != null && pg >= primeiraMantida) depois.push(e)
  })

  // tipos de entrada de cada norma, pelo sumário do livro
  const gruposLivro = grupos(livro.entradas, toc, e => e.texto)
  const gruposNovos = grupos(normando, toc, e => e.trechos.map(r => r.texto).join(''))
  const usados = new Set()
  let tiposAnteriores = null
  const filtradas = []
  for (const g of gruposNovos) {
    const par = g.chave == null ? gruposLivro[0] : gruposLivro.find(x => !usados.has(x) && x.chave === g.chave)
    if (par) usados.add(par)
    // norma que o livro não tem: como a anterior (sem anterior, todos os tipos)
    const tipos = par ? par.tipos : tiposAnteriores
    tiposAnteriores = tipos
    // abertura sem número no sumário do livro (Constituição: o número fica para o Preâmbulo): sem número
    const semNumero = par && g.chave != null && par.entradas[0]?.numero == null
    for (const e of g.entradas) {
      if (ehCabecaDeNorma(e, toc)) filtradas.push(semNumero && e === g.entradas[0] ? { ...e, pagina: null } : e)
      else if (!tipos || tipos.has(e.formato)) filtradas.push(e)
    }
  }

  const parDaEntrada = e => {
    const runs = colarFinal(e.trechos).map(r => ({ abre: `<CharacterStyleRange AppliedCharacterStyle="${selfChar(r.char)}">`, props: '', char: r.char || '', bruto: codificar(r.texto) }))
    if (e.numero && e.pagina != null) {
      let charNum = e.charNumero == null ? e.trechos.at(-1)?.char || null : e.charNumero || null
      // Regimento: o número nunca em negrito, mesmo com a entrada em negrito
      if (numeroRegular && (/bold|black|semi|negrito/i.test(charNum || '') || (!charNum && e.negrito))) charNum = numeroRegular
      runs.push({ abre: `<CharacterStyleRange AppliedCharacterStyle="${selfChar(charNum)}">`, props: '', char: charNum || '', bruto: `${e.separador === TAB_DIREITA ? TAB_DIREITA : codificar(e.separador)}${e.pagina}` })
    }
    // sumário sem hifenização
    return { abre: `<ParagraphStyleRange AppliedParagraphStyle="${selfPar(e.formato)}" Hyphenation="false">`, props: '', estilo: e.formato, runs, br: true }
  }
  // entrada mantida do livro com a página nova
  const comPagina = (e, nova) => {
    if (e.numero == null || nova === e.numero) return e.par
    const p = { ...e.par, runs: e.par.runs.map(r => ({ ...r })) }
    for (let i = p.runs.length - 1; i >= 0; i--) {
      const r = p.runs[i]
      if (r.bruto && /\d+\s*$/.test(r.bruto)) { r.bruto = r.bruto.replace(/\d+(\s*)$/, `${nova}$1`); break }
    }
    return p
  }

  const pars = [
    ...livro.cabeca,
    ...antes.map(e => e.par),
    ...filtradas.map(parDaEntrada),
    ...depois.map(e => comPagina(e, paginaNova(e.numero))),
  ]
  if (pars.length) pars.at(-1).br = false
  h.pars = pars

  const titulo = txt => txt.replace(/\s+/g, ' ').trim()
  const entradas = [
    ...antes.map(e => ({ titulo: e.texto, estilo: e.formato, numerada: e.numero != null, pagina: e.numero })),
    ...filtradas.map(e => ({ titulo: titulo(e.trechos.map(r => r.texto).join('')), estilo: e.formato, numerada: !!e.numero && e.pagina != null, pagina: e.pagina })),
    ...depois.map(e => ({ titulo: e.texto, estilo: e.formato, numerada: e.numero != null, pagina: e.numero != null ? paginaNova(e.numero) : null })),
  ]
  for (const g of gruposLivro.slice(1)) if (!usados.has(g)) avisos.push(`Sumário: "${g.entradas[0].texto}" está no sumário do livro e não no texto do Normando.`)
  return { xml: escreverHistoria(h), entradas, avisos }
}
