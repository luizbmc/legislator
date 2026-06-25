const STORAGE_USUARIOS = 'normando.comentarios.usuarios'
const STORAGE_ATUAL = 'normando.comentarios.usuarioAtual'

export const CORES_USUARIO_COMENTARIO = [
  '#2563eb',
  '#16a34a',
  '#ca8a04',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#c2410c',
  '#4b5563',
]

export const USUARIO_COMENTARIO_CONVIDADO = {
  id: 'convidado',
  nome: 'Convidado',
  cor: '#64748b',
}

function podeUsarStorage() {
  return typeof window !== 'undefined' && !!window.localStorage
}

function normalizarUsuario(usuario) {
  return {
    id: usuario.id || `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome: String(usuario.nome || '').trim(),
    cor: usuario.cor || CORES_USUARIO_COMENTARIO[0],
  }
}

export function iniciaisUsuario(nome) {
  const partes = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!partes.length) return '?'
  return partes.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('')
}

export function carregarUsuariosComentarios() {
  if (!podeUsarStorage()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_USUARIOS)
    const lista = raw ? JSON.parse(raw) : []
    return Array.isArray(lista)
      ? lista.map(normalizarUsuario).filter(u => u.nome)
      : []
  } catch {
    return []
  }
}

export function salvarUsuariosComentarios(usuarios) {
  if (!podeUsarStorage()) return []
  const lista = (usuarios || []).map(normalizarUsuario).filter(u => u.nome)
  window.localStorage.setItem(STORAGE_USUARIOS, JSON.stringify(lista))
  const atual = carregarUsuarioComentarioAtual()
  if (atual && atual.id !== USUARIO_COMENTARIO_CONVIDADO.id && !lista.some(u => u.id === atual.id)) {
    limparUsuarioComentarioAtual()
  }
  return lista
}

export function carregarUsuarioComentarioAtual() {
  if (!podeUsarStorage()) return null
  try {
    const id = window.localStorage.getItem(STORAGE_ATUAL)
    if (!id) return null
    if (id === USUARIO_COMENTARIO_CONVIDADO.id) return USUARIO_COMENTARIO_CONVIDADO
    return carregarUsuariosComentarios().find(u => u.id === id) || null
  } catch {
    return null
  }
}

export function selecionarUsuarioComentario(usuario) {
  if (!podeUsarStorage() || !usuario?.id) return
  window.localStorage.setItem(STORAGE_ATUAL, usuario.id)
  window.dispatchEvent(new CustomEvent('normando:usuario-comentario', { detail: usuario }))
}

export function limparUsuarioComentarioAtual() {
  if (!podeUsarStorage()) return
  window.localStorage.removeItem(STORAGE_ATUAL)
  window.dispatchEvent(new CustomEvent('normando:usuario-comentario', { detail: null }))
}

export function criarUsuarioComentario(nome, cor) {
  const usuarios = carregarUsuariosComentarios()
  const usuario = normalizarUsuario({
    nome,
    cor: cor || CORES_USUARIO_COMENTARIO[usuarios.length % CORES_USUARIO_COMENTARIO.length],
  })
  if (!usuario.nome) return null
  salvarUsuariosComentarios([...usuarios, usuario])
  return usuario
}

export async function sincronizarUsuariosComentarios() {
  if (!window.legislator?.usuarios?.listar) return carregarUsuariosComentarios()
  let lista = await window.legislator.usuarios.listar()
  const locais = carregarUsuariosComentarios()
  if (!lista?.length && locais.length && window.legislator.usuarios.criar) {
    for (const usuario of locais) {
      await window.legislator.usuarios.criar(usuario)
    }
    lista = await window.legislator.usuarios.listar()
  }
  return salvarUsuariosComentarios(lista || [])
}

export async function criarUsuarioComentarioNoBanco(nome, cor) {
  const nomeLimpo = String(nome || '').trim()
  if (!nomeLimpo) return null
  if (!window.legislator?.usuarios?.criar) return criarUsuarioComentario(nomeLimpo, cor)
  const usuario = await window.legislator.usuarios.criar({
    nome: nomeLimpo,
    cor: cor || CORES_USUARIO_COMENTARIO[0],
  })
  await sincronizarUsuariosComentarios()
  return normalizarUsuario(usuario)
}

export async function excluirUsuarioComentarioNoBanco(usuario) {
  if (!usuario?.id) return
  if (window.legislator?.usuarios?.excluir) {
    await window.legislator.usuarios.excluir(usuario.id)
    salvarUsuariosComentarios(
      carregarUsuariosComentarios().filter(item => item.id !== usuario.id),
    )
    await sincronizarUsuariosComentarios()
    return
  }
  salvarUsuariosComentarios(
    carregarUsuariosComentarios().filter(item => item.id !== usuario.id),
  )
}
