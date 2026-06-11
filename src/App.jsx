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
  USUARIO_COMENTARIO_CONVIDADO,
} from './services/usuariosComentarios.js'

function EntradaUsuario({ onEntrar }) {
  const [usuarios] = useState(() => carregarUsuariosComentarios())
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
      <Routes>
        <Route path="/"                   element={<Home usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/nova"               element={<NovaNorma />} />
        <Route path="/editor/:id"         element={<Editor usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/configuracoes"      element={<Configuracoes />} />
        <Route path="/rotinas"            element={<Rotinas />} />
        <Route path="/publicacoes"        element={<PublicacoesPage usuarioAtual={usuarioAtual} onTrocarUsuario={trocarUsuario} />} />
        <Route path="/publicacoes/:id"    element={<PublicacaoPage />} />
      </Routes>
    </HashRouter>
  )
}
