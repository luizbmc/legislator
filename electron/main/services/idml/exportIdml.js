/**
 * exportIdml.js — publicação do Normando → .idml pronto para abrir no InDesign.
 *
 * Parte do modelo (build/modelo-normando/, criado por scripts/idml/criar-modelo-normando.mjs):
 * estilos, mestras, variáveis de cabeço, pré-textuais e colofão. Entre as pré-textuais e
 * o colofão entram as páginas do miolo (mestra A-Miolo), cada uma com um quadro de texto
 * encadeado ao seguinte, e a story do miolo gerada por historia.js.
 *
 * O número de páginas é estimado pela quantidade de texto, com folga; o reflow inteligente
 * do modelo acrescenta páginas se faltar e apaga as que sobrarem vazias.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs'
import { join, basename } from 'path'
import { pathToFileURL } from 'url'
import JSZip from 'jszip'
import { paragrafosDaPublicacao, storyXml, contarCaracteres, novoRelatorio } from './historia.js'
import { valoresDosCampos, aplicarCampos } from './pretextuais.js'
import { aplicarPretextuaisDoLivro, lerPretextuaisDoLivro } from './pretextuaisLivro.js'
import { excecoesNoDesignmap } from '../pdf/hifenizacaoExcecoes.js'
import { filtrarDocPorModoVadeMecum } from '../../../../src/services/filtrarModoVadeMecum.js'
import { aplicarEstiloVadeMecumDoc } from '../../../../src/services/estiloVadeMecum.js'
import { aplicarDecisoes } from './decisoesIdml.js'

const STORY_MIOLO = 'nmiolo'
// caracteres por página do miolo (calibrado no legised 8ª ed.: corpo 9,5/13,25 em 131 × 222 mm)
const CARACTERES_POR_PAGINA = 3950
const FOLGA = 1.12

function lerJson(v) {
  if (!v) return {}
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return {} }
}

export function publicacaoUsaVadeMecum(publicacao) {
  return String(publicacao?.titulo || '').trimStart().toLocaleLowerCase('pt-BR').startsWith('vade')
}

/** Normas da publicação já com o doc pronto (modo Vade Mecum aplicado) e as que ficam de fora. */
export function prepararPublicacao(publicacao) {
  const vm = publicacaoUsaVadeMecum(publicacao)
  const puladas = [], pendentes = []
  const secoes = (publicacao.secoes || []).map(secao => ({
    ...secao,
    normas: (secao.normas || []).map(norma => {
      let doc = null
      try { doc = JSON.parse(norma.conteudo_doc || '') } catch { doc = null }
      const vazia = !doc?.content?.some(b => (b.content || []).length || b.type === 'table')
      // mesmas regras da exportação para o InDesign: só normas finalizadas e não marcadas para pular
      const motivo = vazia ? 'sem conteúdo'
        : norma.exportacao === 'ignorar' ? 'marcada para não exportar'
          : norma.status && norma.status !== 'finalizado' ? `em ${norma.status}` : null
      if (motivo) {
        puladas.push({ secao: secao.titulo, epigrafe: norma.epigrafe, motivo })
        return { ...norma, pular: true }
      }
      // atualização pendente: entra com o texto atual, mas vai para o relatório
      if (norma.atualizacao_pendente) pendentes.push({ secao: secao.titulo, epigrafe: norma.epigrafe })
      if (vm) doc = aplicarEstiloVadeMecumDoc(doc, true).doc
      doc = filtrarDocPorModoVadeMecum(doc, vm)
      return { ...norma, doc }
    }),
  }))
  return { ...publicacao, secoes, puladas, pendentes }
}

/**
 * @param publicacao  publicação com secoes[].normas[] (conteudo_doc em JSON)
 * @param opcoes      { pastaModelo, pastaSaida (para os vínculos), cabecalho: 'secao'|'norma',
 *                      sessao: SessaoPaginacao → IDML ajustado (decisões da paginação, decisoesIdml.js) }
 * @returns { idml: Buffer, relatorio }
 */
