/**
 * Etapa 6 — Detecção de exceções
 * Gera a lista de problemas que o usuário precisa revisar manualmente.
 */

function nomeMarca(marca) {
  return typeof marca?.type === 'string' ? marca.type : marca?.type?.name
}

function temMarca(node, nome) {
  return (node?.marks ?? []).some(marca => nomeMarca(marca) === nome)
}

const RE_TERMO_ITALICO_OBRIGATORIO = /\b(?:Diário|[Cc]aput|DOU)\b/
const RE_NOTA_PARENTETICA_INICIAL = /^\((?:Vide|Revogad[oa]|Incluíd[oa]|Incluid[oa]|Acrescid[oa]|Renumerad[oa]|Redação dada|Com redação|Vigência|(?:Artigo|Inciso|Alínea|Alinea|Item|Parágrafo|Paragrafo)\s+(?:revogad[oa]|incluíd[oa]|incluid[oa]|acrescid[oa]|renumerad[oa]))/i
const ESTILOS_ENUMERACAO = new Set(['inciso', 'alinea', 'item'])
const NIVEL_ENUMERACAO = { inciso: 1, alinea: 2, item: 3 }
const ESTILOS_FECHAM_ENUMERACAO = new Set([
  'paragrafo',
  'artigo',
  'parte-livro-tit-cap',
  'secao-subsecao',
])

function alvoRegex(texto, regex) {
  const match = String(texto || '').match(regex)
  if (!match || match.index == null) return null
  return {
    inicio: match.index,
    fim: match.index + match[0].length,
    texto: match[0],
  }
}

function alvoTextoInteiro(texto) {
  const valor = String(texto || '')
  return {
    inicio: 0,
    fim: valor.length,
    texto: valor,
  }
}

function temTermoSemItalico(linha) {
  if (!linha.content?.length) {
    return RE_TERMO_ITALICO_OBRIGATORIO.test(linha.text || '')
  }

  return linha.content.some(node =>
    node?.type === 'text' &&
    RE_TERMO_ITALICO_OBRIGATORIO.test(node.text || '') &&
    !temMarca(node, 'italic') &&
    !temMarca(node, 'italicoLight')
  )
}

function temMarcaNota(node) {
  return node?.type === 'text' && (node.marks ?? []).some(marca => {
    const nome = nomeMarca(marca)
    return nome === 'nota' || nome === 'notaRodape' || nome === 'notaSobrescrito'
  })
}

function temBoldArtigo(linha) {
  if (!linha.content?.length) return linha.style === 'artigo'
  return linha.content.some(node =>
    node?.type === 'text' &&
    /^Arts?\.?/i.test(node.text || '') &&
    temMarca(node, 'boldArtigo')
  )
}

function textoSemNotas(linha) {
  if (!linha.content?.length) return linha.text ?? ''
  return linha.content
    .map(node => {
      if (node?.type !== 'text') return ''
      return temMarcaNota(node) ? '' : node.text ?? ''
    })
    .join('')
}

function linhaEnumeracaoSemTextoPrincipal(linha) {
  if (!ESTILOS_ENUMERACAO.has(linha?.style)) return false
  const texto = textoSemNotas(linha).trim()
  if (!texto) return true
  if (linha.style === 'inciso') {
    const resto = texto.replace(/^[IVXLCDM]+(?:-[A-Z])?\s*[–—-]\.?\s*/i, '')
    return resto !== texto && (!resto.trim() || RE_NOTA_PARENTETICA_INICIAL.test(resto.trim()))
  }
  if (linha.style === 'alinea') {
    const resto = texto.replace(/^[a-zà-ÿ]\)\s*/i, '')
    return resto !== texto && (!resto.trim() || RE_NOTA_PARENTETICA_INICIAL.test(resto.trim()))
  }
  if (linha.style === 'item') {
    const resto = texto.replace(/^\d+[.)]?\s*/, '')
    return resto !== texto && (!resto.trim() || RE_NOTA_PARENTETICA_INICIAL.test(resto.trim()))
  }
  return false
}

