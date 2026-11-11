/**
 * PaginacaoPage — tela de paginação da publicação (revisores e diagramador).
 *
 * Mostra os espelhos como o PDF de revisão os compõe (sessaoPaginacao.js: as linhas são as do
 * compositor calibrado com o InDesign) e permite ajustes locais, guardados no banco com autor e data
 * (publicacao_ajustes) e aplicados no PDF e no IDML:
 *   • parágrafo: apertar/soltar (tracking e espaço) — nas alternativas do compositor;
 *   • palavra: não hifenizar, liberar a hifenização, não separar da seguinte (painel técnico);
 *   • página: levar a última linha para a próxima, trazer a primeira da seguinte, começar página
 *     num parágrafo, entrelinha da página.
 * Cada ajuste recompõe só a partir da página afetada (as anteriores ficam).
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import './PaginacaoPage.css'
import ProgressoPdf from '../components/ProgressoPdf.jsx'

const MM = 72 / 25.4
const PAGINA = { w: 170 * MM, h: 255 * MM }
const MARGEM = { topo: 19 * MM, interna: 22 * MM, externa: 17 * MM }
const MANCHA = { w: 131 * MM, h: 222 * MM }
const AVISO_SEM_AJUSTES = 'O servidor do Normando ainda não tem a parte dos ajustes de paginação (falta publicar a atualização no Railway). Dá para ver as páginas, mas os ajustes não podem ser gravados.'
// problemas que o navegador do painel percorre
const PROBLEMAS = { aberta: 'Espaçamento aberto', apertada: 'Espaçamento apertado', pilha: 'Palavras empilhadas', curta: 'Última linha curta', buraco: 'Buraco na página', fim: 'Fim de página que não coube' }
const TIPOS = {
  paragrafo: 'Tracking/espaço do parágrafo', palavra: 'Hifenização de palavra', juntar: 'Palavras juntas',
  fimPagina: 'Fim de página', naoTerminar: 'Página não termina aqui', entrelinha: 'Entrelinha da página',
}

// peso e itálico de um estilo do InDesign ("Bold Italic", "Light", "Black")
function fonteDe(estilo) {
  const s = String(estilo || 'Regular').toLowerCase()
  const peso = /black/.test(s) ? 900 : /extrabold/.test(s) ? 800 : /semibold/.test(s) ? 600 : /bold/.test(s) ? 700 : /light/.test(s) ? 300 : 400
  return { fontWeight: peso, fontStyle: /italic/.test(s) ? 'italic' : 'normal' }
}

// palavras de uma linha (com o estilo de caractere de cada pedaço), para a justificação por palavra
function palavrasDaLinha(linha) {
  const out = []
  let atual = null
  const partes = linha.repeteHifen ? [{ t: '-', c: null }, ...linha.partes] : linha.partes
  for (const p of partes) {
    for (const pedaco of p.t.split(/( +)/)) {
      if (!pedaco) continue
      if (/^ +$/.test(pedaco)) { atual = null; continue }
      if (!atual) { atual = []; out.push(atual) }
      atual.push({ t: pedaco, c: p.c })
    }
  }
  if (linha.hifen && out.length) out[out.length - 1].push({ t: '-', c: out[out.length - 1].at(-1).c })
  return out
}

function Linha({ linha, estilo, estilosChar, x, y, largura, altura, escala, marcas, onPalavra, indicePalavra }) {
  const palavras = palavrasDaLinha(linha)
  const just = linha.justificada && palavras.length > 1
  return (
    <div
      className={`pg-linha${linha.aberta ? ' pg-aberta' : ''}${linha.apertada ? ' pg-apertada' : ''}${linha.pilha ? ' pg-pilha' : ''}`}
      title={linha.aberta ? `Espaçamento aberto: ${Math.round(linha.espaco * 100)}% do normal`
        : linha.apertada ? `Espaçamento apertado: ${Math.round(linha.espaco * 100)}% do normal (limite: ${Math.round(estilo.limiteAperto * 100)}%)`
        : linha.pilha ? 'Palavras empilhadas' : undefined}
      style={{
        left: x * escala, top: y * escala, width: largura * escala, height: altura * escala,
        fontSize: estilo.corpo * escala, lineHeight: `${altura * escala}px`,
        justifyContent: just ? 'space-between' : estilo.alinhamento === 'center' ? 'center' : estilo.alinhamento === 'right' ? 'flex-end' : 'flex-start',
        // tracking e espaço como no PDF (o compositor dá os valores da linha em pt)
        gap: just ? 0 : `${(linha.espacoPt ?? 0.22 * estilo.corpo) * escala}px`,
        letterSpacing: linha.tracking ? `${linha.tracking * escala}px` : undefined,
        textTransform: estilo.caixaAlta ? 'uppercase' : undefined,
        ...fonteDe(estilo.estilo),
      }}
    >
      {palavras.map((w, n) => {
        const ip = indicePalavra(n)
        return (
          <span key={n} className={`pg-palavra${marcas?.has(ip) ? ' pg-palavra-ajuste' : ''}`} onClick={onPalavra ? e => { e.stopPropagation(); onPalavra(ip) } : undefined}>
            {w.map((p, m) => {
              const c = p.c ? estilosChar[p.c] : null
              return (
                <span key={m} style={c ? {
                  ...(c.estilo ? fonteDe(c.estilo) : {}), ...(c.corpo ? { fontSize: c.corpo * escala } : {}),
                  ...(c.sobrescrito ? { verticalAlign: 'super', fontSize: (c.corpo || estilo.corpo) * 0.6 * escala } : {}),
                  ...(c.tom < 100 ? { opacity: 0.55 + 0.45 * c.tom / 100 } : {}), textTransform: c.caixaAlta ? 'uppercase' : undefined,
                } : undefined}>{p.t}</span>
              )
            })}
          </span>
        )
      })}
    </div>
  )
}

function Pagina({ pagina, estilos, escala, selecionado, onSelecionar, tecnico, palavraSel, onPalavra, ajustesPorPar }) {
  if (pagina.branca) return <div className="pg-pagina pg-branca" style={{ width: PAGINA.w * escala, height: PAGINA.h * escala }}><span>página em branco</span></div>
  const x0 = pagina.par === 1 ? MARGEM.interna : MARGEM.externa
  const elementos = []
  // 1ª linha da página: linha-base na ascendente do estilo, como no InDesign e no PDF (pdf/mancha.js)
  const b0 = pagina.blocos[0], e0 = b0 && !b0.tabela ? estilos.par[b0.estilo] : null
  let y = e0?.ascendente != null ? e0.ascendente - e0.entrelinha * pagina.entrelinha : 0
  pagina.blocos.forEach((b, nb) => {
    y += b.espaco || 0
    const sel = selecionado?.i === b.i
    if (b.tabela) {
      elementos.push(<div key={nb} className="pg-tabela" style={{ left: 0, top: y * escala, width: MANCHA.w * escala, height: b.h * escala }}>tabela</div>)
      y += b.h
      return
    }
    const e = estilos.par[b.estilo] || { corpo: 9.5, entrelinha: 13.25, alinhamento: 'left', primeira: 0, pendente: 0, esquerda: 0, recuo1: 0, largura: MANCHA.w }
    const alt = e.entrelinha * pagina.entrelinha
    const y0 = y
    if (b.linhas) {
      b.linhas.forEach(l => {
        const primeira = l.n === 0
        const x = primeira ? e.recuo1 : e.esquerda
        const largura = e.largura - (primeira ? e.primeira : e.pendente)
        elementos.push(
          <Linha key={`${nb}-${l.n}`} linha={l} estilo={e} estilosChar={estilos.char} x={x} y={y} largura={largura} altura={alt} escala={escala}
            marcas={sel ? palavraSel?.marcas : null} indicePalavra={k => (l.p0 ?? 0) + k}
            onPalavra={tecnico && sel ? ip => onPalavra(b, ip) : null} />,
        )
        y += alt
      })
    } else {
      const n = b.linhasNaPagina || 1
      elementos.push(
        <div key={nb} className="pg-texto-livre" style={{
          left: e.esquerda * escala, top: y * escala, width: e.largura * escala, height: n * alt * escala,
          fontSize: e.corpo * escala, lineHeight: `${alt * escala}px`, textAlign: e.alinhamento,
          textTransform: e.caixaAlta ? 'uppercase' : undefined, ...fonteDe(e.estilo),
        }}>{b.texto}</div>,
      )
      y += n * alt
    }
    elementos.push(
      <div key={`s${nb}`} className={`pg-par${sel ? ' pg-par-sel' : ''}${b.manual || ajustesPorPar.has(b.i) ? ' pg-par-manual' : ''}`}
        style={{ left: -4 * escala, top: y0 * escala, width: (MANCHA.w + 8) * escala, height: Math.max(1, y - y0) * escala }}
        onClick={() => onSelecionar({ i: b.i, pagina: pagina.n })}
        title={b.fimPedido === false ? 'Fim de página pedido não coube' : undefined} />,
    )
  })
  return (
    <div className="pg-pagina" style={{ width: PAGINA.w * escala, height: PAGINA.h * escala }}>
      <div className="pg-cabeco" style={{ top: 7.9 * MM * escala, left: (pagina.par === 1 ? 22 : 17) * MM * escala, width: MANCHA.w * escala, fontSize: 7.5 * escala, textAlign: pagina.par === 1 ? 'right' : 'left' }}>
        {pagina.par === 0 ? <><b>{pagina.folio}</b>  {pagina.cabeco}</> : <>{pagina.cabeco}  <b>{pagina.folio}</b></>}
      </div>
      <div className="pg-mancha" style={{ left: x0 * escala, top: MARGEM.topo * escala, width: MANCHA.w * escala, height: MANCHA.h * escala }}>
        {elementos}
        {pagina.buracoLinhas >= 0.5 && (
          <div className="pg-buraco" style={{ left: 0, top: y * escala, width: MANCHA.w * escala, height: Math.min(pagina.buraco, MANCHA.h - y) * escala }}
            title={`Buraco de ${pagina.buracoLinhas} linha(s)`} />
        )}
      </div>
      {tecnico && <div className="pg-info" style={{ fontSize: 9 }}>entrelinha {Math.round(pagina.entrelinha * 1000) / 10}%{pagina.ajustadas ? ` · ${pagina.ajustadas} par. ajustado(s)` : ''}</div>}
    </div>
  )
}

// espelho com conteúdo só quando perto da área visível (o livro tem centenas de páginas)
function Espelho({ par, altura, children }) {
  const ref = useRef(null)
  const [visivel, setVisivel] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting), { rootMargin: '1500px 0px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} id={`pg-esp-${par}`} className="pg-espelho" style={{ minHeight: altura }} data-par={par}>{visivel ? children : null}</div>
}

export default function PaginacaoPage({ usuarioAtual }) {
  const { id } = useParams()
  const nav = useNavigate()
  const [estado, setEstado] = useState({ carregando: true, erro: null })
  const [chave, setChave] = useState(null)
  const [modelo, setModelo] = useState(null)
  const [ajustes, setAjustes] = useState([])
  const [sel, setSel] = useState(null)
  const [tecnico, setTecnico] = useState(false)
  const [escala, setEscala] = useState(1.1)
  const [alternativas, setAlternativas] = useState([])
  const [palavraSel, setPalavraSel] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [entrelinha, setEntrelinha] = useState(1)
  const [semAjustes, setSemAjustes] = useState(false)
  const [filtro, setFiltro] = useState(() => new Set(Object.keys(PROBLEMAS)))
  const [atual, setAtual] = useState(-1)
  const autor = usuarioAtual?.nome || null
  const api = window.legislator

  useEffect(() => {
    let vivo = true
    let ch = null
    ;(async () => {
      try {
        // servidor ainda sem as rotas de ajustes (antes do deploy): a paginação abre, sem gravar ajustes
        let lista = []
        try { lista = await api.publicacoes.ajustes.listar(Number(id)) } catch { if (vivo) setSemAjustes(true) }
        if (vivo) setAjustes(lista || [])
        const r = await api.publicacoes.paginacao.abrir(Number(id))
        ch = r.chave
        if (!vivo) return
        setChave(r.chave)
        setModelo(r.modelo)
        setEstado({ carregando: false, erro: null })
      } catch (e) {
        if (vivo) setEstado({ carregando: false, erro: e.message || String(e) })
      }
    })()
    return () => { vivo = false; if (ch) api.publicacoes.paginacao.fechar(ch) }
  }, [id])

  // espelhos: página par à esquerda, ímpar à direita
  const espelhos = useMemo(() => {
    if (!modelo) return []
    const out = []
    let atual = null
    modelo.paginas.forEach((pg, n) => {
      const par = pg.branca ? (n === 0 ? 1 : 1 - (modelo.paginas[n - 1].par ?? 1)) : pg.par
      if (par === 0 || !atual) { atual = [null, null]; out.push(atual) }
      atual[par === 0 ? 0 : 1] = { ...pg, par, idx: n }
      if (par === 1) atual = null
    })
    // espelho de cada página (para o navegador rolar até ela)
    out.espelhoDa = new Map()
    out.forEach((par, n) => par.forEach(pg => pg && out.espelhoDa.set(pg.idx, n)))
    return out
  }, [modelo])

  // problemas marcados nas páginas, na ordem do livro
  const problemas = useMemo(() => {
    if (!modelo) return []
    const out = []
    const texto = b => (b.linhas ? b.linhas.map(l => l.partes.map(p => p.t).join('')).join(' ') : b.texto || '').replace(/\s+/g, ' ').trim().slice(0, 70)
    modelo.paginas.forEach((pg, n) => {
      for (const b of pg.blocos || []) {
        const base = { pagina: n, folio: pg.folio, i: b.i, texto: texto(b) }
        const abertas = (b.linhas || []).filter(l => l.aberta)
        if (abertas.length) out.push({ ...base, tipo: 'aberta', detalhe: `${Math.round(Math.max(...abertas.map(l => l.espaco)) * 100)}%` })
        const apertadas = (b.linhas || []).filter(l => l.apertada)
        if (apertadas.length) out.push({ ...base, tipo: 'apertada', detalhe: `${Math.round(Math.min(...apertadas.map(l => l.espaco)) * 100)}%` })
        if ((b.linhas || []).some(l => l.pilha)) out.push({ ...base, tipo: 'pilha', detalhe: '' })
        if (b.ultimaCurta != null) out.push({ ...base, tipo: 'curta', detalhe: `${b.ultimaCurta} caracteres` })
        if (b.fimPedido === false) out.push({ ...base, tipo: 'fim', detalhe: '' })
      }
      if (pg.buracoLinhas >= 0.5 && pg.blocos?.length) {
        const b = pg.blocos[pg.blocos.length - 1]
        out.push({ pagina: n, folio: pg.folio, i: b.i, texto: texto(b), tipo: 'buraco', detalhe: `${pg.buracoLinhas} linha(s)` })
      }
    })
    return out
  }, [modelo])
  const filtrados = useMemo(() => problemas.filter(p => filtro.has(p.tipo)), [problemas, filtro])
  const contagem = useMemo(() => problemas.reduce((c, p) => ({ ...c, [p.tipo]: (c[p.tipo] || 0) + 1 }), {}), [problemas])
  // vai ao problema k da lista filtrada: rola até o espelho e seleciona o parágrafo
  const irPara = k => {
    const p = filtrados[k]
    if (!p) return
    setAtual(k)
    setSel({ i: p.i, pagina: p.pagina })
    document.getElementById(`pg-esp-${espelhos.espelhoDa.get(p.pagina)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // índice das palavras de cada parágrafo: a palavra dividida entre duas linhas (hífen ou hífen
  // próprio) conta uma vez; cada linha guarda o índice da 1ª palavra (l.p0) e palavrasDoPar, o texto
  // de cada palavra — como as partes de ajustesLocais.marcaDaPalavra
  const palavrasDoPar = useMemo(() => {
    const out = new Map()
    if (!modelo) return out
    const fimComHifen = new Map()
    for (const pg of modelo.paginas) for (const b of pg.blocos || []) {
      if (!b.linhas) continue
      if (!out.has(b.i)) out.set(b.i, [])
      const lista = out.get(b.i)
      for (const l of b.linhas) {
        const ws = palavrasDaLinha(l).map(w => w.map(p => p.t).join(''))
        const cont = (fimComHifen.get(b.i) || l.repeteHifen) && lista.length > 0
        l.p0 = lista.length - (cont ? 1 : 0)
        ws.forEach((w, k) => {
          if (k === 0 && cont) {
            const anterior = lista[lista.length - 1]
            // hifenização: "consi-" + "derando-se"; hífen próprio: "Salário-" + "-Educação"
            lista[lista.length - 1] = l.repeteHifen ? anterior + w.replace(/^-/, '') : anterior.replace(/-$/, '') + w
          } else lista.push(w)
        })
        fimComHifen.set(b.i, l.hifen)
      }
    }
    return out
  }, [modelo])

  const ajustesPorPar = useMemo(() => {
    const s = new Set()
    if (!modelo) return s
    const chaves = new Set(ajustes.map(a => JSON.stringify(a.ancora)))
    for (const pg of modelo.paginas) for (const b of pg.blocos || []) if (b.ancora && chaves.has(JSON.stringify(b.ancora))) s.add(b.i)
    return s
  }, [modelo, ajustes])

  const blocoSel = useMemo(() => {
    if (!modelo || !sel) return null
    const pg = modelo.paginas[sel.pagina]
    return pg?.blocos.find(b => b.i === sel.i) || null
  }, [modelo, sel])

  useEffect(() => {
    setPalavraSel(null)
    setAlternativas([])
    if (!chave || !sel) return
    api.publicacoes.paginacao.alternativas(chave, sel.i).then(setAlternativas).catch(() => {})
    const pg = modelo?.paginas[sel.pagina]
    setEntrelinha(pg?.entrelinha || 1)
  }, [chave, sel?.i, sel?.pagina])

  const aplicar = useCallback(async lista => {
    setOcupado(true)
    try { setModelo(await api.publicacoes.paginacao.aplicar(chave, lista)) } finally { setOcupado(false) }
  }, [chave])

  // grava o ajuste (substitui o do mesmo tipo e lugar) e recompõe
  const salvarAjuste = async (ajuste, mesmo = a => a.tipo === ajuste.tipo && JSON.stringify(a.ancora) === JSON.stringify(ajuste.ancora)) => {
    if (semAjustes) return alert(AVISO_SEM_AJUSTES)
    const existente = ajustes.find(mesmo)
    const salvo = existente
      ? await api.publicacoes.ajustes.atualizar(Number(id), existente.id, { ...ajuste, data: new Date().toISOString() }, autor)
      : await api.publicacoes.ajustes.criar(Number(id), { ...ajuste, data: new Date().toISOString() }, autor)
    const lista = existente ? ajustes.map(a => (a.id === existente.id ? salvo : a)) : [...ajustes, salvo]
    setAjustes(lista)
    await aplicar(lista)
  }
  const removerAjuste = async aid => {
    await api.publicacoes.ajustes.excluir(Number(id), aid)
    const lista = ajustes.filter(a => a.id !== aid)
    setAjustes(lista)
    await aplicar(lista)
  }

  // ── ações ──
  const paginaSel = sel && modelo ? modelo.paginas[sel.pagina] : null
  const ajustarParagrafo = async direcao => {
    if (!blocoSel) return
    const total = blocoSel.total
    const cand = alternativas.filter(a => (direcao < 0 ? a.linhas < total : a.linhas > total) && !(a.tr === 0 && a.sp === 100))
    // primeiro as que não deixam linha apertada demais (abaixo de 80%); entre elas, a
    // de espaçamento mais equilibrado
    const ordem = (a, b) => (a.apertadas > 0) - (b.apertadas > 0) || a.pior - b.pior || b.menor - a.menor
    const melhor = cand.sort(ordem)[0]
    if (!melhor) return alert(direcao < 0 ? 'Não há aperto dentro dos limites que tire uma linha deste parágrafo.' : 'Não há abertura dentro dos limites que acrescente uma linha.')
    if (melhor.apertadas > 0 && !confirm(`O único ajuste possível deixa ${melhor.apertadas} linha(s) apertada(s) demais: espaço de ${Math.round(melhor.menor * 100)}%, abaixo do limite de ${Math.round(melhor.minimo * 100)}%. Aplicar mesmo assim?`)) return
    await salvarAjuste({ tipo: 'paragrafo', ancora: blocoSel.ancora, tr: melhor.tr, sp: melhor.sp })
  }
  const fimDaPagina = pg => {
    const b = pg.blocos[pg.blocos.length - 1]
    if (!b || b.tabela) return null
    const fim = b.deLinha + (b.linhas ? b.linhas.length : b.linhasNaPagina || 1)
    return { b, fim }
  }
  const levarLinha = async () => {
    const f = paginaSel && fimDaPagina(paginaSel)
    if (!f) return
    const linha = f.fim - 1
    await salvarAjuste({ tipo: 'fimPagina', ancora: f.b.ancora, linha: Math.max(0, linha), nota: 'levar a última linha para a página seguinte' }, () => false)
  }
  const trazerLinha = async () => {
    const prox = modelo.paginas.slice(sel.pagina + 1).find(p => !p.branca)
    const b = prox?.blocos[0]
    if (!b || b.tabela) return
    await salvarAjuste({ tipo: 'fimPagina', ancora: b.ancora, linha: b.deLinha + 1, nota: 'trazer a primeira linha da página seguinte' }, () => false)
  }
  const comecarPagina = async () => {
    if (!blocoSel) return
    await salvarAjuste({ tipo: 'fimPagina', ancora: blocoSel.ancora, linha: 0, nota: 'começar página neste parágrafo' }, () => false)
  }
  const fixarEntrelinha = async () => {
    const b = paginaSel?.blocos[0]
    if (!b) return
    await salvarAjuste({ tipo: 'entrelinha', ancora: b.ancora, linha: b.deLinha, fator: Math.round(entrelinha * 1000) / 1000 },
      a => a.tipo === 'entrelinha' && JSON.stringify(a.ancora) === JSON.stringify(b.ancora) && a.linha === b.deLinha)
  }
  // palavra (painel técnico): identificada pelo texto e pela ocorrência no parágrafo
  const escolherPalavra = (b, ip) => {
    const lista = palavrasDoPar.get(b.i) || []
    const palavra = lista[ip]
    if (!palavra) return
    setPalavraSel({ palavra, ocorrencia: lista.slice(0, ip).filter(x => x === palavra).length, ip, marcas: new Set([ip]) })
  }
  const ajustarPalavra = async tipo => {
    if (!palavraSel || !blocoSel) return
    const mesmo = a => (a.tipo === 'palavra' || a.tipo === 'juntar') && JSON.stringify(a.ancora) === JSON.stringify(blocoSel.ancora) && a.palavra === palavraSel.palavra && (a.ocorrencia || 0) === palavraSel.ocorrencia && (tipo === 'juntar' ? a.tipo === 'juntar' : a.tipo === 'palavra')
    if (tipo === 'juntar') await salvarAjuste({ tipo: 'juntar', ancora: blocoSel.ancora, palavra: palavraSel.palavra, ocorrencia: palavraSel.ocorrencia }, mesmo)
    else await salvarAjuste({ tipo: 'palavra', ancora: blocoSel.ancora, palavra: palavraSel.palavra, ocorrencia: palavraSel.ocorrencia, hifen: tipo }, mesmo)
  }
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const gerarPdf = async (grafica = false) => {
    setOcupado(true)
    setGerandoPdf(grafica ? 'grafica' : true)
    // o PDF sai com a paginação que está na tela (sem refazer a composição)
    try {
      const r = await api.publicacoes.paginacao.pdf(chave, grafica ? { grafica: true } : {})
      // PDF para a gráfica: aviso de pasta do livro sem o livro-sangria.pdf
      const avisos = grafica ? (r?.relatorio?.avisos || []).filter(a => /sangria/i.test(a)) : []
      if (avisos.length) alert(avisos.join('\n'))
    } catch (e) { alert(e.message || e) } finally { setOcupado(false); setGerandoPdf(false) }
  }
  const gerarIdml = async () => {
    setOcupado(true)
    // IDML ajustado: as decisões desta tela como ajustes locais, para o InDesign paginar igual
    try {
      const r = await api.publicacoes.paginacao.idml(chave)
      if (r?.ok) alert(`IDML ajustado salvo em:\n${r.filePath}\n\nPara conferir no InDesign se as páginas bateram, rode o script conferir_paginacao_normando.jsx com o documento aberto (ele lê ${r.conferencia?.split(/[\\/]/).pop()}, ao lado do IDML).`)
    } catch (e) { alert(e.message || e) } finally { setOcupado(false) }
  }

  const ajustesDoSel = blocoSel ? ajustes.filter(a => JSON.stringify(a.ancora) === JSON.stringify(blocoSel.ancora)) : []
  const naoEncontrados = new Set((modelo?.ajustes?.naoEncontrados || []).map(a => a.id))
  const alturaEspelho = PAGINA.h * escala + 24

  return (
    <div className="pg-tela">
      <ProgressoPdf ativo={!!gerandoPdf} titulo={gerandoPdf === 'grafica' ? 'Gerando o PDF para a gráfica' : 'Gerando o PDF com a paginação da tela'} />
      <div className="pg-topo">
        <button className="btn-ghost" onClick={() => nav(`/publicacoes/${id}`)}>← Publicação</button>
        <h2>Paginação</h2>
        {modelo && <span className="pg-resumo">{modelo.paginas.length} páginas · {ajustes.length} ajuste(s){naoEncontrados.size ? ` · ${naoEncontrados.size} não encontrado(s)` : ''}{modelo.ms != null ? ` · recomposto em ${(modelo.ms / 1000).toFixed(1)} s${modelo.janela ? ` (só ${modelo.janela} páginas)` : ''}` : ''}</span>}
        <span className="pg-espaco" />
        {ocupado && <span className="pg-ocupado">recompondo…</span>}
        <label className="pg-zoom">zoom <input type="range" min="0.6" max="2" step="0.1" value={escala} onChange={e => setEscala(Number(e.target.value))} /></label>
        <label className="pg-check"><input type="checkbox" checked={tecnico} onChange={e => setTecnico(e.target.checked)} /> detalhes técnicos</label>
        <button className="btn-primary" onClick={() => gerarPdf()} disabled={!modelo || ocupado} title="PDF de revisão com a paginação desta tela">Gerar PDF</button>
        <button className="btn-ghost" onClick={() => gerarPdf(true)} disabled={!modelo || ocupado} title="PDF de impressão com a paginação desta tela: sangria de 5 mm, marcas de corte e informação da página, sem os comentários da conferência">PDF para a gráfica</button>
        <button className="btn-ghost" onClick={gerarIdml} disabled={!modelo || ocupado} title="IDML com os ajustes desta paginação (tracking, espaço, entrelinha, quebras de página), para o InDesign paginar igual">Gerar IDML ajustado</button>
      </div>

      {estado.carregando && <div className="pg-aviso">Compondo o livro (cerca de 1 minuto)… As páginas aparecem quando a composição terminar.</div>}
      {estado.erro && <div className="pg-aviso pg-erro">Não foi possível abrir a paginação: {estado.erro}</div>}
      {semAjustes && <div className="pg-aviso pg-erro">{AVISO_SEM_AJUSTES}</div>}

      {modelo && (
        <div className="pg-corpo">
          <div className="pg-paginas">
            <div className="pg-legenda">
              <span><i className="pg-leg-aberta" /> espaçamento aberto</span>
              <span><i className="pg-leg-apertada" /> espaçamento apertado</span>
              <span><i className="pg-leg-pilha" /> palavras empilhadas</span>
              <span><i className="pg-leg-buraco" /> buraco</span>
              <span><i className="pg-leg-manual" /> parágrafo com ajuste</span>
            </div>
            {espelhos.map((par, n) => (
              <Espelho key={n} par={n} altura={alturaEspelho}>
                {par.map((pg, lado) => pg
                  ? <Pagina key={lado} pagina={pg} estilos={modelo.estilos} escala={escala} selecionado={sel?.pagina === pg.idx ? sel : null}
                      onSelecionar={s => setSel({ i: s.i, pagina: pg.idx })} tecnico={tecnico} palavraSel={palavraSel}
                      onPalavra={escolherPalavra} ajustesPorPar={ajustesPorPar} />
                  : <div key={lado} className="pg-vazia" style={{ width: PAGINA.w * escala, height: PAGINA.h * escala }} />)}
              </Espelho>
            ))}
          </div>

          <aside className="pg-painel">
            <h3>Problemas ({filtrados.length})</h3>
            <div className="pg-filtros">
              {Object.entries(PROBLEMAS).map(([k, rotulo]) => (
                <label key={k}><input type="checkbox" checked={filtro.has(k)} onChange={e => {
                  const novo = new Set(filtro)
                  if (e.target.checked) novo.add(k); else novo.delete(k)
                  setFiltro(novo)
                  setAtual(-1)
                }} /> {rotulo} ({contagem[k] || 0})</label>
              ))}
            </div>
            <div className="pg-nav">
              <button className="btn-ghost" disabled={!filtrados.length} onClick={() => irPara(atual <= 0 ? filtrados.length - 1 : atual - 1)}>◀ Anterior</button>
              <span className="pg-dica">{filtrados.length ? `${atual >= 0 ? Math.min(atual, filtrados.length - 1) + 1 : '–'} de ${filtrados.length}` : 'nenhum'}</span>
              <button className="btn-ghost" disabled={!filtrados.length} onClick={() => irPara(atual >= filtrados.length - 1 ? 0 : atual + 1)}>Próximo ▶</button>
            </div>
            {filtrados.length > 0 && (
              <ul className="pg-prob-lista">
                {filtrados.map((p, k) => (
                  <li key={k} className={k === atual ? 'pg-prob-atual' : ''} onClick={() => irPara(k)}>
                    <b>p. {p.folio}</b> · {PROBLEMAS[p.tipo]}{p.detalhe ? ` (${p.detalhe})` : ''}
                    <div className="pg-dica">{p.texto}…</div>
                  </li>
                ))}
              </ul>
            )}

            {!blocoSel && <p className="pg-dica">Clique num parágrafo para ver as opções de ajuste.</p>}
            {blocoSel && (
              <>
                <h3>Parágrafo</h3>
                <p className="pg-dica">p. {paginaSel?.folio} · {blocoSel.estilo} · {blocoSel.total} linha(s)
                  {blocoSel.deLinha > 0 || (blocoSel.linhas && blocoSel.deLinha + blocoSel.linhas.length < blocoSel.total) ? ' (dividido entre páginas)' : ''}</p>
                <div className="pg-botoes">
                  <button className="btn-ghost" disabled={ocupado || !blocoSel.linhas} onClick={() => ajustarParagrafo(-1)}>Apertar (−1 linha)</button>
                  <button className="btn-ghost" disabled={ocupado || !blocoSel.linhas} onClick={() => ajustarParagrafo(+1)}>Soltar (+1 linha)</button>
                </div>

                <h3>Página {paginaSel?.folio}</h3>
                <div className="pg-botoes pg-coluna">
                  <button className="btn-ghost" disabled={ocupado} onClick={levarLinha}>Levar a última linha para a página seguinte</button>
                  <button className="btn-ghost" disabled={ocupado} onClick={trazerLinha}>Trazer a primeira linha da página seguinte</button>
                  <button className="btn-ghost" disabled={ocupado} onClick={comecarPagina}>Começar página neste parágrafo</button>
                </div>
                <label className="pg-entrelinha">Entrelinha da página: {Math.round(entrelinha * 1000) / 10}%
                  <input type="range" min="0.9" max="1.1" step="0.005" value={entrelinha} onChange={e => setEntrelinha(Number(e.target.value))} />
                </label>
                <button className="btn-ghost" disabled={ocupado} onClick={fixarEntrelinha}>Fixar entrelinha</button>

                {tecnico && (
                  <>
                    <h3>Alternativas (tracking / espaço)</h3>
                    <table className="pg-alt">
                      <thead><tr><th>tracking</th><th>espaço</th><th>linhas</th><th>maior</th><th>menor</th><th>hífens</th></tr></thead>
                      <tbody>
                        {alternativas.map((a, n) => (
                          <tr key={n} className={a.tr === blocoSel.tr && a.sp === blocoSel.sp ? 'pg-alt-atual' : ''}
                            onClick={() => !ocupado && salvarAjuste({ tipo: 'paragrafo', ancora: blocoSel.ancora, tr: a.tr, sp: a.sp })}>
                            <td>{Math.round(a.tr * 1000)}</td><td>{a.sp}%</td><td>{a.linhas}</td>
                            <td className={a.pior > 1.7 ? 'pg-ruim' : ''}>{Math.round(a.pior * 100)}%</td>
                            <td className={a.apertadas ? 'pg-ruim' : ''} title={a.apertadas ? `${a.apertadas} linha(s) abaixo do limite de ${Math.round(a.minimo * 100)}%` : undefined}>{Math.round(a.menor * 100)}%</td>
                            <td>{a.hifens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="pg-dica">"maior" e "menor": o maior e o menor espaço entre palavras do parágrafo, em % do normal. Em vermelho: aberto demais (acima de 170%) ou apertado (abaixo de 80%; o piso é 82%).</p>

                    <h3>Palavra</h3>
                    {!palavraSel && <p className="pg-dica">Clique numa palavra do parágrafo selecionado.</p>}
                    {palavraSel && (
                      <>
                        <p><b>{palavraSel.palavra}</b>{palavraSel.ocorrencia ? ` (${palavraSel.ocorrencia + 1}ª ocorrência)` : ''}</p>
                        <div className="pg-botoes pg-coluna">
                          <button className="btn-ghost" disabled={ocupado} onClick={() => ajustarPalavra('proibir')}>Não hifenizar</button>
                          <button className="btn-ghost" disabled={ocupado} onClick={() => ajustarPalavra('permitir')}>Liberar hifenização</button>
                          <button className="btn-ghost" disabled={ocupado} onClick={() => ajustarPalavra('juntar')}>Não separar da palavra seguinte</button>
                        </div>
                      </>
                    )}
                  </>
                )}

                {ajustesDoSel.length > 0 && (
                  <>
                    <h3>Ajustes deste parágrafo</h3>
                    <ListaAjustes itens={ajustesDoSel} naoEncontrados={naoEncontrados} onRemover={removerAjuste} ocupado={ocupado} />
                  </>
                )}
              </>
            )}
            <h3>Todos os ajustes ({ajustes.length})</h3>
            <ListaAjustes itens={ajustes} naoEncontrados={naoEncontrados} onRemover={removerAjuste} ocupado={ocupado} />
          </aside>
        </div>
      )}
    </div>
  )
}

function ListaAjustes({ itens, naoEncontrados, onRemover, ocupado }) {
  if (!itens.length) return <p className="pg-dica">Nenhum ajuste.</p>
  return (
    <ul className="pg-ajustes">
      {itens.map(a => (
        <li key={a.id} className={naoEncontrados.has(a.id) ? 'pg-nao-achado' : ''}>
          <div><b>{TIPOS[a.tipo] || a.tipo}</b>
            {a.tipo === 'paragrafo' && ` ${Math.round(a.tr * 1000)} / ${a.sp}%`}
            {a.tipo === 'palavra' && ` "${a.palavra}": ${a.hifen === 'proibir' ? 'não hifenizar' : a.hifen === 'permitir' ? 'liberar' : a.hifen}`}
            {a.tipo === 'juntar' && ` "${a.palavra}" + seguinte`}
            {a.tipo === 'fimPagina' && (a.linha ? ` depois da linha ${a.linha}` : ' antes do parágrafo')}
            {a.tipo === 'entrelinha' && ` ${Math.round(a.fator * 1000) / 10}%`}
          </div>
          <div className="pg-dica">{(a.ancora?.texto || '').slice(0, 50)}…</div>
          <div className="pg-dica">{a.autor || '—'} · {a.atualizado_em ? new Date(a.atualizado_em).toLocaleString('pt-BR') : ''}{naoEncontrados.has(a.id) ? ' · não encontrado no texto atual' : ''}</div>
          <button className="pg-remover" disabled={ocupado} onClick={() => onRemover(a.id)} title="Remover ajuste">×</button>
        </li>
      ))}
    </ul>
  )
}
