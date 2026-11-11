/**
 * compositor.js — quebra de linhas de um parágrafo justificado (Knuth-Plass), para imitar o
 * compositor de parágrafo do InDesign (calibração: scratchpad/calib).
 *
 * O parágrafo é uma lista de itens:
 *   { tipo: 'caixa', w, st, sh, t }       texto (st/sh: o quanto o espaçamento entre letras pode
 *                                         alargar/encolher a caixa; hangIni/hangFim: quanto da pontuação
 *                                         do começo/fim fica fora da coluna, com margem óptica)
 *   { tipo: 'cola', w, st, sh, t }        espaço entre palavras (w: desejado; st/sh: até o máximo/mínimo)
 *   { tipo: 'pena', w, p, hifen, t }      ponto de quebra opcional (hifen: quebra com hífen; w: largura
 *                                         do hífen); p = -Infinity força a quebra
 *
 * Diferente do TeX: o encolhimento é limite duro (o InDesign não passa do espaço mínimo), mas o
 * alargamento pode passar do máximo (com custo alto), como o InDesign faz quando não há saída.
 */

export const PARAMETROS = {
  penaLinha: 10,         // custo fixo por linha (o TeX usa 10)
  penaHifen: 50,         // custo de uma quebra com hífen
  penaHifenProprio: 50,  // custo de quebrar logo depois de um hífen da palavra ("Salário-|Educação")
  hifensSeguidos: 3000,  // custo extra de duas linhas seguidas terminadas em hífen
  hifenFinal: 5000,      // custo extra do hífen na penúltima linha
  saltoClasse: 100,      // custo de linhas vizinhas de classes de aperto muito diferentes
  razaoMax: 10,          // alargamento máximo considerado (múltiplos do alargamento até o máximo)
  limiteHifens: 3,       // máximo de linhas seguidas terminadas em hífen (InDesign: "limite de hífens")
  expoente: 3,           // a "feiura" da linha: 100 × |razão|^expoente
  pesoAperto: 1,         // multiplica a feiura de linha apertada (o InDesign prefere linha folgada)
  pesoFolga: 1,          // multiplica a feiura de linha folgada
  expoenteFolga: null,   // expoente da folga (null = o mesmo do aperto): o InDesign aceita bem linha folgada
  etapas: false,         // justificação em etapas: espaços entre palavras primeiro, letras depois
  kLetras: 1,            // em etapas: quanto pesa (em razão) usar todo o espaçamento de letras
  apertoMax: 1,          // aperto máximo (múltiplos do encolhimento até o mínimo); além de 1 custa pesoAlemAperto
  pesoAlemAperto: 10,
  pilha: 0,              // custo de palavras empilhadas (mesmo trecho de mais de 2 letras no fim ou no
  pilhaCurta: 0,         // começo de linhas seguidas); pilhaCurta: trecho de até 2 letras
  pesoUltima: 0,         // custo da última linha curta: 100 × peso × (fração vazia)^expoenteUltima
  expoenteUltima: 2,
}

const INF = Infinity

// somas acumuladas de largura, alargamento e encolhimento até antes do item i
function somas(itens) {
  const n = itens.length
  const W = new Float64Array(n + 1), ST = new Float64Array(n + 1), SH = new Float64Array(n + 1)
  // só das colas (espaços entre palavras), para a justificação em etapas
  const STc = new Float64Array(n + 1), SHc = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const it = itens[i]
    const conta = it.tipo !== 'pena', cola = it.tipo === 'cola'
    W[i + 1] = W[i] + (conta ? it.w : 0)
    ST[i + 1] = ST[i] + (conta ? it.st || 0 : 0)
    SH[i + 1] = SH[i] + (conta ? it.sh || 0 : 0)
    STc[i + 1] = STc[i] + (cola ? it.st || 0 : 0)
    SHc[i + 1] = SHc[i] + (cola ? it.sh || 0 : 0)
  }
  return { W, ST, SH, STc, SHc }
}

