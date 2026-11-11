/**
 * pretextuaisPdf.js — páginas pré-textuais do livro no PDF completo, quando o Normando troca textos
 * delas (pretextuaisLivro.js: Mesa, rosto, folha técnica, colofão; e a última emenda).
 *
 * A página continua sendo a do PDF do livro: o texto dos quadros trocados sai do PDF (apagarTexto.js)
 * e o texto novo é composto pelo Typst no mesmo quadro, com os estilos do IDML (fonte, corpo,
 * entrelinha, alinhamento, espaços, estilos de caractere e formatação local).
 */

import { lerEstilos } from './estilosModelo.js'
import { funcaoParagrafo, trecho } from './typstLivro.js'
import { lerHistoria, textoDoParagrafo, nomeDoEstilo } from '../idml/pretextuaisLivro.js'

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null }
const pt = v => `${Math.round(v * 1000) / 1000}pt`
const attrs = tag => { const o = {}; for (const m of String(tag).matchAll(/\s([A-Za-z]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o }
const mult = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]
const transf = t => (t || '1 0 0 1 0 0').split(/\s+/).map(Number)
const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Quadros de texto do livro: [{ story, pagina (1…), x0, y0, x1, y1 (pt, da página), colunas, medianiz, inset, vertical }]. */
export async function quadrosDoLivro(zip) {
  const designmap = await zip.file('designmap.xml').async('string')
  const quadros = []
  let nPagina = 0
  for (const m of designmap.matchAll(/<idPkg:Spread src="([^"]+)"/g)) {
    const xml = await zip.file(m[1]).async('string')
    const paginas = [...xml.matchAll(/<Page\b[^>]*>/g)].map(p => {
      const a = attrs(p[0]), t = transf(a.ItemTransform), gb = (a.GeometricBounds || '0 0 0 0').split(/\s+/).map(Number)
      return { n: ++nPagina, x0: t[4] + gb[1], y0: t[5] + gb[0], x1: t[4] + gb[3], y1: t[5] + gb[2] }
    })
    // grupos aninhados: a transformação do quadro é composta com a dos grupos
    const pilha = [[1, 0, 0, 1, 0, 0]]
    const re = /<(\/?)(Group|TextFrame)\b([^>]*?)(\/?)>/g
    let t
    while ((t = re.exec(xml))) {
      const [, fecha, tag, resto, auto] = t
      if (tag === 'Group') {
        if (fecha) pilha.pop()
        else if (!auto) pilha.push(mult(transf(attrs(' ' + resto).ItemTransform), pilha.at(-1)))
        continue
      }
      if (fecha) continue
      const a = attrs(' ' + resto)
      const fim = xml.indexOf('</TextFrame>', re.lastIndex)
      const corpo = auto ? '' : xml.slice(re.lastIndex, fim)
      const M = mult(transf(a.ItemTransform), pilha.at(-1))
      const pts = [...corpo.matchAll(/Anchor="([-\d.e]+) ([-\d.e]+)"/g)].map(p => aplicar(M, Number(p[1]), Number(p[2])))
      if (!pts.length) continue
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const pg = paginas.find(p => cx >= p.x0 && cx <= p.x1 && cy >= p.y0 && cy <= p.y1)
      if (!pg) continue
      const tfp = corpo.match(/<TextFramePreference\b[^>]*>[\s\S]*?(<\/TextFramePreference>|$)|<TextFramePreference\b[^>]*\/>/)?.[0] || ''
      const ta = attrs(tfp.slice(0, tfp.indexOf('>') + 1))
      const inset = [...(tfp.match(/<InsetSpacing[^>]*>([\s\S]*?)<\/InsetSpacing>/)?.[1] || '').matchAll(/>([-\d.e]+)</g)].map(x => Number(x[1]))
      quadros.push({
        story: a.ParentStory, pagina: pg.n,
        x0: Math.min(...xs) - pg.x0, y0: Math.min(...ys) - pg.y0, x1: Math.max(...xs) - pg.x0, y1: Math.max(...ys) - pg.y0,
        colunas: num(ta.TextColumnCount) || 1, medianiz: num(ta.TextColumnGutter) ?? 12,
        inset: inset.length === 4 ? inset : [0, 0, 0, 0], vertical: ta.VerticalJustification || 'TopAlign',
      })
      re.lastIndex = auto ? re.lastIndex : fim
    }
  }
  return quadros
}

// formatação local (atributos do ParagraphStyleRange/CharacterStyleRange e <Properties>)
const LOCAL = ['PointSize', 'FontStyle', 'Tracking', 'Position', 'Capitalization', 'FillColor', 'FillTint', 'Justification', 'SpaceBefore', 'SpaceAfter', 'LeftIndent', 'RightIndent', 'FirstLineIndent', 'Leading', 'AppliedFont']
function locais(abre, props) {
  const a = attrs(abre), o = {}
  for (const k of LOCAL) if (a[k] != null) o[k] = a[k]
  for (const k of ['AppliedFont', 'Leading']) {
    const v = (props || '').match(new RegExp(`<${k}[^>]*>([^<]*)</${k}>`))
    if (v) o[k] = v[1].trim()
  }
  return o
}
// "Montserrat ExtraBold" (família com o peso no nome, como o InDesign mostra fonte sem família
// instalada): família "Montserrat" e o peso no estilo da fonte
const PESO_NO_NOME = /^(.*?)\s+(Extra ?Bold|Semi ?Bold|Demi ?Bold|Bold|Extra ?Light|Light|Medium|Thin|Black|Heavy)$/i
function fonteSeparada(p) {
  const f = String(p.AppliedFont || '').split('\t')[0].replace(/ \(TT\)$/, '')
  const m = f.match(PESO_NO_NOME)
  if (!m || (p.FontStyle && !/^(Regular|Italic)$/i.test(p.FontStyle))) return p
  return { ...p, AppliedFont: m[1], FontStyle: m[2].replace(/\s+/g, '') + (/italic/i.test(p.FontStyle || '') ? ' Italic' : '') }
}

// fio acima/abaixo do parágrafo (InDesign): espessura, tipo, deslocamento a partir da linha de base
// pontilhado do InDesign ("Canned Dotted"): pontos redondos a cada ~3 espessuras (o "dotted" do Typst
// é mais espaçado)
const TRACO = (t, peso) => /dott/i.test(t || '') ? `(array: (0pt, ${pt(peso * 3)}))` : /dash/i.test(t || '') ? '"dashed"' : 'none'
function fios(p, f) {
  const out = []
  for (const [lado, sinal] of [['Above', -1], ['Below', 1]]) {
    if (p[`Rule${lado}`] !== 'true') continue
    const peso = num(p[`Rule${lado}LineWeight`]) ?? 1, off = num(p[`Rule${lado}Offset`]) ?? 0
    const esq = num(p[`Rule${lado}LeftIndent`]) || 0, dir = num(p[`Rule${lado}RightIndent`]) || 0
    // preto em CMYK (sem "paint" o Typst usa cinza com perfil ICC, que o PDF da gráfica não quer)
    const traco = `stroke: (paint: cmyk(0%, 0%, 0%, 100%), thickness: ${pt(peso)}, dash: ${TRACO(p[`Rule${lado}Type`], peso)}, cap: "round")`
    const dy = lado === 'Above' ? `${pt(f.asc - off)}` : `${pt(off)}`
    out.push(`place(${lado === 'Above' ? 'top' : 'bottom'} + left, dx: ${pt(esq)}, dy: ${dy}, line(length: 100% - ${pt(esq + dir)}, ${traco}))`)
  }
  return out
}

const nomeEstilo = (abre, tipo) => decodeURIComponent(abre.match(new RegExp(`Applied${tipo}Style="${tipo}Style/([^"]+)"`))?.[1] || '')

/** Conteúdo Typst de uma história, para o quadro dela. */
function typstDaHistoria(xml, estilos, largura, { bandas = [], faixa = null } = {}) {
  const h = lerHistoria(xml)
  if (!h) return ''
  const extraPar = new Map(), extraChar = new Map()
  const E = { par: n => fonteSeparada(extraPar.get(n) || estilos.par(n)), char: n => (n ? fonteSeparada(extraChar.get(n) || estilos.char(n)) : {}), cor: estilos.cor }
  const defs = new Map()
  const blocos = []
  let anterior = null, primeiro = null, ultimo = null
  h.pars.forEach((p, k) => {
    let estilo = nomeEstilo(p.abre, 'Paragraph')
    const loc = locais(p.abre, p.props)
    // corpo local em todos os trechos (ex.: edições anteriores em 6 pt): vale para o parágrafo
    const texto = p.runs.filter(r => !r.elemento && r.bruto)
    const corpos = texto.map(r => locais(r.abre, r.props))
    if (texto.length && corpos.every(c => c.PointSize)) loc.PointSize = corpos[0].PointSize
    // entrelinha local em todos os trechos (título do rosto do bolso: 17 pt): a do parágrafo
    if (texto.length && corpos.every(c => c.Leading && c.Leading !== 'Auto')) loc.Leading = String(Math.max(...corpos.map(c => num(c.Leading))))
    if (Object.keys(loc).length) {
      const nome = `${estilo}__local${k}`
      extraPar.set(nome, { ...estilos.par(estilo), ...loc })
      estilo = nome
    }
    const f = funcaoParagrafo(estilo, E)
    // "equilibrar" pede a definição do documento inteiro: aqui fica o parágrafo comum
    if (!defs.has(f.nome)) defs.set(f.nome, f.def.replace(/equilibrar\(/g, 'par('))
    const runs = p.runs.filter(r => !r.elemento).map((r, j) => {
      let char = nomeEstilo(r.abre, 'Character')
      if (/\[No character style\]/.test(char)) char = ''
      const lc = locais(r.abre, r.props)
      delete lc.Leading
      if (Object.keys(lc).length) { const nome = `${char || 'sem'}__local${k}_${j}`; extraChar.set(nome, { ...estilos.char(char), ...lc }); char = nome }
      return { char, bruto: r.bruto }
    })
    const conteudo = runs.map(r => r.bruto.split('<?ACE 8?>').map(parte => {
      const t = parte.replace(/<\?[^>]*\?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').split(String.fromCharCode(0xfeff)).join('')
      return t ? `#(${trecho({ texto: t, char: r.char || null }, E)})` : ''
    }).join('#h(1fr)')).join('')
    // parágrafo que não mudou: a faixa dele no PDF do livro (composição do InDesign), no lugar novo
    const b = bandas[k]
    // espaço entre parágrafos: o do livro entre duas faixas que já eram seguidas; senão, o dos estilos
    const gap = anterior == null ? 0
      : b && anterior.b && b.velho === anterior.b.velho + 1 ? (b.b - f.asc) - anterior.b.e
      : (anterior.f.estilo === f.estilo && anterior.f.mesmoEstilo != null ? anterior.f.mesmoEstilo : anterior.f.depois + f.antes) + (f.leading - f.asc)
    if (anterior) blocos.push(`#v(${pt(gap)})`)
    const fs = fios(E.par(estilo), f)
    let corpoPar
    if (b && faixa) {
      const alto = b.e - b.b + b.asc + b.desc
      const img = `place(top + left, dx: ${pt(-b.x0)}, dy: ${pt(-(b.b - b.asc))}, image(${JSON.stringify(faixa.arquivo)}, page: ${faixa.pagina}, width: ${pt(faixa.largura)}, height: ${pt(faixa.altura)}))`
      corpoPar = `block(width: 100%, height: ${pt(b.e - b.b + f.asc)}, above: 0pt, below: 0pt, place(top + left, dx: ${pt(b.x0 - faixa.x0)}, dy: ${pt(f.asc - b.asc)}, box(width: ${pt(b.x1 - b.x0)}, height: ${pt(alto)}, clip: true, ${img})))`
    } else corpoPar = `${f.nome}(plano: true)[${conteudo || '#sym.space.nobreak'}]`
    blocos.push(fs.length ? `#block(width: 100%, above: 0pt, below: 0pt, { ${corpoPar}; ${fs.join('; ')} })` : `#${corpoPar}`)
    if (k === 0) primeiro = { b, f }
    anterior = { f, b }
    ultimo = { b, f }
  })
  // fonte que falta (ex.: "Roboto (TT)" do colofão do bolso): a Source Sans 3 no lugar da serifada do Typst
  const reserva = t => t.replace(/font: ("[^"]+")/g, (m, f) => (f === '"Source Sans 3"' ? m : `font: (${f}, "Source Sans 3")`))
  return { defs: [...defs.values()].map(reserva), corpo: reserva(blocos.join('\n')), primeiro, ultimo }
}

const VERTICAL = { TopAlign: 'top', CenterAlign: 'horizon', BottomAlign: 'bottom', JustifyAlign: 'top' }

/** Pares [i, j] da maior subsequência comum de a e b (igual(a[i], b[j])). */
function lcs(a, b, igual) {
  const n = a.length, m = b.length
  const t = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = igual(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out = []
  for (let i = 0, j = 0; i < n && j < m;) {
    if (igual(a[i], b[j])) { out.push([i, j]); i++; j++ } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++
  }
  return out
}
const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const nomeBase = estilo => semAcento(nomeDoEstilo(estilo).split(':').pop().split('/').pop())
const chave = p => `${p.estilo}|${textoDoParagrafo(p).trim()}`

/**
 * Faixas do PDF do livro para os parágrafos da história antiga: Map índice → { b, e, asc, desc, x0, x1 }
 * (linhas de base da 1ª e da última linha). Os parágrafos do PDF (árvore de estrutura, um elemento
 * por parágrafo com o nome do estilo) são casados com os da história pelo estilo.
 */
async function faixasDoLivro(pdf, q, velhos) {
  const { paragrafosDaEstrutura, textoPorMcid, conteudoDaPagina } = await import('./apagarTexto.js')
  const altura = pdf.getPages()[q.pagina - 1].getHeight()
  const pos = textoPorMcid(await conteudoDaPagina(pdf, q.pagina), altura)
  const dentro = l => l.x >= q.x0 - 2 && l.x <= q.x1 + 2 && l.y >= q.y0 - 2 && l.y <= q.y1 + 2
  const els = (await paragrafosDaEstrutura(pdf, q.pagina))
    .map(e => ({ ...e, linhas: e.mcids.flatMap(m => pos.get(m) || []) }))
    .filter(e => e.linhas.length && e.linhas.every(dentro))
  const comTexto = velhos.map((p, i) => ({ p, i })).filter(x => textoDoParagrafo(x.p).trim())
  const out = new Map()
  for (const [a, b] of lcs(comTexto, els, (x, e) => nomeBase(x.p.estilo) === nomeBase(e.estilo))) {
    const ls = els[b].linhas, corpo = Math.max(...ls.map(l => l.corpo))
    out.set(comTexto[a].i, { b: Math.min(...ls.map(l => l.y)), e: Math.max(...ls.map(l => l.y)), asc: corpo * 0.95, desc: corpo * 0.24, x0: q.x0 - 2, x1: q.x1 + 20, velho: comTexto[a].i })
  }
  // parágrafo só com elemento ancorado (brasão do rosto do Regimento, com "Câmara dos Deputados"
  // dentro): a faixa vai do fim do parágrafo anterior (ou do topo do quadro) até o começo do
  // seguinte — sem ela o elemento sumia e o texto de baixo subia
  velhos.forEach((p, i) => {
    if (out.has(i) || textoDoParagrafo(p).trim() || !p.runs.some(r => r.elemento)) return
    const prox = [...out.keys()].filter(j => j > i).sort((x, y) => x - y)[0]
    if (prox == null) return
    const ant = [...out.keys()].filter(j => j < i).sort((x, y) => y - x)[0]
    const topo = ant != null ? out.get(ant).e + out.get(ant).desc : q.y0
    const fundo = out.get(prox).b - out.get(prox).asc
    if (fundo - topo < 1) return
    // linha de base "no fundo": a faixa inteira fica acima dela (asc = altura), sem linha abaixo
    out.set(i, { b: fundo, e: fundo, asc: fundo - topo, desc: 0, x0: q.x0 - 2, x1: q.x1 + 20, velho: i })
  })
  return out
}

/**
 * Por página do livro (1…): regiões a apagar e Typst do texto novo dos quadros das histórias trocadas.
 * Os parágrafos que não mudaram entram como faixas do PDF do livro (`original`: arquivo com o texto,
 * ao lado do livro.pdf apagado); os trocados são compostos pelo Typst.
 * @param zip IDML final (com os textos trocados); historias: Self das histórias trocadas
 * @param filtro (pagina) → true para as páginas que entram (pré-textuais e colofão)
 * @param base { zip: IDML do livro (geometria e textos antigos), pdf: PDF do livro (pdf-lib), arquivo: nome do PDF original no Typst }
 */
export async function pretextuaisNasPaginas(zip, historias, filtro = () => true, base = {}) {
  const out = new Map()
  if (!historias?.length) return out
  const estilos = lerEstilos(await zip.file('Resources/Styles.xml').async('string'), await zip.file('Resources/Graphic.xml')?.async('string') || '')
  // páginas na numeração do livro: geometria do IDML do livro
  const quadros = (await quadrosDoLivro(base.zip || zip)).filter(q => historias.includes(q.story) && filtro(q.pagina))
  for (const q of quadros) {
    const xml = await zip.file(`Stories/Story_${q.story}.xml`)?.async('string')
    if (!xml) continue
    const [it, il, ib, ir] = q.inset
    const w = q.x1 - q.x0, hgt = q.y1 - q.y0
    let bandas = [], faixa = null
    const velhoXml = base.zip && base.pdf && quadros.filter(x => x.story === q.story).length === 1 ? await base.zip.file(`Stories/Story_${q.story}.xml`)?.async('string') : null
    if (velhoXml) {
      try {
        const velhos = lerHistoria(velhoXml)?.pars || [], novos = lerHistoria(xml)?.pars || []
        const fx = await faixasDoLivro(base.pdf, q, velhos)
        for (const [i, j] of lcs(velhos, novos, (a, b) => chave(a) === chave(b))) if (fx.has(i)) bandas[j] = fx.get(i)
        const pg = base.pdf.getPages()[q.pagina - 1]
        faixa = { arquivo: base.arquivo, pagina: q.pagina, largura: pg.getWidth(), altura: pg.getHeight(), x0: q.x0 + il }
      } catch (e) {
        bandas = []; faixa = null
      }
    }
    const t = typstDaHistoria(xml, estilos, w - il - ir, { bandas, faixa })
    if (!t) continue
    const corpo = q.colunas > 1 ? `#columns(${q.colunas}, gutter: ${pt(q.medianiz)})[\n${t.corpo}\n]` : t.corpo
    // alinhamento vertical: com a 1ª (ou a última) faixa do livro, onde ela estava; senão, pela
    // altura medida. Texto que não cabe no quadro (no InDesign, texto excedente) fica marcado em
    // vermelho embaixo do quadro
    const W = pt(w - il - ir), H = pt(hgt - it - ib), v = VERTICAL[q.vertical] || 'top'
    const topo = q.y0 + it
    const dy = v === 'top' && t.primeiro?.b ? pt(t.primeiro.b.b - t.primeiro.f.asc - topo)
      : v === 'bottom' && t.ultimo?.b ? `${pt(t.ultimo.b.e - topo)} - h`
      : v === 'bottom' ? `${H} - h` : v === 'horizon' ? `(${H} - h) / 2` : '0pt'
    const typ = `${t.defs.join('\n')}\n#place(top + left, dx: ${pt(q.x0 + il)}, dy: ${pt(topo)}, context {\n` +
      `  let c = block(width: ${W})[\n${corpo}\n]\n` +
      `  let h = measure(c).height\n` +
      `  let dy = ${dy}\n` +
      `  place(top + left, dy: dy, c)\n` +
      `  if dy + h > ${H} + 0.5pt { place(top + left, dy: ${H} + 2pt, box(fill: rgb(220, 0, 0), inset: 2pt, text(font: "Source Sans 3", size: 7pt, fill: white)[Texto excedente: o quadro do livro não comporta este texto])) }\n` +
      `})`
    if (!out.has(q.pagina)) out.set(q.pagina, { regioes: [], typst: [] })
    const pg = out.get(q.pagina)
    pg.regioes.push({ x0: q.x0 - 2, y0: q.y0 - 2, x1: q.x1 + 2, y1: q.y1 + 2 })
    pg.typst.push(typ)
  }
  return out
}
