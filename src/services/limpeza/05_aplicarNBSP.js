/**
 * Etapa 5 — Espaços não-separáveis (NBSP)
 * Aplicados POR ÚLTIMO, depois de toda normalização.
 * Equivalente às operações finais de safeGrep do script JSX.
 */
const NBSP = ' '

const REGRAS = [
  [/§ /g,                              `§${NBSP}`],
  [/\bart\. (\d)/g,                    `art.${NBSP}$1`],
  [/\barts\. (\d)/g,                   `arts.${NBSP}$1`],
  [/\bArt\. (\d)/g,                    `Art.${NBSP}$1`],
  [/\bArts\. (\d)/g,                   `Arts.${NBSP}$1`],
  [/\binciso ([IVXLCDM])/g,            `inciso${NBSP}$1`],
  [/\balínea ([a-záéíóúâêôîûàèìòùãõç])/g, `alínea${NBSP}$1`],
  [/\bnºs (\d)/g,                      `nºs${NBSP}$1`],
  [/\bnº (\d)/g,                       `nº${NBSP}$1`],
  [/\bn\. (\d)/g,                      `n.${NBSP}$1`],
  [/(\d) \(/g,                         `$1${NBSP}(`],
]

export { REGRAS as NBSP_REGRAS }

function normalizarTexto(texto) {
  return REGRAS
    .reduce((t, [pattern, repl]) => t.replace(pattern, repl), texto ?? '')
    .replace(/[  ]+$/g, '')
}

function textoDoContent(content) {
  return (content ?? []).map(node => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    return ''
  }).join('')
}

// As regras de NBSP apenas substituem caracteres ou removem espaços finais.
// Assim podemos redistribuir o texto normalizado preservando as marks originais.
function normalizarContent(content) {
  if (!content?.length) return content

  const original = textoDoContent(content)
  const normalizado = normalizarTexto(original)
  if (normalizado === original) return content

  let cursor = 0
  const resultado = []

  for (const node of content) {
    if (node.type === 'hardBreak') {
      if (cursor < normalizado.length && normalizado[cursor] === '\n') {
        resultado.push(node)
        cursor++
      }
      continue
    }
    if (node.type !== 'text') {
      resultado.push(node)
      continue
    }

    const trecho = normalizado.slice(cursor, cursor + node.text.length)
    cursor += node.text.length
    if (trecho) resultado.push({ ...node, text: trecho })
  }

  if (cursor < normalizado.length) {
    resultado.push({ type: 'text', text: normalizado.slice(cursor) })
  }

  return resultado
}

export function aplicarNBSP(linhas) {
  return {
    output: linhas.map(linha => {
      if (linha.isTable) return linha
      const text = normalizarTexto(linha.text)
      const content = normalizarContent(linha.content)
      return {
        ...linha,
        text,
        ...(content ? { content } : {}),
      }
    }),
    log: ['NBSP aplicados em: §, art., inciso, alínea, nº, número+('],
  }
}
