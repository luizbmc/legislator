/**
 * estilosModelo.js — lê os estilos de parágrafo e de caractere do Styles.xml do modelo IDML,
 * com a cadeia "Baseado em" resolvida, para o PDF de revisão usar as mesmas definições do
 * InDesign (fonte, corpo, entrelinha, recuos, espaços, alinhamento, caixa, cor).
 */

// SameParaStyleSpacing: "espaço entre parágrafos que usam o mesmo estilo" (número em pt, ou
// "SetIgnore" = não se aplica); BalanceRaggedLines: "equilibrar linhas irregulares" (NoBalancing,
// VeeShape, PyramidShape, FullyBalanced)
// RuleAboveType/RuleBelowType: tipo do fio do parágrafo ("StrokeStyle/$ID/Canned Dotted" = pontilhado)
const ATRIBUTOS_FILHOS = ['AppliedFont', 'Leading', 'BasedOn', 'SameParaStyleSpacing', 'BalanceRaggedLines', 'RuleAboveType', 'RuleBelowType']

function atributos(tag) {
  const out = {}
  for (const m of tag.matchAll(/\s([A-Za-z]+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

/** Elementos <Tag …>…</Tag> ou <Tag …/> de um tipo (sem aninhamento do mesmo tipo). */
function elementos(xml, tag) {
  const out = []
  const re = new RegExp(`<${tag}\\s[^>]*?(/>|>)`, 'g')
  let m
  while ((m = re.exec(xml))) {
    const abertura = m[0]
    let corpo = ''
    if (m[1] === '>') {
      const fim = xml.indexOf(`</${tag}>`, re.lastIndex)
      corpo = xml.slice(re.lastIndex, fim)
      re.lastIndex = fim
    }
    const a = atributos(abertura)
    for (const f of ATRIBUTOS_FILHOS) {
      const v = corpo.match(new RegExp(`<${f}[^>]*>([^<]*)</${f}>`))
      if (v) a[f] = v[1].trim()
    }
    out.push(a)
  }
  return out
}

function resolver(lista, prefixo) {
  const porSelf = new Map(lista.map(e => [e.Self, e]))
  const cache = new Map()
  const props = (self, visto = new Set()) => {
    if (cache.has(self)) return cache.get(self)
    const e = porSelf.get(self)
    if (!e || visto.has(self)) return {}
    visto.add(self)
    let pai = e.BasedOn
    if (pai && !porSelf.has(pai) && porSelf.has(`${prefixo}/${pai}`)) pai = `${prefixo}/${pai}`
    const r = { ...(pai && pai !== self ? props(pai, visto) : {}), ...e }
    cache.set(self, r)
    return r
  }
  return props
}

/** { par(nome) → props resolvidas, char(nome) → props (só as do próprio estilo e base), cores } */
export function lerEstilos(stylesXml, graphicXml = '') {
  const pars = elementos(stylesXml, 'ParagraphStyle')
  const chars = elementos(stylesXml, 'CharacterStyle')
  const propsPar = resolver(pars, 'ParagraphStyle')
  const propsChar = resolver(chars, 'CharacterStyle')
  const selfPar = n => 'ParagraphStyle/' + n.replace(/%/g, '%25').replace(/:/g, '%3a')
  const selfChar = n => 'CharacterStyle/' + n.replace(/%/g, '%25').replace(/:/g, '%3a')
  // cores: só o que interessa ao texto (preto e tons de cinza; o resto vira preto)
  const cores = new Map()
  for (const c of elementos(graphicXml, 'Color')) {
    const v = (c.ColorValue || '').split(/\s+/).map(Number)
    if (c.Space === 'CMYK' && v.length === 4) cores.set(c.Self, { cmyk: v })
    else if (c.Space === 'RGB' && v.length === 3) cores.set(c.Self, { rgb: v })
  }
  return {
    par: nome => propsPar(selfPar(nome)),
    char: nome => (nome ? propsChar(selfChar(nome)) : {}),
    cor: self => cores.get(self) || null,
  }
}
