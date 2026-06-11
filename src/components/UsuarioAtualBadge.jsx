import { iniciaisUsuario } from '../services/usuariosComentarios.js'

export default function UsuarioAtualBadge({ usuario, onTrocar }) {
  if (!usuario) return null
  return (
    <button
      type="button"
      className="usuario-atual-badge"
      onClick={onTrocar}
      title="Trocar usuario"
    >
      <span className="usuario-badge usuario-badge-mini" style={{ backgroundColor: usuario.cor }}>
        {iniciaisUsuario(usuario.nome)}
      </span>
      <span>{usuario.nome}</span>
      <em>Trocar</em>
    </button>
  )
}
