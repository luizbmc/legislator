/**
 * translineacao.js — fragmentos que não podem ficar no fim nem no começo de uma linha quando a
 * palavra é dividida por hifenização (ex.: "docu-mento", "fede-ral", "com-putado").
 *
 * Para cada palavra, acha os pontos de quebra que deixariam um desses fragmentos de um dos lados e
 * protege as duas letras em volta do ponto: no PDF, com a hifenização desligada só nelas
 * (typstLivro.js); no IDML, com "Sem quebra" (NoBreak) nelas (historia.js). O resto da palavra
 * continua podendo ser hifenizado ("do-cumento", "fe-deral").
 *
 * Com { vogais: true } (só no PDF), também não se separam duas vogais seguidas, como pede a
 * ortografia ("ciên-cia", não "ci-ência"; "coo-pe-rar", não "co-operar"). No IDML isso fica com o
 * dicionário do InDesign: seriam milhares de "Sem quebra".
 *
 * Com { regras: true } (só no PDF), as regras de hifenização do usuário, palavra a palavra (uma
 * "palavra" aqui é uma sequência de letras: "complementação-VAAT" e "PIS/Pasep" têm duas):
 * - menos de 7 letras: não se hifeniza (com { minLetras: 6 }, de 6 letras: a verificação da
 *   composição permite quando o espaçamento passa de 190%);
 * - sigla (2 maiúsculas ou mais: IBGE, NAAHs, PIS, VAAT): não se hifeniza;
 * - prefixos inter, super, extra, anti, ante, contra, trans e socio: sem quebra dentro deles; com
 *   { prefixoPreferido: true }, a quebra fica só logo depois do prefixo ("socio-profissionais",
 *   "extra-curricular"), se os padrões de hifenização a aceitarem — a verificação da composição
 *   libera a palavra quando isso deixa a linha aberta demais;
 * - parte de palavra composta: pelo menos 4 letras depois da quebra ("complemen-tação-VAAT", não
 *   "complementa-ção-VAAT"; a quebra preferida, no hífen próprio, fica com typstLivro.js).
 */

export const FRAGMENTOS_PROIBIDOS = ['cu', 'cus', 'docu', 'fede', 'puta', 'putado', 'putada', 'putadas', 'pica']

const PROIBIDOS = new Set(FRAGMENTOS_PROIBIDOS.map(f => normalizar(f)))

// palavras com uma divisão só: começo da palavra (sem acento, minúsculo) → letras antes da única
// quebra permitida. "deputado(a)(s)" só se divide em "depu-" ("deputa-" e "de-" geram palavrão).
// A palavra fica inteira protegida, com um hífen discricionário (U+00AD) no ponto permitido: no
// Typst ele quebra mesmo com a hifenização desligada; no InDesign, uma palavra com hífen
// discricionário só se divide nele (e o trecho não leva "Sem quebra").
export const DIVISAO_UNICA = { deputad: 4 }
export const HIFEN_DISCRICIONARIO = String.fromCharCode(0xad)
const LETRA = /\p{L}/u
const VOGAL = /[aeiouy]/
const MAIUSCULA = /\p{Lu}/gu
export const PREFIXOS = ['inter', 'super', 'extra', 'anti', 'ante', 'contra', 'trans', 'socio']

/**
 * Palavras que começam com as letras de um prefixo mas não são formadas com ele ("superior" não é
 * super + ior): começo da palavra, sem acentos e em minúsculas; com "$" no fim, a palavra exata
 * ("interna$" não pega "internacional", que é inter + nacional). Para elas não vale a regra do prefixo.
 */
export const EXCECOES_PREFIXO = [
  // super
  'superior', 'superar', 'superac', 'superavit',
  // socio ("sócio", "sócios")
  'socio$', 'socios$', 'socia$', 'socias$',
  // trans (transição, trânsito, transação, transigir: "tran-si-ção")
  'transic', 'transit', 'transac', 'transig',
  // inter
  'interess', 'internet', 'interior', 'interpret', 'interprete', 'intervalo', 'interrog', 'interromp',
  'interno$', 'interna$', 'internos$', 'internas$', 'internamente$', 'internar$', 'internado$', 'internada$',
  'internados$', 'internadas$', 'internacao$', 'internacoes$', 'internato$',
  // ante
  'anterior', 'antes', 'antena', 'antecip',
  // anti
  'antig',
  // contra ("contraturno" é contra + turno)
  'contrata', 'contrato', 'contratua', 'contrai', 'contrari',
  // extra
  'extrat', 'extrai', 'extracao$', 'extracoes$',
]

/** Prefixo da lista no começo da palavra normalizada (com mais letras depois dele), fora as exceções. */
function prefixoNormalizado(p, minDepois = 1) {
  if (EXCECOES_PREFIXO.some(e => (e.endsWith('$') ? p === e.slice(0, -1) : p.startsWith(e)))) return null
  return PREFIXOS.find(pre => p.length > pre.length + minDepois - 1 && p.startsWith(pre)) || null
}

