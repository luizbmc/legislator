/**
 * textosDeIdml.js — texto de normas tirado de um IDML já diagramado (ex.: a última edição do livro),
 * no lugar do texto do banco. Usado para as normas cujo texto revisado só existe no InDesign (na CF,
 * as convenções e os tratados internacionais).
 *
 * Cada norma do IDML começa num parágrafo de abertura (tit-subtit:abertura-cap…), com o título dela;
 * a norma da publicação é achada pelo título (epígrafe, sem acentos nem maiúsculas). Os parágrafos
 * viram blocos do mesmo tipo que o editor grava (epigrafe, notaTitulo, artigoTitulo, corpoTratado…),
 * para valerem as mesmas regras de paginação; o texto do corpo mantém o estilo de parágrafo do IDML
 * (texto-lei, texto-lei-espaco-ant…) e os estilos de caractere dele. Ajustes locais da diagramação
 * (tracking, condições de marcação) ficam de fora.
 */
import { readFileSync } from 'fs'
import JSZip from 'jszip'

// começo de norma: abertura de capítulo (CF) ou epígrafe (Regimento); a epígrafe de emenda fica dentro da norma
const ABERTURA = /^tit-subtit:(abertura-cap|epigrafe$)/
// estilo de parágrafo do IDML → tipo de bloco do editor
const TIPO = [
  [/^corpo-legis:nota-titulos$/, 'notaTitulo'],
  [/^corpo-legis:art-tit-centro$/, 'artigoTitulo'],
  [/^corpo-legis:art$/, 'artigo'],
  [/^tit-subtit:parte-livro-tit-cap$/, 'partelivroTitCap'],
  [/^tit-subtit:secao-subsecao$/, 'secaoSubsecao'],
  [/^corpo-legis:ass-data$/, 'data'],
  [/^corpo-legis:ass-nome/, 'assinatura'],
]
// estilos de caractere que a exportação põe sozinha (cabeço) ou que não existem fora do InDesign
const CHAR_IGNORADO = new Set(['$ID/[No character style]', 'parte1', 'parte2'])

const desescapar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const nomeEstilo = (self, prefixo) => decodeURIComponent(self.replace(prefixo, ''))
export const normalizarTitulo = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ajustes locais de composição (override) que o diagramador faz no parágrafo
const COMPOSICAO = ['Tracking', 'DesiredWordSpacing', 'MinimumWordSpacing', 'MaximumWordSpacing', 'DesiredLetterSpacing',
  'MinimumLetterSpacing', 'MaximumLetterSpacing', 'DesiredGlyphScaling', 'MinimumGlyphScaling', 'MaximumGlyphScaling',
  'HorizontalScale', 'Hyphenation', 'HyphenationZone', 'HyphenWeight', 'NoBreak', 'Composer', 'KerningMethod']
const ajustesDe = attrs => COMPOSICAO.filter(a => attrs.includes(` ${a}="`))

/**
 * Parágrafos de uma story: [{ estilo, nos: [{ type: 'text', text, char }], ajustes: [atributos de
 * composição com override] }]. Notas de rodapé, tabelas e comentários ficam de fora (avisos).
 */
function paragrafosDaStoryIdml(xml, avisos) {
  const pars = []
  let atual = null
  const novo = (estilo, ajustes) => { atual = { estilo, nos: [], ajustes: new Set(ajustes) }; pars.push(atual) }
  // (têm parágrafos dentro: saem antes, para não confundir os limites dos parágrafos)
  xml = xml.replace(/<(Footnote|Table|Note)\b[\s\S]*?<\/(Footnote|Table|Note)>/g, (m, tag) => { avisos.push(`${tag} ignorado`); return '' })
  for (const psr of xml.matchAll(/<ParagraphStyleRange([^>]*)>([\s\S]*?)<\/ParagraphStyleRange>/g)) {
    const estilo = nomeEstilo(psr[1].match(/AppliedParagraphStyle="([^"]*)"/)?.[1] || '', 'ParagraphStyle/')
    const ajustesPar = ajustesDe(psr[1])
    if (!atual || atual.fechado) novo(estilo, ajustesPar)
    else { atual.estilo = estilo; for (const a of ajustesPar) atual.ajustes.add(a) }
    for (const csr of psr[2].matchAll(/<CharacterStyleRange([^>]*)>([\s\S]*?)<\/CharacterStyleRange>/g)) {
      const ajustesChar = ajustesDe(csr[1])
      let char = nomeEstilo(csr[1].match(/AppliedCharacterStyle="([^"]*)"/)?.[1] || '', 'CharacterStyle/')
      if (CHAR_IGNORADO.has(char)) char = null
      if (!char && /Position="Superscript"/.test(csr[1])) char = 'sobrescrito'
      const corpo = csr[2].replace(/<Properties>[\s\S]*?<\/Properties>/g, '')
      for (const m of corpo.matchAll(/<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g)) {
        if (m[1] == null) { atual.fechado = true; continue }
        if (atual.fechado) novo(estilo, ajustesPar)
        const text = desescapar(m[1].replace(/<\?ACE \d+\?>/g, ''))
        if (text) { atual.nos.push({ type: 'text', text, char }); for (const a of ajustesChar) atual.ajustes.add(a) }
      }
    }
  }
  return pars.filter(p => p.nos.length).map(({ estilo, nos, ajustes }) => ({ estilo, nos, ajustes: [...ajustes] }))
}

