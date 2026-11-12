/**
 * historia.js — publicação do Normando → story do miolo em IDML.
 *
 * Mesmo mapeamento dos scripts de inserção no InDesign (scripts/indesign/
 * inserir_norma_legislator*.jsx), mais as regras que, nos livros, eram feitas à mão:
 *   • abertura de cada seção (tit-subtit:abertura-cap, que já começa página nova) — a
 *     1ª seção não tem abertura; quando a seção começa com um Texto comum cujo 1º bloco
 *     é um título, esse título vira a abertura (é o "texto introdutório da seção");
 *   • estilo de caractere `parte1` no texto que alimenta o cabeço corrido (variável
 *     "Epígrafe parte 1"): a abertura da seção ou, com cabecalho:'norma', o apelido
 *     (ou a epígrafe) de cada norma;
 *   • Texto comum: estilos artigos:* — listas ("Lista de…") com tópico/ementa sem recuo;
 *   • 1ª assinatura depois da data com espaço antes (ass-nome-espaco-ant);
 *   • Emenda Constitucional: epígrafe e ementa próprias.
 *
 * Não gera nenhum ajuste fino (entrelinha, tracking, condições): isso fica no InDesign.
 */

import { segmentarTranslineacao, comHifens } from './translineacao.js'

const SEM_CHAR = 'CharacterStyle/$ID/[No character style]'
const QUEBRA_LINHA = '\u2028'

export const ESTILO = {
  epigrafe: 'tit-subtit:epigrafe',
  epigrafeEmenda: 'tit-subtit:epigrafe-emenda',
  epigrafeApelido: 'tit-subtit:epigrafe-apelido',
  notaTitulo: 'corpo-legis:nota-titulos',
  ementa: 'corpo-legis:ementa',
  ementaEmenda: 'corpo-legis:emenda-ementa',
  paragrafAbertura: 'corpo-legis:texto-lei-sem-indent',
  paragrafFacoSaber: 'corpo-legis:texto-lei-faco-saber',
  aberturaCapitulo: 'tit-subtit:abertura-cap',
  aberturaSecao: 'tit-subtit:abertura-cap',
  aberturaSecaoDireita: 'tit-subtit:abertura-cap-quebra-dir',
  partelivroTitCap: 'tit-subtit:parte-livro-tit-cap',
  secaoSubsecao: 'tit-subtit:secao-subsecao',
  artigo: 'corpo-legis:art',
  artigoTitulo: 'corpo-legis:art-tit-centro',
  textoLei: 'corpo-legis:texto-lei',
  nomeJuridico: 'corpo-legis:nome-juridico',
  citacao: 'corpo-legis:texto-lei-citacao',
  data: 'corpo-legis:ass-data',
  assinaturaPrimeira: 'corpo-legis:ass-nome-espaco-ant',
  assinaturaConstituicao: 'corpo-legis:ass-cf',
  assinatura: 'corpo-legis:ass-nome',
  notaRodape: 'corpo-legis:nota-rodape',
  tabelaContem: 'corpo-legis:texto-lei-sem-indent',
  celula: 'tabela:tab-corpo-esq',
  celulaCabecalho: 'tabela:tab-cab-centro',
  // Texto comum
  textoTitulo: 'artigos:epigrafe-artigo',
  textoSubtitulo: 'artigos:topico-artigo',
  textoCorrido: 'artigos:corpo-artigo',
  textoCorridoAposTitulo: 'artigos:corpo-artigo-esp-ant',
  textoRecuado: 'artigos:recuado-artigo',
  textoCitacao: 'artigos:citacao-artigo',
  textoBullets: 'artigos:bullet-artigo-lista',
  textoAssinatura: 'artigos:ass-autor',
  textoAssinaturaFinal: 'artigos:ass-autor-final',
  textoAssinaturaCargo: 'artigos:ass-cargo',
  listaTopico: 'artigos:topico-artigo-sem-rec',
  listaCorrido: 'artigos:corpo-artigo-rem-rec',
}

const TEXTO_LEI = new Set(['corpoTratado', 'paragrafLei', 'inciso', 'alinea', 'item', 'paragraph'])

// blocos que abrem uma norma, antes do texto: ficam presos ao início do 1º artigo
const CABECA_DA_NORMA = new Set(['epigrafe', 'epigrafeApelido', 'notaTitulo', 'ementa', 'paragrafAbertura',
  'paragrafFacoSaber', 'aberturaCapitulo', 'partelivroTitCap', 'secaoSubsecao', 'artigoTitulo',
  'textoComumTitulo', 'textoComumSubtitulo'])

