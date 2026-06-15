/**
 * Etapa 4 — Operações contextuais
 * Reclassificações que dependem do parágrafo anterior ou seguinte.
 * Só pode rodar depois que TODOS os estilos da etapa 3 estiverem definidos.
 */

// Estilos que permitem que um parágrafo entre parênteses logo abaixo seja nota-titulo.
// Inclui 'nota-titulo' para encadeamento (várias notas consecutivas sob um título).
const ESTILOS_TITULO_OU_SECAO = new Set([
  'parte-livro-tit-cap',
  'secao-subsecao',
  'nota-titulo',
])

// Exclui da detecção de apelido linhas que contenham datas ou palavras-chave de nota.
const RE_APELIDO_EXCL = /Publicad|Aprovad|\d{1,2}\/\d{1,2}\/\d{4}/i
const RE_NOTA_FINAL_NOME_JURIDICO = /\s*\((?:Nome\s+jur[ií]dico|Reda[cç][aã]o|Inclu[ií]d[oa]|Acrescid[oa]|Revogad[oa]|Renumerad[oa]|Com\s+reda[cç][aã]o)[^)]*\)\s*$/i
const RE_PREFIXO_OCULTO_WORD = /^[\u00ac\u00ad\u200b\u200c\u200d\ufeff\u2010\u2011\u2012]+/

function limparPrefixoOcultoWord(text) {
  return String(text || '').replace(RE_PREFIXO_OCULTO_WORD, '')
}

// Retorna o estilo da linha não-vazia mais próxima antes de i.
function estiloAnteriorNaoVazio(linhas, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (linhas[j].style !== 'vazio') return linhas[j].style
  }
  return null
}

function estiloSeguinteNaoVazio(linhas, i) {
  for (let j = i + 1; j < linhas.length; j++) {
    if (linhas[j].style !== 'vazio') return linhas[j].style
  }
  return null
}

function pareceNomeJuridico(text) {
  const s = limparPrefixoOcultoWord(text).trim().replace(RE_NOTA_FINAL_NOME_JURIDICO, '').trim()
  if (!s) return false
  if (s.length > 90) return false
  if (/^[("]/.test(s)) return false
  if (/[.;:]$/.test(s)) return false
  if (/^(Art\.|Arts\.|§|Parágrafo\s+único|[IVXLCDM]+(?:-[A-Z])?\s*[–—-]|[a-záéíóúâêôîûàèìòùãõç]\)|\d+[.)]\s)/i.test(s)) return false
  return /[A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç]/.test(s)
}

export function aplicarContextuais(linhas) {
  const log = []

  for (let i = 0; i < linhas.length; i++) {
    const prev = linhas[i - 1]
    const curr = linhas[i]
    const next = linhas[i + 1]

    // texto-lei entre parênteses logo após epígrafe, sem data nem palavras de nota
    // → epigrafe-apelido  (ex: "(Consolidação das Leis do Trabalho – CLT)")
    if (curr.style === 'texto-lei' &&
        /^\(.*\)\s*$/.test(curr.text.trim()) &&
        estiloAnteriorNaoVazio(linhas, i) === 'epigrafe' &&
        !RE_APELIDO_EXCL.test(curr.text)) {
      curr.style = 'epigrafe-apelido'
      log.push(`Linha ${i + 1}: texto-lei → epigrafe-apelido`)
    }

    // artigo logo após artigo-titulo  →  artigo-pos-titulo
    if (curr.style === 'artigo' && prev?.style === 'artigo-titulo') {
      curr.style = 'artigo-pos-titulo'
      log.push(`Linha ${i + 1}: artigo → artigo-pos-titulo`)
    }

    // Nome juridico: rubrica curta entre dispositivos, imediatamente antes de dispositivo.
    if (curr.style === 'texto-lei' &&
        pareceNomeJuridico(curr.text) &&
        ['artigo', 'paragrafo', 'inciso', 'alinea'].includes(estiloSeguinteNaoVazio(linhas, i))) {
      curr.style = 'nome-juridico'
      log.push(`Linha ${i + 1}: texto-lei → nome-juridico`)
    }

    // texto-lei entre parênteses logo após título/seção/nota-titulo → nota-titulo
    // Ignora linhas vazias intermediárias ao buscar o estilo anterior.
    if (curr.style === 'texto-lei' &&
        curr.text.trimStart().startsWith('(') &&
        ESTILOS_TITULO_OU_SECAO.has(estiloAnteriorNaoVazio(linhas, i))) {
      curr.style = 'nota-titulo'
      log.push(`Linha ${i + 1}: texto-lei → nota-titulo (nota abaixo de título/seção)`)
    }
  }

  // Promove linhas de texto-lei após data para assinatura.
  let dentroAssinatura = false
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.style === 'data' || l.style === 'assinatura-data') {
      l.style = 'data'
      dentroAssinatura = true
      continue
    }
    if (dentroAssinatura) {
      if (l.style === 'texto-lei' && l.text.trim()) {
        l.style = 'assinatura'
        log.push(`Linha ${i + 1}: texto-lei → assinatura (pós-data)`)
      } else if (['artigo', 'paragrafo', 'inciso', 'parte-livro-tit-cap', 'secao-subsecao', 'ementa', 'epigrafe'].includes(l.style)) {
        dentroAssinatura = false
      }
    }
  }

  return { output: linhas, log }
}
