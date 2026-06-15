import { filtrarDocPorModoVadeMecum } from './filtrarModoVadeMecum.js'

const NOTE_MARKS = new Set(['nota', 'notaSobrescrito'])

function clonar(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor))
}

function roleDoNo(no) {
  return no?.attrs?.vmRole || null
}

function noVisivelNoModo(no, modoVadeMecum = false) {
  const role = roleDoNo(no)
  if (role === 'vm' && !modoVadeMecum) return false
  if (role === 'original' && modoVadeMecum) return false
  return true
}

function indicesVisiveis(doc, modoVadeMecum = false) {
  const indices = []
  ;(doc?.content || []).forEach((no, index) => {
    if (noVisivelNoModo(no, modoVadeMecum)) indices.push(index)
  })
  return indices
}

function temMarkNota(no) {
  return no?.type === 'text' && Array.isArray(no.marks) && no.marks.some(mark => NOTE_MARKS.has(mark?.type))
}

function indiceMarkNota(no) {
  return (no?.marks || []).findIndex(mark => mark.type === 'nota')
}

function textoDeNos(nos = []) {
  return nos.map(no => no?.text || '').join('').replace(/\s+/g, ' ').trim()
}

function textNodeEspaco() {
  return { type: 'text', text: ' ' }
}

function dividirRunsNota(content = []) {
  const partes = []
  let runAtual = null

  function fecharRun() {
    if (!runAtual) return
    partes.push(runAtual)
    runAtual = null
  }

  for (const no of content) {
    if (temMarkNota(no)) {
      if (!runAtual) runAtual = { tipo: 'nota', nos: [] }
      runAtual.nos.push(clonar(no))
      continue
    }

    fecharRun()
    partes.push({ tipo: 'normal', no: clonar(no) })
  }

  fecharRun()
  return partes
}

function runsNota(content = []) {
  return dividirRunsNota(content)
    .filter(parte => parte.tipo === 'nota')
    .map(parte => parte.nos)
}

function conteudoSemNotas(content = []) {
  return dividirRunsNota(content)
    .filter(parte => parte.tipo === 'normal')
    .map(parte => parte.no)
}

function aplicarRunsNotaNoConteudo(targetContent = [], sourceRuns = []) {
  const partesTarget = dividirRunsNota(targetContent)
  const resultado = []
  let runIndex = 0

  for (const parte of partesTarget) {
    if (parte.tipo === 'normal') {
      resultado.push(parte.no)
      continue
    }

    const sourceRun = sourceRuns[runIndex++]
    if (sourceRun?.length) resultado.push(...sourceRun.map(clonar))
  }

  while (runIndex < sourceRuns.length) {
    const sourceRun = sourceRuns[runIndex++]
    if (!sourceRun?.length) continue
    if (resultado.length) resultado.push(textNodeEspaco())
    resultado.push(...sourceRun.map(clonar))
  }

  return resultado
}

function markNotaComAttrs(mark, attrsExtras = {}) {
  const attrs = {
    ...(mark.attrs || {}),
    ...attrsExtras,
  }
  Object.keys(attrs).forEach(key => {
    if (attrs[key] == null || attrs[key] === false) delete attrs[key]
  })
  return Object.keys(attrs).length ? { ...mark, attrs } : { type: mark.type }
}

function aplicarAttrsNota(node, attrsExtras) {
  const idx = indiceMarkNota(node)
  if (idx < 0) return node
  const marks = [...(node.marks || [])]
  marks[idx] = markNotaComAttrs(marks[idx], attrsExtras)
  return { ...node, marks }
}

function aplicarRunsVmNoConteudo(targetContent = [], sourceRuns = []) {
  const partesTarget = dividirRunsNota(targetContent)
  const resultado = []
  let runIndex = 0

  for (const parte of partesTarget) {
    if (parte.tipo === 'normal') {
      resultado.push(parte.no)
      continue
    }

    const sourceRun = sourceRuns[runIndex++]
    const textoVm = sourceRun?.length ? textoDeNos(sourceRun) : ''
    parte.nos.forEach((node, idx) => {
      resultado.push(aplicarAttrsNota(node, idx === 0 && textoVm
        ? { vmText: textoVm, vmHidden: null }
        : { vmText: null, vmHidden: true }))
    })
  }

  while (runIndex < sourceRuns.length) {
    const sourceRun = sourceRuns[runIndex++]
    const textoVm = textoDeNos(sourceRun)
    if (!textoVm) continue
    if (resultado.length) resultado.push(textNodeEspaco())
    resultado.push({ type: 'text', text: textoVm, marks: [{ type: 'nota', attrs: { vmText: textoVm } }] })
  }

  return resultado
}