// ── texto e marcas ───────────────────────────────────────────────
const escXml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // caracteres de controle não são válidos em XML (tab e quebras ficam)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')

const selfPar = nome => 'ParagraphStyle/' + nome.replace(/%/g, '%25').replace(/:/g, '%3a')
const selfChar = nome => nome ? 'CharacterStyle/' + nome.replace(/%/g, '%25').replace(/:/g, '%3a') : SEM_CHAR

/** Estilo de caractere de um trecho, pelas marcas do TipTap (como activeCharStyleName do JSX). */
export function estiloDasMarcas(marks = []) {
  const t = new Set(marks.map(m => m.type))
  if (t.has('boldArtigo')) return 'bold-artigo'
  if (t.has('notaSobrescrito')) return 'sobrescrito-nota'
  if (t.has('nota')) {
    if (t.has('superscript')) return 'sobrescrito-nota'
    return t.has('italic') || t.has('italicoLight') ? 'italico light' : 'nota novo formato'
  }
  if (t.has('superscript')) return t.has('italic') ? 'sobrescrito-italico' : 'sobrescrito'
  if (t.has('italicoLight')) return 'italico light'
  if (t.has('italic') && t.has('bold')) return 'bold-italic'
  if (t.has('italic')) return 'italico'
  if (t.has('bold')) return 'bold'
  if (t.has('regular')) return 'regular'
  return null
}

/** HTML simples do texto da nota de rodapé → texto (itálico vira o estilo `italico`). */
function runsDaNotaRodape(html) {
  const runs = []
  let italico = 0, sobre = 0
  for (const parte of String(html || '').split(/(<[^>]+>)/)) {
    if (!parte) continue
    const tag = parte.match(/^<(\/?)(\w+)/)
    if (tag) {
      const d = tag[1] ? -1 : 1
      if (/^(i|em)$/i.test(tag[2])) italico = Math.max(0, italico + d)
      if (/^sup$/i.test(tag[2])) sobre = Math.max(0, sobre + d)
      if (/^br$/i.test(tag[2])) runs.push({ texto: ' ', char: null })
      continue
    }
    const texto = parte.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    runs.push({ texto, char: sobre ? 'sobrescrito' : italico ? 'italico' : null })
  }
  return runs
}

/** Nós inline do TipTap → runs { texto, char } e notas de rodapé { nota: runs }. */
export function runsInline(nos = [], rel) {
  const runs = []
  for (const no of nos) {
    if (no.type === 'hardBreak') { runs.push({ texto: QUEBRA_LINHA, char: null }); continue }
    if (no.type !== 'text') continue
    const nota = no.marks?.find(m => m.type === 'notaRodape')
    if (nota) {
      // o texto do nó é um marcador ("[nota de rodapé 1: …]"); o conteúdo está em attrs.texto
      runs.push({ nota: runsDaNotaRodape(nota.attrs?.texto ?? '') })
      if (rel) rel.notasRodape++
      continue
    }
    // texto vindo de um IDML (textosDeIdml.js) já traz o estilo de caractere
    const char = 'char' in no ? no.char : estiloDasMarcas(no.marks || [])
    if (no.marks?.some(m => m.type === 'subscript') && rel) rel.subscritos++
    runs.push({ texto: no.text || '', char })
  }
  return semColchetesNaChamada(juntar(runs))
}

/**
 * Tira os colchetes em volta da chamada de nota: "meio;[" + nota + "]" (como veio o Tratado de
 * Marraqueche). A chamada é só o número automático; os colchetes não existem no projeto gráfico.
 */
function semColchetesNaChamada(runs) {
  runs.forEach((r, i) => {
    const ant = runs[i - 1], prox = runs[i + 1]
    if (!r.nota || !ant?.texto?.endsWith('[') || !prox?.texto?.startsWith(']')) return
    ant.texto = ant.texto.slice(0, -1)
    prox.texto = prox.texto.slice(1)
  })
  return runs.filter(r => r.nota || r.texto !== '')
}

function juntar(runs) {
  const out = []
  for (const r of runs) {
    const ant = out[out.length - 1]
    if (ant && !ant.nota && !r.nota && ant.char === r.char) ant.texto += r.texto
    else out.push({ ...r })
  }
  return out
}

