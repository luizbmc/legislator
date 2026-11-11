/**
 * decisoesIdml.js — decisões da paginação do Normando (sessão de pdf/sessaoPaginacao.js) levadas ao
 * IDML "ajustado", para o InDesign encaixar em cada página as mesmas linhas do PDF de revisão.
 *
 * Por parágrafo (overrides locais, como o diagramador faria):
 *   • tracking e espaço entre palavras do plano (rodadas da verificação, ajustes da tela), com o
 *     espaço mínimo nunca abaixo de ESPACO_MINIMO;
 *   • entrelinha da página (fator lf) e espaço antes do parágrafo exatamente como no PDF (espaço
 *     depois zerado e "espaço entre parágrafos do mesmo estilo" desligado: o PDF já somou tudo no
 *     espaço antes);
 *   • sem hifenização (fim de página ímpar), quebra de página antes do parágrafo que começa página;
 *   • "manter com o seguinte"/"manter linhas" desligados: as páginas já foram decididas.
 * Por palavra: protegida (sem quebra), hífen escolhido na tela (hífen discricionário) e espaço sem
 * quebra (palavras empilhadas, "juntar" da tela).
 * As quebras de linha ficam com o InDesign (no gabarito, 98,8% dos parágrafos com o mesmo nº de
 * linhas do compositor); `esperado` diz, por parágrafo da story, a página e o nº de linhas
 * previstos, para o script de conferência do InDesign.
 */

import { ESPACO_MINIMO } from '../pdf/typstLivro.js'
import { formato } from '../pdf/mancha.js'

const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d }
const r3 = x => Math.round(x * 1000) / 1000

/**
 * Runs com as decisões por palavra. A contagem das palavras (k) é a de runsMarcados/compositor:
 * cada trecho sem espaço de cada run de texto (notas fora).
 */
function runsComPalavras(runs, rs) {
  const semQuebra = new Set(rs.semHifen || [])
  const hifenEm = new Map()
  for (const [k, v] of rs.manual?.palavras || []) {
    if (v === 'proibir') semQuebra.add(k)
    else if (typeof v === 'number') hifenEm.set(k, v)
  }
  // espaço sem quebra: depois da palavra k (juntar da tela; pilha "depois") ou antes dela (pilha "antes")
  const juntarDepois = new Set(rs.manual?.juntar || [])
  const juntarAntes = new Set()
  if (rs.pilha?.nbsp) (rs.pilha.nbsp.lado === 'antes' ? juntarAntes : juntarDepois).add(rs.pilha.nbsp.k)
  if (!semQuebra.size && !hifenEm.size && !juntarDepois.size && !juntarAntes.size) return runs

  const out = []
  let k = -1
  for (const r of runs) {
    if (r.nota || r.texto === undefined) { out.push(r); continue }
    const partes = String(r.texto).split(/([ \u2028]+)/).filter(Boolean)
    let acumulado = ''
    const soltar = () => { if (acumulado) out.push({ ...r, texto: acumulado }); acumulado = '' }
    partes.forEach((parte, q) => {
      if (/^[ \u2028]+$/.test(parte)) {
        // espaço simples entre a palavra k e a seguinte
        const proxK = k + 1
        const junta = parte === ' ' && (juntarDepois.has(k) || juntarAntes.has(proxK))
        acumulado += junta ? '\u00A0' : parte
        return
      }
      k++
      if (hifenEm.has(k)) {
        const pos = hifenEm.get(k)
        acumulado += pos > 0 && pos < parte.length ? parte.slice(0, pos) + '\u00AD' + parte.slice(pos) : parte
      } else if (semQuebra.has(k)) {
        soltar()
        out.push({ ...r, texto: parte, semQuebra: true })
      } else acumulado += parte
    })
    soltar()
  }
  return out
}

/**
 * @param sessao  SessaoPaginacao (planoAtual, paginas, itensMiolo, miolo, estilos, rsDe, composicao)
 * @returns { pars, paginas (nº de páginas do miolo, com as em branco), esperado: [{ par, i, pagina, linhas }] }
 */
