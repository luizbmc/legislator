/**
 * mancha.js — medidas verticais do miolo, iguais no PDF (Typst), na tela de paginação e no InDesign,
 * para o InDesign encaixar em cada página as mesmas linhas que o Normando planejou.
 *
 * Medido no InDesign (gabaritos CF 70 e Regimento 31ª ed.), com o quadro do modelo (222 mm de altura,
 * topo a 19 mm, 1ª linha-base pela ascendente — AscentOffset):
 *   • a 1ª linha-base da página fica na ascendente da fonte (Source Sans 3: 1,024 em, 9,73 pt no
 *     corpo 9,5; Montserrat: 0,968 em), qualquer que seja a entrelinha; o espaço antes do parágrafo
 *     some no alto do quadro;
 *   • as linhas seguintes ficam a uma entrelinha da anterior;
 *   • uma linha cabe se a linha-base fica dentro do quadro;
 *   • notas: presas ao pé do quadro, o filete fica a uma entrelinha da nota acima da 1ª linha-base
 *     (FootnoteFirstBaselineOffset = LeadingOffset), 2,83 pt entre notas (SpaceBetween) e o texto
 *     termina pelo menos 12,76 pt acima do filete (Spacer).
 * No Typst (composição final, com plano) cada linha tem o topo na ascendente do estilo e o espaço
 * entre linhas completa a entrelinha; o espaço que completa a entrelinha da 1ª linha do parágrafo
 * vai junto com o espaço antes (e some no alto da página, como no InDesign).
 */

export const PT_MM = 72 / 25.4
/**
 * Formato do livro, em pontos. O padrão é o do modelo (mestra A-Miolo: 170 × 255 mm, mancha de
 * 131 × 222 mm); um livro em outro formato (CF de bolso) define o seu com definirFormato.
 * `ultimaLinha`: mínimo de caracteres na última linha (8; 7 em caso complexo, relatado; bolso: 5).
 * `espacoMinimo`: piso do espaço entre palavras (%); `limiteAperto`: piso do espaço visível, já com o
 * tracking; `apertada`: marca da tela; `ajustesExtra`: passos de aperto além dos comuns; `soltarNbsp`:
 * tirar o espaço sem quebra que deixa a linha anterior aberta.
 * `cabeco`: posição e estilo do fólio e dos cabeços, quando diferem do modelo (livroCompleto.js).
 */
const PADRAO = { largura: 170 * PT_MM, altura: 255 * PT_MM, topo: 19 * PT_MM, baixo: 14 * PT_MM, dentro: 22 * PT_MM, fora: 17 * PT_MM, linha: 13.25, corpo: 9.5, ultimaLinha: 8, ultimaComplexa: 7, espacoMinimo: 82, apertada: 0.8, limiteAperto: 0.76, ajustesExtra: [], visivelMinimo: null, ultimaOcupacao: false, notaMaisUm: false, soltarNbsp: false, cabeco: null }
export const formato = { ...PADRAO }
export const definirFormato = f => { Object.assign(formato, PADRAO, f || {}) }
/** Ocupação mínima da última linha (fração da largura) para um parágrafo de n linhas (formato com ultimaOcupacao). */
export const ocupacaoMinima = n => (n <= 2 ? 0.10 : n === 3 ? 0.11 : n === 4 ? 0.12 : 0.13)
export const larguraMancha = () => formato.largura - formato.dentro - formato.fora
export const alturaMancha = () => formato.altura - formato.topo - formato.baixo
/** Ascendente (em) das fontes do modelo: no Typst ("ascender") e no InDesign (AscentOffset). */
export const ascendente = (fonte, corpo) => corpo * (/montserrat/i.test(fonte || '') ? 0.968 : 1.024)
/** Notas de rodapé (opções de nota do modelo). */
// estilos que não entram na conferência (linha aberta, empilhada, última curta): as assinaturas da
// CF, listas de nomes (usuário, 2026-11-07)
export const semConferencia = estilo => /(^|:)ass-cf$/.test(estilo || '')
export const NOTAS = { espacador: 12.755905511811024, entre: 2.834645669291339 }