const textoDe = no => (no?.content || []).map(c => c.type === 'text' ? c.text : c.type === 'hardBreak' ? ' ' : '').join('').trim()

// ── blocos → parágrafos ──────────────────────────────────────────

/**
 * Publicação → lista de parágrafos { estilo, runs, parte1?, tabela? }.
 * publicacao = { secoes: [{ titulo, normas: [{ tipo, epigrafe, doc, pular }] }] }
 * opcoes = { cabecalho: 'secao' | 'norma' }
 */
export function paragrafosDaPublicacao(publicacao, opcoes = {}, rel = novoRelatorio()) {
  const cabecalhoPorNorma = opcoes.cabecalho === 'norma'
  const pars = []
  let primeiraAbertura = true
  const secoes = publicacao.secoes || []

  secoes.forEach((secao, iSecao) => {
    const normas = (secao.normas || []).filter(n => !n.pular)
    if (!normas.length) return
    // abertura: o título do texto introdutório da seção, ou o título da seção (a 1ª não tem)
    const primeira = normas[0]
    const primeiroBloco = primeira.doc?.content?.[0]
    const introComTitulo = primeira.tipo === 'Texto comum' && primeiroBloco?.type === 'textoComumTitulo'
    let tituloAbertura = null
    if (iSecao > 0) tituloAbertura = introComTitulo ? null : (secao.tituloImpresso || secao.titulo)
    if (tituloAbertura) {
      pars.push(abertura(runsTexto(tituloAbertura), primeiraAbertura, !cabecalhoPorNorma))
      primeiraAbertura = false
      rel.aberturas++
    }

    normas.forEach((norma, iNorma) => {
      const blocos = norma.doc?.content || []
      const ehTexto = norma.tipo === 'Texto comum'
      const ehEmenda = norma.tipo === 'Emenda Constitucional'
      // Constituição: depois da data vêm a Mesa e os constituintes, no estilo próprio (ass-cf)
      const ehConstituicao = norma.tipo === 'Constituição'
      let aposDataCF = false
      const lista = ehTexto && /^lista\b/i.test(textoDe(blocos.find(b => b.type === 'textoComumTitulo')))
      let aposTitulo = false
      let aposData = false
      // assinaturas do Texto comum: sem blocos de cargo, alternam nome / cargo
      const comCargo = blocos.some(b => b.type === 'textoComumAssinaturaCargo')
      const nAssinaturas = blocos.filter(b => b.type === 'textoComumAssinatura').length
      const autores = comCargo ? nAssinaturas : Math.ceil(nAssinaturas / 2)
      let assinaturaN = 0, autorN = 0
      // cabeço por norma: parte1 no apelido; sem apelido, na epígrafe
      const temApelido = blocos.some(b => b.type === 'epigrafeApelido')

      // abertura da norma (epígrafe, apelido, nota, ementa, preâmbulo, títulos): fica na mesma página
      // de pelo menos 2 linhas do 1º artigo — os parágrafos da abertura levam `cola` e o 1º
      // parágrafo de texto, `manter2`
      let naAbertura = blocos.some(b => CABECA_DA_NORMA.has(b.type) && /^(epigrafe|textoComumTitulo|paragrafFacoSaber)$/.test(b.type))
      const marcarAbertura = (b, par) => {
        if (!naAbertura) return
        // recortes: "[...]" antes do 1º artigo também é abertura
        if (CABECA_DA_NORMA.has(b.type) || /^\[\s*\.\.\.\s*\]$/.test(textoDe(b))) { par.cola = true; return }
        par.manter2 = true
        naAbertura = false
      }

      rel.normas++
      const inicioNorma = pars.length
      blocos.forEach((b, iBloco) => {
        // título do texto introdutório → abertura da seção
        if (iNorma === 0 && iBloco === 0 && introComTitulo && iSecao > 0) {
          pars.push(abertura(runsInline(b.content, rel), primeiraAbertura, !cabecalhoPorNorma))
          primeiraAbertura = false
          rel.aberturas++
          return
        }
        if (b.type === 'table') { pars.push({ estilo: ESTILO.tabelaContem, tabela: tabelaDe(b, rel) }); rel.tabelas++; return }

        const runs = runsInline(b.content, rel)
        let estilo = null, parte1 = false
        switch (b.type) {
          case 'epigrafe':
            estilo = ehEmenda ? ESTILO.epigrafeEmenda : ESTILO.epigrafe
            parte1 = cabecalhoPorNorma && !temApelido
            aposData = false
            break
          case 'epigrafeApelido': estilo = ESTILO.epigrafeApelido; parte1 = cabecalhoPorNorma; break
          case 'ementa': estilo = ehEmenda ? ESTILO.ementaEmenda : ESTILO.ementa; break
          case 'data': estilo = ESTILO.data; aposData = true; break
          case 'assinatura':
          case 'assinaturaNome':
            estilo = aposData ? ESTILO.assinaturaPrimeira : ESTILO.assinatura
            aposData = false
            break
          case 'assinaturaData': estilo = ESTILO.data; aposData = true; break
          case 'textoComumTitulo': estilo = ESTILO.textoTitulo; break
          case 'textoComumSubtitulo': estilo = lista ? ESTILO.listaTopico : ESTILO.textoSubtitulo; break
          case 'textoComumCorrido':
            // 1º parágrafo depois do título de um texto (ex.: Nota das organizadoras) tem espaço antes
            estilo = lista ? ESTILO.listaCorrido : aposTitulo ? ESTILO.textoCorridoAposTitulo : ESTILO.textoCorrido
            break
          case 'textoComumRecuado': estilo = ESTILO.textoRecuado; break
          case 'textoComumCitacao': estilo = ESTILO.textoCitacao; break
          case 'textoComumBullets': estilo = ESTILO.textoBullets; break
          case 'textoComumAssinatura':
            assinaturaN++
            if (!comCargo && assinaturaN % 2 === 0) { estilo = ESTILO.textoAssinaturaCargo; break }
            autorN++
            estilo = autores > 1 && autorN === autores ? ESTILO.textoAssinaturaFinal : ESTILO.textoAssinatura
            break
          case 'textoComumAssinaturaCargo': estilo = ESTILO.textoAssinaturaCargo; break
          default:
            estilo = TEXTO_LEI.has(b.type) ? ESTILO.textoLei : ESTILO[b.type] || null
        }
        // texto vindo de um IDML (textosDeIdml.js): o estilo de parágrafo de lá
        if (b.attrs?.estiloIdml) estilo = b.attrs.estiloIdml
        if (ehConstituicao) {
          if (aposDataCF && /^(paragrafLei|assinatura|assinaturaNome)$/.test(b.type)) estilo = ESTILO.assinaturaConstituicao
          if (b.type === 'data') aposDataCF = true
        }
        // emenda: a ementa vem como parágrafo comum em itálico, logo depois da publicação; o estilo
        // de ementa já é centrado e em itálico
        if (ehEmenda && b.type === 'paragrafLei' && blocos[iBloco - 1]?.type === 'notaTitulo' && blocos[iBloco - 2]?.type === 'epigrafe') {
          estilo = ESTILO.ementaEmenda
          for (const r of runs) if (r.char === 'italico') r.char = null
        }
        // "(Publicada no DOU…)" da CF e das emendas: o texto fica no estilo, e o DOU em itálico light
        if ((ehEmenda || ehConstituicao) && b.type === 'notaTitulo') {
          for (const r of runs) r.char = r.char === 'nota novo formato' ? null : r.char === 'italico' ? 'italico light' : r.char
        }
        // nota-titulos de qualquer norma ("…publicado no DOU de…"): o itálico é o light, na cor da nota
        // (o "italico" comum sai mais escuro que o resto do parágrafo)
        if (b.type === 'notaTitulo' || estilo === ESTILO.notaTitulo) {
          for (const r of runs) if (r.char === 'italico') r.char = 'italico light'
        }
        if (!estilo) { rel.ignorados[b.type] = (rel.ignorados[b.type] || 0) + 1; return }
        aposTitulo = b.type === 'textoComumTitulo' && !lista
        if (!runs.length) return   // parágrafo vazio
        const par = { estilo, runs: parte1 ? comParte1(runs) : runs }
        // texto vindo de um IDML: overrides de composição de lá (calibração com o InDesign)
        if (b.attrs?.ajustesIdml) par.ajustesIdml = b.attrs.ajustesIdml
        // livro dividido pelas epígrafes: o cabeço da página ímpar desta norma (artigo ou título)
        if (b.attrs?.cabModo) par.cabModo = b.attrs.cabModo
        // origem (norma e bloco): âncora dos ajustes locais de paginação (pdf/ajustesLocais.js)
        par.origem = { norma: norma.norma_id ?? norma.id ?? null, bloco: iBloco }
        marcarAbertura(b, par)
        // termina com ":" (caput que abre incisos/alíneas): não fica sozinho no pé da página
        if (terminaComDoisPontos(runs)) par.doisPontos = true
        pars.push(par)
      })
      marcarFecho(pars.slice(inicioNorma))
      // início de norma: buraco e espelho desequilibrado antes dele são aceitáveis (paginação do PDF)
      if (pars[inicioNorma]) pars[inicioNorma].inicioNorma = true
    })
  })
  rel.paragrafos = pars.length
  // espaço sem quebra entre "art."/"arts."/"§"/"§§"/"R$" e o número, sempre (IDML e PDF)
  for (const p of pars) {
    if (p.runs) espacosSemQuebra(p.runs)
    for (const c of p.tabela?.celulas || []) for (const runs of c.pars) espacosSemQuebra(runs)
  }
  return pars
}