function substituirNotaTitulo(targetNode, sourceNode) {
  const novo = {
    ...clonar(targetNode),
    content: clonar(sourceNode?.content || []),
  }
  return novo
}

function substituirNotasNoBloco(targetNode, sourceNode) {
  if (!targetNode || !sourceNode) {
    return { node: targetNode, notasImportadas: 0, notasRemovidas: 0, alterado: false }
  }

  if (targetNode.type === 'notaTitulo' || sourceNode.type === 'notaTitulo') {
    const notaOrigem = sourceNode.type === 'notaTitulo'
    const notaDestino = targetNode.type === 'notaTitulo'
    if (!notaOrigem && !notaDestino) {
      return { node: targetNode, notasImportadas: 0, notasRemovidas: 0, alterado: false }
    }
    const novo = notaOrigem ? substituirNotaTitulo(targetNode, sourceNode) : { ...clonar(targetNode), content: conteudoSemNotas(targetNode.content || []) }
    const alterado = JSON.stringify(novo) !== JSON.stringify(targetNode)
    return {
      node: novo,
      notasImportadas: notaOrigem ? 1 : 0,
      notasRemovidas: !notaOrigem && notaDestino ? 1 : 0,
      alterado,
    }
  }

  const targetRuns = runsNota(targetNode.content || [])
  const sourceRuns = runsNota(sourceNode.content || [])

  if (!targetRuns.length && !sourceRuns.length) {
    return { node: targetNode, notasImportadas: 0, notasRemovidas: 0, alterado: false }
  }

  const novo = {
    ...clonar(targetNode),
    content: aplicarRunsNotaNoConteudo(targetNode.content || [], sourceRuns),
  }
  const alterado = JSON.stringify(novo) !== JSON.stringify(targetNode)

  return {
    node: novo,
    notasImportadas: sourceRuns.filter(run => textoDeNos(run)).length,
    notasRemovidas: Math.max(0, targetRuns.length - sourceRuns.length),
    alterado,
  }
}

function substituirNotasVmNoBloco(targetNode, sourceNode) {
  if (!targetNode || !sourceNode) {
    return { node: targetNode, notasImportadas: 0, notasRemovidas: 0, alterado: false }
  }

  const targetRuns = runsNota(targetNode.content || [])
  const sourceRuns = runsNota(sourceNode.content || [])
  if (!targetRuns.length && !sourceRuns.length) {
    return { node: targetNode, notasImportadas: 0, notasRemovidas: 0, alterado: false }
  }

  const novo = {
    ...clonar(targetNode),
    content: aplicarRunsVmNoConteudo(targetNode.content || [], sourceRuns),
  }
  const alterado = JSON.stringify(novo) !== JSON.stringify(targetNode)

  return {
    node: novo,
    notasImportadas: sourceRuns.filter(run => textoDeNos(run)).length,
    notasRemovidas: Math.max(0, targetRuns.length - sourceRuns.length),
    alterado,
  }
}

export function importarNotasDaNorma(targetDoc, sourceDoc, opcoes = {}) {
  const modoVadeMecum = !!opcoes.modoVadeMecum
  const targetContent = clonar(targetDoc?.content || [])
  const sourceDocPreparado = modoVadeMecum ? filtrarDocPorModoVadeMecum(sourceDoc, true) : sourceDoc
  const sourceContent = sourceDocPreparado?.content || []
  const targetIndices = indicesVisiveis({ content: targetContent }, false)
  const sourceIndices = indicesVisiveis(sourceDocPreparado, false)

  let notasImportadas = 0
  let notasRemovidas = 0
  let blocosAlterados = 0
  const pares = Math.min(targetIndices.length, sourceIndices.length)

  for (let i = 0; i < pares; i++) {
    const targetIdx = targetIndices[i]
    const sourceIdx = sourceIndices[i]
    const resultado = modoVadeMecum
      ? substituirNotasVmNoBloco(targetContent[targetIdx], sourceContent[sourceIdx])
      : substituirNotasNoBloco(targetContent[targetIdx], sourceContent[sourceIdx])
    targetContent[targetIdx] = resultado.node
    notasImportadas += resultado.notasImportadas
    notasRemovidas += resultado.notasRemovidas
    if (resultado.alterado) blocosAlterados++
  }

  return {
    doc: { ...(targetDoc || { type: 'doc' }), content: targetContent },
    notasImportadas,
    notasRemovidas,
    blocosAlterados,
    blocosComparados: pares,
  }
}
