/**
 * sessaoPaginacao.js — motor da tela de paginação.
 *
 * A abertura roda a composição completa do PDF de revisão (com as rodadas de verificação) e guarda o
 * estado. A cada mudança nos ajustes locais (ajustesLocais.js), recalcula só o compositor dos
 * parágrafos afetados e replaneja a paginação a partir da primeira página afetada (as anteriores
 * ficam como estão: o ajuste é local) — em frações de segundo, sem o Typst. Devolve o modelo das
 * páginas para a tela desenhar: linhas de cada parágrafo (com estilos de caractere), entrelinha,
 * buracos e indicadores (espaçamento aberto, hífens, palavras empilhadas).
 * O PDF exato continua sendo o da exportação (salvarPdf.js), com os mesmos ajustes.
 */
import { gerarPdfPublicacao } from './exportPdf.js'
import { planejarPaginas } from './paginacao.js'
import { resolverAjustes, ancoraDe, textoDoParagrafo } from './ajustesLocais.js'
import { AJUSTES, ABRIR, funcaoParagrafo, ESPACO_MINIMO, aplicarFormato } from './typstLivro.js'
import { ABERTA } from './linhas.js'

import { formato, semConferencia } from './mancha.js'

const sessoes = new Map()

/** Abre (ou reabre) a sessão de uma publicação: composição completa, ~1 min. */
export async function abrirSessao(chave, publicacao, opcoes) {
  // espaço sem quebra que abre a linha anterior: compõe, solta esses grupos e compõe de novo
  if (opcoes.formato?.soltarNbsp && !opcoes.semNbsp) {
    const grupos = new Map()
    let sessao = null
    for (let rodada = 0; rodada < 3; rodada++) {
      // barra de progresso: cada composição num terço (a última pode vir antes)
      const progresso = opcoes.progresso && (p => opcoes.progresso({ texto: p.texto, fracao: (rodada + p.fracao) / 3 }))
      sessao = await abrirSessao(chave, publicacao, { ...opcoes, progresso, semNbsp: new Map(grupos) })
      let mudou = false
      for (const [k, lista] of sessao.gruposQueAbrem()) {
        const atual = grupos.get(k) || []
        const novos = lista.filter(g => !atual.includes(g))
        if (novos.length) { grupos.set(k, [...atual, ...novos]); mudou = true }
      }
      if (!mudou) break
    }
    return sessao
  }
  const { relatorio, estado } = await gerarPdfPublicacao(publicacao, { ...opcoes, devolverEstado: true, conferencia: false })
  if (!estado?.composicao) throw new Error('A tela de paginação precisa do compositor (dicionário de hifenização do InDesign não encontrado).')
  // a exportação termina com a sessão já planejada (a mesma paginação do PDF)
  const s = estado.sessao || new SessaoPaginacao(estado, relatorio, publicacao)
  // opções da exportação, para o "Gerar PDF" da tela (institucional, modelo, Typst)
  s.opcoes = opcoes
  sessoes.set(chave, s)
  return s
}

export const sessaoAberta = chave => sessoes.get(chave) || null
export const fecharSessao = chave => sessoes.delete(chave)

const permitidos = (passos, proibidos) => passos.filter(([t, s]) => !(proibidos || []).some(([pt, ps]) => Math.abs(pt - t) < 1e-6 && Math.abs(ps - s) < 1e-6))
const fixoDe = rs => rs.manual?.tr != null ? [rs.manual.tr, rs.manual.sp] : rs.fixo ? [rs.fixo.tr, rs.fixo.sp] : rs.aperto != null ? AJUSTES[rs.aperto] : rs.pilha?.tr != null ? [rs.pilha.tr, rs.pilha.sp] : null
// replanejamento local: mudança de até LINHAS_JANELA linhas tenta antes uma janela de 4, depois de
// 8 páginas, terminando onde a paginação anterior terminava; senão, replaneja até o fim do livro
const LINHAS_JANELA = 2
const JANELAS = [4, 8]
// linha apertada, marcada na tela: espaço entre palavras abaixo de 80% (regra do usuário,
// 2026-11-04; o piso absoluto, que nunca é passado, é ESPACO_MINIMO = 82%)
const letras = t => (String(t).match(/\p{L}/gu) || []).length

