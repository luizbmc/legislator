const ESTILOS_ENUMERACAO = new Set(['inciso', 'alinea', 'item'])
const NIVEL_ENUMERACAO = { inciso: 1, alinea: 2, item: 3 }
const RE_ESPACO_FINAL = /[ \u00a0]*$/

function temMarcaNota(node) {
  return node?.type === 'text' && (node.marks ?? []).some(
    marca => marca.type === 'nota' || marca.type === 'notaRodape'
  )
}

function corrigirTextoFinal(texto, pontuacao) {
  if (!texto) return { texto, alterado: false }

  const espacos = texto.match(RE_ESPACO_FINAL)?.[0] ?? ''
  const principal = texto.slice(0, texto.length - espacos.length)
  if (!principal) return { texto, alterado: false }

  const ultimo = principal.slice(-1)

  // Dois-pontos normalmente introduzem uma enumeracao subordinada.
  // Interrogacao e exclamacao tambem devem ser preservadas.
  if (ultimo === ':' || ultimo === '?' || ultimo === '!') {
    return { texto, alterado: false }
  }

  const novoPrincipal = /[.;,]$/.test(principal)
    ? principal.slice(0, -1) + pontuacao
    : principal + pontuacao

  const novoTexto = novoPrincipal + espacos
  return { texto: novoTexto, alterado: novoTexto !== texto }
}

function corrigirContent(content, pontuacao) {
  if (!content?.length) return { content, alterado: false }

  const novoContent = [...content]

  for (let i = novoContent.length - 1; i >= 0; i--) {
    const node = novoContent[i]
    if (node?.type !== 'text' || !node.text) continue
    if (temMarcaNota(node) || !node.text.trim()) continue

    const corrigido = corrigirTextoFinal(node.text, pontuacao)
    if (!corrigido.alterado) return { content, alterado: false }

    novoContent[i] = { ...node, text: corrigido.texto }
    return { content: novoContent, alterado: true }
  }

  return { content, alterado: false }
}

function textoDoContent(content) {
  return (content ?? []).map(node => node?.type === 'text' ? node.text ?? '' : '').join('')
}

function textoSemNotas(content) {
  return (content ?? [])
    .map(node => {
      if (node?.type !== 'text') return ''
      return temMarcaNota(node) ? '' : node.text ?? ''
    })
    .join('')
}

function linhaEnumeracaoSemTextoPrincipal(linha) {
  if (!ESTILOS_ENUMERACAO.has(linha?.style) || !linha.content?.length) return false
  const texto = textoSemNotas(linha.content).trim()
  if (!texto) return true
  if (linha.style === 'inciso') return /^[IVXLCDM]+(?:-[A-Z])?\s*[–—-]\.?\s*$/i.test(texto)
  if (linha.style === 'alinea') return /^[a-zà-ÿ]\)\s*$/i.test(texto)
  if (linha.style === 'item') return /^\d+[.)]?\s*$/i.test(texto)
  return false
}

function limparPontuacaoMarcadorVazio(linha) {
  if (!linhaEnumeracaoSemTextoPrincipal(linha)) return linha
  if (linha.style !== 'inciso' || !linha.content?.length) return linha

  let alterado = false
  const content = linha.content.map(node => {
    if (node?.type !== 'text' || temMarcaNota(node)) return node
    const texto = node.text.replace(/([IVXLCDM]+(?:-[A-Z])?\s*[–—-])\.\s*$/i, '$1')
    if (texto !== node.text) alterado = true
    return texto !== node.text ? { ...node, text: texto } : node
  })

  return alterado
    ? { ...linha, content, text: textoDoContent(content) }
    : linha
}

function corrigirLinha(linha, pontuacao) {
  if (linhaEnumeracaoSemTextoPrincipal(linha)) return limparPontuacaoMarcadorVazio(linha)

  if (linha.content?.length) {
    const corrigido = corrigirContent(linha.content, pontuacao)
    if (!corrigido.alterado) return linha
    return {
      ...linha,
      content: corrigido.content,
      text: textoDoContent(corrigido.content),
    }
  }

  const corrigido = corrigirTextoFinal(linha.text ?? '', pontuacao)
  return corrigido.alterado ? { ...linha, text: corrigido.texto } : linha
}

function proximoSignificativo(linhas, inicio) {
  for (let i = inicio; i < linhas.length; i++) {
    if (linhas[i]?.style !== 'vazio') return i
  }
  return -1
}

function marcadorTratado(linha) {
  if (linha?.style !== 'corpo-tratado') return null
  const texto = String(linha.text || '').trimStart()

  const numero = /^(\d+)\.\s/.exec(texto)
  if (numero) return { familia: 'numero', nivel: 0, corrigivel: false, token: numero[1] }

  const parenteses = /^([A-Za-z]+)\)\s/.exec(texto)
  if (!parenteses) return null

  const token = parenteses[1]
  if (/^[IVXLCDM]+$/.test(token)) {
    return { familia: 'romano-maiusculo', nivel: 2, corrigivel: true, token }
  }
  if (/^[ivxlcdm]{2,}$/.test(token)) {
    return { familia: 'romano-minusculo', nivel: 2, corrigivel: true, token }
  }
  if (/^[a-z]$/.test(token)) {
    return { familia: 'letra-minuscula', nivel: 1, corrigivel: true, token }
  }
  if (/^[A-Z]$/.test(token)) {
    return { familia: 'letra-maiuscula', nivel: 1, corrigivel: true, token }
  }

  return null
}

