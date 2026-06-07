/**
 * Etapa 1 — Normalização de texto puro
 * Operações independentes de contexto (sem saber o estilo do parágrafo).
 * Equivalente à seção "LIMPA LEGISLAÇÃO" e parte dos GREPs do script JSX.
 */
import { isTipoTratado } from '../../constants/normas.js'

export function normalizarTexto(texto, { tipoNorma = '' } = {}) {
  const log = []
  let s = texto
  const modoTratado = isTipoTratado(tipoNorma)

  // NBSP → espaço normal (sempre primeiro, antes de qualquer outra operação)
  const nbspCount = (s.match(/ /g) || []).length
  s = s.replace(/ /g, ' ')
  if (nbspCount) log.push(`${nbspCount} espaço(s) não-separável(is) removido(s)`)

  // ü → u  (trema germânico sem equivalente no português)
  const uCount = (s.match(/ü/g) || []).length
  s = s.replace(/ü/g, 'u')
  if (uCount) log.push(`${uCount} "ü" → "u"`)

  // ¬ (U+00AC, NOT SIGN) → remove  (artefato de hífen não-separável em docs Word/PDF)
  const notCount = (s.match(/¬/g) || []).length
  s = s.replace(/¬/g, '')
  if (notCount) log.push(`${notCount} caractere(s) "¬" removido(s)`)

  // Colapsa tabs múltiplos → um tab
  s = s.replace(/\t+/g, '\t')

  // Alíneas: \ta)\t → a)·  (remove tabs, mantém rótulo)
  s = s.replace(/^\t([a-záéíóúâêôîûàèìòùãõç]\))\t/gm, '$1 ')

  // Itens numerados: \t1.\t → 1.·  ou  \t1)\t → 1)·
  s = s.replace(/^\t(\d+[.)])\t/gm, '$1 ')

  // Em tratados, cada paragrafo deve permanecer autonomo. A hierarquia pode
  // usar texto livre e enumeracoes sem os identificadores de uma lei comum.
  if (!modoTratado) {
    // Remove parágrafo gerado por quebra após vírgula
    const virgulas = (s.match(/,[  \t]?\n/g) || []).length
    s = s.replace(/,[ \t]?\n/g, ', ')
    if (virgulas) log.push(`${virgulas} quebra(s) após vírgula removida(s)`)

    // Une frases partidas no meio — artefato de cópia do Word ou PDF
    // Condição: linha anterior não termina com pontuação de fim de período
    //           linha seguinte começa com minúscula e NÃO é rótulo de alínea (ex: "a)")
    const antesMerge = s
    s = s.replace(
      /([^.;:!?\n])\n(?![a-záéíóúâêôîûàèìòùãõç]\s*\))([a-záéíóúâêôîûàèìòùãõç])/g,
      '$1 $2'
    )
    if (s !== antesMerge) log.push('Quebras de linha no meio de frases unidas')
  }

  // Colapsa 3+ quebras consecutivas em 2 (um parágrafo em branco)
  s = s.replace(/(\n[ \t]*){3,}/g, '\n\n')

  // Colapsa espaços e tabs duplicados numa linha
  s = s.replace(/[ \t]{2,}/g, ' ')

  // Remove espaço/tab antes de quebra de linha
  s = s.replace(/[ \t]+(?=\n)/g, '')

  // Remove espaço(s) no início de linha
  s = s.replace(/^ +/gm, '')

  // Remove parágrafo vazio no final
  s = s.replace(/\n+$/, '')

  // ── TableText2: une alínea isolada com próximo parágrafo ─────────
  // Situação: `a)` sozinho na linha, separado por quebra(s), seguido de
  // conteúdo que começa com `(MAIÚSCULA` ou com 2+ letras minúsculas.
  // Ex: "a)\n\n(VETADO)" → "a) (VETADO)"
  const alinAnt = s
  s = s.replace(/^([a-záéíóúâêôîûàèìòùãõç]\))\n+(\([A-Z])/gm, '$1 $2')
  s = s.replace(/^([a-záéíóúâêôîûàèìòùãõç]\))\n+([a-záéíóúâêôîûàèìòùãõç]{2})/gm, '$1 $2')
  if (s !== alinAnt) log.push('Alíneas isoladas unidas ao parágrafo seguinte')

  // ── tabelinha_coringa: une rótulo de título + texto do título ─────
  // TÍTULO I\nDAS DISPOSIÇÕES GERAIS  →  TÍTULO I – DAS DISPOSIÇÕES GERAIS
  // (somente quando separados por UMA quebra — linhas consecutivas)
  // Palavras que indicam que o próximo parágrafo é independente (não é subtítulo):
  const INICIO_ESTRUTURA = /^(?:LIVRO|PARTE|SUBTÍTULO|TÍTULO|CAPÍTULO|Seção|Subseção|SEÇÃO|SUBSEÇÃO|Art\.|Arts\.|§|Parágrafo\s+único|[IVXLCDM]+(?:-[A-Z])?[\s–—\-]|[a-záéíóúâêôîûàèìòùãõç]\)|Brasília,|\(Publicad|\(Vigência|\(Redação|\(Incluíd|\(Revogad|\(NR|Dispõe|Disciplina|Estatui|Define|Regula|Estabelece|Cria|Institui|Altera|Revoga|Faço\s+saber|O\s+Presidente)/i

  if (!modoTratado) {
    const titAnt = s
    // Rótulo com numeral/ordinal/especial obrigatório (evita falsos positivos)
    s = s.replace(
      /^((?:LIVRO|PARTE|SUBTÍTULO|TÍTULO|CAPÍTULO)\s+(?:[IVXLCDM]+|\d+[ºª]?|ÚNICO|Único|ESPECIAL|Especial)[^\n]*)\n(?!\n)([^\n]+)/gm,
      (match, rotulo, proximo) => {
        if (INICIO_ESTRUTURA.test(proximo.trim())) return match
        return rotulo + ' – ' + proximo
      }
    )
    s = s.replace(
      /^((?:Seção|Subseção|SEÇÃO|SUBSEÇÃO)\s+(?:[IVXLCDM]+|\d+[ºª]?)[^\n]*)\n(?!\n)([^\n]+)/gm,
      (match, rotulo, proximo) => {
        if (INICIO_ESTRUTURA.test(proximo.trim())) return match
        return rotulo + ' – ' + proximo
      }
    )
    if (s !== titAnt) log.push('Rótulos de título unidos ao texto do título com " – "')
  }

  log.push(`Texto: ${texto.length} → ${s.length} caracteres`)
  return { output: s, log }
}