function textoPrincipalEnumeracao(linha) {
  return textoSemNotas(linha).replace(/[ \u00a0]+$/g, '')
}

function textoDepoisDoRotuloEnumeracao(linha) {
  const texto = textoPrincipalEnumeracao(linha).trim()
  return removerRotuloEnumeracao(linha, texto)
}

function textoCompletoDepoisDoRotuloEnumeracao(linha) {
  const texto = String(linha?.text || '').trim()
  return removerRotuloEnumeracao(linha, texto)
}

function removerRotuloEnumeracao(linha, texto) {
  if (linha?.style === 'inciso') {
    return texto.replace(/^[IVXLCDM]+(?:-[A-Z])?\s*[–—-]\.?\s*/i, '').trim()
  }
  if (linha?.style === 'alinea') {
    return texto.replace(/^[a-zà-ÿ]\)\s*/i, '').trim()
  }
  if (linha?.style === 'item') {
    return texto.replace(/^\d+[.)]?\s*/, '').trim()
  }
  return texto
}

function ultimoCharPrincipal(linha) {
  const texto = textoPrincipalEnumeracao(linha)
  return texto ? texto.charAt(texto.length - 1) : ''
}

function alvoPontuacaoEnumeracao(linha) {
  const principal = textoPrincipalEnumeracao(linha)
  if (!principal) return alvoTextoInteiro(linha.text)

  const texto = String(linha.text || '')
  const pos = texto.lastIndexOf(principal)
  const inicio = pos >= 0 ? pos + principal.length - 1 : Math.max(0, texto.length - 1)
  return {
    inicio,
    fim: inicio + 1,
    texto: texto.charAt(inicio) || principal.charAt(principal.length - 1),
  }
}

function proximoSignificativo(linhas, inicio) {
  for (let i = inicio; i < linhas.length; i++) {
    if (linhas[i]?.style !== 'vazio') return i
  }
  return -1
}

