import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'

const STATUS_LABELS = {
  rascunho:   { label: 'Rascunho',   cor: '#f59e0b' },
  revisao:    { label: 'Em revisão', cor: '#3b82f6' },
  finalizado: { label: 'Finalizado', cor: '#10b981' },
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normaBateNaBuscaPrincipal(norma, termo) {
  if (!termo) return true
  return normalizarBusca(norma.epigrafe).includes(termo) ||
    normalizarBusca(norma.apelido).includes(termo)
}

function normaTemTagVm(norma) {
  return (norma.tags || []).some(tag => normalizarBusca(tag) === 'vm')
}

export default function Home() {
  const nav = useNavigate()
  const [normas,  setNormas]  = useState([])
  const [busca,   setBusca]   = useState('')
  const [tipo,    setTipo]    = useState('')
  const [status,  setStatus]  = useState('')
  const [buscarConteudo, setBuscarConteudo] = useState(false)
  const [somenteVm, setSomenteVm] = useState(false)
  const [visao,   setVisao]   = useState('cards')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.legislator.normas.listar({ busca, tipo, status, buscarConteudo })
      .then(setNormas)
      .finally(() => setLoading(false))
  }, [busca, tipo, status, buscarConteudo])

  async function excluir(e, id) {
    e.stopPropagation()
    if (!confirm('Excluir esta norma?')) return
    await window.legislator.normas.excluir(id)
    setNormas(prev => prev.filter(n => n.id !== id))
  }

  async function duplicar(e, id) {
    e.stopPropagation()
    try {
      const origem = await window.legislator.normas.buscar(id)
      if (!origem) {
        alert('Nao foi possivel localizar a norma de origem.')
        return
      }
      nav('/nova', { state: { duplicarNorma: origem } })
    } catch (err) {
      alert(String(err?.message || err))
    }
  }

  const termoBuscaPrincipal = normalizarBusca(busca)
  const normasFiltradasPorBusca = buscarConteudo
    ? normas
    : normas.filter(n => normaBateNaBuscaPrincipal(n, termoBuscaPrincipal))
  const normasVisiveis = somenteVm
    ? normasFiltradasPorBusca.filter(normaTemTagVm)
    : normasFiltradasPorBusca

  return (
    <div className="home-page">
      <header className="home-header">
        <h1 className="home-logo">LEGISLATOR</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => nav('/configuracoes')} title="Preferências do aplicativo">
            Configurações
          </button>
          <button className="btn-ghost" onClick={() => nav('/publicacoes')}>
            📚 Publicações
          </button>
          <button className="btn-primary" onClick={() => nav('/nova')}>
            + Nova norma
          </button>
        </div>
      </header>

      <div className="home-filtros">
        <input
          className="input-busca"
          placeholder={buscarConteudo ? 'Buscar por epígrafe, apelido ou conteúdo…' : 'Buscar por epígrafe ou apelido…'}
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        <label className="home-check">
          <input
            type="checkbox"
            checked={buscarConteudo}
            onChange={e => setBuscarConteudo(e.target.checked)}
          />
          <span>Buscar no conteúdo</span>
        </label>
        <label className={`home-check home-check-vm${somenteVm ? ' ativo' : ''}`}>
          <input
            type="checkbox"
            checked={somenteVm}
            onChange={e => setSomenteVm(e.target.checked)}
          />
          <span>Vade mecum</span>
        </label>
        <select value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="rascunho">Rascunho</option>
          <option value="revisao">Em revisão</option>
          <option value="finalizado">Finalizado</option>
        </select>
        <div className="view-toggle" aria-label="Visualização">
          <button
            type="button"
            className={visao === 'cards' ? 'ativo' : ''}
            onClick={() => setVisao('cards')}
            title="Visualizar como cards"
          >
            Cards
          </button>
          <button
            type="button"
            className={visao === 'lista' ? 'ativo' : ''}
            onClick={() => setVisao('lista')}
            title="Visualizar como lista"
          >
            Lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="home-loading">Carregando…</p>
      ) : normasVisiveis.length === 0 ? (
        <div className="home-vazio">
          <p>Nenhuma norma encontrada.</p>
          <button className="btn-primary" onClick={() => nav('/nova')}>Cadastrar primeira norma</button>
        </div>
      ) : visao === 'cards' ? (
        <div className="normas-grid">
          {normasVisiveis.map(n => {
            const st = STATUS_LABELS[n.status] ?? STATUS_LABELS.rascunho
            return (
              <div key={n.id} className="norma-card" onClick={() => nav(`/editor/${n.id}`)}>
                <div className="norma-card-top">
                  <span className="norma-tipo">{n.tipo}</span>
                  <span className="norma-status" style={{ color: st.cor }}>{st.label}</span>
                </div>
                <div className="norma-epigrafe">{n.epigrafe}</div>
                {n.apelido && <div className="norma-apelido">{n.apelido}</div>}
                {n.ementa  && <div className="norma-ementa">{n.ementa}</div>}
                {n.tags?.length > 0 && (
                  <div className="norma-tags">
                    {n.tags.map(t => <span key={t} className="norma-tag">{t}</span>)}
                  </div>
                )}
                <div className="norma-card-footer">
                  <span className="norma-data">
                    Atualizado em {new Date(n.atualizado_em).toLocaleDateString('pt-BR')}
                  </span>
                  <div className="norma-card-acoes">
                    <button className="btn-ghost btn-sm" onClick={e => duplicar(e, n.id)} title="Duplicar norma">
                      Duplicar
                    </button>
                    <button className="btn-ghost btn-sm" onClick={e => excluir(e, n.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Epígrafe</th>
                <th>Apelido</th>
                <th>Status</th>
                <th>Link para acesso</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {normasVisiveis.map(n => {
                const st = STATUS_LABELS[n.status] ?? STATUS_LABELS.rascunho
                return (
                  <tr key={n.id} onClick={() => nav(`/editor/${n.id}`)}>
                    <td className="catalog-table-type">{n.tipo}</td>
                    <td className="catalog-table-title">{n.epigrafe}</td>
                    <td>{n.apelido || <span className="catalog-table-muted">-</span>}</td>
                    <td>
                      <span className="catalog-table-status" style={{ color: st.cor }}>
                        {st.label}
                      </span>
                    </td>
                    <td>
                      {n.link_acesso ? (
                        <a
                          className="catalog-table-link"
                          href={n.link_acesso}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          title={n.link_acesso}
                        >
                          Abrir
                        </a>
                      ) : (
                        <span className="catalog-table-muted">-</span>
                      )}
                    </td>
                    <td className="catalog-table-actions">
                      <button className="btn-ghost btn-sm" onClick={e => duplicar(e, n.id)} title="Duplicar norma">
                        Duplicar
                      </button>
                      <button className="btn-ghost btn-sm" onClick={e => excluir(e, n.id)} title="Excluir norma">
                        Excluir
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