/** Prefixo da lista no começo da palavra (com mais letras depois dele), ou null. */
export function prefixoDe(palavra) {
  // sem a pontuação em volta ("interno," é "interno", que é exceção)
  return prefixoNormalizado(normalizar(String(palavra || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')), 2)
}
const MIN_LETRAS = 7
const MIN_DEPOIS_COMPOSTA = 4

function normalizar(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

/**
 * Pontos protegidos de um texto: lista de [início, fim) de trechos de 2 letras que não podem ser
 * separados (o ponto proibido fica entre elas). Um trecho pode ter um 3º elemento: as posições
 * (no texto) onde a quebra é permitida com hífen discricionário (DIVISAO_UNICA).
 */
export function trechosProtegidos(texto, { vogais = false, regras = false, prefixoPreferido = false, minLetras = MIN_LETRAS } = {}) {
  const out = []
  const s = String(texto || '')
  let i = 0
  while (i < s.length) {
    if (!LETRA.test(s[i])) { i++; continue }
    let j = i
    while (j < s.length && LETRA.test(s[j])) j++
    const palavra = normalizar(s.slice(i, j))
    // quebra depois de p letras: fragmento no fim da linha = palavra[0, p); no começo = palavra[p, …)
    for (let p = 2; p <= palavra.length - 2; p++) {
      if (PROIBIDOS.has(palavra.slice(0, p)) || PROIBIDOS.has(palavra.slice(p))) out.push([i + p - 1, i + p + 1])
    }
    // divisão única: a palavra inteira protegida, menos o ponto permitido
    for (const [comeco, p] of Object.entries(DIVISAO_UNICA)) {
      if (palavra.startsWith(comeco) && palavra.length > p + 1) out.push([i, j, [i + p]])
    }
    // duas vogais seguidas (a palavra normalizada, sem acentos, tem o mesmo comprimento) — menos no
    // ponto logo depois de um prefixo, onde a quebra vale mesmo entre vogais ("socio-emocional",
    // "extra-ordinário")
    if (vogais) {
      const fimPrefixo = regras ? (prefixoNormalizado(palavra)?.length ?? -1) : -1
      for (let p = 1; p < palavra.length; p++) {
        if (p === fimPrefixo) continue
        if (VOGAL.test(palavra[p - 1]) && VOGAL.test(palavra[p])) out.push([i + p - 1, i + p + 1])
      }
    }
    if (regras) {
      const original = s.slice(i, j)
      // palavra curta ou sigla: inteira, sem hifenização
      if (palavra.length < minLetras || (original.match(MAIUSCULA) || []).length >= 2) out.push([i, j])
      // prefixo: sem quebra dentro dele; preferido: nem depois da 1ª letra seguinte (só fica a quebra
      // logo depois do prefixo)
      const prefixo = prefixoNormalizado(palavra)
      if (prefixo) out.push([i, i + prefixo.length])
      if (prefixo && prefixoPreferido && palavra.length > prefixo.length + 1) out.push([i + prefixo.length + 1, j])
      // parte de palavra composta (hífen entre letras antes ou depois): as últimas letras juntas
      const composta = (s[j] === '-' && LETRA.test(s[j + 1] || '')) || (s[i - 1] === '-' && LETRA.test(s[i - 2] || ''))
      if (composta && palavra.length > MIN_DEPOIS_COMPOSTA) out.push([j - MIN_DEPOIS_COMPOSTA, j])
    }
    i = j
  }
  // o ponto da divisão única não vale se outra regra o proíbe (sigla, palavra em maiúsculas…)
  const fechados = out.filter(t => !t[2])
  for (const t of out) if (t[2]) t[2] = t[2].filter(x => !fechados.some(([a, b]) => a < x && x < b))
  // junta trechos encostados (dois pontos proibidos vizinhos)
  out.sort((a, b) => a[0] - b[0])
  const juntos = []
  for (const t of out) {
    const u = juntos[juntos.length - 1]
    if (u && t[0] <= u[1]) {
      u[1] = Math.max(u[1], t[1])
      if (t[2]?.length) u[2] = [...(u[2] || []), ...t[2]]
    } else juntos.push(t[2]?.length ? [t[0], t[1], [...t[2]]] : [t[0], t[1]])
  }
  return juntos
}

/**
 * Texto em segmentos { t, protegido } (protegido = não pode haver quebra dentro); um segmento
 * protegido pode ter { hifens }: posições (no segmento) da quebra permitida com hífen discricionário.
 */
export function segmentarTranslineacao(texto, opcoes) {
  const s = String(texto ?? '')
  const trechos = trechosProtegidos(s, opcoes)
  if (!trechos.length) return [{ t: s, protegido: false }]
  const seg = []
  let pos = 0
  for (const [a, b, h] of trechos) {
    if (a > pos) seg.push({ t: s.slice(pos, a), protegido: false })
    seg.push(h ? { t: s.slice(a, b), protegido: true, hifens: h.map(x => x - a) } : { t: s.slice(a, b), protegido: true })
    pos = b
  }
  if (pos < s.length) seg.push({ t: s.slice(pos), protegido: false })
  return seg
}

/** Texto do segmento com os hífens discricionários (U+00AD) nos pontos permitidos. */
export function comHifens(seg) {
  if (!seg.hifens?.length) return seg.t
  let t = seg.t
  for (const p of [...seg.hifens].sort((a, b) => b - a)) t = t.slice(0, p) + HIFEN_DISCRICIONARIO + t.slice(p)
  return t
}
