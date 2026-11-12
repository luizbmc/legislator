/**
 * exportPdf.js — PDF de revisão da publicação, composto pelo Typst com as fontes do livro
 * (pasta "Document fonts" do modelo) e os estilos do modelo IDML.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import JSZip from 'jszip'
import { prepararPublicacao } from '../idml/exportIdml.js'
import { aplicarTextosDoIdml } from '../idml/textosDeIdml.js'
import { acharDicionarioIndesign, prepararComposicao, pontoBomComposta } from './composicaoLivro.js'
import { resolverAjustes } from './ajustesLocais.js'
import { paragrafosDaPublicacao, novoRelatorio, aplicarGrep, soltarNbsp } from '../idml/historia.js'
import { valoresDosCampos, aplicarCampos } from '../idml/pretextuais.js'
import { aplicarPretextuaisDoLivro } from '../idml/pretextuaisLivro.js'
import { lerEstilos } from './estilosModelo.js'
import { documentoTypst, documentoLarguras, documentoTentativas, paragrafosDaStory, itensParaPaginacao, HIFENIZACAO, AJUSTES, ABRIR, aplicarFormato, definirCalibracao, ESPACO_MINIMO } from './typstLivro.js'
import { semConferencia, formato } from './mancha.js'
import { divisoes, candidatosPilha, pilhasConfirmadas } from './pilhas.js'
import { itensConferencia, numeracaoDeLinhas, anotarPdf, palavrasParaTestar } from './conferencia.js'
import { planejarPaginas } from './paginacao.js'
import { SessaoPaginacao } from './sessaoPaginacao.js'
import { montarLinhas, hifenizacao, pedidosDeLargura, aberturas, revisar, ABERTA, LIBERAR_JA, pedidosDePrefixos, listaHifenizacoes, pedidosHifenProprio } from './linhas.js'

// rodadas de verificação da composição (medir → paginar → compor → conferir as linhas): as
// primeiras corrigem tudo; as seguintes, só hífens seguidos (até RODADAS_ESCADA a mais)
const RODADAS = 5, RODADAS_ESCADA = 2

function lerJson(v) {
  if (!v) return {}
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return {} }
}

/**
 * @param opcoes { pastaModelo, typst (caminho do executável), pretextuais, institucional,
 *                 cabecalho, manterFonte (guarda o .typ ao lado, para depuração),
 *                 sessao (SessaoPaginacao: o PDF exatamente com a paginação da tela, sem as rodadas
 *                 de verificação — só compõe, confere e lista as hifenizações) }
 * @returns { pdf: Buffer, relatorio, typ, hifenizacoes (texto: uma palavra hifenizada por linha) }
 */