export class SessaoPaginacao {
  constructor(estado, relatorio, publicacao) {
    Object.assign(this, estado)
    this.publicacao = publicacao
    this.relatorioInicial = relatorio
    this.itensPorJ = estado.itensMiolo
    this.jDoI = new Map(estado.itensMiolo.map((it, j) => [it.i, j]))
    this.manual = resolverAjustes(null, estado.miolo)
    this.quebrasProibidas = new Map([...estado.restricoes].filter(([, r]) => r.quebrasProibidas).map(([i, r]) => [i, new Set(r.quebrasProibidas)]))
    this.paginas = []
    this.planoAtual = {}
    this.finsManuais = []
    this.planejar(0)
    this.corrigirFimImpar(0)
  }

  /**
   * Replaneja a partir da página p0 (as anteriores ficam como estão). Mesma regra do PDF: o hífen no
   * fim de página ímpar é tratado pela sessão (corrigirFimImpar), não desligando a hifenização do
   * parágrafo inteiro (semHifenImpar: false) — que deixaria as linhas abertas demais.
   */
  planejar(p0, { janela = false } = {}) {
    // mudança pequena (até 2 linhas): primeiro numa janela de 4, depois de 8 páginas, que tem de
    // terminar onde a paginação anterior terminava — o resto do livro fica igual
    if (janela && this.paginas.length) {
      for (const W of JANELAS) if (this.planejarJanela(p0, W)) { this.janela = W; return }
    }
    this.janela = null
    const pg = p0 > 0 ? this.paginas[p0] : null
    const r = planejarPaginas(this.itensMiolo, this.medidas, this.paridade, this.opcoesPlano(pg ? this.inicioDa(p0) : null))
    const fixas = pg ? this.paginas.slice(0, p0) : []
    this.paginas = [...fixas, ...r.paginas]
    this.juntarPlano(r.plano, fixas.length, this.paginas.length)
    this.resumo = r.resumo
    this.conferirFins()
  }

  /**
   * Plano depois de replanejar as páginas [a, b): os parágrafos que começam nelas ficam com o
   * tracking/espaço do plano novo, os outros com o de antes; entrelinha, quebra antes e hifenização
   * da última linha vêm de novo de cada página (como na reconstrução de paginacao.js) — o plano
   * é o que vai para o PDF.
   */
  juntarPlano(novo, a, b) {
    const N = this.itensMiolo.length
    const ini = n => n >= this.paginas.length ? N : this.paginas[n].de[0] + (this.paginas[n].de[1] > 0 ? 1 : 0)
    const plano = {}
    for (const it of this.itensMiolo) {
      const p = this.planoAtual[it.i] || novo[it.i]
      if (!p) continue
      const { lf, fatorEspaco, quebraAntes, hy, ...resto } = p
      plano[it.i] = { ...resto, lf: 1 }
    }
    for (let j = ini(a); j < ini(b); j++) {
      const p = novo[this.itensMiolo[j].i]
      if (!p) continue
      const { lf, fatorEspaco, quebraAntes, hy, ...resto } = p
      plano[this.itensMiolo[j].i] = { ...resto, lf: 1 }
    }
    for (const pg of this.paginas) {
      const [j0, k0] = pg.de, [j1, k1] = pg.ate
      for (let j = k0 > 0 ? j0 + 1 : j0; j < Math.min(j1 + (k1 > 0 ? 1 : 0), N); j++) {
        const p = plano[this.itensMiolo[j].i]
        if (p) { p.lf = Math.round((pg.f || 1) * 10000) / 10000; p.fatorEspaco = p.lf }
      }
      if (k1 === 0 && j1 < N && !this.itensMiolo[j1].quebra && plano[this.itensMiolo[j1].i]) plano[this.itensMiolo[j1].i].quebraAntes = true
      if (k1 > 0 && pg.v2 === 1 && plano[this.itensMiolo[j1].i]) plano[this.itensMiolo[j1].i].hy = false
    }
    this.planoAtual = plano
  }

  opcoesPlano(inicio, alvo = null) {
    return {
      semHifenImpar: false,
      quebrasProibidas: this.quebrasProibidas,
      manual: { fins: this.manual.fins, proibidos: this.manual.proibidos, entrelinhas: this.manual.entrelinhas },
      inicio, alvo,
    }
  }