const NBSP = String.fromCharCode(0xa0)
// "art. 5º", "arts. 205", "§ 1º", "§§ 2º", "R$ 1.200,00": o número não pode ir para a linha seguinte
const ANTES_DO_NUMERO = /(\b[Aa]rts?\.|§§?|R\$)[   ](?=\d)/gu

/** Troca, nos runs (e nas notas de rodapé), o espaço comum depois de art./§/R$ pelo espaço sem quebra. */
function espacosSemQuebra(runs) {
  for (const r of runs) {
    if (typeof r.texto === 'string') r.texto = r.texto.replace(ANTES_DO_NUMERO, `$1${NBSP}`)
    if (Array.isArray(r.nota)) espacosSemQuebra(r.nota)
  }
}

/**
 * Estilos de caractere que o GREP do estilo de parágrafo aplica no InDesign (CF de bolso: "I –",
 * "§ 1º" em negrito), para o Normando compor com as mesmas larguras. Os trechos ficam com `grep`.
 * regras: { 'corpo-legis:texto-lei': [{ expressao, char }] }, expressão como no InDesign.
 */
export function aplicarGrep(pars, regras) {
  const compiladas = Object.fromEntries(Object.entries(regras || {}).map(([estilo, lista]) => [estilo, lista.flatMap(({ expressao, char }) => {
    try {
      return [{ re: new RegExp(expressao.replace(/\\u/g, '\\p{Lu}').replace(/\\l/g, '\\p{Ll}').replace(/~=/g, '–'), 'gu'), char }]
    } catch { return [] }
  })]))
  for (const p of pars) {
    const lista = compiladas[p.estilo]
    if (!lista?.length || !p.runs) continue
    const texto = p.runs.map(r => r.nota ? '' : r.texto ?? '').join('')
    const marcas = lista.flatMap(({ re, char }) => [...texto.matchAll(re)].filter(m => m[0]).map(m => ({ de: m.index, ate: m.index + m[0].length, char })))
    if (!marcas.length) continue
    const out = []
    let pos = 0
    for (const r of p.runs) {
      if (r.nota || typeof r.texto !== 'string') { out.push(r); continue }
      const fim = pos + r.texto.length
      const cortes = [...new Set([pos, fim, ...marcas.flatMap(m => [m.de, m.ate]).filter(x => x > pos && x < fim)])].sort((a, b) => a - b)
      for (let k = 0; k + 1 < cortes.length; k++) {
        const [a, b] = [cortes[k], cortes[k + 1]]
        const m = marcas.find(x => x.de <= a && b <= x.ate)
        const trecho = r.texto.slice(a - pos, b - pos)
        out.push(m && !r.char ? { ...r, texto: trecho, char: m.char, grep: true } : { ...r, texto: trecho })
      }
      pos = fim
    }
    p.runs = out
  }
  return pars
}