export async function gerarPdfPublicacao(publicacao, opcoes = {}) {
  const { pastaModelo } = opcoes
  // andamento para a barra de progresso: { texto, fracao (0–1) }
  const prog = (texto, f) => { try { opcoes.progresso?.({ texto, fracao: Math.max(0, Math.min(1, f)) }) } catch { /* janela fechada */ } }
  prog('Preparando o texto', 0.02)
  // formato do livro (bolso): vale para a composição, a paginação e a tela
  aplicarFormato(opcoes.formato)
  const cfg = JSON.parse(readFileSync(join(pastaModelo, 'modelo.json'), 'utf8'))
  const zip = await JSZip.loadAsync(readFileSync(join(pastaModelo, 'modelo.idml')))
  const ler = n => zip.file(n)?.async('string') ?? Promise.resolve('')
  const estilos = lerEstilos(await ler('Resources/Styles.xml'), await ler('Resources/Graphic.xml'))

  // calibração com o InDesign (experimento): opcoes.calibracao = { padroes: hyph_*.dic do InDesign, minimos }
  aplicarFormato, definirCalibracao(opcoes.calibracao || null)
  const rel = novoRelatorio()
  const pub = prepararPublicacao(publicacao)
  rel.puladas = pub.puladas
  rel.pendentes = pub.pendentes
  // texto de algumas normas tirado de um IDML diagramado (opcoes.textosIdml = { arquivo, tipos })
  if (opcoes.textosIdml?.arquivo) rel.textosIdml = await aplicarTextosDoIdml(pub, opcoes.textosIdml)

  // pré-textuais com os mesmos campos do IDML
  const valores = valoresDosCampos(pub, lerJson(opcoes.pretextuais ?? publicacao.pretextuais), lerJson(opcoes.institucional))
  // campos do modelo e, por cima, a folha técnica da publicação (como no IDML)
  for (const id of Object.values(cfg.pretextuais || {})) {
    const n = `Stories/Story_${id}.xml`
    if (zip.file(n)) zip.file(n, aplicarCampos(await ler(n), valores).xml)
  }
  await aplicarPretextuaisDoLivro(zip, { publicacao, institucional: lerJson(opcoes.institucional) })
  const story = async papel => {
    const id = cfg.pretextuais[papel]
    if (!id) return []
    return paragrafosDaStory(await ler(`Stories/Story_${id}.xml`))
  }
  const direitos = await story('direitos')
  const pre = [
    await story('rosto'),
    await story('mesa'),
    [...await story('creditos'), ...await story('ficha'), ...direitos],
  ].filter(p => p.length)

  // PDF da tela de paginação: o miolo, as medidas, o compositor e as restrições são os da sessão
  const sessao = opcoes.sessao || null
  const miolo = sessao ? sessao.miolo : soltarNbsp(aplicarGrep(paragrafosDaPublicacao(pub, { cabecalho: opcoes.cabecalho || 'secao' }, rel), opcoes.formato?.grep), opcoes.semNbsp, { numeroParentese: !!opcoes.formato?.soltarNbsp })
  const primeiraPaginaMiolo = opcoes.primeiraPaginaMiolo ?? cfg.paginasPreTextuais + 1
  // livro completo (pdfLivroCompleto.js): aqui só o miolo; o resto vem das páginas do livro
  const soMiolo = !!(opcoes.livro || opcoes.somenteMiolo)
  const partes = {
    hifenizacao: opcoes.hifenizacao,
    titulo: [publicacao.titulo, publicacao.edicao].filter(Boolean).join(' — '),
    pre,
    miolo,
    colofao: soMiolo ? [] : await story('colofao'),
    semPreTextuais: soMiolo,
    cabecoArtigo: !!opcoes.livro,
    // livro dividido pelas epígrafes (Regimento): cabeço corrido pela norma, como no livro
    cabecoPorNorma: opcoes.livro?.dados?.divisao === 'epigrafe',
    cabecalhoImpar: opcoes.cabecalhoImpar,
    cabecalhoPar: opcoes.cabecalhoPar ?? publicacao.titulo,
    primeiraPaginaMiolo,
    verificar: !!opcoes.verificar,
  }
  const fontes = join(pastaModelo, 'Document fonts')

  const pasta = mkdtempSync(join(tmpdir(), 'normando-pdf-'))
  try {
    const arq = n => join(pasta, n)
    let typ
    let hifenizacoes
    let conferencia = null
    let sessaoDoLivro = null
    // estado da composição, para a sessão de paginação (tela): opcoes.devolverEstado
    let estado = null
    if (opcoes.paginar === false) {
      typ = documentoTypst(partes, estilos)
    } else {
      // restrições da verificação da composição (linhas.js), acumuladas a cada rodada
      // (as da sessão, copiadas: a exportação não mexe no estado da tela)
      const restricoes = sessao ? new Map([...sessao.restricoes].map(([i, r]) => [i, { ...r }])) : new Map()
      const rodadas = []
      // a medição de um parágrafo só depende do texto e das restrições dele: da 2ª rodada em
      // diante, só os parágrafos com restrição nova são medidos de novo
      const medidas = sessao ? sessao.medidas : {}
      let alterados = null
      // larguras naturais de palavras (documento só de medidas)
      const medirLarguras = async pedidos => {
        const larguras = new Map()
        if (!pedidos.size) return larguras
        writeFileSync(arq('larguras.typ'), documentoLarguras([...pedidos.values()], estilos), 'utf8')
        const [valores] = JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('larguras.typ'), '<lg>', '--field', 'value']))
        ;[...pedidos.keys()].forEach((chave, k) => larguras.set(chave, valores[k]))
        return larguras
      }
      // quebras de linha pelo compositor calibrado com o InDesign (composicaoLivro.js), quando o
      // dicionário de hifenização do InDesign está instalado; opcoes.compositor === false: o Typst quebra
      const itensMiolo = sessao ? sessao.itensMiolo : itensParaPaginacao(miolo, estilos)
      let composicao = sessao ? sessao.composicao : null
      const dicionario = sessao ? null : opcoes.compositor === false ? null : acharDicionarioIndesign(opcoes.dicionarioIndesign)
      if (sessao) {
        rel.compositor = { paragrafos: composicao.pars.size, ms: 0, daSessao: true }
      } else if (dicionario) {
        const t0 = Date.now()
        composicao = await prepararComposicao(itensMiolo, estilos, {
          dicionario,
          medir: async pedidos => {
            const out = []
            for (let k = 0; k < pedidos.length; k += 15000) {
              writeFileSync(arq('larguras-compositor.typ'), documentoLarguras(pedidos.slice(k, k + 15000), estilos), 'utf8')
              const [valores] = JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('larguras-compositor.typ'), '<lg>', '--field', 'value']))
              out.push(...valores)
            }
            return out
          },
        })
        rel.compositor = { dicionario, paragrafos: composicao.pars.size, ms: Date.now() - t0 }
      } else {
        rel.compositor = { desligado: opcoes.compositor === false ? 'pedido' : 'dicionário de hifenização do InDesign não encontrado' }
      }
      const baseHifen = opcoes.hifenizacao ?? HIFENIZACAO
      // ajustes locais da tela de paginação (ajustesLocais.js, opcoes.ajustes): prevalecem sobre a
      // verificação automática
      const manual = sessao ? sessao.manual : resolverAjustes(opcoes.ajustes, miolo)
      const manualDe = i => {
        const m = manual.porPar.get(i)
        return m ? { ...(m.tr != null ? { tr: m.tr, sp: m.sp } : {}), palavras: [...m.palavras], juntar: [...m.juntar] } : null
      }
      // restrições do parágrafo: as da verificação mais as do usuário (rs.manual)
      const rsDe = i => { const rs = restricoes.get(i) || {}; const m = manualDe(i); return m ? { ...rs, manual: m } : rs }
      // tracking/espaço do usuário também nos parágrafos que o Typst mede (rs.fixo)
      for (const [i, m] of manual.porPar) if (m.tr != null) restricoes.set(i, { ...(restricoes.get(i) || {}), fixo: { tr: m.tr, sp: m.sp } })
      rel.ajustes = { pedidos: (opcoes.ajustes?.itens || []).length, aplicados: manual.aplicados, naoEncontrados: manual.naoEncontrados }
      // passos de ajuste que o parágrafo ainda pode usar (sem os proibidos pela verificação)
      const permitidos = (passos, proibidos) => passos.filter(([t, s]) => !(proibidos || []).some(([pt, ps]) => Math.abs(pt - t) < 1e-6 && Math.abs(ps - s) < 1e-6))
      // compostas liberadas que podem quebrar no hífen próprio (ver o uso, depois de revisar): tira a
      // liberação e fixa o tracking/espaço que serve; devolve quantas
      const voltarAoHifenProprio = (restricoes, plano, novos) => {
        let n = 0
        for (const [i, rs] of restricoes) {
          if (!rs.compostasLivres?.length || !composicao.tem(i) || manualDe(i)?.tr != null) continue
          const est = composicao.pars.get(i)
          const compostas = new Set(est.atomos.flatMap(a => a.pecas || []).filter(p => p.composta).map(p => p.k))
          const ks = rs.compostasLivres.filter(k => compostas.has(k) && !(rs.compostasNoHifen || []).includes(k) && !(rs.noHifenFalhou || []).includes(k))
          if (!ks.length) continue
          const pl = plano[i] || {}
          const base = rsDe(i)
          const atual = composicao.textos(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, rs: base, base: baseHifen })
          const sem = { ...base, compostasLivres: base.compostasLivres.filter(k => !ks.includes(k)) }
          const igual = composicao.textos(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, rs: sem, base: baseHifen })
          // a liberação não mudou nada: nada a fazer
          const texto = l => l.partes.map(q => q.t).join('')
          if (igual.map(texto).join('|') === atual.map(texto).join('|')) continue
          // só quando alguma composta ficou dividida fora do hífen próprio (linha terminada em hífen de
          // hifenização, e a palavra dividida tem hífen entre letras)
          // (só as divisões fora da regra das 4 letras: as outras são divisões comuns — pontoBomComposta)
          const divididas = atual.map((l, n) => {
            if (!l.hifen || !atual[n + 1]) return null
            const pre = texto(l).split(' ').pop() || ''
            const w = pre + (texto(atual[n + 1]).split(' ')[0] || '')
            return /\p{L}[-‐]\p{L}/u.test(w) && !pontoBomComposta(w, pre.length) ? w : null
          }).filter(Boolean)
          if (!divididas.length) continue
          // serve: mesmo nº de linhas, nenhuma acima de LIBERAR_JA nem apertada além do limite, e a
          // composta quebra no hífen próprio ou cabe inteira na linha — descer inteira para a linha
          // seguinte não é quebrar no hífen ("au-|sentar-se" fica melhor que "|ausentar-se")
          const desceu = ls => ls.some((l, n) => n > 0 && divididas.includes(texto(l).split(' ')[0]))
          const serve = ls => ls.length === atual.length && !desceu(ls) && ls.every(l => !l.justificada || (l.espaco <= LIBERAR_JA && l.espaco >= formato.apertada))
          // (nunca um passo proibido pela verificação, nem o atual)
          const passos = permitidos([[pl.tr ?? 0, pl.sp ?? 100], [0, 100], ...AJUSTES, ...ABRIR], rs.proibidos)
          // de todos os passos que servem, o de menor abertura (a pior linha do parágrafo)
          const pior = ls => Math.max(0, ...ls.filter(l => l.justificada).map(l => l.espaco))
          let ok = null, melhor = Infinity
          for (const [tr, sp] of passos) {
            const ls = composicao.textos(i, { tr, sp, rs: sem, base: baseHifen })
            if (serve(ls) && pior(ls) < melhor - 1e-6) { ok = [tr, sp]; melhor = pior(ls) }
          }
          if (!ok) continue
          const novo = { ...restricoes.get(i), compostasLivres: rs.compostasLivres.filter(k => !ks.includes(k)), compostasNoHifen: [...new Set([...(rs.compostasNoHifen || []), ...ks])], fixo: { tr: ok[0], sp: ok[1] }, fixoHifen: true, semAperto: true }
          delete novo.aperto
          if (!novo.compostasLivres.length) delete novo.compostasLivres
          restricoes.set(i, novo)
          if (!novos.includes(i)) novos.push(i)
          n++
        }
        return n
      }
      const fixoDe = rs => rs.manual?.tr != null ? [rs.manual.tr, rs.manual.sp] : rs.fixo ? [rs.fixo.tr, rs.fixo.sp] : rs.aperto != null ? AJUSTES[rs.aperto] : rs.pilha?.tr != null ? [rs.pilha.tr, rs.pilha.sp] : null
      // quebras do compositor para a composição final, com o ajuste do plano
      const quebrasDoPlano = plano => {
        const q = new Map()
        if (!composicao) return q
        for (const i of composicao.pars.keys()) {
          const pl = plano[i] || {}
          q.set(i, composicao.compor(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: rsDe(i), base: baseHifen }).quebras)
        }
        return q
      }
      // palavras empilhadas de uma composição (linhas.js + pilhas.js): Map i → pilhas
      const analisarPilhas = async (linhasPorPar, hif, info, plano) => {
        const { pedidos, casos } = pedidosDePrefixos(linhasPorPar, hif, info, plano)
        const div = divisoes(casos, await medirLarguras(pedidos))
        const { pares, pedidos: pedidosPontas } = candidatosPilha(linhasPorPar, info, div, plano)
        const r = pilhasConfirmadas(pares, await medirLarguras(pedidosPontas))
        for (const i of [...r.keys()]) if (semConferencia(info.get(i)?.fn?.estilo)) r.delete(i)
        return r
      }
      // para cada parágrafo com pilha, compõe à parte as tentativas — apertar ou abrir (passos do
      // ajuste fino, dentro dos limites) e espaço sem quebra antes/depois de uma palavra da pilha — e
      // fica a primeira que desfaz a pilha sem mudar o nº de linhas, sem abrir linha além do limite
      // e sem 3 hífens seguidos; nenhuma serve: o parágrafo fica como está
      const itensPorI = new Map(itensMiolo.map(it => [it.i, it]))
      const tentarPilhas = async (elegiveis, pilhas, plano) => {
        const tentativas = []
        const porPar = new Map()
        let id = 0
        for (const i of elegiveis) {
          const it = itensPorI.get(i)
          const pl = plano[i] || {}
          const rs = rsDe(i)
          const comum = { it, lf: pl.lf ?? 1, hc: rs.hc, semHifen: rs.semHifen, compostasLivres: rs.compostasLivres }
          const tr = pl.tr ?? 0, sp = pl.sp ?? 100
          // parágrafo já apertado por linha aberta (rs.aperto): o aperto fica, só se tenta o espaço sem quebra
          const passos = rs.aperto != null ? [] : [...AJUSTES, ...ABRIR]
          const vs = [{ tr, sp, base: true }, ...passos.map(([t, e]) => ({ tr: t, sp: e }))]
          for (const p of pilhas.get(i)) for (const k of p.ks) for (const lado of ['antes', 'depois']) vs.push({ tr, sp, nbsp: { k, lado } })
          porPar.set(i, vs.map(v => {
            const t = { id: ++id, ...comum, ...v }
            // com o compositor, a tentativa também tem as quebras decididas por ele
            if (composicao?.tem(i)) t.quebras = composicao.compor(i, { tr: t.tr, sp: t.sp, rs: { ...rs, pilha: t.nbsp ? { nbsp: t.nbsp } : rs.pilha }, base: baseHifen }).quebras
            tentativas.push(t)
            return t
          }))
        }
        const marcasPorId = new Map()
        writeFileSync(arq('tentativas.typ'), documentoTentativas(tentativas, estilos, { hifenizacao: opcoes.hifenizacao, marcasPorId }), 'utf8')
        const [{ marcas: posicoes }] = JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('tentativas.typ'), '<wpos>', '--field', 'value']))
        const info2 = new Map(tentativas.map(t => [t.id, { marcas: marcasPorId.get(t.id), runs: t.it.runs, fn: t.it.fn }]))
        const plano2 = Object.fromEntries(tentativas.map(t => [t.id, { tr: t.tr, sp: t.sp }]))
        const lp2 = montarLinhas(posicoes, info2)
        // fólio par: a regra do fim de página ímpar não se aplica aqui
        // (com as larguras do hífen próprio, como na composição do livro: sem elas a quebra em
        // "con-|siderando-se" não é reconhecida e a tentativa não reproduz a pilha)
        const hif2 = hifenizacao(lp2, info2, () => 2, await medirLarguras(pedidosHifenProprio(lp2, info2, plano2)), plano2)
        const pil2 = await analisarPilhas(lp2, hif2, info2, plano2)
        const ab2 = aberturas(hif2, info2, plano2, await medirLarguras(pedidosDeLargura(hif2, info2, plano2)), { grave: opcoes.limiteAberta ?? ABERTA })
        const solucoes = new Map()
        // motivos das recusas (conferência no PDF): Map i → texto
        solucoes.motivos = new Map()
        let semBase = 0
        for (const [i, ts] of porPar) {
          const base = ts[0]
          const hb = hif2.get(base.id)
          // composto sozinho o parágrafo não tem a pilha (o contexto muda): não há o que tentar
          if (!hb || !pil2.has(base.id)) {
            solucoes.set(i, null); semBase++
            solucoes.motivos.set(i, 'composto à parte para as tentativas, o parágrafo não reproduz a pilha')
            continue
          }
          const abertasBase = ab2.get(base.id)?.abertas || 0
          const recusas = { linhas: 0, abertas: 0, escada: 0, pilha: 0 }
          const boa = ts.slice(1).find(t => {
            const h = hif2.get(t.id)
            if (!h) return false
            if (h.linhas !== hb.linhas) { recusas.linhas++; return false }
            if (pil2.has(t.id)) { recusas.pilha++; return false }
            if (h.escada > 2) { recusas.escada++; return false }
            if ((ab2.get(t.id)?.abertas || 0) > abertasBase) { recusas.abertas++; return false }
            return true
          })
          solucoes.set(i, boa ? (boa.nbsp ? { nbsp: boa.nbsp } : { tr: boa.tr, sp: boa.sp }) : null)
          if (!boa) {
            const partes = [
              recusas.pilha && `${recusas.pilha} mantinham palavras empilhadas`,
              recusas.linhas && `${recusas.linhas} mudavam o número de linhas do parágrafo (mexeria na paginação)`,
              recusas.abertas && `${recusas.abertas} deixavam linha com espaçamento aberto demais`,
              recusas.escada && `${recusas.escada} criavam 3 hífens seguidos`,
            ].filter(Boolean)
            solucoes.motivos.set(i, `${ts.length - 1} tentativas (apertar/abrir dentro dos limites e espaço sem quebra) recusadas: ${partes.join('; ')}`)
          }
        }
        solucoes.semBase = semBase
        return solucoes
      }
      // dados da última rodada conferida (lista de hifenizações)
      let ultima = null
      // melhor composição de cada parágrafo: i → Map(nº de linhas → { pior, rodada, tr, sp, rs })
      const melhores = new Map()
      const baseDoc = () => ({ ...partes, restricoes, linhas: new Map(), compostos: composicao ? new Set(composicao.pars.keys()) : null })
      // composição com um plano de paginação e conferência das linhas (onde ficaram, hífens,
      // aberturas): { typ, u } — u são os dados da conferência (ultima)
      const comporComPlano = async plano => {
        const linhas = new Map()
        const typ = documentoTypst({ ...baseDoc(), modo: 'final', plano, linhas, quebras: quebrasDoPlano(plano) }, estilos)
        writeFileSync(arq('livro.typ'), typ, 'utf8')
        const [{ marcas: posicoes, trechos, inicio: [paginaInicio, folioInicio] }] = JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('livro.typ'), '<wpos>', '--field', 'value']))
        const folio = p => p - paginaInicio + folioInicio
        const linhasPorPar = montarLinhas(posicoes, linhas)
        const hif = hifenizacao(linhasPorPar, linhas, folio, await medirLarguras(pedidosHifenProprio(linhasPorPar, linhas, plano)), plano)
        const larguras = await medirLarguras(pedidosDeLargura(hif, linhas, plano))
        const abert = aberturas(hif, linhas, plano, larguras, { grave: opcoes.limiteAberta ?? ABERTA })
        return { typ, u: { linhasPorPar, hif, linhas, plano, trechos, folio, abert, larguras } }
      }
      const contarFimImpar = u => [...u.hif.values()].reduce((t, h) => t + h.fimImpar.length, 0)
      // sessão final: a paginação que a tela mostra (com a correção do hífen em fim de página ímpar)
      let sessaoFinal = null
      if (sessao) {
        // PDF da tela de paginação: o plano da sessão, sem rodadas
        prog('Compondo com a paginação da tela', 0.2)
        const r = await comporComPlano(sessao.planoAtual)
        typ = r.typ
        ultima = r.u
        ultima.pilhas = await analisarPilhas(ultima.linhasPorPar, ultima.hif, ultima.linhas, ultima.plano)
        rel.paginacao = sessao.resumo
        rel.ajustes.fins = sessao.finsManuais
        rel.composicao = { daSessao: true, fimImpar: contarFimImpar(ultima), pilhas: [...ultima.pilhas.values()].reduce((t, l) => t + l.length, 0) }
        if (opcoes.verificar) { rel._paginasPlanejadas = sessao.paginas; rel._medidas = medidas; rel._plano = sessao.planoAtual }
      }
      for (let rodada = 1; !sessao; rodada++) {
        // o nº de rodadas varia (acaba quando nada muda): cada rodada anda menos que a anterior
        prog(`Compondo e conferindo as linhas (rodada ${rodada})`, 0.05 + 0.57 * (1 - Math.pow(0.6, rodada - 1)))
        // 1) medição de cada parágrafo do miolo (com o ajuste fino já escolhido)
        const base = baseDoc()
        writeFileSync(arq('medir.typ'), documentoTypst({ ...base, modo: 'medir', somente: alterados }, estilos), 'utf8')
        for (const m of JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('medir.typ'), '<med>', '--field', 'value']))) medidas[m.i] = m
        // parágrafos do compositor: as medidas são dele (o Typst só mediu as notas de rodapé)
        if (composicao) {
          for (const i of composicao.pars.keys()) {
            if (alterados && !alterados.has(i) && medidas[i]?.compositor) continue
            const rs = rsDe(i)
            medidas[i] = { notas: [], ...medidas[i], ...composicao.medidas(i, { rs, fixo: fixoDe(rs), aj: permitidos(AJUSTES, rs.proibidos), ab: permitidos(ABRIR, rs.proibidos), base: baseHifen }) }
          }
        }
        // 2) plano de paginação; 3) composição com o plano
        // com a verificação, a regra do fim de página ímpar é dela (linhas.js): a paginação não
        // desliga a hifenização do parágrafo inteiro
        const { plano, resumo, paginas, finsManuais } = planejarPaginas(itensParaPaginacao(miolo, estilos), medidas, primeiraPaginaMiolo % 2,
          { semHifenImpar: opcoes.conferirLinhas === false, quebrasProibidas: new Map([...restricoes].filter(([, r]) => r.quebrasProibidas).map(([i, r]) => [i, new Set(r.quebrasProibidas)])),
            manual: { fins: manual.fins, proibidos: manual.proibidos, entrelinhas: manual.entrelinhas } })
        rel.paginacao = resumo
        rel.ajustes.fins = finsManuais
        if (opcoes.verificar) { rel._paginasPlanejadas = paginas; rel._medidas = medidas; rel._plano = plano }
        if (opcoes.conferirLinhas === false) {
          typ = documentoTypst({ ...base, modo: 'final', plano, linhas: new Map(), quebras: quebrasDoPlano(plano) }, estilos)
          break
        }
        // 4) verificação: onde ficaram as linhas, hífens seguidos e linhas abertas além do limite
        const r = await comporComPlano(plano)
        typ = r.typ
        ultima = r.u
        ultima.paginas = paginas
        const { linhasPorPar, hif, linhas, larguras, abert } = ultima
        // depuração: análise das linhas de alguns parágrafos (opcoes.depurar = [i, …])
        if (opcoes.depurar) {
          rel._depurar = rel._depurar || []
          for (const i of opcoes.depurar) rel._depurar.push({ rodada, i, restricao: restricoes.get(i), plano: plano[i], hif: hif.get(i) && { ...hif.get(i), medir: hif.get(i).medir.map(l => ({ ...l, larguras: l.chaves?.map(c => larguras.get(c)), resto: l.resto && { ...l.resto, largura: larguras.get(l.resto.chave) } })) }, abertura: abert.get(i), palavras: linhas.get(i)?.marcas.map(m => m.palavra) })
        }
        // melhor composição de cada parágrafo até aqui, por nº de linhas (antes de revisar mexer
        // nas restrições): a de menor abertura, sem escada de hífens nem hífen em fim de página ímpar
        for (const [i, h] of hif) {
          if (h.escada > 2 || h.fimImpar.length || restricoes.get(i)?.restaurado) continue
          const pior = abert.get(i)?.pior || 0
          const porLinhas = melhores.get(i) || new Map()
          const m = porLinhas.get(h.linhas)
          if (!m || pior < m.pior - 1e-6) {
            porLinhas.set(h.linhas, { pior, rodada, tr: plano[i]?.tr ?? 0, sp: plano[i]?.sp ?? 100, rs: JSON.parse(JSON.stringify(restricoes.get(i) || {})) })
            melhores.set(i, porLinhas)
          }
        }
        // restrições como estavam nesta composição: se as rodadas acabarem com mudanças pendentes,
        // voltam a elas (a tela e a correção final têm de partir do que foi medido e composto)
        const restricoesDaRodada = structuredClone(restricoes)
        const { alterados: novos, ...resumoRodada } = revisar(hif, abert, plano, restricoes,
          { soEscada: rodada >= RODADAS, base: opcoes.hifenizacao ?? HIFENIZACAO })
        // composta liberada: se ela pode quebrar no hífen próprio sem linha acima de LIBERAR_JA nem
        // apertada além do limite (com o tracking/espaço de algum passo permitido, com o mesmo nº de
        // linhas), quebra no hífen — a liberação fica só para quando o hífen não serve (regra do usuário)
        if (composicao) {
          const noHifen = voltarAoHifenProprio(restricoes, plano, novos)
          if (noHifen) resumoRodada.compostasNoHifen = noHifen
        }
        // acabaram as correções: o parágrafo que ficou aberto demais e pior do que já esteve (com o
        // mesmo nº de linhas, então sem mexer na paginação) volta àquela composição, com o tracking e
        // o espaço dela fixos
        if (rodada === RODADAS) {
          for (const [i, h] of hif) {
            const pior = abert.get(i)?.pior || 0
            const m = melhores.get(i)?.get(h.linhas)
            if (pior < (opcoes.limiteAberta ?? ABERTA) || !m || m.pior > pior - 0.03 || restricoes.get(i)?.restaurado || manual.porPar.get(i)?.tr != null) continue
            // as palavras já liberadas (compostas, prefixo, itálico) continuam liberadas: voltar à
            // composição anterior não pode desfazer a liberação
            const noHifen = restricoes.get(i)?.compostasNoHifen || []
            const livres = [...new Set([...(m.rs.compostasLivres || []), ...(restricoes.get(i)?.compostasLivres || [])])].filter(k => !noHifen.includes(k))
            restricoes.set(i, { ...m.rs, ...(livres.length ? { compostasLivres: livres } : {}), ...(noHifen.length ? { compostasNoHifen: noHifen } : {}), fixo: { tr: m.tr, sp: m.sp }, restaurado: { rodada: m.rodada, antes: m.pior, depois: pior } })
            if (!novos.includes(i)) novos.push(i)
            resumoRodada.restaurados = (resumoRodada.restaurados || 0) + 1
          }
        }
        // palavras empilhadas (pilhas.js): nas rodadas completas, tenta desfazer cada pilha
        const pilhas = await analisarPilhas(linhasPorPar, hif, linhas, plano)
        ultima.pilhas = pilhas
        resumoRodada.pilhas = [...pilhas.values()].reduce((t, l) => t + l.length, 0)
        if (rodada < RODADAS && opcoes.pilhas !== false) {
          // solução que não desfez a pilha na composição real: volta ao que era e não tenta mais
          for (const [i, rs] of restricoes) {
            if (rs.pilha && pilhas.has(i)) {
              rs.pilhaMotivo = `a solução escolhida (${rs.pilha.nbsp ? 'espaço sem quebra' : 'tracking/espaço'}) não desfez a pilha na composição do livro`
              delete rs.pilha; rs.pilhaFalhou = true; novos.push(i)
            }
          }
          const elegiveis = [...pilhas.keys()].filter(i => {
            const rs = restricoes.get(i) || {}
            return linhas.has(i) && !rs.pilha && !rs.pilhaFalhou && !novos.includes(i)
          })
          const solucoes = elegiveis.length ? await tentarPilhas(elegiveis, pilhas, plano) : new Map()
          for (const i of elegiveis) {
            const rs = restricoes.get(i) || {}
            const sol = solucoes.get(i)
            if (sol) { rs.pilha = sol; novos.push(i) } else { rs.pilhaFalhou = true; rs.pilhaMotivo = solucoes.motivos?.get(i) }
            restricoes.set(i, rs)
          }
          resumoRodada.pilhasResolvidas = [...solucoes.values()].filter(Boolean).length
          resumoRodada.pilhasTentadas = elegiveis.length
          resumoRodada.pilhasSemBase = solucoes.semBase || 0
        }
        rodadas.push({ ...resumoRodada, mudancas: novos.length })
        if (!novos.length) break
        if (rodada >= RODADAS + RODADAS_ESCADA) {
          restricoes.clear()
          for (const [i, r] of restricoesDaRodada) restricoes.set(i, r)
          break
        }
        alterados = new Set(novos)
      }
      if (!sessao) rel.composicao = { rodadas, restricoes: restricoes.size }
      const estadoDe = () => ({ miolo, estilos, itensMiolo, composicao, medidas, restricoes, baseHifen, plano: ultima?.plano,
        paridade: primeiraPaginaMiolo % 2, primeiraPaginaMiolo, linhasPorPar: ultima?.linhasPorPar, hif: ultima?.hif, abert: ultima?.abert })
      // correção final, a mesma da tela de paginação (sessaoPaginacao.js): a paginação das rodadas
      // ainda pode terminar página ímpar com hífen; a sessão proíbe essa quebra e replaneja ali.
      // Se a paginação mudar, o livro é composto de novo com ela — o PDF e a tela recém-aberta
      // ficam com a mesma paginação
      if (!sessao && composicao && ultima && opcoes.conferirLinhas !== false && opcoes.correcaoFinal !== false) {
        prog('Correção final da paginação', 0.62)
        const t0 = Date.now()
        sessaoFinal = new SessaoPaginacao(estadoDe(), rel, publicacao)
        const igual = (a, b) => a.length === b.length && a.every((p, n) => p.de.join() === b[n].de.join() && p.ate.join() === b[n].ate.join() && Math.abs((p.f || 1) - (b[n].f || 1)) < 1e-6)
        const antes = contarFimImpar(ultima)
        const mudou = !igual(ultima.paginas, sessaoFinal.paginas)
        if (mudou) {
          const r = await comporComPlano(sessaoFinal.planoAtual)
          typ = r.typ
          ultima = r.u
          ultima.pilhas = await analisarPilhas(ultima.linhasPorPar, ultima.hif, ultima.linhas, ultima.plano)
          rel.paginacao = sessaoFinal.resumo
          rel.ajustes.fins = sessaoFinal.finsManuais
          if (opcoes.verificar) { rel._paginasPlanejadas = sessaoFinal.paginas; rel._plano = sessaoFinal.planoAtual }
        }
        rel.composicao.correcaoFinal = { replanejou: mudou, fimImparAntes: antes, fimImparDepois: contarFimImpar(ultima), ms: Date.now() - t0 }
      }
      sessaoDoLivro = sessao || sessaoFinal
      if (opcoes.devolverEstado) {
        estado = estadoDe()
        // a sessão já planejada (abrirSessao usa esta, sem replanejar)
        estado.sessao = sessaoFinal
      }
      // o Typst desenhou as linhas que o compositor decidiu? (nº de linhas por parágrafo)
      if (composicao && ultima) {
        const difs = []
        for (const [i, { linhas: ls }] of ultima.linhasPorPar) {
          if (!composicao.tem(i)) continue
          const pl = ultima.plano[i] || {}
          const n = composicao.compor(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: rsDe(i), base: baseHifen }).n
          if (n !== ls.length) difs.push(i)
        }
        rel.compositor.linhasDiferentes = difs.length
        rel.compositor._linhasDiferentes = difs.slice(0, 50)
      }
      // lista das palavras hifenizadas, com fólio e linha da página
      if (ultima) {
        const { linhasPorPar, hif, linhas, plano, trechos, folio } = ultima
        const { pedidos, casos } = pedidosDePrefixos(linhasPorPar, hif, linhas, plano)
        const itens = new Map(itensParaPaginacao(miolo, estilos).map(it => [it.i, it]))
        const naoMarcadas = i => {
          const it = itens.get(i)
          if (!it || it.tipo === 'tabela' || !medidas[i]) return 0
          return Math.max(1, Math.round(medidas[i].h / it.L))
        }
        const largurasPrefixos = await medirLarguras(pedidos)
        const lista = listaHifenizacoes(casos, largurasPrefixos, linhasPorPar, trechos, naoMarcadas, folio)
        // conferência no PDF: marcas (camada de fundo) e relatório no fim, com as justificativas
        if (opcoes.conferencia !== false) {
          prog('Conferindo hifenização e espaçamento', 0.7)
          // as palavras que desceram inteiras depois de linha aberta: têm ponto de divisão permitido?
          const teste = palavrasParaTestar(ultima, restricoes)
          const linhasTeste = await medirLarguras(teste.pedidos)
          const divisiveis = new Map(teste.casos.map(c => [`${c.i}:${c.k}`, (linhasTeste.get(c.chave) || 1) > 1]))
          // menor pedaço que as regras deixam na linha: { texto, largura }
          const pedacos = new Map(teste.casos.filter(c => c.chavePedaco).map(c => [`${c.i}:${c.k}`, { texto: c.pedaco, largura: linhasTeste.get(c.chavePedaco) }]))
          const conf = itensConferencia({
            ultima, restricoes, div: divisoes(casos, largurasPrefixos),
            divisivel: (i, k) => divisiveis.get(`${i}:${k}`),
            pedacoMinimo: (i, k) => pedacos.get(`${i}:${k}`),
            numerar: numeracaoDeLinhas(linhasPorPar, trechos, naoMarcadas),
            italico: r => !!r?.char && /italic|oblique/i.test(estilos.char(r.char).FontStyle || ''),
            base: opcoes.hifenizacao ?? HIFENIZACAO, grave: opcoes.limiteAberta ?? ABERTA, ajustes: AJUSTES,
            // linhas com o espaço entre palavras no piso (ESPACO_MINIMO), para conferir o limite: marca
            // desligada (usuário, 2026-11-08: o limite está conferido); opcoes.marcarEspacoMinimo liga de novo
            espacoMinimo: opcoes.marcarEspacoMinimo ? ESPACO_MINIMO / 100 : null,
            linhasDe: i => {
              if (!composicao?.tem(i)) return null
              const pl = ultima.plano[i] || {}
              return composicao.textos(i, { tr: pl.tr ?? 0, sp: pl.sp ?? 100, semHifen: pl.hy === false, rs: rsDe(i), base: baseHifen })
            },
          })
          conferencia = conf
          rel.conferencia = { total: conf.length, aberta: conf.filter(c => c.tipo === 'aberta').length, pilha: conf.filter(c => c.tipo === 'pilha').length, hifen: conf.filter(c => c.tipo === 'hifen').length, minimo: conf.filter(c => c.tipo === 'minimo').length }
        }
        // em seções: maiúsculas, compostas e as demais (cada uma na ordem do documento)
        const SECOES = ['PALAVRAS MAIÚSCULAS', 'PALAVRAS COMPOSTAS', 'DEMAIS PALAVRAS']
        hifenizacoes = SECOES.map((titulo, g) => {
          const itens = lista.filter(h => h.grupo === g)
          return `******** ${titulo} (${itens.length}) ********\r\n` + itens.map(h => h.texto + '\r\n').join('')
        }).join('\r\n')
        rel.hifenizacoes = lista.length
      }
    }
    writeFileSync(arq('livro.typ'), typ, 'utf8')
    prog('Gerando o PDF', 0.8)
    await typst(opcoes.typst, ['compile', '--font-path', fontes, arq('livro.typ'), arq('livro.pdf')])
    if (opcoes.verificar) {
      // página real de cada parágrafo (para conferir o plano nos testes)
      rel._posicoes = JSON.parse(await typst(opcoes.typst, ['query', '--font-path', fontes, arq('livro.typ'), '<pos>', '--field', 'value']))
    }
    let pdf = readFileSync(arq('livro.pdf'))
    // conferência: comentários no próprio PDF (anotações de realce com a justificativa)
    if (conferencia?.length) pdf = await anotarPdf(pdf, conferencia)
    if (opcoes.livro && !opcoes.devolverEstado) {
      prog('Montando o livro completo (pré-textuais e partes do livro)', 0.88)
      const { montarPdfLivro } = await import('./pdfLivroCompleto.js')
      pdf = await montarPdfLivro(pdf, { livro: opcoes.livro, sessao: sessaoDoLivro, opcoes, rel, compilar: (a, b, raiz) => typst(opcoes.typst, ['compile', '--root', raiz, '--font-path', fontes, a, b]) })
    }
    // PDF para a gráfica (pdfGrafica.js): folha com sangria e marcas de corte, sem comentários nem links
    if (opcoes.grafica && !opcoes.devolverEstado) {
      prog('Preparando para a gráfica (sangria e marcas de corte)', 0.96)
      const { pdfParaGrafica } = await import('./pdfGrafica.js')
      if (!rel.avisos) rel.avisos = []
      pdf = await pdfParaGrafica(pdf, {
        nome: opcoes.grafica.nome || 'livro.pdf', pasta,
        compilar: (a, b) => typst(opcoes.typst, ['compile', '--font-path', fontes, a, b]),
        origem: opcoes.livro ? rel.livro?.origem || [] : [],
        sangria: opcoes.livro?.pasta ? join(opcoes.livro.pasta, 'livro-sangria.pdf') : null,
        titulo: [publicacao.titulo, publicacao.edicao].filter(Boolean).join(' — '),
        avisos: rel.avisos,
      })
    }
    return { pdf, relatorio: rel, typ: opcoes.manterFonte ? typ : undefined, hifenizacoes, estado }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

function typst(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args,
      { maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000, windowsHide: true },
      (erro, stdout, stderr) => {
        if (erro) {
          const msg = String(stderr || erro.message).split('\n').slice(0, 30).join('\n')
          reject(new Error(`O Typst não conseguiu compor o PDF:\n${msg}`))
        } else resolve(stdout)
      })
  })
}