// aperto máximo, em unidades de razão (em etapas: espaços até o mínimo = −1, depois as letras)
const limiteAperto = P => (P.etapas ? 1 + P.kLetras : P.apertoMax)

// largura natural da linha que começa no item `ini` e quebra no item `b`
function larguraDaLinha(itens, { W }, ini, b) {
  const it = itens[b]
  const wPena = it.tipo === 'pena' ? it.w || 0 : 0
  // margem óptica: pontuação no fim da linha (hangFim da última caixa) e no começo (hangIni) fica
  // em parte fora da coluna; o hífen da quebra já vem com a largura reduzida
  return W[b] - W[ini] + wPena - (it.tipo === 'cola' ? itens[b - 1].hangFim || 0 : 0) - (itens[ini]?.hangIni || 0)
}

// razão de ajuste da linha que começa no item `ini` e quebra no item `b`. Em etapas (P.etapas), como a
// justificação do InDesign: primeiro os espaços entre palavras (até o máximo/mínimo = ±1), depois o
// espaçamento entre letras (cada unidade de letras vale kLetras na razão)
function razaoDaLinha(itens, S, ini, b, T, P = {}) {
  const { ST, SH, STc, SHc } = S
  const L = larguraDaLinha(itens, S, ini, b)
  if (P.etapas) {
    const Yc = STc[b] - STc[ini], Zc = SHc[b] - SHc[ini]
    const Yl = ST[b] - ST[ini] - Yc, Zl = SH[b] - SH[ini] - Zc
    if (L < T) {
      const d = T - L
      if (d <= Yc) return Yc > 0 ? d / Yc : INF
      return Yl > 0 ? 1 + (d - Yc) / Yl * P.kLetras : Yc > 0 ? d / Yc : INF
    }
    if (L > T) {
      const d = L - T
      if (d <= Zc) return Zc > 0 ? -d / Zc : -INF
      return Zl > 0 ? -(1 + (d - Zc) / Zl * P.kLetras) : -INF
    }
    return 0
  }
  const Y = ST[b] - ST[ini], Z = SH[b] - SH[ini]
  if (L < T) return Y > 0 ? (T - L) / Y : INF
  if (L > T) return Z > 0 ? (T - L) / Z : -INF
  return 0
}

const classeDe = r => (r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3)

// custo (deméritos) de uma linha, com as partes: feiura (aperto/folga), penalidade da quebra, hífens
// seguidos e salto de classe. vazio: na última linha (quebra forçada), a fração da largura que
// sobrou — o InDesign prefere última linha mais cheia
function custoDaLinha(rr, pena, hifen, hifenAntes, classe, classeAntes, P, vazio = null) {
  let feiura = rr < 0
    ? 100 * P.pesoAperto * Math.pow(-rr, P.expoente) + (rr < -1 && !P.etapas ? 100 * P.pesoAlemAperto * (-rr - 1) : 0)
    : 100 * P.pesoFolga * Math.pow(rr, P.expoenteFolga ?? P.expoente)
  if (vazio != null && P.pesoUltima) feiura += 100 * P.pesoUltima * Math.pow(Math.max(0, vazio), P.expoenteUltima)
  const partes = {
    feiura: Math.pow(P.penaLinha + feiura, 2),
    pena: pena >= 0 ? pena * pena : pena > -INF ? -pena * pena : 0,
    seguidos: hifen && hifenAntes ? P.hifensSeguidos : 0,
    salto: Math.abs(classe - classeAntes) > 1 ? P.saltoClasse : 0,
  }
  return { dem: partes.feiura + partes.pena + partes.seguidos + partes.salto, partes }
}

/**
 * Custo de uma solução dada (as quebras do InDesign, por exemplo) no mesmo modelo de quebrarLinhas.
 * @param quebras índices dos itens de quebra, em ordem (o último é a quebra final)
 * @returns { total, linhas: [{ r, inviavel, partes }] }
 */
