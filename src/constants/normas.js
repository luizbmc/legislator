export const TIPOS_NORMA = [
  'Lei Ordinária',
  'Lei Complementar',
  'Decreto',
  'Decreto Legislativo',
  'Decreto-Lei',
  'Resolução',
  'Resolução da CD',
  'Resolução do CN',
  'Constituição',
  'Ato da Mesa',
  'Emenda Constitucional',
  'Tratado Internacional',
  'Estatuto',
  'Código',
  'Portaria',
  'Instrução Normativa',
  'Ato institucional',
  'Outros',
  'Texto comum',
  'Recorte',
]

export function isTipoTratado(tipo) {
  const normalizado = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalizado.includes('tratado') ||
    (normalizado.includes('convenc') && normalizado.includes('internacion'))
}

export function isTipoFacoSaber(tipo) {
  const normalizado = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalizado === 'resolucao da cd' ||
    normalizado === 'decreto legislativo' ||
    normalizado === 'resolucao do cn'
}

export function isTipoTextoComum(tipo) {
  const normalizado = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalizado === 'texto comum'
}

export function isTipoRecorte(tipo) {
  const normalizado = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalizado === 'recorte'
}

export function isTipoOcultoCatalogo(tipo) {
  return isTipoTextoComum(tipo) || isTipoRecorte(tipo)
}
