// Formato da publicação (campo "Formato" do formulário): valor gravado no banco → rótulo.
// Na página de publicações, a capa do formato bolso sai 20% menor e cada capa mostra o formato
// numa etiqueta na faixa da lombada.
export const FORMATOS_PUBLICACAO = [
  { valor: 'normal', rotulo: 'Normal' },
  { valor: 'bolso', rotulo: 'Bolso' },
  { valor: 'vade_mecum', rotulo: 'Vade Mecum' },
  { valor: 'outro', rotulo: 'Outro' },
]

export const FORMATO_PADRAO = 'normal'

export function rotuloDoFormato(valor) {
  return FORMATOS_PUBLICACAO.find(f => f.valor === valor)?.rotulo || null
}