/**
 * Tira o espaço sem quebra dos grupos que deixavam aberta a linha anterior (CF de bolso).
 * grupos: Map 'norma:bloco' → grupos de palavras ("art. 5º,") daquele parágrafo.
 */
export function soltarNbsp(pars, grupos, { numeroParentese = false } = {}) {
  // número preso ao parêntese por extenso ("3.000.000 (três milhões)"): no bolso o espaço sem quebra
  // sai sempre — o InDesign e o compositor quebram essas alíneas de jeitos diferentes, e preso ele
  // abre a linha (usuário, 2026-11-07: a quebra deve poder ficar depois do número)
  if (numeroParentese) {
    for (const p of pars) for (const r of p.runs || []) if (typeof r.texto === 'string') r.texto = r.texto.replace(/(\d) \(/g, '$1 (')
  }
  if (!grupos?.size) return pars
  for (const p of pars) {
    const lista = p.origem && grupos.get(`${p.origem.norma}:${p.origem.bloco}`)
    if (!lista || !p.runs) continue
    for (const r of p.runs) {
      if (typeof r.texto !== 'string') continue
      for (const g of lista) r.texto = r.texto.split(g).join(g.split(NBSP).join(' '))
    }
  }
  return pars
}

export function novoRelatorio() {
  return { normas: 0, paragrafos: 0, aberturas: 0, tabelas: 0, notasRodape: 0, subscritos: 0, ignorados: {}, estilosAusentes: {}, puladas: [] }
}

const runsTexto = t => [{ texto: String(t || ''), char: null }]

// fecho da norma: data e assinaturas (lei) ou assinaturas do Texto comum
const ESTILOS_FECHO = new Set([ESTILO.data, ESTILO.assinaturaPrimeira, ESTILO.assinatura, ESTILO.assinaturaConstituicao,
  ESTILO.textoAssinatura, ESTILO.textoAssinaturaFinal, ESTILO.textoAssinaturaCargo])

/**
 * O fecho fica na mesma página de parte do último artigo: o último parágrafo de texto antes da
 * data/assinaturas e cada parágrafo do fecho (menos o último) ficam presos ao seguinte (`fecho`).
 * O fecho nem sempre é o fim da norma (anexos vêm depois das assinaturas): vale cada sequência
 * de parágrafos de data/assinatura.
 */
function marcarFecho(doNorma) {
  for (let ini = 1; ini < doNorma.length; ini++) {
    if (!ESTILOS_FECHO.has(doNorma[ini].estilo) || ESTILOS_FECHO.has(doNorma[ini - 1].estilo)) continue
    let fim = ini
    while (fim + 1 < doNorma.length && ESTILOS_FECHO.has(doNorma[fim + 1].estilo)) fim++
    for (let k = ini - 1; k < fim; k++) doNorma[k].fecho = true
    ini = fim
  }
}

/** Texto do parágrafo (sem notas de alteração e de rodapé no fim) termina com ":"? */
function terminaComDoisPontos(runs) {
  const t = runs.filter(r => !r.nota && !/^(nota novo formato|italico light|nota titulos)/.test(r.char || ''))
    .map(r => r.texto || '').join('').trim()
  return t.endsWith(':')
}

function abertura(runs, primeira, parte1) {
  return { estilo: primeira ? ESTILO.aberturaSecaoDireita : ESTILO.aberturaSecao, runs: parte1 ? comParte1(runs) : runs }
}

/** `parte1` nos trechos sem estilo de caractere (é o que a variável do cabeço lê). */
const comParte1 = runs => runs.map(r => r.nota || r.char ? r : { ...r, char: 'parte1' })

// ── tabelas ──────────────────────────────────────────────────────
function tabelaDe(no, rel) {
  const linhas = (no.content || []).filter(r => r.type === 'tableRow')
  // grade: posição de cada célula considerando colspan/rowspan
  const ocupado = []
  const celulas = []
  let colunas = 0
  linhas.forEach((linha, r) => {
    let c = 0
    for (const cel of linha.content || []) {
      while (ocupado[r]?.[c]) c++
      const cs = Math.max(1, Number(cel.attrs?.colspan) || 1)
      const rs = Math.max(1, Number(cel.attrs?.rowspan) || 1)
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
        ocupado[r + i] = ocupado[r + i] || []
        ocupado[r + i][c + j] = true
      }
      celulas.push({ r, c, cs, rs, cabecalho: cel.type === 'tableHeader', larguras: cel.attrs?.colwidth, pars: (cel.content || []).map(p => runsInline(p.content, rel)) })
      c += cs
      colunas = Math.max(colunas, c)
    }
  })
  const nLinhas = Math.max(linhas.length, ocupado.length)
  // linhas de cabeçalho: as primeiras em que todas as células são de cabeçalho
  let cabecalho = 0
  for (let r = 0; r < nLinhas; r++) {
    const daLinha = celulas.filter(x => x.r === r)
    if (daLinha.length && daLinha.every(x => x.cabecalho)) cabecalho++
    else break
  }
  // larguras: colwidth do editor (px) quando houver, senão iguais; proporção aplicada à mancha
  const pesos = Array(colunas).fill(null)
  for (const x of celulas) if (Array.isArray(x.larguras) && x.cs === x.larguras.length) x.larguras.forEach((w, j) => { if (w) pesos[x.c + j] = w })
  const conhecidos = pesos.filter(Boolean)
  const media = conhecidos.length ? conhecidos.reduce((a, b) => a + b, 0) / conhecidos.length : 1
  return { colunas, linhas: nLinhas, cabecalho, celulas, pesos: pesos.map(p => p || media) }
}