/**
 * Normas de um IDML: [{ titulo, chave, blocos }] (blocos no formato do editor, prontos para
 * substituir norma.doc.content).
 */
export async function normasDoIdml(arquivo) {
  const zip = await JSZip.loadAsync(readFileSync(arquivo))
  const design = await zip.file('designmap.xml').async('string')
  // ordem das stories: a do designmap
  const ids = [...design.matchAll(/<idPkg:Story src="Stories\/Story_([^"]+)\.xml"/g)].map(m => m[1])
  const avisos = []
  const normas = []
  let norma = null
  for (const id of ids) {
    const xml = await zip.file(`Stories/Story_${id}.xml`)?.async('string')
    if (!xml) continue
    for (const p of paragrafosDaStoryIdml(xml, avisos)) {
      if (ABERTURA.test(p.estilo)) {
        const titulo = p.nos.map(n => n.text).join('')
        // o estilo de abertura do InDesign põe o título em maiúsculas; no banco a epígrafe já vem assim
        norma = { titulo, chave: normalizarTitulo(titulo), blocos: [{ type: 'epigrafe', content: p.nos.map(n => ({ ...n, text: n.text.toLocaleUpperCase('pt-BR'), char: null })) }] }
        normas.push(norma)
        continue
      }
      if (!norma) continue
      const tipo = TIPO.find(([re]) => re.test(p.estilo))?.[1]
      // corpo: texto de tratado, com o estilo de parágrafo do IDML
      // (ajustesIdml: overrides de composição do diagramador, para a calibração)
      const attrs = { ...(tipo ? {} : { estiloIdml: p.estilo }), ...(p.ajustes.length ? { ajustesIdml: p.ajustes } : {}) }
      norma.blocos.push({ type: tipo || 'corpoTratado', ...(Object.keys(attrs).length ? { attrs } : {}), content: p.nos })
    }
    // a norma não continua de uma story para outra
    norma = null
  }
  return { normas, avisos }
}

/**
 * Troca o texto das normas da publicação (preparada) pelo do IDML, nas normas dos tipos pedidos.
 * @returns [{ epigrafe, idml: título no IDML | null }]
 */
export async function aplicarTextosDoIdml(pub, { arquivo, tipos = ['Tratado Internacional'] }) {
  const { normas, avisos } = await normasDoIdml(arquivo)
  const usadas = []
  for (const secao of pub.secoes || []) {
    for (const n of secao.normas || []) {
      if (n.pular || !tipos.includes(n.tipo)) continue
      const chaves = [n.epigrafe, n.doc?.content?.[0]?.content?.map(c => c.text || '').join('')].map(normalizarTitulo).filter(Boolean)
      const achada = normas.find(x => chaves.some(c => c === x.chave)) ||
        normas.find(x => chaves.some(c => c.length >= 30 && x.chave.length >= 30 && (c.startsWith(x.chave.slice(0, 60)) || x.chave.startsWith(c.slice(0, 60)))))
      usadas.push({ epigrafe: n.epigrafe, idml: achada?.titulo ?? null })
      if (achada) n.doc = { type: 'doc', content: achada.blocos }
    }
  }
  return { usadas, avisos }
}