export function aplicarDecisoes(sessao) {
  const { itensMiolo, miolo } = sessao
  // começo de página: parágrafo (k = 0) → página (índice no miolo, com as em branco) e paridade
  const inicioDe = new Map()
  const paginaDaLinha = new Map()   // i → página da 1ª linha
  let n = 0
  sessao.paginas.forEach((pg, q) => {
    if (pg.branca) n++
    const [j0, k0] = pg.de, [j1, k1] = pg.ate
    if (q > 0 && k0 === 0 && j0 < itensMiolo.length) inicioDe.set(itensMiolo[j0].i, { branca: !!pg.branca, par: pg.par })
    for (let j = j0; j <= Math.min(j1, itensMiolo.length - 1); j++) {
      if (j === j1 && k1 === 0) break
      const i = itensMiolo[j].i
      if (!(j === j0 && k0 > 0) && !paginaDaLinha.has(i)) paginaDaLinha.set(i, n)
    }
    n++
  })

  const pars = miolo.map(p => ({ ...p }))
  const esperado = []
  itensMiolo.forEach(it => {
    const p = pars[it.i]
    const pl = sessao.planoAtual[it.i] || {}
    const at = {
      KeepWithNext: '0', KeepLinesTogether: 'false', KeepAllLinesTogether: 'false', KeepWithPrevious: 'false',
      KeepFirstLines: '1', KeepLastLines: '1',
    }
    const props = []
    // entrelinha e tracking são atributos de caractere: vão em cada trecho (no parágrafo, o InDesign
    // só os aplica ao 1º trecho, e a linha fica com a maior entrelinha dela)
    const car = {}, carProps = []
    const ini = inicioDe.get(it.i)
    if (ini) at.StartParagraph = ini.branca ? (ini.par === 1 ? 'NextOddPage' : 'NextEvenPage') : 'NextPage'
    if (it.tipo !== 'tabela') {
      const est = sessao.estilos.par(it.fn.estilo)
      // espaço antes = o do PDF (espaço depois do anterior + antes deste, ou o do mesmo estilo) × fator da página
      at.SpaceBefore = String(r3(it.espaco * (pl.fatorEspaco ?? 1)))
      at.SpaceAfter = '0'
      props.push('<SameParaStyleSpacing type="enumeration">SetIgnore</SameParaStyleSpacing>')
      const lf = pl.lf ?? 1
      if (Math.abs(lf - 1) > 1e-6) carProps.push(`<Leading type="unit">${r3(it.fn.leading * lf)}</Leading>`)
      const tr = pl.tr ?? 0
      if (tr) car.Tracking = String(r3(num(est.Tracking, 0) + tr * 1000))
      const sp = pl.sp ?? 100
      const ws = { min: num(est.MinimumWordSpacing, 80), des: num(est.DesiredWordSpacing, 100), max: num(est.MaximumWordSpacing, 133) }
      const des = ws.des * sp / 100
      const min = Math.max(Math.min(ws.min, des), ESPACO_MINIMO), max = Math.max(ws.max, des)
      // formato com piso próprio: o mínimo do plano não está no estilo do livro
      if (sp !== 100 || min !== ws.min || formato.espacoMinimo !== 82) Object.assign(at, { DesiredWordSpacing: String(r3(des)), MinimumWordSpacing: String(r3(min)), MaximumWordSpacing: String(r3(max)) })
      if (pl.hy === false) at.Hyphenation = 'false'
      if (sessao.composicao.tem(it.i)) p.runs = runsComPalavras(p.runs, sessao.rsDe(it.i))
    }
    p.idml = { atributos: at, propriedades: props.join(''), caractere: car, propriedadesCaractere: carProps.join('') }
    const linhas = it.tipo === 'tabela' || !sessao.composicao.tem(it.i) ? null
      : sessao.composicao.textos(it.i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: sessao.rsDe(it.i), base: sessao.baseHifen }).length
    esperado.push({ par: it.i, pagina: paginaDaLinha.get(it.i) ?? null, linhas })
  })
  return { pars, paginas: n, esperado }
}