  /** Estado do começo da página p0 no plano atual (ponto de partida do replanejamento). */
  inicioDa(p0) {
    const pg = this.paginas[p0], anterior = this.paginas[p0 - 1]
    return {
      j: pg.de[0], k: pg.de[1], v: pg.v ?? 0, phi: pg.phi ?? 1, par: pg.par,
      esq: pg.par === 1 && anterior && anterior.par === 0 && !anterior.excecao ? anterior.buraco : 'x',
    }
  }

  /**
   * Replaneja as páginas de p0 até a primeira página, depois de W, que começa num parágrafo: a solução
   * tem de chegar a esse ponto com a mesma paridade e o mesmo número de páginas, e o que vem depois
   * fica como estava. false se não houver solução assim.
   */
  planejarJanela(p0, W) {
    let q = p0 + W
    while (q < this.paginas.length && this.paginas[q].de[1] !== 0) q++
    if (q >= this.paginas.length) return false
    const alvoPg = this.paginas[q]
    const r = planejarPaginas(this.itensMiolo, this.medidas, this.paridade,
      this.opcoesPlano(p0 > 0 ? this.inicioDa(p0) : null, { j: alvoPg.de[0], k: 0, par: alvoPg.par }))
    const ult = r.paginas[r.paginas.length - 1]
    if (r.paginas.length !== q - p0 || !ult || ult.ate[0] !== alvoPg.de[0] || ult.ate[1] !== 0) return false
    // plano: o da janela para os parágrafos dela, o anterior para os outros
    this.paginas = [...this.paginas.slice(0, p0), ...r.paginas, ...this.paginas.slice(q)]
    this.juntarPlano(r.plano, p0, p0 + r.paginas.length)
    this.conferirFins()
    return true
  }

  /** Fins de página pedidos na tela: cumpridos ou não, no livro inteiro. */
  conferirFins() {
    const N = this.itensMiolo.length
    const fimEm = new Set(this.paginas.map(pg => { const [j1, k1] = pg.ate; return j1 < N ? `${this.itensMiolo[j1].i}|${k1}` : 'fim' }))
    const out = []
    for (const [i, linhas] of this.manual.fins) {
      const j = this.jDoI.get(i)
      const n = Math.max(1, Math.round((this.medidas[i]?.h ?? this.itensMiolo[j].L) / this.itensMiolo[j].L))
      for (const k of linhas) {
        const alvo = k > 0 && k >= n ? (j + 1 < N ? `${this.itensMiolo[j + 1].i}|0` : 'fim') : `${i}|${k}`
        out.push({ i, linha: k, cumprido: fimEm.has(alvo) })
      }
    }
    this.finsManuais = out
  }