// ── serialização (story IDML) ────────────────────────────────────
let seqTabela = 0

function csr(char, conteudo, semQuebra = false) {
  return `<CharacterStyleRange AppliedCharacterStyle="${escXml(selfChar(char))}"${semQuebra ? ' NoBreak="true"' : ''}>${conteudo}</CharacterStyleRange>`
}

/** Trecho de texto com os pontos de translineação proibidos em "Sem quebra" (translineacao.js). */
function csrTexto(char, texto) {
  // com hífen discricionário (divisão única), sem "Sem quebra": o InDesign só divide a palavra nele
  return segmentarTranslineacao(texto).filter(s => s.t)
    .map(s => s.hifens ? csr(char, content(comHifens(s))) : csr(char, content(s.t), s.protegido)).join('') || csr(char, '')
}

/** Texto → <Content>, com a quebra de linha forçada como caractere (U+2028). */
const content = t => t ? `<Content>${escXml(t)}</Content>` : ''

function runsXml(runs) {
  return runs.map(r => {
    if (r.nota) {
      const corpo = r.nota.map((x, i) => csrTexto(x.char, (i === 0 ? '\t' : '') + x.texto)).join('')
      // número automático (<?ACE 4?>) no começo do texto da nota, como o InDesign grava
      const notaXml = `<Footnote><ParagraphStyleRange AppliedParagraphStyle="${escXml(selfPar(ESTILO.notaRodape))}">` +
        (corpo ? corpo.replace('<Content>', '<Content><?ACE 4?>') : csr(null, '<Content><?ACE 4?></Content>')) +
        '</ParagraphStyleRange></Footnote>'
      return csr('sobrescrito', notaXml)
    }
    // palavra protegida pela paginação (IDML ajustado, decisoesIdml.js): sem quebra
    // estilo vindo de GREP do estilo de parágrafo: o InDesign aplica sozinho, e estilo direto
    // mudaria o cabeço (a variável "Artigo-CF" só vê bold-artigo aplicado à mão)
    const char = r.grep ? null : r.char
    if (r.semQuebra) return csr(char, content(r.texto), true)
    return csrTexto(char, r.texto)
  }).join('')
}

