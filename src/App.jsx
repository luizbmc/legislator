import { HashRouter, Routes, Route } from 'react-router-dom'
import Home             from './pages/Home.jsx'
import NovaNorma        from './pages/NovaNorma.jsx'
import Editor           from './pages/Editor.jsx'
import Rotinas          from './pages/Rotinas.jsx'
import Configuracoes    from './pages/Configuracoes.jsx'
import PublicacoesPage  from './pages/PublicacoesPage.jsx'
import PublicacaoPage   from './pages/PublicacaoPage.jsx'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/"                   element={<Home />} />
        <Route path="/nova"               element={<NovaNorma />} />
        <Route path="/editor/:id"         element={<Editor />} />
        <Route path="/configuracoes"      element={<Configuracoes />} />
        <Route path="/rotinas"            element={<Rotinas />} />
        <Route path="/publicacoes"        element={<PublicacoesPage />} />
        <Route path="/publicacoes/:id"    element={<PublicacaoPage />} />
      </Routes>
    </HashRouter>
  )
}
