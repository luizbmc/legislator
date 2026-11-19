/**
 * avisosExportacao.js — o que a exportação (PDF ou IDML) deixou de fora ou não conseguiu fazer,
 * em texto para o alerta do fim da exportação. Vazio quando não há nada a avisar.
 *
 * relatorio.puladas: normas inteiras fora (rascunho, sem conteúdo, fora do livro da pasta do modelo)
 * relatorio.perdidos: trechos de normas que não entraram (conferência do texto em historia.js)
 * relatorio.avisos: outros avisos da geração
 */
const MAX = 12

function lista(itens, linha) {
  const out = itens.slice(0, MAX).map(linha)
  if (itens.length > MAX) out.push(`• … e mais ${itens.length - MAX}`)
  return out
}

export function linhasDeAviso(relatorio = {}) {
  const linhas = []
  const perdidos = relatorio.perdidos || []
  if (perdidos.length) {
    linhas.push('', `⚠ ATENÇÃO: ${perdidos.length} parágrafo(s) das normas não entraram por inteiro na exportação:`)
    linhas.push(...lista(perdidos, p => `• ${p.epigrafe}: "${p.texto}"${p.inteiro ? '' : ' (em parte)'}`))
    linhas.push('Confira o estilo desses parágrafos no editor: a exportação não soube onde pô-los.')
  }
  const puladas = relatorio.puladas || []
  if (puladas.length) {
    // seção inteira fora do livro da pasta do modelo vem numa linha só, com o nº de normas
    const total = puladas.reduce((n, p) => n + (p.quantas || 1), 0)
    linhas.push('', `Ficaram de fora ${total} norma(s):`)
    linhas.push(...lista(puladas, p => `• ${p.epigrafe} — ${p.motivo}`))
  }
  const avisos = relatorio.avisos || []
  if (avisos.length) linhas.push('', ...avisos.map(a => `⚠ ${a}`))
  return linhas
}