  /** Primeira página ímpar, a partir de p0, que termina com hífen (hifenização ou hífen próprio): { n, i, k }. */
  fimImparComHifen(p0) {
    for (let n = p0; n < this.paginas.length; n++) {
      const pg = this.paginas[n]
      const [j1, k1] = pg.ate
      if (pg.par !== 1 || k1 === 0 || j1 >= this.itensMiolo.length) continue
      const i = this.itensMiolo[j1].i
      if (!this.composicao.tem(i)) continue
      const pl = this.planoAtual[i] || {}
      const ls = this.composicao.textos(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: this.rsDe(i), base: this.baseHifen })
      if (ls[k1 - 1]?.hifen || ls[k1]?.repeteHifen) return { n, i, k: k1 }
    }
    return null
  }

  /**
   * Hífen no fim de página ímpar (proibido): como a verificação do PDF, a página não pode terminar
   * naquela linha — a paginação traz as linhas da página seguinte (o parágrafo junto, com a
   * entrelinha) ou leva a linha para a frente, pelo menor custo.
   */
  corrigirFimImpar(p0) {
    for (let t = 0; t < 8; t++) {
      const x = this.fimImparComHifen(p0)
      if (!x) return
      this.quebrasProibidas = new Map(this.quebrasProibidas)
      this.quebrasProibidas.set(x.i, new Set([...(this.quebrasProibidas.get(x.i) || []), x.k]))
      p0 = Math.max(0, x.n - 1)
      this.planejar(p0, { janela: true })
    }
  }

  manualDe(i) {
    const m = this.manual.porPar.get(i)
    return m ? { ...(m.tr != null ? { tr: m.tr, sp: m.sp } : {}), palavras: [...m.palavras], juntar: [...m.juntar] } : null
  }

  rsDe(i) {
    const rs = this.restricoes.get(i) || {}
    const m = this.manualDe(i)
    return m ? { ...rs, manual: m } : rs
  }

  /** Parágrafos cujo ajuste mudou entre dois resultados de resolverAjustes. */
  static diferencas(a, b) {
    const out = new Set()
    const cmpPar = x => x ? JSON.stringify({ tr: x.tr, sp: x.sp, p: [...x.palavras], j: [...x.juntar] }) : ''
    for (const i of new Set([...a.porPar.keys(), ...b.porPar.keys()])) if (cmpPar(a.porPar.get(i)) !== cmpPar(b.porPar.get(i))) out.add(i)
    for (const m of ['fins', 'proibidos']) {
      for (const i of new Set([...a[m].keys(), ...b[m].keys()])) {
        if (JSON.stringify([...(a[m].get(i) || [])].sort()) !== JSON.stringify([...(b[m].get(i) || [])].sort())) out.add(i)
      }
    }
    for (const c of new Set([...a.entrelinhas.keys(), ...b.entrelinhas.keys()])) {
      if (a.entrelinhas.get(c) !== b.entrelinhas.get(c)) out.add(Number(c.split('|')[0]))
    }
    return out
  }

  /** Aplica a lista completa de ajustes (os do banco) e devolve o modelo das páginas. */
  aplicar(itens) {
    aplicarFormato(this.opcoes?.formato)
    const t0 = Date.now()
    const novo = resolverAjustes({ itens }, this.miolo)
    const alterados = SessaoPaginacao.diferencas(this.manual, novo)
    this.manual = novo
    if (alterados.size) {
      // medidas dos parágrafos do compositor que mudaram; quantas linhas mudaram ao todo
      let delta = 0
      const linhas = i => Math.round((this.medidas[i]?.h ?? 0) / this.itensMiolo[this.jDoI.get(i)].L)
      for (const i of alterados) {
        if (!this.composicao.tem(i)) continue
        const antes = linhas(i)
        const rs = this.rsDe(i)
        this.medidas[i] = { notas: [], ...this.medidas[i], ...this.composicao.medidas(i, { rs, fixo: fixoDe(rs), aj: permitidos(AJUSTES, rs.proibidos), ab: permitidos(ABRIR, rs.proibidos), base: this.baseHifen }) }
        delta += Math.abs(linhas(i) - antes)
      }
      this.deltaLinhas = delta
      // replaneja a partir da página do primeiro parágrafo alterado (as anteriores ficam)
      const jMin = Math.min(...[...alterados].map(i => this.jDoI.get(i)).filter(j => j != null))
      let p0 = this.paginas.findIndex(pg => pg.ate[0] > jMin || (pg.ate[0] === jMin && pg.ate[1] > 0))
      if (p0 < 0) p0 = this.paginas.length - 1
      // começa uma página antes, para o pedido de "trazer a linha" da página seguinte poder agir
      p0 = Math.max(0, p0 - 1)
      this.planejar(p0, { janela: delta <= LINHAS_JANELA })
      this.corrigirFimImpar(p0)
    }
    this.ms = Date.now() - t0
    return this.modelo()
  }

  /** Espaço mínimo entre palavras do estilo (1 = 100%; o padrão do InDesign é 80%). */
  espacoMinimo(estilo) {
    const v = parseFloat(this.estilos.par(estilo).MinimumWordSpacing)
    return Math.max(Number.isFinite(v) ? v : 80, ESPACO_MINIMO) / 100
  }

  /** Grupos com espaço sem quebra no começo da linha seguinte a uma linha aberta, por parágrafo. */
  gruposQueAbrem() {
    const nbsp = String.fromCharCode(0xa0), grupos = new Map()
    for (const pg of this.modelo().paginas) {
      for (const b of pg.blocos || []) {
        const linhas = b.linhas || []
        linhas.forEach((l, k) => {
          const prox = linhas[k + 1]
          if (!l.aberta || !prox) return
          // as linhas da tela mostram espaço comum: o grupo sai do texto do parágrafo
          const par = this.miolo[b.i], o = par?.origem
          const texto = (prox.partes || []).map(q => q.t).join('').trim()
          const bruto = (par?.runs || []).map(r => r.nota ? '' : r.texto ?? '').join('')
          const ini = bruto.split(nbsp).join(' ').indexOf(texto.slice(0, 40))
          if (ini < 0 || !o) return
          const fim = bruto.indexOf(' ', ini)
          const g = bruto.slice(ini, fim < 0 ? undefined : fim)
          if (!g.includes(nbsp)) return
          // na última linha, soltar o grupo pode deixar sobrar pouco: "art. 89, / VII;"
          if (k + 2 === linhas.length && texto.length < 3 * formato.ultimaLinha + g.length) return
          const chave = `${o.norma}:${o.bloco}`
          grupos.set(chave, [...(grupos.get(chave) || []), g])
        })
      }
    }
    return grupos
  }

  /** Limite do aperto: abaixo dele a linha é marcada como apertada na tela (o mesmo em todos os estilos). */
  limiteAperto() { return formato.apertada }

  /** Estilos de parágrafo e de caractere usados, para a tela desenhar. */
  estilosUsados() {
    const par = {}, char = {}
    const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d }
    for (const it of this.itensMiolo) {
      if (it.tipo !== 'par') continue
      const e = it.fn.estilo
      if (!par[e]) {
        const p = this.estilos.par(e)
        const f = funcaoParagrafo(e, this.estilos)
        par[e] = {
          corpo: f.corpo, entrelinha: f.leading, ascendente: f.asc, justificado: f.justify,
          alinhamento: /Center/.test(p.Justification || '') ? 'center' : /Right/.test(p.Justification || '') ? 'right' : 'left',
          // x da 1ª linha (recuo1) e das outras (esquerda) na coluna; largura útil: largura − primeira / − pendente
          primeira: f.geo.primeira, pendente: f.geo.pendente, esquerda: f.geo.esquerda, recuo1: f.geo.recuo1, largura: f.geo.largura,
          espacoMinimo: this.espacoMinimo(e), limiteAperto: this.limiteAperto(e),
          fonte: p.AppliedFont || 'Source Sans 3', estilo: p.FontStyle || 'Regular',
          caixaAlta: p.Capitalization === 'AllCaps', marcador: p.BulletsAndNumberingListType === 'BulletList',
        }
      }
      for (const r of it.runs || []) {
        if (!r.char || char[r.char]) continue
        const c = this.estilos.char(r.char)
        char[r.char] = { estilo: c.FontStyle || null, corpo: num(c.PointSize, null), caixaAlta: c.Capitalization === 'AllCaps', sobrescrito: /Superscript/.test(c.Position || ''), tom: num(c.FillTint, 100) }
      }
    }
    return { par, char }
  }

  /** Modelo das páginas para a tela. */
  modelo() {
    const N = this.itensMiolo.length
    const paginas = []
    let parte1 = ''
    const fimPedido = new Map()
    for (const f of this.finsManuais || []) fimPedido.set(`${f.i}|${f.linha}`, f.cumprido)
    this.paginas.forEach((pg, n) => {
      if (pg.branca) paginas.push({ branca: true, folio: null })
      const [j0, k0] = pg.de, [j1, k1] = pg.ate
      const blocos = []
      for (let j = j0; j <= Math.min(j1, N - 1); j++) {
        const it = this.itensMiolo[j]
        if (j === j1 && k1 === 0) break
        if (it.parte1) parte1 = it.parte1
        const pl = this.planoAtual[it.i] || {}
        const de = j === j0 ? k0 : 0
        if (it.tipo === 'tabela') { blocos.push({ i: it.i, tabela: true, h: this.medidas[it.i]?.h || 0 }); continue }
        const bloco = { i: it.i, estilo: it.fn.estilo, espaco: j === j0 ? 0 : it.espaco * (pg.f || 1), deLinha: de, tr: pl.tr ?? 0, sp: pl.sp ?? 100, manual: this.manual.porPar.has(it.i) }
        if (this.composicao.tem(it.i)) {
          const todas = this.composicao.textos(it.i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: this.rsDe(it.i), base: this.baseHifen })
          const ate = j === j1 ? k1 : todas.length
          // apertada: espaço entre palavras abaixo de 80% (APERTADA), como aparece arredondado na tela
          const minimo = this.limiteAperto(it.fn.estilo)
          // assinaturas da CF (ass-cf): sem marca de problema
          const conferir = !semConferencia(it.fn.estilo)
          bloco.linhas = todas.slice(de, ate).map((l, m) => ({ ...l, n: de + m, aberta: conferir && l.justificada && l.espaco > ABERTA, apertada: conferir && l.justificada && l.espaco < minimo - 1e-9 }))
          bloco.total = todas.length
          // última linha abaixo do mínimo (7 caracteres só em caso complexo): sempre aparece nos problemas
          if (conferir && todas.length > 1 && ate === todas.length) {
            const cp = this.composicao.compor(it.i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: this.rsDe(it.i), base: this.baseHifen })
            // o mínimo sobe 1 quando a última linha é só nota, de corpo menor (bolso)
            if (cp.ultima < formato.ultimaLinha + (formato.notaMaisUm && cp.ultimaNota ? 1 : 0)) bloco.ultimaCurta = cp.ultima
          }
          // palavras empilhadas (mesmo trecho de mais de 2 letras no fim ou no começo de linhas seguidas)
          const ponta = (l, fim) => {
            const t = l.partes.map(p => p.t).join('').trim()
            const w = fim ? t.split(/\s+/).pop() + (l.hifen ? '-' : '') : t.split(/\s+/)[0]
            return w.toLocaleLowerCase('pt-BR')
          }
          for (let m = 1; conferir && m < bloco.linhas.length; m++) {
            const a = bloco.linhas[m - 1], b = bloco.linhas[m]
            for (const fim of [true, false]) {
              const ta = ponta(a, fim), tb = ponta(b, fim)
              if (ta && ta === tb && letras(ta) > 2) { a.pilha = b.pilha = true }
            }
          }
        } else {
          bloco.texto = textoDoParagrafo(this.miolo[it.i])
          bloco.total = Math.max(1, Math.round((this.medidas[it.i]?.h || it.L) / it.L))
          bloco.linhasNaPagina = (j === j1 ? k1 : bloco.total) - de
        }
        bloco.notas = (it.runs || []).filter(r => r.nota).map(r => r.nota.map(x => x.texto).join(''))
        bloco.ancora = ancoraDe(this.miolo[it.i])
        bloco.fimPedido = fimPedido.get(`${it.i}|${j === j1 ? k1 : bloco.total}`) ?? null
        blocos.push(bloco)
      }
      paginas.push({
        n, folio: this.primeiraPaginaMiolo + paginas.length, par: pg.par, entrelinha: Math.round((pg.f || 1) * 1000) / 1000,
        buraco: Math.round(pg.buraco || 0), buracoLinhas: Math.round((pg.buraco || 0) / formato.linha * 10) / 10,
        ajustadas: (pg.ajustes || []).length, cabeco: pg.par === 0 ? this.publicacao.titulo : parte1, blocos,
      })
    })
    const naoEncontrados = this.manual.naoEncontrados.map(a => ({ id: a.id, tipo: a.tipo, texto: a.ancora?.texto }))
    return {
      paginas, estilos: this.estilosUsados(), resumo: this.resumo, ms: this.ms ?? null,
      // replanejamento do último ajuste: janela de N páginas, ou null (até o fim do livro)
      janela: this.janela ?? null,
      ajustes: { aplicados: this.manual.aplicados, naoEncontrados, fins: this.finsManuais },
      alternativas: null,
    }
  }

  /**
   * Alternativas de tracking/espaço de um parágrafo do compositor, para o painel: cada passo com o nº
   * de linhas, o pior espaçamento e os hífens.
   */
  alternativas(i) {
    if (!this.composicao.tem(i)) return []
    const rs = this.rsDe(i)
    const out = []
    for (const [tr, sp] of [[0, 100], ...AJUSTES, ...ABRIR]) {
      const ls = this.composicao.textos(i, { tr, sp, rs, base: this.baseHifen })
      const just = ls.filter(l => l.justificada)
      // pior: o maior espaço entre palavras das linhas justificadas; menor: o menor (1 = 100% do
      // normal); apertadas: linhas abaixo de 80% (APERTADA)
      const minimo = this.limiteAperto(this.itensMiolo[this.jDoI.get(i)].fn.estilo)
      out.push({
        tr, sp, linhas: ls.length, hifens: ls.filter(l => l.hifen).length,
        pior: Math.round(Math.max(1, ...just.map(l => l.espaco)) * 100) / 100,
        menor: Math.round(Math.min(1, ...just.map(l => l.espaco)) * 100) / 100,
        apertadas: just.filter(l => l.espaco < minimo - 1e-9).length, minimo,
      })
    }
    return out
  }
}
