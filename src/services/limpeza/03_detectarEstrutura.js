/**
 * Etapa 3 — Detecção de estrutura
 * Classifica cada linha em um nó TipTap de acordo com seu conteúdo.
 * Equivalente ao bloco "FORMATA LEGISLAÇÃO" do script JSX.
 *
 * Hierarquia dos estilos:
 *   Nível 1: epigrafe
 *   Nível 2: parte-livro-tit-cap  (Livro, Parte, Título, Capítulo — mesmo peso)
 *   Nível 3: secao-subsecao       (Seção, Subseção — mesmo peso)
 */
import { isTipoTratado } from '../../constants/normas.js'

const RE_PREFIXO_OCULTO_WORD = /^[\u00ac\u00ad\u200b\u200c\u200d\ufeff\u2010\u2011\u2012]+/

function limparPrefixoOcultoWord(line) {
  return String(line || '').replace(RE_PREFIXO_OCULTO_WORD, '')
}

// Regras aplicadas em ordem — a primeira que bater vence
const REGRAS = [
  // ── Nível 1: Epígrafe ──────────────────────────────────────
  {
    style: 'epigrafe',
    test: s => /^(Lei\b|Lei\s+Complementar|Decreto(?:-[Ll]ei)?|Resolução|Emenda\s+Constitucional|Ato\s+da\s+Mesa|Portaria|Instrução\s+Normativa|Estatuto|Código|Tratado)\b.+n[oº°ª]/i.test(s),
  },

  // ── Nível 2: Parte / Livro / Título / Capítulo ─────────────
  {
    style: 'parte-livro-tit-cap',
    test: s => /^(LIVRO|PARTE|SUBTÍTULO|TÍTULO|CAPÍTULO|Livro|Parte|Subtítulo|Título|Capítulo)\b/i.test(s),
    transform: s => s.toUpperCase(),
  },

  // ── Nível 3: Seção / Subseção ──────────────────────────────
  {
    style: 'secao-subsecao',
    test: s => /^(Seção|Subseção|SEÇÃO|SUBSEÇÃO)\b/i.test(s),
  },

  // ── Ementa ─────────────────────────────────────────────────
  {
    style: 'ementa',
    test: s => /^(Dispõe|Disciplina|Estatui|Define|Regula|Estabelece|Cria|Institui|Altera|Revoga|Autoriza|Denomina|Fixa|Aprova|Concede|Proíbe|Veda)\b/i.test(s),
  },

  // ── Abertura de lei (sem recuo) ────────────────────────────
  {
    style: 'paragrafo-abertura',
    test: s => /^(Faço\s+saber|O\s+Presidente|A\s+Presidente|O\s+Vice-Presidente|O\s+Governador|A\s+Governadora|PRESIDEN|A\s+MESA)/i.test(s),
  },

  // ── Artigo escrito por extenso ─────────────────────────────
  {
    style: 'artigo-titulo',
    test: s => /^(Artigo|ARTIGO)\s+\d+/.test(s),
  },

  // ── Artigo ─────────────────────────────────────────────────
  {
    style: 'artigo',
    test: s => /^Arts?\.?\s*\d/.test(s),
  },

  // ── Parágrafo (§ ou "Parágrafo único") ─────────────────────
  {
    style: 'paragrafo',
    test: s => /^§\s*\d+|^Parágrafo\s+único/i.test(s),
  },

  // ── Inciso (romano, com sufixo opcional -A, + travessão/hífen) ─
  {
    style: 'inciso',
    test: s => /^[IVXLCDM]+(?:-[A-Z])?\s*[–—\-]\s/.test(s),
  },

  // ── Alínea (letra minúscula + parêntese) ───────────────────
  {
    style: 'alinea',
    test: s => /^[a-záéíóúâêôîûàèìòùãõç]\)\s/.test(s),
  },

  // ── Item (número + ponto, parêntese ou travessão/hífen) ──────
  // Ex.: "1. texto", "1) texto" ou "1 – texto" (subitens de alínea)
  {
    style: 'item',
    test: s => /^\d+(?:[.)]\s|\s*[–—-]\s)/.test(s),
  },

  // ── Nota de título (publicação, vigência, redação, aprovação) ──
  {
    style: 'nota-titulo',
    test: s => /^\((Publicad|Aprovad|Vigência|Redação\s+dada|Incluíd|Revogad|NR\b)/i.test(s),
  },

  // ── Data de assinatura ─────────────────────────────────────
  {
    style: 'data',
    test: s => /^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç.' -]+,\s+(?:em\s+)?\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇáéíóúâêôîûàèìòùãõç]+\s+de\s+\d{4}\b/i.test(s),
  },

  // ── Citação (bloco recuado, geralmente precedido por ":") ──
  // Detectado na etapa contextual, não aqui
]

const ESTILOS_MANTIDOS_TRATADO = new Set([
  'epigrafe',
  'ementa',
  'nota-titulo',
  'data',
])

const RE_TITULO_TRATADO =
  /^(?:ARTIGO\s+(?:\d+[A-Z]?|[IVXLCDM]+)\b|PARTE\b|TÍTULO\b|CAPÍTULO\b|SEÇÃO\b|SUBSEÇÃO\b|ANEXO\b|PROTOCOLO\b|PREÂMBULO\b|PREAMBULO\b)/i

function detectarEstruturaTratado(texto) {
  const log = []
  const contadores = {}

  const resultado = texto.split('\n').map(line => {
    const linha = limparPrefixoOcultoWord(line)
    if (!linha.trim()) return { style: 'vazio', text: '', marks: [] }

    if (RE_TITULO_TRATADO.test(linha.trim())) {
      contadores['artigo-titulo'] = (contadores['artigo-titulo'] || 0) + 1
      return { style: 'artigo-titulo', text: linha, marks: [] }
    }

    for (const regra of REGRAS) {
      if (!ESTILOS_MANTIDOS_TRATADO.has(regra.style) || !regra.test(linha)) continue
      const text = regra.transform ? regra.transform(linha) : linha
      contadores[regra.style] = (contadores[regra.style] || 0) + 1
      return { style: regra.style, text, marks: [] }
    }

    contadores['corpo-tratado'] = (contadores['corpo-tratado'] || 0) + 1
    return { style: 'corpo-tratado', text: linha, marks: [] }
  })

  for (const [style, n] of Object.entries(contadores)) {
    log.push(`${n}× ${style}`)
  }

  return { output: resultado, log }
}

export function detectarEstrutura(texto, { tipoNorma = '' } = {}) {
  if (isTipoTratado(tipoNorma)) return detectarEstruturaTratado(texto)

  const log = []
  const linhas = texto.split('\n')
  const contadores = {}

  const resultado = linhas.map((line, i) => {
    const linha = limparPrefixoOcultoWord(line)
    if (!linha.trim()) return { style: 'vazio', text: '', marks: [] }

    for (const regra of REGRAS) {
      if (regra.test(linha)) {
        const text = regra.transform ? regra.transform(linha) : linha
        contadores[regra.style] = (contadores[regra.style] || 0) + 1
        return { style: regra.style, text, marks: [] }
      }
    }

    return { style: 'texto-lei', text: linha, marks: [] }
  })

  // Correção de falso positivo: nó "artigo" cujo texto não começa com "Art" → texto-lei
  resultado.forEach(l => {
    if (l.style === 'artigo' && !/^Arts?\.?/.test(l.text)) {
      l.style = 'texto-lei'
    }
  })

  for (const [style, n] of Object.entries(contadores)) {
    log.push(`${n}× ${style}`)
  }

  return { output: resultado, log }
}
