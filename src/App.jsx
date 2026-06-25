import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Home             from './pages/Home.jsx'
import NovaNorma        from './pages/NovaNorma.jsx'
import Editor           from './pages/Editor.jsx'
import Rotinas          from './pages/Rotinas.jsx'
import Configuracoes    from './pages/Configuracoes.jsx'
import PublicacoesPage  from './pages/PublicacoesPage.jsx'
import PublicacaoPage   from './pages/PublicacaoPage.jsx'
import {
  carregarUsuarioComentarioAtual,
  carregarUsuariosComentarios,
  iniciaisUsuario,
  limparUsuarioComentarioAtual,
  selecionarUsuarioComentario,
  sincronizarUsuariosComentarios,
  USUARIO_COMENTARIO_CONVIDADO,
} from './services/usuariosComentarios.js'

function EntradaUsuario({ onEntrar }) {
  const [usuarios, setUsuarios] = useState(() => carregarUsuariosComentarios())
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    sincronizarUsuariosComentarios()
      .then(setUsuarios)
      .catch(() => setUsuarios(carregarUsuariosComentarios()))
      .finally(() => setCarregando(false))
  }, [])
  const opcoes = [...usuarios, USUARIO_COMENTARIO_CONVIDADO]

  function entrar(usuario) {
    selecionarUsuarioComentario(usuario)
    onEntrar(usuario)
  }

  return (
    <div className="usuario-entrada-page">
      <section className="usuario-entrada-card">
        <h1>Normando</h1>
        <p>Selecione seu nome para identificar comentários feitos nas normas.</p>
        {carregando && <p className="usuario-entrada-carregando">Carregando usuários...</p>}

        <div className="usuario-entrada-lista">
          {opcoes.map(usuario => (
            <button key={usuario.id} type="button" onClick={() => entrar(usuario)}>
              <span className="usuario-badge" style={{ backgroundColor: usuario.cor }}>
                {iniciaisUsuario(usuario.nome)}
              </span>
              <span>{usuario.nome}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function AvisoAtualizacao() {
  const api = window.legislator?.atualizacoes
  const [estado, setEstado] = useState(null)
  const [fechado, setFechado] = useState(false)

  useEffect(() => {
    let cancelar = () => {}
    api?.estado().then(setEstado).catch(() => {})
    if (api?.acompanhar) cancelar = api.acompanhar(proximo => {
      setEstado(proximo)
      if (['disponivel', 'baixada'].includes(proximo.status)) setFechado(false)
    })
    return cancelar
  }, [])

  if (
    fechado ||
    !estado?.disponivelNoApp ||
    !['disponivel', 'baixando', 'baixada'].includes(estado.status)
  ) return null

  async function agir() {
    try {
      if (estado.status === 'disponivel') await api.baixar()
      if (estado.status === 'baixada') await api.instalar()
    } catch (error) {
      setEstado(prev => ({ ...prev, status: 'erro', mensagem: error.message }))
    }
  }

  return (
    <aside className="app-update-toast" role="status">
      <button
        type="button"
        className="app-update-close"
        aria-label="Ocultar aviso"
        onClick={() => setFechado(true)}
      >
        ×
      </button>
      <strong>
        {estado.status === 'baixada'
          ? 'Atualização pronta'
          : `Normando ${estado.novaVersao || ''} disponível`}
      </strong>
      <p>
        {estado.status === 'baixando'
          ? `Baixando... ${Math.round(estado.progresso || 0)}%`
          : estado.mensagem}
      </p>
      {estado.status !== 'baixando' && (
        <button type="button" className="btn-primary btn-sm" onClick={agir}>
          {estado.status === 'baixada' ? 'Instalar e reiniciar' : 'Baixar'}
        </button>
      )}
    </aside>
  )
}

export default function App() {
  const [usuarioAtual, setUsuarioAtual] = useState(() => carregarUsuarioComentarioAtual())

  useEffect(() => {
    function onUsuario(e) {
      setUsuarioAtual(e.detail || carregarUsuarioComentarioAtual())
    }
    window.addEventListener('normando:usuario-comentario', onUsuario)
    return () => window.removeEventListener('normando:usuario-comentario', onUsuario)
  }, [])

  if (!usuarioAtual) {
    return <EntradaUsuario onEntrar={setUsuarioAtual} />
  }

  function trocarUsuario() {
    limparUsuarioComentarioAtual()
    setUsuarioAtual(null)
  }

  return (
    <HashRouter>
      <AvisoAtualizacao />
      <Routes>
        <Route path="/"                   element={<Home usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/nova"               element={<NovaNorma usuarioAtual={usuarioAtual} />} />
        <Route path="/editor/:id"         element={<Editor usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/editor-remoto/:id"  element={<Editor remoto usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/configuracoes"      element={<Configuracoes />} />
        <Route path="/rotinas"            element={<Rotinas />} />
        <Route path="/publicacoes"        element={<PublicacoesPage usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/publicacoes/:id"    element={<PublicacaoPage usuarioAtual={usuarioAtual} />} />
      </Routes>
    </HashRouter>
  )
}
