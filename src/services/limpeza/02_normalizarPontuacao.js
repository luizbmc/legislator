/**
 * Etapa 2 — Normalização de pontuação, ortografia e espaçamento
 *
 * Incorpora as operações das macros Word:
 *   • Parte1_PreparaLegislacao  (seção Espacamento)
 *   • tabelinha_texto.docx      (substituições exatas)
 *   • Parte2_FormataLegislacao  (correções pontuais)
 */
export function normalizarPontuacao(texto) {
  const log = []
  let s = texto

  // ══════════════════════════════════════════════════════════════
  // DATAS
  // ══════════════════════════════════════════════════════════════

  // 01/ → 1º/ (primeiro dia do mês)
  const d1 = (s.match(/\b01\/(?=\d{1,2}\/\d{3,4}\b)/g) || []).length
  s = s.replace(/\b01\/(?=\d{1,2}\/\d{3,4}\b)/g, '1º/')
  if (d1) log.push(`${d1} ocorrência(s): "01/" → "1º/"`)

  // 0X/ → X/ (zeros à esquerda em dias)
  s = s.replace(/\b0([1-9])\/(?=\d{1,2}\/\d{3,4}\b)/g, '$1/')

  // /0X/ → /X/ (zeros à esquerda em meses)
  s = s.replace(/\/0([1-9])\/(?=\d{3,4}\b)/g, '/$1/')

  // ══════════════════════════════════════════════════════════════
  // ORTOGRAFIA PRÉ-REFORMA
  // ══════════════════════════════════════════════════════════════

  const orto = (s.match(/\b\w*éia\b/g) || []).length
  s = s.replace(/\b([a-záéíóúâêôîûàèìòùãõç]*)éia\b/gi, '$1eia')
  if (orto) log.push(`${orto} palavra(s) com "éia" → "eia"`)

  // ══════════════════════════════════════════════════════════════
  // TRAÇOS E SÍMBOLOS  (tabelinha_texto + Parte1 + Parte2)
  // ══════════════════════════════════════════════════════════════

  // " - " → " – "  (hífen com espaços → travessão curto)
  const tracos = (s.match(/ - /g) || []).length
  s = s.replace(/ - /g, ' – ')
  if (tracos) log.push(`${tracos} " - " → " – "`)

  // "Pena: texto" no início do parágrafo → "Pena – texto"
  const penaDoisPontos = (s.match(/^Pena:\s+/gm) || []).length
  s = s.replace(/^Pena:\s+/gm, 'Pena – ')
  if (penaDoisPontos) log.push(`${penaDoisPontos} rótulo(s) "Pena:" corrigido(s) para "Pena –"`)

  // "Art 1.636" → "Art. 1.636" (abreviação de artigo sem ponto)
  const artSemPonto = (s.match(/^Arts?\s+(?=\d)/gm) || []).length
  s = s.replace(/^(Arts?)\s+(?=\d)/gm, '$1. ')
  if (artSemPonto) log.push(`${artSemPonto} rótulo(s) de artigo com ponto restaurado(s)`)

  // Marcador numérico no início da linha com hífen → travessão.
  // Ex.: "1- texto" / "1 - texto" → "1 – texto"
  const itensHifen = (s.match(/^\d+\s*-\s+/gm) || []).length
  s = s.replace(/^(\d+)\s*-\s+/gm, '$1 – ')
  if (itensHifen) log.push(`${itensHifen} item(ns) com hífen inicial corrigido(s) (1 - → 1 –)`)

  // §·§ → §§  (dois parágrafos separados por espaço)
  s = s.replace(/§ §/g, '§§')

  // n° → nº  (grau de número)
  s = s.replace(/n°/g, 'nº')

  // \d+o → \d+º  e  \d+a → \d+ª  (ordinal na grafia antiga: "1o", "2a" etc.)
  // Ex.: "§ 1o" → "§ 1º",  "Art. 2a" → "Art. 2ª"
  const ordinaisAntes = (s.match(/\b\d+[oa]\b/g) || []).length
  s = s.replace(/\b(\d+)o\b/g, '$1º')
  s = s.replace(/\b(\d+)a\b/g, '$1ª')
  if (ordinaisAntes) log.push(`${ordinaisAntes} ordinal(is) antigo(s) corrigido(s) (1o → 1º, 2a → 2ª)`)

  // ══════════════════════════════════════════════════════════════
  // PARÊNTESES E PONTUAÇÃO INTERNA
  // ══════════════════════════════════════════════════════════════

  // ".) " → ") "  —  ponto antes de fechar parêntese (Espacamento: ".\)")
  //   Ex: "inciso I.)" → "inciso I)"
  s = s.replace(/\.\)/g, ')')

  // (Vetado). / (Vetado); → (Vetado)
  s = s.replace(/\(Vetado\)[.;]/gi, '(Vetado)')

  // VETADO → Vetado  (caixa)
  s = s.replace(/\bVETADO\b/g, 'Vetado')

  // ══════════════════════════════════════════════════════════════
  // NÚMEROS COMPOSTOS  (Espacamento: espaço interno em decimais)
  // ══════════════════════════════════════════════════════════════

  // "1. 2" → "1.2"  (ponto decimal ou separador de milhar com espaço)
  s = s.replace(/(\d)\. (\d)/g, '$1.$2')

  // "1, 2" → "1,2"  (vírgula decimal com espaço — ex: "3, 5%")
  s = s.replace(/(\d), (\d)/g, '$1,$2')

  // "1: 2" → "1:2"  (hora/razão com espaço — ex: "proporção 1: 3")
  s = s.replace(/(\d): (\d)/g, '$1:$2')

  // ══════════════════════════════════════════════════════════════
  // ESPAÇAMENTO ANTES/APÓS PONTUAÇÃO  (Parte1 Espacamento)
  // ══════════════════════════════════════════════════════════════

  // Remove espaço antes de pontuação de fechamento  " ," " ." " ;" " :" " )" " ]"
  s = s.replace(/ ([,.:;)\]])/g, '$1')

  // Remove espaço após pontuação de abertura  "( " "[ "
  s = s.replace(/([(\[]) /g, '$1')

  // Garante espaço após pontuação de fechamento seguida de letra/dígito
  //   "texto)texto" → "texto) texto"
  // Mantém abreviaturas como "nºs" sem espaço interno.
  s = s.replace(/([)\]%ºª°])([A-Za-záéíóúâêôîûàèìòùãõç])/g, (match, pont, letra, offset, str) => {
    if ((pont === 'º' || pont === '°') && /n/i.test(str.charAt(offset - 1)) && /s/i.test(letra)) {
      return pont + letra
    }
    return pont + ' ' + letra
  })

  // Garante espaço após dois-pontos e ponto-e-vírgula
  s = s.replace(/([;:])([A-Za-záéíóúâêôîûàèìòùãõç])/g, '$1 $2')

  // ══════════════════════════════════════════════════════════════
  // ASPAS TIPOGRÁFICAS — itálico de citações curtas
  // ══════════════════════════════════════════════════════════════

  // Normaliza aspas duplas retas → curvas (opcional — comenta se não quiser)
  // s = s.replace(/"([^"]+)"/g, '"$1"')

  // ══════════════════════════════════════════════════════════════
  // LIMPEZA FINAL DE ESPAÇOS (garante resultado limpo)
  // ══════════════════════════════════════════════════════════════

  // Duplos espaços remanescentes
  s = s.replace(/  +/g, ' ')

  // Espaço (regular ou não-separável) no início de linha
  s = s.replace(/^[  ]+/gm, '')

  // Espaço (regular ou não-separável) no final de linha
  s = s.replace(/[  ]+$/gm, '')

  return { output: s, log }
}