export async function gerarIdmlPublicacao(publicacao, opcoes = {}) {
  const pastaModelo = opcoes.pastaModelo
  const cfg = JSON.parse(readFileSync(join(pastaModelo, 'modelo.json'), 'utf8'))
  const zip = await JSZip.loadAsync(readFileSync(join(pastaModelo, 'modelo.idml')))
  const ler = n => zip.file(n).async('string')

  const rel = novoRelatorio()
  const pub = prepararPublicacao(publicacao)
  rel.puladas = pub.puladas
  rel.pendentes = pub.pendentes

  const estilos = await ler('Resources/Styles.xml')
  const existentes = new Set([...estilos.matchAll(/<ParagraphStyle Self="([^"]+)"/g)].map(m => m[1]))
  const designmap0 = await ler('designmap.xml')
  const versao = designmap0.match(/DOMVersion="([^"]+)"/)?.[1] || '21.5'

  // pré-textuais: campos {{…}} do modelo
  const pre = lerJson(opcoes.pretextuais ?? publicacao.pretextuais)
  const inst = lerJson(opcoes.institucional)
  const valores = valoresDosCampos(pub, pre, inst)
  rel.camposDesconhecidos = []
  for (const n of Object.keys(zip.files).filter(n => /^Stories\/.*\.xml$/.test(n))) {
    const xml = await ler(n)
    if (!xml.includes('{{')) continue
    const r = aplicarCampos(xml, valores)
    zip.file(n, r.xml)
    rel.camposDesconhecidos.push(...r.desconhecidos)
  }
  // folha técnica da publicação (botão "Folha técnica…"), parágrafo a parágrafo nos estilos do modelo,
  // como nos livros com pasta do livro
  await aplicarPretextuaisDoLivro(zip, { publicacao, institucional: inst })
  rel.camposAPreencher = Object.entries(valores)
    .filter(([, v]) => typeof v === 'string' && v.includes('[a preencher:'))
    .map(([, v]) => v.match(/\[a preencher: ([^\]]+)\]/)[1])

  // story do miolo
  // IDML ajustado: os parágrafos da sessão de paginação, com as decisões dela; senão texto limpo
  let pars, paginasExatas = null
  if (opcoes.sessao) {
    const d = aplicarDecisoes(opcoes.sessao)
    pars = d.pars
    paginasExatas = d.paginas
    rel.ajustado = { paginas: d.paginas, esperado: d.esperado }
  } else pars = paragrafosDaPublicacao(pub, { cabecalho: opcoes.cabecalho || 'secao' }, rel)
  const mestra = await ler(`MasterSpreads/MasterSpread_${cfg.mestraMiolo}.xml`)
  const geo = geometria(mestra)
  zip.file(`Stories/Story_${STORY_MIOLO}.xml`, storyXml(STORY_MIOLO, pars, { versao, largura: geo.largura, estilosExistentes: existentes, rel }))

  // páginas: estimadas pelo texto; o colofão (página final) fica numa página par
  // (ajustado: as do plano, exatas)
  let paginas = paginasExatas ?? Math.max(1, Math.ceil(contarCaracteres(pars) / CARACTERES_POR_PAGINA * FOLGA))
  if ((cfg.paginasPreTextuais + paginas) % 2 === 0) paginas++
  rel.paginasMiolo = paginas
  rel.paginasPreTextuais = cfg.paginasPreTextuais

  const novosSpreads = await montarSpreads(zip, cfg, geo, paginas, ler)

  // designmap: spreads novos antes do colofão, story nova, tamanho da seção
  let designmap = designmap0
  const entrada = s => `<idPkg:Spread src="${s}" />`
  designmap = designmap.replace(new RegExp(`(<idPkg:Spread src="${cfg.ultimoSpread}"\\s*/>)`), `$1\n\t${novosSpreads.map(entrada).join('\n\t')}`)
  designmap = designmap.replace(/(<idPkg:BackingStory [^>]*\/>)/, `<idPkg:Story src="Stories/Story_${STORY_MIOLO}.xml" />\n\t$1`)
  designmap = designmap.replace(/StoryList="([^"]*)"/, (_, l) => `StoryList="${l} ${STORY_MIOLO}"`)
  const total = cfg.paginasPreTextuais + paginas + (cfg.paginasFinais || 0)
  designmap = designmap.replace(/(<Section [^>]*?)Length="\d+"/, `$1Length="${total}"`)
    .replace(/(<Section [^>]*?)AlternateLayoutLength="\d+"/, `$1AlternateLayoutLength="${total}"`)
  // exceções de hifenização do usuário no dicionário do documento (o InDesign divide igual ao Normando)
  zip.file('designmap.xml', excecoesNoDesignmap(designmap))
  // o modelo apaga páginas vazias: ao abrir, o InDesign tirava as 5 do sumário (ainda sem texto), e o
  // miolo passava da p. 11 para a p. 6 — página par, com as margens trocadas
  const preferencias = await ler('Resources/Preferences.xml')
  zip.file('Resources/Preferences.xml', preferencias.replace(/(<TextPreference [^>]*?)DeleteEmptyPages="[^"]*"/, '$1DeleteEmptyPages="false"'))
  rel.paginas = total

  // vínculos (imagens das pré-textuais) apontando para a pasta Links ao lado do .idml
  if (opcoes.pastaSaida) await religarVinculos(zip, join(opcoes.pastaSaida, 'Links'))

  // mimetype primeiro e sem compressão
  const saida = new JSZip()
  saida.file('mimetype', await ler('mimetype'), { compression: 'STORE' })
  for (const n of Object.keys(zip.files)) {
    if (n === 'mimetype' || zip.files[n].dir) continue
    saida.file(n, await zip.file(n).async('uint8array'))
  }
  const idml = await saida.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' })
  return { idml, relatorio: rel }
}