function tabelaXml(t, largura) {
  const id = `ntab${(++seqTabela).toString(36)}`
  const soma = t.pesos.reduce((a, b) => a + b, 0) || 1
  const cols = t.pesos.map((p, i) => `<Column Self="${id}Column${i}" Name="${i}" SingleColumnWidth="${(largura * p / soma).toFixed(3)}"/>`).join('')
  const rows = Array.from({ length: t.linhas }, (_, i) => `<Row Self="${id}Row${i}" Name="${i}" AutoGrow="true"/>`).join('')
  const cells = t.celulas.map(x => {
    const estilo = x.cabecalho ? ESTILO.celulaCabecalho : ESTILO.celula
    const pars = x.pars.length ? x.pars : [[]]
    const corpo = pars.map((runs, i) =>
      `<ParagraphStyleRange AppliedParagraphStyle="${escXml(selfPar(estilo))}">${runs.length ? runsXml(runs) : csr(null, '')}${i < pars.length - 1 ? '<Br/>' : ''}</ParagraphStyleRange>`).join('')
    return `<Cell Self="${id}i${x.c}i${x.r}" Name="${x.c}:${x.r}" RowSpan="${x.rs}" ColumnSpan="${x.cs}" AppliedCellStyle="CellStyle/cel-corpo">${corpo}</Cell>`
  }).join('')
  return `<Table Self="${id}" HeaderRowCount="${t.cabecalho}" FooterRowCount="0" BodyRowCount="${t.linhas - t.cabecalho}" ColumnCount="${t.colunas}" ` +
    `AppliedTableStyle="TableStyle/tabela1" TableDirection="LeftToRightDirection">${rows}${cols}${cells}</Table>`
}