export function avaliarQuebras(itens, larguras, quebras, parametros = {}) {
  const P = { ...PARAMETROS, ...parametros }
  const S = somas(itens)
  const n = itens.length
  const inicioApos = q => { let i = q; while (i < n && itens[i].tipo !== 'caixa') { if (itens[i].tipo === 'pena' && itens[i].p === -INF && i > q) break; i++ } return i }
  let ini = 0, classeAntes = 1, hifenAntes = false, marcaAntes = false, total = 0, seguidos = 0
  const linhas = []
  quebras.forEach((b, k) => {
    const it = itens[b]
    const pena = it.tipo === 'pena' ? it.p : 0
    const hifen = it.tipo === 'pena' && !!it.hifen
    const marca = hifen || (it.tipo === 'pena' && !!it.contaHifen)
    const T = larguras(k)
    const r = razaoDaLinha(itens, S, ini, b, T, P)
    const rr = pena === -INF && r > 0 ? 0 : r
    seguidos = marca ? seguidos + 1 : 0
    const classe = classeDe(rr)
    const vazio = pena === -INF ? (T - larguraDaLinha(itens, S, ini, b)) / T : null
    const c = custoDaLinha(Math.max(rr, -limiteAperto(P)), pena, marca, marcaAntes, classe, classeAntes, P, vazio)
    if (k === quebras.length - 1 && hifenAntes) { c.partes.hifenFinal = P.hifenFinal; c.dem += P.hifenFinal }
    linhas.push({ r: rr, inviavel: rr < -limiteAperto(P) || rr > P.razaoMax || seguidos > P.limiteHifens, partes: c.partes, dem: c.dem })
    total += c.dem
    ini = inicioApos(b + 1); classeAntes = classe; hifenAntes = hifen; marcaAntes = marca
  })
  return { total, linhas }
}

/**
 * Melhor quebra de linhas. larguras(n) = largura disponível da linha n (0 = primeira).
 * @returns [{ ini, fim, razao, hifen }] — índices dos itens: a linha vai de `ini` até `fim` (o ponto
 * de quebra, exclusive), razão de ajuste e se termina com hífen; null se não houver quebra possível
 */