/** Arquivos que acompanham o .idml (Links e Document fonts do modelo). */
/**
 * Páginas pré-textuais como o modelo do Normando sai para a publicação (campos preenchidos), para o
 * formulário da folha técnica de publicação sem pasta do livro.
 */
export async function pretextuaisDoModelo(publicacao, institucional, pastaModelo) {
  const zip = await JSZip.loadAsync(readFileSync(join(pastaModelo, 'modelo.idml')))
  const valores = valoresDosCampos(publicacao, lerJson(publicacao.pretextuais), lerJson(institucional))
  // bloco vazio sai do modelo e as partes da folha técnica se confundiriam: marca no lugar, tirada depois
  const MARCA = '⁣'
  if (!valores.creditos_institucionais.texto) valores.creditos_institucionais = { ...valores.creditos_institucionais, texto: `${MARCA}: ${MARCA}` }
  if (!valores.equipe.texto) valores.equipe = { ...valores.equipe, texto: `${MARCA}: ${MARCA}` }
  for (const k of ['nota_editor', 'historico_edicoes', 'linha_serie']) if (!valores[k]) valores[k] = MARCA
  for (const n of Object.keys(zip.files).filter(n => /^Stories\/.*\.xml$/.test(n))) {
    const xml = await zip.file(n).async('string')
    if (xml.includes('{{')) zip.file(n, aplicarCampos(xml, valores).xml)
  }
  const out = await lerPretextuaisDoLivro(zip)
  const ft = out.folhaTecnica
  const vazio = t => !String(t || '').replace(new RegExp(MARCA, 'g'), '').replace(/[:\s]/g, '')
  ft.creditosInstitucionais = ft.creditosInstitucionais.filter(c => !vazio(c.rotulo + c.nome))
  ft.creditosPublicacao = ft.creditosPublicacao.filter(c => !vazio(c.rotulo + c.nome))
  ft.informacoes = ft.informacoes.map(t => (vazio(t) ? '' : t))
  return out
}

export function arquivosDeApoio(pastaModelo) {
  return ['Links', 'Document fonts'].map(sub => join(pastaModelo, sub)).filter(p => existsSync(p))
}

/**
 * Copia Links e Document fonts para a pasta do .idml. Arquivo que já existe com o mesmo
 * tamanho fica (o InDesign trava as fontes do documento aberto); falha vai para o retorno.
 */
export function copiarArquivosDeApoio(pastaModelo, pastaSaida) {
  const falhas = []
  for (const origem of arquivosDeApoio(pastaModelo)) {
    const destino = join(pastaSaida, basename(origem))
    mkdirSync(destino, { recursive: true })
    for (const nome of readdirSync(origem)) {
      const de = join(origem, nome), para = join(destino, nome)
      try {
        if (existsSync(para) && statSync(para).size === statSync(de).size) continue
        copyFileSync(de, para)
      } catch (e) {
        falhas.push(`${basename(origem)}/${nome}: ${e.code || e.message}`)
      }
    }
  }
  return falhas
}

// ── geometria e páginas ──────────────────────────────────────────
const LARG = 481.8897637795001
const ALT = 722.8346456693
const ESPACO_SPREADS = 931.1811023623   // distância vertical entre spreads no pasteboard

function geometria(mestraXml) {
  const mp = mestraXml.match(/<MarginPreference [^>]*>/)?.[0] || ''
  const v = k => Number(mp.match(new RegExp(`\\b${k}="([^"]+)"`))?.[1] || 0)
  const top = v('Top'), bottom = v('Bottom'), dentro = v('Left'), fora = v('Right')
  return { top, bottom, dentro, fora, largura: LARG - dentro - fora, margemXml: mp }
}