/**
 * Parágrafos → XML da story (<idPkg:Story>). `estilosExistentes`: Selfs de estilos
 * de parágrafo do modelo — estilo ausente cai em texto-lei e vai para o relatório.
 */
export function storyXml(self, pars, { versao = '21.5', largura = 371.3386, estilosExistentes = null, rel = null } = {}) {
  seqTabela = 0
  const corpo = paragrafosXml(pars, { largura, estilosExistentes, rel })
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="${versao}">\n` +
    `<Story Self="${self}" AppliedTOCStyle="n" UserText="true" IsEndnoteStory="false" TrackChanges="false" StoryTitle="Normando — miolo" AppliedNamedGrid="n">\n` +
    '<StoryPreference OpticalMarginAlignment="true" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>\n' +
    '<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>\n' +
    corpo + '\n</Story>\n</idPkg:Story>\n'
}

/**
 * Parágrafos → <ParagraphStyleRange>…, sem o invólucro da story. `terminarComBr`: o último
 * parágrafo também termina com <Br/> (trecho que entra no meio de uma story).
 */
export function paragrafosXml(pars, { largura = 371.3386, estilosExistentes = null, rel = null, terminarComBr = false } = {}) {
  return pars.map((p, i) => {
    let estilo = p.estilo
    if (estilosExistentes && !estilosExistentes.has(selfPar(estilo))) {
      if (rel) rel.estilosAusentes[estilo] = (rel.estilosAusentes[estilo] || 0) + 1
      estilo = ESTILO.textoLei
    }
    const fim = terminarComBr || i < pars.length - 1 ? '<Br/>' : ''
    const dentro = p.tabela ? csr(null, tabelaXml(p.tabela, largura)) : runsXml(p.runs)
    // abertura da norma presa às 2 primeiras linhas do 1º artigo (mesma regra do PDF)
    // e parágrafo que termina com ":" preso a 2 linhas do seguinte
    // e o fecho da norma (último artigo + data + assinaturas)
    let manter = p.cola || p.doisPontos || p.fecho ? ' KeepWithNext="2"' : p.manter2 ? ' KeepLinesTogether="true" KeepFirstLines="2"' : ''
    // IDML ajustado (decisoesIdml.js): overrides da paginação do Normando no lugar dessas regras
    let props = ''
    if (p.idml) {
      manter = Object.entries(p.idml.atributos).map(([k, v]) => ` ${k}="${escXml(v)}"`).join('')
      if (p.idml.propriedades) props = `<Properties>${p.idml.propriedades}</Properties>`
    }
    let texto = dentro + (fim ? csr(null, fim) : '')
    if (p.idml) texto = comAtributosDeCaractere(texto, p.idml.caractere, p.idml.propriedadesCaractere)
    return `<ParagraphStyleRange AppliedParagraphStyle="${escXml(selfPar(estilo))}"${manter}>${props}${texto}</ParagraphStyleRange>`
  }).join('\n')
}

/**
 * Atributos de caractere (tracking, entrelinha) em cada <CharacterStyleRange> do corpo do parágrafo —
 * fora das notas de rodapé e das tabelas, que têm os seus.
 */
function comAtributosDeCaractere(xml, atributos = {}, propriedades = '') {
  const attrs = Object.entries(atributos || {}).map(([k, v]) => ` ${k}="${escXml(v)}"`).join('')
  if (!attrs && !propriedades) return xml
  const props = propriedades ? `<Properties>${propriedades}</Properties>` : ''
  // trechos de nota e de tabela ficam como estão
  return xml.split(/(<Footnote>[\s\S]*?<\/Footnote>|<Table [\s\S]*?<\/Table>)/).map((parte, q) =>
    q % 2 ? parte : parte.replace(/<CharacterStyleRange ([^>]*?)>/g, (m, a) => `<CharacterStyleRange ${a}${attrs}>${props}`)).join('')
}

/** Quantidade aproximada de caracteres (para estimar o número de páginas). */
export function contarCaracteres(pars) {
  let n = 0
  for (const p of pars) {
    if (p.tabela) { n += p.tabela.celulas.reduce((s, c) => s + c.pars.flat().reduce((t, r) => t + (r.texto || '').length, 0), 0) * 1.6; continue }
    for (const r of p.runs) n += r.nota ? r.nota.reduce((t, x) => t + x.texto.length, 0) * 0.6 : r.texto.length
    n += 40   // fim de parágrafo: sobra média da última linha
  }
  return n
}
