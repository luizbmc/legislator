/**
 * ajustesLocais.js — ajustes locais de paginação feitos por revisores e diagramador (tela de
 * paginação), guardados com a publicação (publicacoes.ajustes_paginacao, JSON) e aplicados no PDF e
 * no IDML. Prevalecem sobre a verificação automática da composição.
 *
 * Formato: { versao: 1, itens: [ajuste, …] }, cada ajuste com uma âncora:
 *   { tipo: 'paragrafo', ancora, tr, sp }            tracking (em) e espaço entre palavras (%) fixos
 *   { tipo: 'palavra', ancora, palavra, ocorrencia, hifen: 'proibir' | 'permitir' | posição }
 *                                                     hífen numa palavra (posição = letras antes do hífen)
 *   { tipo: 'juntar', ancora, palavra, ocorrencia }  espaço sem quebra depois da palavra
 *   { tipo: 'fimPagina', ancora, linha }             a página termina depois da linha `linha` do
 *                                                     parágrafo (0 = antes do parágrafo)
 *   { tipo: 'naoTerminar', ancora, linha }           a página não pode terminar ali
 *   { tipo: 'entrelinha', ancora, linha, fator }     entrelinha da página que começa ali (0,9–1,1)
 * Opcionais em todos: autor, data, nota.
 *
 * Âncora: { norma, bloco, texto } — a norma, o bloco do documento da norma e o começo do texto
 * (normalizado). Na resolução, vale o parágrafo da mesma norma com o mesmo começo de texto e bloco
 * mais próximo (o texto pode ter mudado de lugar com edições); sem ele, o ajuste não é aplicado e vai
 * para o relatório.
 */

const TAM_TEXTO = 60
// separadores de palavra das marcas (espaço e quebra de linha forçada, U+2028), como em runsMarcados
const LSEP = String.fromCharCode(0x2028)
const ESPACOS = new RegExp('([ ' + LSEP + ']+)')
const SO_ESPACOS = new RegExp('^[ ' + LSEP + ']+' + String.fromCharCode(36))
const normalizar = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')
export const textoDoParagrafo = par => (par.runs || []).filter(r => !r.nota).map(r => r.texto || '').join('')

/** Âncora de um parágrafo do miolo (para a tela criar ajustes). */
export function ancoraDe(par) {
  return { norma: par.origem?.norma ?? null, bloco: par.origem?.bloco ?? null, texto: normalizar(textoDoParagrafo(par)).slice(0, TAM_TEXTO) }
}

/** Índice do parágrafo do miolo que corresponde à âncora, ou null. */
function acharParagrafo(indice, ancora) {
  const candidatos = indice.get(`${ancora.norma}|${ancora.texto}`) || []
  if (!candidatos.length) return null
  let melhor = candidatos[0]
  for (const c of candidatos) if (Math.abs(c.bloco - ancora.bloco) < Math.abs(melhor.bloco - ancora.bloco)) melhor = c
  return melhor.i
}

/**
 * k (numeração das marcas de runsMarcados/composicaoLivro: cada parte de run sem espaço) da
 * `ocorrencia`-ésima parte com o texto `palavra`; null se não houver.
 */
export function marcaDaPalavra(par, palavra, ocorrencia = 0) {
  let k = 0, vista = 0
  for (const r of par.runs || []) {
    if (r.nota || r.texto === undefined) continue
    for (const parte of String(r.texto).split(ESPACOS).filter(Boolean)) {
      if (SO_ESPACOS.test(parte)) continue
      if (parte === palavra) { if (vista === ocorrencia) return k; vista++ }
      k++
    }
  }
  return null
}

/**
 * Resolve os ajustes para os parágrafos do miolo.
 * @returns {
 *   porPar: Map i → { tr?, sp?, palavras: Map k → hifen, juntar: Set k },
 *   fins: Map i → Set linha, proibidos: Map i → Set linha, entrelinhas: Map 'i|linha' → fator,
 *   aplicados: n, naoEncontrados: [ajuste]
 * }
 */
export function resolverAjustes(ajustes, pars) {
  const out = { porPar: new Map(), fins: new Map(), proibidos: new Map(), entrelinhas: new Map(), aplicados: 0, naoEncontrados: [] }
  const itens = ajustes?.itens || []
  if (!itens.length) return out
  const indice = new Map()
  pars.forEach((par, i) => {
    if (!par.runs) return
    const a = ancoraDe(par)
    const c = `${a.norma}|${a.texto}`
    if (!indice.has(c)) indice.set(c, [])
    indice.get(c).push({ i, bloco: a.bloco })
  })
  const doPar = i => {
    if (!out.porPar.has(i)) out.porPar.set(i, { palavras: new Map(), juntar: new Set() })
    return out.porPar.get(i)
  }
  const add = (mapa, i, v) => { if (!mapa.has(i)) mapa.set(i, new Set()); mapa.get(i).add(v) }
  for (const aj of itens) {
    const i = aj.ancora ? acharParagrafo(indice, aj.ancora) : null
    if (i == null) { out.naoEncontrados.push(aj); continue }
    switch (aj.tipo) {
      case 'paragrafo': Object.assign(doPar(i), { tr: aj.tr ?? 0, sp: aj.sp ?? 100 }); break
      case 'palavra':
      case 'juntar': {
        const k = marcaDaPalavra(pars[i], aj.palavra, aj.ocorrencia || 0)
        if (k == null) { out.naoEncontrados.push(aj); continue }
        if (aj.tipo === 'palavra') doPar(i).palavras.set(k, aj.hifen)
        else doPar(i).juntar.add(k)
        break
      }
      case 'fimPagina': add(out.fins, i, aj.linha ?? 0); break
      case 'naoTerminar': add(out.proibidos, i, aj.linha ?? 0); break
      case 'entrelinha': out.entrelinhas.set(`${i}|${aj.linha ?? 0}`, aj.fator); break
      default: out.naoEncontrados.push(aj); continue
    }
    out.aplicados++
  }
  return out
}