async function montarSpreads(zip, cfg, geo, paginas, ler) {
  const camada = cfg.camada
  const numPre = cfg.paginasPreTextuais
  let seq = 0
  const quadro = (pagNum) => `ntf${pagNum}`
  const pagina = (n, direita) => {
    const x = direita ? 0 : -LARG
    return `<Page Self="npg${n}" AppliedAlternateLayout="uae" LayoutRule="UseMaster" SnapshotBlendingMode="IgnoreLayoutSnapshots" OptionalPage="false" ` +
      `GeometricBounds="0 0 ${ALT} ${LARG}" ItemTransform="1 0 0 1 ${x} -${ALT / 2}" Name="${n}" AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapStyleName" ` +
      `OverrideList="" AppliedMaster="${cfg.mestraMiolo}" MasterPageTransform="1 0 0 1 0 0" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true">` +
      `${geo.margemXml}</Page>`
  }
  const textFrame = (n, direita, primeiro, ultimo) => {
    // coordenadas do spread: origem na lombada, y no centro da página (quadro do modelo: 1ª linha-base
    // pela ascendente, que o Normando também segue — pdf/mancha.js)
    const y0 = -ALT / 2 + geo.top, y1 = ALT / 2 - geo.bottom
    const x0 = direita ? geo.dentro : -LARG + geo.fora
    const x1 = direita ? LARG - geo.fora : -geo.dentro
    const ponto = (x, y) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}" />`
    return `<TextFrame Self="${quadro(n)}" ParentStory="${STORY_MIOLO}" PreviousTextFrame="${primeiro ? 'n' : quadro(n - 1)}" NextTextFrame="${ultimo ? 'n' : quadro(n + 1)}" ` +
      `ContentType="TextType" ItemLayer="${camada}" Locked="false" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" Visible="true" Name="$ID/" ItemTransform="1 0 0 1 0 0">` +
      `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>` +
      ponto(x0, y0) + ponto(x0, y1) + ponto(x1, y1) + ponto(x1, y0) +
      `</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
      `<TextFramePreference TextColumnCount="1" TextColumnFixedWidth="${x1 - x0}" TextColumnMaxWidth="0">` +
      `<Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties>` +
      `</TextFramePreference></TextFrame>`
  }

  const primeiraPag = numPre + 1, ultimaPag = numPre + paginas
  const itens = n => ({ pagina: pagina(n, n % 2 === 1), quadro: textFrame(n, n % 2 === 1, n === primeiraPag, n === ultimaPag) })

  // 1ª página do miolo: se a última pré-textual ficou sozinha à esquerda, entra no mesmo spread
  let n = primeiraPag
  let ultimo = await ler(cfg.ultimoSpread)
  const paginasNoUltimo = (ultimo.match(/<Page /g) || []).length
  if (paginasNoUltimo === 1 && n % 2 === 1) {
    const it = itens(n++)
    ultimo = ultimo.replace(/(<\/Page>)(?![\s\S]*<\/Page>)/, `$1${it.pagina}`)
      .replace(/(<\/Spread>)/, `${it.quadro}$1`)
      .replace(/(<Spread [^>]*?)PageCount="\d+"/, '$1PageCount="2"')
    zip.file(cfg.ultimoSpread, ultimo)
  }
  const yBase = Number(ultimo.match(/<Spread [^>]*ItemTransform="1 0 0 1 0 ([-\d.]+)"/)?.[1] || 0)

  const nomes = []
  while (n <= ultimaPag) {
    const grupo = n % 2 === 1 ? [n] : (n + 1 <= ultimaPag ? [n, n + 1] : [n])
    const id = `nsp${(++seq).toString(36)}`
    const y = yBase + seq * ESPACO_SPREADS
    const it = grupo.map(itens)
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.5">` +
      `<Spread Self="${id}" FlattenerOverride="Default" SpreadHidden="false" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 ${y}" ShowMasterItems="true" ` +
      `PageCount="${grupo.length}" BindingLocation="${grupo.length === 2 || grupo[0] % 2 === 0 ? 1 : 0}" PageTransitionType="None" PageTransitionDirection="NotApplicable" PageTransitionDuration="Medium">` +
      it.map(x => x.pagina).join('') + it.map(x => x.quadro).join('') +
      '</Spread></idPkg:Spread>'
    const nome = `Spreads/Spread_${id}.xml`
    zip.file(nome, xml)
    nomes.push(nome)
    n += grupo.length
  }
  // colofão: depois do miolo no pasteboard
  if (cfg.spreadFinal) {
    let fim = await ler(cfg.spreadFinal)
    fim = fim.replace(/(<Spread [^>]*ItemTransform="1 0 0 1 0 )[-\d.]+"/, `$1${yBase + (seq + 1) * ESPACO_SPREADS}"`)
    zip.file(cfg.spreadFinal, fim)
  }
  return nomes
}

/** LinkResourceURI dos vínculos → pasta Links ao lado do .idml exportado. */
async function religarVinculos(zip, pastaLinks) {
  for (const n of Object.keys(zip.files)) {
    if (!/^(Spreads|MasterSpreads|Stories)\/.*\.xml$/.test(n)) continue
    const xml = await zip.file(n).async('string')
    if (!xml.includes('LinkResourceURI=')) continue
    const novo = xml.replace(/LinkResourceURI="([^"]+)"/g, (m, uri) => {
      const arquivo = decodeURIComponent(uri.split('/').pop())
      const caminho = join(pastaLinks, arquivo)
      if (!existsSync(caminho)) return m
      return `LinkResourceURI="file:${pathToFileURL(caminho).pathname.replace(/^\//, '')}"`
    })
    zip.file(n, novo)
  }
}
