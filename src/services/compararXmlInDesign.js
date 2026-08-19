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

function blocosDoXml(xmlText) {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('O XML do InDesign é inválido ou está malformado.')
  if (!xml.documentElement || nomeLocal(xml.documentElement) !== 'Norma') {
    throw new Error('O XML do InDesign não possui a raiz <Norma>.')
  }
  return Array.from(xml.documentElement.children).map((elemento, indice) => ({
    indice,
    tag: nomeLocal(elemento),
    texto: elemento.textContent || '',
  }))
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
export function compararXmlInDesign(editorDoc, xmlText) {
  const normando = blocosDoEditor(editorDoc)
  const indesign = blocosDoXml(xmlText)
  const m = normando.length
  const n = indesign.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = blocosIguais(normando[i - 1], indesign[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

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