function corrigirPontuacaoTratado(linhas) {
  const output = [...linhas]
  const marcadores = output.map(marcadorTratado)
  const processados = new Set()
  let total = 0

  // "i)" e ambiguo: quando seguido por "ii)", trata-se de romano minusculo.
  for (let i = 0; i < marcadores.length; i++) {
    if (marcadores[i]?.familia !== 'letra-minuscula' || marcadores[i].token !== 'i') continue
    const proximo = proximoSignificativo(output, i + 1)
    if (proximo >= 0 && marcadores[proximo]?.familia === 'romano-minusculo') {
      marcadores[i] = { ...marcadores[i], familia: 'romano-minusculo', nivel: 2 }
    }
  }

  for (let i = 0; i < output.length; i++) {
    const marcador = marcadores[i]
    if (!marcador?.corrigivel || processados.has(i)) continue

    const grupo = [i]
    let cursor = i + 1

    while (true) {
      const proximo = proximoSignificativo(output, cursor)
      if (proximo < 0) break
      const seguinte = marcadores[proximo]

      if (!seguinte || !seguinte.corrigivel || seguinte.nivel < marcador.nivel) break
      if (seguinte.familia === marcador.familia && seguinte.nivel === marcador.nivel) {
        grupo.push(proximo)
      }
      cursor = proximo + 1
    }

    // Uma ocorrencia isolada nao fornece contexto suficiente para correcao segura.
    if (grupo.length < 2) continue

    for (let g = 0; g < grupo.length - 1; g++) {
      const indice = grupo[g]
      const corrigida = corrigirLinha(output[indice], ';')
      if (corrigida !== output[indice]) {
        output[indice] = corrigida
        total++
      }
      processados.add(indice)
    }

    const ultimo = grupo[grupo.length - 1]
    const proximoDoUltimo = proximoSignificativo(output, ultimo + 1)
    const marcadorSeguinte = proximoDoUltimo >= 0 ? marcadores[proximoDoUltimo] : null

    // So fecha com ponto quando a lista termina claramente. Se outra enumeracao
    // vier logo abaixo, preserva a pontuacao porque a hierarquia pode ser aninhada.
    if (proximoDoUltimo < 0 || !marcadorSeguinte || marcadorSeguinte.familia === 'numero') {
      const corrigida = corrigirLinha(output[ultimo], '.')
      if (corrigida !== output[ultimo]) {
        output[ultimo] = corrigida
        total++
      }
    }
    processados.add(ultimo)
  }

  return {
    output,
    log: total ? [`${total} ${total === 1 ? 'enumeração' : 'enumerações'} de tratado com pontuação final corrigida`] : [],
  }
}

/**
 * Normaliza a pontuacao de sequencias de incisos, alineas e itens:
 * intermediarios terminam com ponto e virgula; o ultimo termina com ponto.
 *
 * Quando o ultimo elemento introduz uma enumeracao subordinada logo abaixo,
 * sua pontuacao e preservada.
 */
export function corrigirPontuacaoEnumeracoes(linhas) {
  const output = [...(linhas ?? [])]
  const log = []
  const contadores = { inciso: 0, alinea: 0, item: 0 }
  let i = 0

  while (i < output.length) {
    const estilo = output[i]?.style
    if (!ESTILOS_ENUMERACAO.has(estilo)) {
      i++
      continue
    }

    const grupo = [i]
    let cursor = i + 1

    while (true) {
      const proximo = proximoSignificativo(output, cursor)
      if (proximo < 0 || output[proximo]?.style !== estilo) break
      grupo.push(proximo)
      cursor = proximo + 1
    }

    const depoisDoGrupo = proximoSignificativo(output, cursor)
    const estiloSeguinte = depoisDoGrupo >= 0 ? output[depoisDoGrupo]?.style : null
    const ultimoIntroduzSublista =
      ESTILOS_ENUMERACAO.has(estiloSeguinte) &&
      NIVEL_ENUMERACAO[estiloSeguinte] > NIVEL_ENUMERACAO[estilo]

    for (let g = 0; g < grupo.length; g++) {
      const ultimo = g === grupo.length - 1
      if (ultimo && ultimoIntroduzSublista) continue

      const indice = grupo[g]
      const pontuacao = ultimo ? '.' : ';'
      const corrigida = corrigirLinha(output[indice], pontuacao)
      if (corrigida !== output[indice]) {
        output[indice] = corrigida
        contadores[estilo]++
      }
    }

    i = Math.max(i + 1, cursor)
  }

  for (const estilo of ['inciso', 'alinea', 'item']) {
    const total = contadores[estilo]
    if (total) {
      log.push(`${total} ${estilo}${total !== 1 ? 's' : ''} com pontuacao final corrigida`)
    }
  }

  const tratado = corrigirPontuacaoTratado(output)
  return { output: tratado.output, log: [...log, ...tratado.log] }
}