export function quebrarLinhas(itens, larguras, parametros = {}) {
  const P = { ...PARAMETROS, ...parametros }
  const n = itens.length
  const S = somas(itens)
  // depois de uma quebra, a linha seguinte começa no próximo item que não é cola nem penalidade
  const inicioApos = q => {
    let i = q
    while (i < n && itens[i].tipo !== 'caixa') {
      if (itens[i].tipo === 'pena' && itens[i].p === -INF && i > q) break
      i++
    }
    return i
  }
  // palavras empilhadas: o trecho no fim da linha que quebra em b (a palavra, ou o pedaço com hífen) e
  // o trecho no começo da linha que começa em i; mesmo trecho em linhas seguidas custa P.pilha (mais de
  // 2 letras) ou P.pilhaCurta
  const trechoFim = b => {
    if (itens[b].tipo === 'pena' && itens[b].p === -INF) return null
    let t = ''
    for (let i = b - 1; i >= 0 && itens[i].tipo !== 'cola'; i--) if (itens[i].tipo === 'caixa') t = itens[i].t + t
    return (t + (itens[b].tipo === 'pena' && itens[b].hifen ? '-' : '')).toLocaleLowerCase('pt-BR') || null
  }
  const trechoIni = i0 => {
    let t = ''
    for (let i = i0; i < n && itens[i].tipo !== 'cola'; i++) {
      if (itens[i].tipo === 'caixa') t += itens[i].t
      else if (itens[i].tipo === 'pena' && itens[i].p === -INF) break
    }
    return t.toLocaleLowerCase('pt-BR') || null
  }
  const custoPilha = t => (!t ? 0 : (t.match(/\p{L}/gu) || []).length > 2 ? P.pilha : P.pilhaCurta)
  const comPilha = P.pilha > 0 || P.pilhaCurta > 0
  // nós ativos: { pos (quebra), ini (começo da linha seguinte), linha, classe, seguidos, dem, ant,
  // fim/comeco: trechos do fim e do começo da linha que termina no nó }
  let ativos = [{ pos: -1, ini: 0, linha: 0, classe: 1, seguidos: 0, dem: 0, ant: null, hifen: false, fim: null, comeco: null }]
  let melhorForcado = null
  for (let b = 0; b < n; b++) {
    const it = itens[b]
    let legal = false, pena = 0, hifen = false
    if (it.tipo === 'cola') legal = b > 0 && itens[b - 1].tipo === 'caixa'
    else if (it.tipo === 'pena' && it.p < INF) { legal = true; pena = it.p; hifen = !!it.hifen }
    // linha terminada em hífen, para o limite de hífens seguidos: o da hifenização e, com contaHifen,
    // o hífen próprio da palavra ("Salário-|Educação"), que também fica no fim da linha
    const marca = hifen || (it.tipo === 'pena' && !!it.contaHifen)
    if (!legal) continue
    const novos = new Map()
    const restantes = []
    for (const a of ativos) {
      const T = larguras(a.linha)
      const r = razaoDaLinha(itens, S, a.ini, b, T, P)
      // não cabe nem encolhendo tudo: a linha a partir deste nó não tem mais quebra possível
      const morto = r < -limiteAperto(P) || pena === -INF
      if (!morto) restantes.push(a)
      if (r < -limiteAperto(P)) continue
      const rr = pena === -INF && r > 0 ? 0 : r   // linha final/forçada: não precisa encher
      if (rr > P.razaoMax) continue
      const seguidos = marca ? a.seguidos + 1 : 0
      if (seguidos >= P.limiteHifens + 1) continue
      const classe = classeDe(rr)
      const vazio = pena === -INF && P.pesoUltima ? (T - larguraDaLinha(itens, S, a.ini, b)) / T : null
      let total = a.dem + custoDaLinha(rr, pena, marca, a.marca, classe, a.classe, P, vazio).dem
      // palavras empilhadas com a linha anterior, no fim e no começo
      let fim = null, comeco = null
      if (comPilha) {
        fim = trechoFim(b)
        comeco = trechoIni(a.ini)
        if (fim && fim === a.fim) total += custoPilha(fim)
        if (comeco && comeco === a.comeco) total += custoPilha(comeco)
      }
      const chave = `${a.linha === 0 ? 0 : 1}|${classe}|${seguidos}` + (comPilha ? `|${fim}|${comeco}` : '')
      const atual = novos.get(chave)
      if (!atual || total < atual.dem) {
        novos.set(chave, { pos: b, ini: inicioApos(b + 1), linha: a.linha + 1, classe, seguidos, dem: total, ant: a, hifen, marca, razao: rr, ini0: a.ini, fim, comeco })
      }
    }
    ativos = restantes
    // penúltima linha com hífen: custo extra (decidido na quebra final)
    for (const v of novos.values()) ativos.push(v)
    if (!ativos.length) return null
    if (it.tipo === 'pena' && it.p === -INF) {
      // quebra forçada: só os nós que terminam aqui seguem
      ativos = ativos.filter(a => a.pos === b)
      for (const a of ativos) if (a.ant?.hifen && b === n - 1) a.dem += P.hifenFinal
      if (b === n - 1) melhorForcado = ativos.reduce((m, a) => (!m || a.dem < m.dem ? a : m), null)
      // na quebra forçada do meio do parágrafo, fica só o melhor (o que vem depois não depende do resto)
      else if (ativos.length > 1) {
        const m = ativos.reduce((x, a) => (a.dem < x.dem ? a : x))
        ativos = [{ ...m }]
      }
    }
  }
  const fim = melhorForcado
  if (!fim) return null
  const linhas = []
  for (let a = fim; a && a.ant; a = a.ant) linhas.unshift({ ini: a.ini0, fim: a.pos, razao: a.razao, hifen: a.hifen })
  return linhas
}
