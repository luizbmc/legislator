import { diffChars } from 'diff'

function textoNode(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(textoNode).join('')
}

function nomeLocal(node) {
  return node?.localName || node?.nodeName?.replace(/^.*:/, '') || ''
}

function blocosDoXml(xmlText, origem = 'arquivo') {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error(`O XML ${origem} é inválido ou está malformado.`)
  const raiz = xml.documentElement
  const tagRaiz = nomeLocal(raiz)
  if (!raiz || (tagRaiz !== 'Norma' && tagRaiz !== 'Publicacao')) {
    throw new Error(`O XML ${origem} não possui a raiz <Norma> ou <Publicacao>.`)
  }

  const normas = tagRaiz === 'Norma'
    ? [raiz]
    : Array.from(raiz.children).filter(elemento => nomeLocal(elemento) === 'Norma')
  if (tagRaiz === 'Publicacao' && normas.length === 0) {
    throw new Error(`O XML ${origem} possui uma <Publicacao> sem elementos <Norma>.`)
  }

  const blocos = []
  normas.forEach((norma, normaIndice) => {
    Array.from(norma.children).forEach(elemento => {
      blocos.push({
        indice: blocos.length,
        normaIndice,
        tag: nomeLocal(elemento),
        texto: elemento.textContent || '',
      })
    })
  })
  return blocos
}

function blocosDoEditor(doc) {
  return (doc?.content || []).map((node, indice) => ({
    indice,
    tag: node.type || '',
    texto: textoNode(node),
  }))
}

// Caracteres Unicode de espaço têm a mesma função para esta checagem. Inclui
// espaço comum, não separável, fino, en/em, estreito e ideográfico. A chave
// existe só para a igualdade; textos e quantidade de espaços ficam intactos.
function chaveDeComparacao(texto) {
  return String(texto || '')
    .replace(/[\u0020\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/g, ' ')
    .replace(/ +$/, '')
}

function blocosIguais(a, b) {
  return chaveDeComparacao(a?.texto) === chaveDeComparacao(b?.texto)
}

function detalheCaracteres(normando, indesign) {
  if (!normando || !indesign) return null
  const antigo = chaveDeComparacao(normando.texto)
  const novo = chaveDeComparacao(indesign.texto)
  const partes = diffChars(antigo, novo)
  const iguais = partes.reduce((total, parte) => total + (!parte.added && !parte.removed ? parte.value.length : 0), 0)
  const similaridade = iguais / Math.max(antigo.length, novo.length, 1)
  if (similaridade <= 0.95) return null

  return {
    similaridade,
    normando: partes
      .filter(parte => !parte.added)
      .map(parte => ({ texto: parte.value, diferente: !!parte.removed })),
    indesign: partes
      .filter(parte => !parte.removed)
      .map(parte => ({ texto: parte.value, diferente: !!parte.added })),
  }
}

// Não chama importadores, pipeline, filtros de Vade Mecum ou rotinas de edição:
// apenas lê o texto de cada bloco e compara espaços tipográficos equivalentes.
function criarMatriz(m, n) {
  return Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
}

function preencherLinha(dp, normando, indesign, i) {
  for (let j = 1; j <= indesign.length; j++) {
    dp[i][j] = blocosIguais(normando[i - 1], indesign[j - 1])
      ? dp[i - 1][j - 1] + 1
      : Math.max(dp[i - 1][j], dp[i][j - 1])
  }
}

function montarRelatorio(normando, indesign, dp) {
  const m = normando.length
  const n = indesign.length
  const operacoes = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && blocosIguais(normando[i - 1], indesign[j - 1])) {
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      operacoes.unshift({ tipo: 'adicionado', indesign: indesign[j - 1] })
      j--
    } else {
      operacoes.unshift({ tipo: 'removido', normando: normando[i - 1] })
      i--
    }
  }

  const diferencas = []
  for (let k = 0; k < operacoes.length; k++) {
    const atual = operacoes[k]
    const proxima = operacoes[k + 1]
    if (atual.tipo === 'removido' && proxima?.tipo === 'adicionado') {
      diferencas.push({
        tipo: 'modificado',
        normando: atual.normando,
        indesign: proxima.indesign,
        detalheCaracteres: detalheCaracteres(atual.normando, proxima.indesign),
      })
      k++
    } else {
      diferencas.push(atual)
    }
  }

  return {
    integro: diferencas.length === 0,
    totalNormando: m,
    totalInDesign: n,
    diferencas,
  }
}

function compararBlocos(normando, indesign) {
  const dp = criarMatriz(normando.length, indesign.length)
  for (let i = 1; i <= normando.length; i++) preencherLinha(dp, normando, indesign, i)
  return montarRelatorio(normando, indesign, dp)
}

async function compararBlocosComProgresso(normando, indesign, onProgresso) {
  const dp = criarMatriz(normando.length, indesign.length)
  const total = Math.max(normando.length, 1)
  const lote = Math.max(1, Math.floor(120000 / Math.max(indesign.length, 1)))

  onProgresso?.(10, 'Comparando os blocos…')
  for (let i = 1; i <= normando.length; i++) {
    preencherLinha(dp, normando, indesign, i)
    if (i % lote === 0 || i === normando.length) {
      onProgresso?.(10 + Math.round((i / total) * 80), `Comparando blocos: ${i} de ${normando.length}`)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  onProgresso?.(95, 'Preparando o relatório…')
  await new Promise(resolve => setTimeout(resolve, 0))
  const relatorio = montarRelatorio(normando, indesign, dp)
  onProgresso?.(100, 'Comparação concluída')
  return relatorio
}

export function compararXmlInDesign(editorDoc, xmlText) {
  return compararBlocos(blocosDoEditor(editorDoc), blocosDoXml(xmlText, 'do InDesign'))
}

export function compararDoisXml(xmlNormando, xmlInDesign) {
  return compararBlocos(
    blocosDoXml(xmlNormando, 'do Normando'),
    blocosDoXml(xmlInDesign, 'do InDesign'),
  )
}

export async function compararDoisXmlComProgresso(xmlNormando, xmlInDesign, onProgresso) {
  onProgresso?.(8, 'Lendo os XMLs…')
  const normando = blocosDoXml(xmlNormando, 'do Normando')
  const indesign = blocosDoXml(xmlInDesign, 'do InDesign')
  return compararBlocosComProgresso(normando, indesign, onProgresso)
}
