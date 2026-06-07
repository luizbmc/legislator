// ── Substituição de texto dentro de trechos com a marca "nota" ──────
//
// As notas editoriais costumam ser montadas a partir de vários nós de
// texto (múltiplos hyperlinks unidos por fillNotaGaps, fragmentos com
// itálico/negrito etc.). Uma substituição feita nó-a-nó perde qualquer
// ocorrência cujo trecho atravesse a fronteira entre dois nós — por isso
// "Emenda Constitucional" deixava de ser substituída em vários casos.
//
// Estas funções operam sobre RUNS de nós-texto consecutivos que carregam
// a marca `nota`, concatenando o texto do run, aplicando o regex sobre o
// texto unido e redistribuindo o resultado em nós, preservando as marcas
// originais de cada caractere.

// Regex de "Emenda Constitucional" tolerante a espaços normais e NBSP
// (e múltiplos espaços) entre as duas palavras.
export const RE_EMENDA_CONSTITUCIONAL_NOTA = /\bEmenda[\s ]+Constitucional\b/g

function hasNota(node) {
  return node?.type === 'text' && (node.marks ?? []).some(m => m.type === 'nota')
}

// Chave de comparação de marcas (tipo + atributos) para coalescer nós.
function marksKey(marks) {
  return (marks ?? [])
    .map(m => m.type + (m.attrs ? JSON.stringify(m.attrs) : ''))
    .sort()
    .join('|')
}

// Substitui `re` por `replacement` ao longo de uma sequência de nós que
// (todos) carregam a marca nota, permitindo que o padrão atravesse a
// fronteira entre nós. Devolve { nodes, count }.
function replaceAcrossRun(run, re, replacement) {
  const joined = run.map(n => n.text).join('')
  re.lastIndex = 0
  if (!re.test(joined)) return { nodes: run, count: 0 }

  // Marca de origem de cada caractere do texto unido (referência ao array
  // de marks do nó original — usada para preservar a formatação).
  const charMarks = new Array(joined.length)
  let p = 0
  for (const n of run) {
    for (let k = 0; k < n.text.length; k++) charMarks[p++] = n.marks
  }

  const segs = []
  // Copia o intervalo [start, end) preservando as marcas por caractere,
  // quebrando em segmentos sempre que a marca de origem muda.
  const pushPreserved = (start, end) => {
    let runStart = start
    for (let i = start + 1; i <= end; i++) {
      if (i === end || charMarks[i] !== charMarks[runStart]) {
        segs.push({ text: joined.slice(runStart, i), marks: charMarks[runStart] })
        runStart = i
      }
    }
  }

  re.lastIndex = 0
  let count = 0
  let last = 0
  let m
  while ((m = re.exec(joined)) !== null) {
    count++
    if (m.index > last) pushPreserved(last, m.index)
    // O texto substituído herda as marcas do primeiro caractere do match.
    segs.push({ text: replacement, marks: charMarks[m.index] })
    last = m.index + m[0].length
    if (m[0].length === 0) { re.lastIndex++; if (re.lastIndex > joined.length) break }
  }
  if (last < joined.length) pushPreserved(last, joined.length)

  // Coalesce segmentos adjacentes com as mesmas marcas em nós de texto.
  const nodes = []
  for (const s of segs) {
    if (!s.text) continue
    const prev = nodes[nodes.length - 1]
    if (prev && marksKey(prev.marks) === marksKey(s.marks)) {
      prev.text += s.text
    } else {
      nodes.push({ type: 'text', text: s.text, marks: s.marks })
    }
  }
  return { nodes, count }
}

/**
 * Substitui `re` por `replacement` em todos os trechos com marca nota de
 * um array de nós inline, considerando matches que atravessam nós.
 * @returns {{ content: Array, count: number }}
 */
export function substituirTextoEmNota(content, re, replacement) {
  if (!content?.length) return { content, count: 0 }
  let total = 0
  const out = []
  let i = 0
  while (i < content.length) {
    if (!hasNota(content[i])) { out.push(content[i]); i++; continue }
    // Coleta o run máximo de nós-texto consecutivos com nota.
    let j = i
    while (j < content.length && hasNota(content[j])) j++
    const run = content.slice(i, j)
    const { nodes, count } = replaceAcrossRun(run, re, replacement)
    total += count
    out.push(...nodes)
    i = j
  }
  return { content: total ? out : content, count: total }
}