function incisoSeguinteSoNotaRevogadoOuVetado(linhas, indiceInciso) {
  const inciso = linhas[indiceInciso]
  if (inciso?.style !== 'inciso') return false

  const textoInciso = textoCompletoDepoisDoRotuloEnumeracao(inciso)
  if (!/^\((?:Vetado|Revogado)/i.test(textoInciso)) return false

  const depoisDoInciso = proximoSignificativo(linhas, indiceInciso + 1)
  return depoisDoInciso >= 0 && ESTILOS_FECHAM_ENUMERACAO.has(linhas[depoisDoInciso]?.style)
}

function pontuacaoEsperadaUltimoEnumeracao(linhas, estilo, indiceSeguinte) {
  if (estilo !== 'alinea' && estilo !== 'item') return 'ponto'
  if (indiceSeguinte < 0) return 'ponto'

  const estiloSeguinte = linhas[indiceSeguinte]?.style
  if (ESTILOS_FECHAM_ENUMERACAO.has(estiloSeguinte)) return 'ponto'
  if (estiloSeguinte === 'inciso' && incisoSeguinteSoNotaRevogadoOuVetado(linhas, indiceSeguinte)) {
    return 'ponto'
  }

  return 'ponto-e-virgula'
}

function numeroArtigoParaInteiro(valor) {
  return parseInt(String(valor || '').replace(/\./g, ''), 10)
}

function formatarNumeroArtigo(numero) {
  return String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function infoArtigo(linha, index) {
  if (linha?.style !== 'artigo' || !temBoldArtigo(linha)) return null

  const texto = String(linha.text || '').replace(/\u00a0/g, ' ')
  const match = texto.match(/^Arts?\.?\s+(\d+(?:\.\d{3})*)(?:[ºª°])?(?:-[A-Z])?\.?(?:\s+a\s+(\d+(?:\.\d{3})*)(?:[ºª°])?)?/i)
  if (!match) return null

  const inicio = numeroArtigoParaInteiro(match[1])
  const fim = match[2] ? numeroArtigoParaInteiro(match[2]) : inicio
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null

  return {
    index,
    inicio: Math.min(inicio, fim),
    fim: Math.max(inicio, fim),
    rotulo: match[0],
    linha,
  }
}

function alvoRotuloArtigo(linha) {
  return alvoRegex(linha.text, /^Arts?\.?\s+\d+(?:\.\d{3})*(?:[ºª°])?(?:-[A-Z])?\.?(?:\s+a\s+\d+(?:\.\d{3})*(?:[ºª°])?)?/i) || alvoTextoInteiro(linha.text)
}

const PADROES = [
  {
    tipo: 'ordinal_antigo',
    descricao: 'Ordinal na grafia antiga (1o, 2a) — use 1º, 2ª',
    test: l => /\b\d+[oa]\b/.test(l.text),
    alvo: l => alvoRegex(l.text, /\b\d+[oa]\b/),
    estilosExcluidos: ['assinatura-nome', 'assinatura-data', 'assinatura', 'data'],
  },
  {
    tipo: 'traco_simples_inciso',
    descricao: 'Traço simples (-) em inciso — use travessão (–)',
    test: l => l.style === 'inciso' && /^[IVXLCDM]+(?:-[A-Z])? - /.test(l.text),
    alvo: l => alvoRegex(l.text, / - /),
  },
  {
    tipo: 'inciso_sem_espaco_antes_traco',
    descricao: 'Inciso sem espaço entre o rótulo e o traço',
    test: l => l.style === 'inciso' && /^[IVXLCDM]+(?:-[A-Z])?[–—-](?![A-Z])/i.test(l.text),
    alvo: l => alvoRegex(l.text, /^[IVXLCDM]+(?:-[A-Z])?[–—-]/i),
  },
  {
    tipo: 'inciso_sem_travessao',
    descricao: 'Inciso sem travessão (–) após o rótulo',
    test: l => {
      if (l.style !== 'inciso') return false
      if (!/^[IVXLCDM]+(?:-[A-Z])?(?:\s|\u00a0|[.)])/i.test(l.text)) return false
      return !/^[IVXLCDM]+(?:-[A-Z])?\s*[–—-]/i.test(l.text)
    },
    alvo: l => alvoRegex(l.text, /^[IVXLCDM]+(?:-[A-Z])?/i),
  },
  {
    // Artigos 1–9 devem ter º logo após o número (ex: "Art. 5º")
    // O número é capturado com separador de milhar opcional (ex: "1.001")
    // para que artigos ≥ 1000 não disparem esta regra.
    tipo: 'artigo_sem_grau',
    descricao: 'Artigo de 1 a 9 sem símbolo de grau (º)',
    test: l => {
      if (l.style !== 'artigo') return false
      const m = l.text.match(/^Arts?\.\s+(\d+(?:\.\d{3})*)/)
      if (!m) return false
      if (parseInt(m[1].replace(/\./g, '')) > 9) return false
      // O caractere imediatamente após os dígitos deve ser º ou °
      const seg = l.text[m[0].length] ?? ''
      return !/[º°]/.test(seg)
    },
    alvo: l => alvoRegex(l.text, /^Arts?\.\s+\d+(?:\.\d{3})*/),
  },
  {
    // Artigos 10+ não têm º, mas devem ter ponto após o número (ex: "Art. 169. texto")
    // Arts. (plural/faixa) são ignorados pois têm formato diferente ("Arts. 10 a 15.")
    // O número é capturado com separador de milhar opcional (ex: "1.001").
    tipo: 'artigo_sem_ponto',
    descricao: 'Artigo sem ponto após o identificador',
    test: l => {
      if (l.style !== 'artigo') return false
      if (/^Arts?\./.test(l.text) && /\ba\s+\d/.test(l.text)) return false  // faixa "Arts. X a Y"
      const m = l.text.match(/^Art\.\s+(\d+(?:\.\d{3})*)/)
      if (!m) return false
      if (parseInt(m[1].replace(/\./g, '')) < 10) return false
      // O caractere imediatamente após os dígitos deve ser ponto ou hífen (sufixo "10-A")
      const seg = l.text[m[0].length] ?? ''
      return seg !== '.' && seg !== '-'
    },
    alvo: l => alvoRegex(l.text, /^Art\.\s+\d+(?:\.\d{3})*/),
  },
  {
    tipo: 'paragrafo_sem_espaco_apos_simbolo',
    descricao: 'Parágrafo sem espaço entre § e o número',
    test: l => l.style === 'paragrafo' && /^§{1,2}\d/.test(l.text),
    alvo: l => alvoRegex(l.text, /^§{1,2}\d+/),
  },
  {
    // Parágrafos §1–§9 devem ter º logo após o número (ex: "§ 5º")
    tipo: 'paragrafo_sem_grau',
    descricao: 'Parágrafo de § 1 a § 9 sem símbolo de grau (º)',
    test: l => {
      if (l.style !== 'paragrafo') return false
      const m = l.text.match(/^§{1,2}\s*(\d+)/)
      if (!m) return false
      if (parseInt(m[1]) > 9) return false
      const seg = l.text[m[0].length] ?? ''
      return !/[º°]/.test(seg)
    },
    alvo: l => alvoRegex(l.text, /^§{1,2}\s*\d+/),
  },
  {
    // Parágrafos §10+ não têm º, mas devem ter ponto após o número (ex: "§ 10. texto")
    tipo: 'paragrafo_sem_ponto',
    descricao: 'Parágrafo sem ponto após o identificador (ex: § 10. texto)',
    test: l => {
      if (l.style !== 'paragrafo') return false
      const m = l.text.match(/^§{1,2}\s*(\d+)/)
      if (!m) return false
      if (parseInt(m[1]) < 10) return false
      const seg = l.text[m[0].length] ?? ''
      return seg !== '.' && seg !== '-'
    },
    alvo: l => alvoRegex(l.text, /^§{1,2}\s*\d+/),
  },
  {
    tipo: 'alinea_sem_parentese',
    descricao: 'Possível alínea sem fechamento de parêntese',
    test: l => /^[a-z]\s+[^)]/.test(l.text) && l.style === 'texto-lei',
    alvo: l => alvoRegex(l.text, /^[a-z]/),
  },
  {
    tipo: 'parenteses_desbalanceados',
    descricao: 'Parênteses não balanceados',
    test: l => {
      // Remove o rótulo de alínea ("a) ") ou item ("1) ") antes de contar,
      // pois o ")" do rótulo não tem "(" correspondente no mesmo parágrafo.
      // A remoção é feita pelo padrão do texto (não pelo style), porque a linha
      // pode estar classificada como 'texto-lei' mesmo tendo formato de alínea.
      let texto = l.text
      if (/^[A-Za-záéíóúâêôîûàèìòùãõçÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ]+\)/.test(texto)) {
        texto = texto.replace(/^[A-Za-záéíóúâêôîûàèìòùãõçÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ]+\)\s*/, '')
      } else if (/^\d+\)/.test(texto)) {
        texto = texto.replace(/^\d+\)\s*/, '')
      }
      const a = (texto.match(/\(/g) || []).length
      const f = (texto.match(/\)/g) || []).length
      return a !== f
    },
    alvo: l => alvoRegex(l.text, /\(|\)/) || alvoTextoInteiro(l.text),
    estilosExcluidos: ['vazio'],
  },
  {
    tipo: 'texto_colado_parentese',
    descricao: 'Texto colado após parêntese de fechamento',
    test: l => /\)(?=[A-Za-zÀ-ÿ0-9§])/.test(l.text),
    alvo: l => alvoRegex(l.text, /\)(?=[A-Za-zÀ-ÿ0-9§])/),
    estilosExcluidos: ['vazio'],
  },
  {
    tipo: 'linha_nao_classificada',
    descricao: 'Linha toda em maiúsculas não reconhecida como título',
    test: l => l.style === 'texto-lei' && /^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ\s\-]{15,}$/.test(l.text),
    alvo: l => alvoTextoInteiro(l.text),
  },
  {
    // Caractere inicial inesperado — possível artefato de conversão (ex.: ¬, •, →)
    // Caracteres legítimos no início: letras (incl. acentuadas), dígitos, §, (, ", ', «, [
    // Linhas de citação são excluídas: o texto original pode iniciar com aspas
    // que já foram removidas pela rotina de citações antes desta verificação.
    tipo: 'inicio_nao_alfanumerico',
    descricao: 'Parágrafo inicia com caractere inesperado (possível artefato de conversão)',
    test: l => {
      const first = l.text[0]
      return !!first && !/[a-záéíóúâêôîûàèìòùãõçA-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ0-9§("'«\[]/.test(first)
    },
    alvo: l => l.text ? { inicio: 0, fim: 1, texto: l.text[0] } : null,
    estilosExcluidos: ['vazio', 'citacao'],
  },
  {
    tipo: 'termo_sem_italico',
    descricao: 'Diário, Caput, caput ou DOU sem itálico',
    test: temTermoSemItalico,
    alvo: l => alvoRegex(l.text, RE_TERMO_ITALICO_OBRIGATORIO),
  },
  {
    // Parágrafo com texto livre que não foi reconhecido como nenhuma estrutura
    // legislativa (artigo, parágrafo, inciso, alínea, item, citação etc.).
    // Indica conteúdo inserido manualmente ou erro de classificação.
    // Exceção: "Pena –" é uma cláusula penal válida em legislação criminal.
    tipo: 'estrutura_nao_identificada',
    descricao: 'Estrutura não identificada — verificar estilo da linha',
    test: l => l.style === 'texto-lei' && !/^Pena\s–/.test(l.text),
    alvo: l => alvoTextoInteiro(l.text),
    estilosExcluidos: ['vazio'],
  },
]

function criarExcecaoPontuacaoEnumeracao(linha, indice, tipo, descricao) {
  const alvo = alvoPontuacaoEnumeracao(linha)
  return {
    linha: indice + 1,
    tipo,
    descricao,
    texto: linha.text.slice(0, 80),
    alvoTexto: alvo?.texto ?? linha.text.slice(0, 80),
    alvoInicio: alvo?.inicio ?? 0,
    alvoFim: alvo?.fim ?? Math.min(linha.text.length, 80),
    style: linha.style,
    resolvida: false,
  }
}

function adicionarExcecoesPontuacaoEnumeracoes(linhas, excecoes) {
  let i = 0

  while (i < linhas.length) {
    const estilo = linhas[i]?.style
    if (!ESTILOS_ENUMERACAO.has(estilo)) {
      i++
      continue
    }

    const grupo = [i]
    let cursor = i + 1

    while (true) {
      const proximo = proximoSignificativo(linhas, cursor)
      if (proximo < 0 || linhas[proximo]?.style !== estilo) break
      grupo.push(proximo)
      cursor = proximo + 1
    }

    const grupoComTexto = grupo.filter(indice => !linhaEnumeracaoSemTextoPrincipal(linhas[indice]))

    if (grupoComTexto.length < 2) {
      i = Math.max(i + 1, cursor)
      continue
    }

    const depoisDoGrupo = proximoSignificativo(linhas, cursor)
    const estiloSeguinte = depoisDoGrupo >= 0 ? linhas[depoisDoGrupo]?.style : null
    const ultimoIntroduzSublista =
      ESTILOS_ENUMERACAO.has(estiloSeguinte) &&
      NIVEL_ENUMERACAO[estiloSeguinte] > NIVEL_ENUMERACAO[estilo]
    const pontuacaoEsperadaUltimo = pontuacaoEsperadaUltimoEnumeracao(linhas, estilo, depoisDoGrupo)

    for (let g = 0; g < grupoComTexto.length; g++) {
      const indice = grupoComTexto[g]
      const linha = linhas[indice]

      const ultimo = g === grupoComTexto.length - 1
      if (ultimo && ultimoIntroduzSublista) continue

      const final = ultimoCharPrincipal(linha)
      if (!ultimo && final === '.') {
        excecoes.push(criarExcecaoPontuacaoEnumeracao(
          linha,
          indice,
          'enumeracao_intermediaria_com_ponto',
          'Elemento intermediário de enumeração termina com ponto final',
        ))
      }

      if (ultimo && pontuacaoEsperadaUltimo === 'ponto' && final !== '.' && final !== ':') {
        excecoes.push(criarExcecaoPontuacaoEnumeracao(
          linha,
          indice,
          'enumeracao_final_sem_ponto',
          'Último elemento de enumeração deve terminar com ponto final',
        ))
      }

      if (ultimo && pontuacaoEsperadaUltimo === 'ponto-e-virgula' && final !== ';') {
        excecoes.push(criarExcecaoPontuacaoEnumeracao(
          linha,
          indice,
          'enumeracao_final_sem_ponto_e_virgula',
          'Último elemento desta enumeração deve terminar com ponto e vírgula',
        ))
      }
    }

    i = Math.max(i + 1, cursor)
  }
}

function adicionarExcecoesArtigosFaltantes(linhas, excecoes) {
  const artigos = (linhas || [])
    .map((linha, index) => infoArtigo(linha, index))
    .filter(Boolean)
    .sort((a, b) => a.inicio - b.inicio || a.fim - b.fim || a.index - b.index)

  if (artigos.length < 2) return

  const primeiro = artigos[0].inicio
  const ultimo = artigos.reduce((max, art) => Math.max(max, art.fim), artigos[0].fim)
  const cobertos = new Set()

  for (const art of artigos) {
    for (let numero = art.inicio; numero <= art.fim; numero++) {
      cobertos.add(numero)
    }
  }

  let artigoAnterior = artigos[0]
  let artCursor = 0

  for (let numero = primeiro; numero <= ultimo; numero++) {
    while (artCursor < artigos.length && artigos[artCursor].fim < numero) {
      artigoAnterior = artigos[artCursor]
      artCursor++
    }

    if (cobertos.has(numero)) continue

    const alvo = alvoRotuloArtigo(artigoAnterior.linha)
    excecoes.push({
      linha: artigoAnterior.index + 1,
      tipo: 'artigo_nao_encontrado',
      descricao: `Artigo ${formatarNumeroArtigo(numero)} não encontrado`,
      texto: artigoAnterior.linha.text.slice(0, 80),
      alvoTexto: alvo?.texto ?? artigoAnterior.linha.text.slice(0, 80),
      alvoInicio: alvo?.inicio ?? 0,
      alvoFim: alvo?.fim ?? Math.min(artigoAnterior.linha.text.length, 80),
      style: artigoAnterior.linha.style,
      resolvida: false,
    })
  }
}

export function detectarExcecoes(linhas) {
  const excecoes = []

  linhas.forEach((linha, i) => {
    if (!linha.text.trim() || linha.style === 'vazio') return

    for (const padrao of PADROES) {
      if (padrao.estilosExcluidos?.includes(linha.style)) continue
      if (padrao.test(linha)) {
        const alvo = padrao.alvo?.(linha)
        excecoes.push({
          linha: i + 1,
          tipo: padrao.tipo,
          descricao: padrao.descricao,
          texto: linha.text.slice(0, 80),
          alvoTexto: alvo?.texto ?? linha.text.slice(0, 80),
          alvoInicio: alvo?.inicio ?? 0,
          alvoFim: alvo?.fim ?? Math.min(linha.text.length, 80),
          style: linha.style,
          resolvida: false,
        })
      }
    }
  })

  adicionarExcecoesPontuacaoEnumeracoes(linhas, excecoes)
  adicionarExcecoesArtigosFaltantes(linhas, excecoes)

  return {
    excecoes,
    log: [`${excecoes.length} exceção(ões) detectada(s)`],
  }
}
