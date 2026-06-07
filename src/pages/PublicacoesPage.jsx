import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const STATUS_MAP = {
  'previsto':     { cls: 'previsto',   label: 'Previsto' },
  'solicitado':   { cls: 'solicitado', label: 'Solicitado' },
  'em produção':  { cls: 'producao',   label: 'Em produção' },
  'parado':       { cls: 'parado',     label: 'Parado' },
  'concluído':    { cls: 'concluido',  label: 'Concluído' },
}

const DEFAULT_COVER_COLOR = 'hsl(90 42% 78%)'

const FORM_PUBLICACAO_VAZIO = {
  titulo: '',
  edicao: '',
  organizador: '',
  lancado_em: '',
  descricao: '',
  status: 'previsto',
  cor_capa: '',
  ultima_edicao: false,
}

function statusInfo(status) {
  return STATUS_MAP[status] ?? { cls: 'previsto', label: status ?? 'Previsto' }
}

function coverStyle(cor) {
  return { '--pub-cover-color': cor || DEFAULT_COVER_COLOR }
}

export default function PublicacoesPage() {
  const nav = useNavigate()
  const [lista,    setLista]    = useState([])
  const [busca,    setBusca]    = useState('')
  const [status,   setStatus]   = useState('')
  const [somenteUltimaEdicao, setSomenteUltimaEdicao] = useState(false)
  const [visao,    setVisao]    = useState('cards')
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form,     setForm]     = useState(FORM_PUBLICACAO_VAZIO)
  const [duplicando, setDuplicando] = useState(null)
  const [erro,     setErro]     = useState('')

  useEffect(() => { carregar() }, [busca, status, somenteUltimaEdicao])

  async function carregar() {
    setLoading(true)
    const data = await window.legislator.publicacoes.listar({ busca, status, ultimaEdicao: somenteUltimaEdicao })
    setLista(data)
    setLoading(false)
  }

  function abrirModal() {
    setForm(FORM_PUBLICACAO_VAZIO)
    setDuplicando(null)
    setErro('')
    setModal(true)
  }

  async function criar(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { setErro('O título é obrigatório.'); return }
    setSalvando(true)
    try {
      const pub = await window.legislator.publicacoes.criar(form)
      if (duplicando) {
        await window.legislator.publicacoes.salvar(pub.id, {
          ...form,
          secoes: duplicando.secoes || [],
        })
      }
      nav(`/publicacoes/${pub.id}`)
    } catch (err) {
      setErro(err.message || 'Erro ao criar.')
      setSalvando(false)
    }
  }

  async function duplicar(e, id) {
    e.stopPropagation()
    try {
      const origem = await window.legislator.publicacoes.buscar(id)
      if (!origem) {
        alert('Nao foi possivel localizar a publicacao de origem.')
        return
      }
      setForm({
        titulo: `Cópia de ${origem.titulo || ''}`.trim(),
        edicao: origem.edicao || '',
        organizador: origem.organizador || '',
        lancado_em: origem.lancado_em || '',
        descricao: origem.descricao || '',
        status: origem.status || 'previsto',
        cor_capa: origem.cor_capa || '',
        ultima_edicao: Boolean(origem.ultima_edicao),
      })
      setDuplicando(origem)
      setErro('')
      setModal(true)
    } catch (err) {
      alert(String(err?.message || err))
    }
  }

  async function excluir(e, id) {
    e.stopPropagation()
    if (!confirm('Excluir esta publicação?')) return
    await window.legislator.publicacoes.excluir(id)
    setLista(prev => prev.filter(p => p.id !== id))
  }

  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))

  return (
    <div className="home-page">
      <header className="home-header">
        <button className="btn-ghost" onClick={() => nav('/')}>← Catálogo</button>
        <h1 className="home-logo">PUBLICAÇÕES</h1>
        <button className="btn-primary" onClick={abrirModal}>+ Nova publicação</button>
      </header>

      <div className="home-filtros">
        <input
          className="input-busca"
          placeholder="Buscar por título, edição, organizador ou normas…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="previsto">Previsto</option>
          <option value="solicitado">Solicitado</option>
          <option value="em produção">Em produção</option>
          <option value="parado">Parado</option>
          <option value="concluído">Concluído</option>
        </select>
        <label className={`home-check${somenteUltimaEdicao ? ' ativo' : ''}`}>
          <input
            type="checkbox"
            checked={somenteUltimaEdicao}
            onChange={e => setSomenteUltimaEdicao(e.target.checked)}
          />
          <span>Última edição</span>
        </label>
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
      ) : lista.length === 0 ? (
        <div className="home-vazio">
          <p>{busca || status ? 'Nenhuma publicação encontrada.' : 'Nenhuma publicação criada.'}</p>
          {!busca && !status && (
            <button className="btn-primary" onClick={abrirModal}>Criar primeira publicação</button>
          )}
        </div>
      ) : visao === 'cards' ? (
        <div className="normas-grid pub-grid">
          {lista.map(p => (
            <div
              key={p.id}
              className="norma-card pub-card"
              style={coverStyle(p.cor_capa)}
              onClick={() => nav(`/publicacoes/${p.id}`)}
            >
              <div className="norma-card-top">
                <span className={`pub-status pub-status-${statusInfo(p.status).cls}`}>
                  {statusInfo(p.status).label}
                </span>
              </div>
              <div className="norma-epigrafe">{p.titulo}</div>
              {p.edicao      && <div className="norma-apelido">{p.edicao}</div>}
              <div className="pub-contagem-row">
                <span className="pub-contagem">{p.total_normas} norma{p.total_normas !== 1 ? 's' : ''}</span>
              </div>
              {p.organizador && <div className="norma-apelido">{p.organizador}</div>}
              <div className="norma-card-footer">
                <span className="norma-data">
                  Atualizado em {new Date(p.atualizado_em).toLocaleDateString('pt-BR')}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-ghost btn-sm" onClick={e => duplicar(e, p.id)} title="Duplicar">Duplicar</button>
                  <button className="btn-ghost btn-sm" onClick={e => excluir(e, p.id)}>Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="catalog-list">
          {lista.map(p => {
            const st = statusInfo(p.status)
            return (
              <div
                key={p.id}
                className="catalog-list-row pub-list-row"
                onClick={() => nav(`/publicacoes/${p.id}`)}
              >
                <div className="pub-list-cover" style={coverStyle(p.cor_capa)} aria-hidden="true" />
                <div className="catalog-list-main">
                  <div className="catalog-list-kicker">
                    <span className={`pub-status pub-status-${st.cls}`}>{st.label}</span>
                    <span>{p.total_normas} norma{p.total_normas !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="catalog-list-title">{p.titulo}</div>
                  <div className="catalog-list-sub">
                    {[p.edicao, p.organizador].filter(Boolean).join(' · ') || 'Sem edição ou organizador cadastrados'}
                  </div>
                </div>
                <div className="catalog-list-meta">
                  <span>Atualizado em {new Date(p.atualizado_em).toLocaleDateString('pt-BR')}</span>
                  <div className="catalog-list-actions">
                    <button className="btn-ghost btn-sm" onClick={e => duplicar(e, p.id)} title="Duplicar">Duplicar</button>
                    <button className="btn-ghost btn-sm" onClick={e => excluir(e, p.id)}>Excluir</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal nova publicação */}
      {modal && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div className="modal-box" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{duplicando ? 'Duplicar publicação' : 'Nova publicação'}</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModal(false)}>✕</button>
            </div>
            <form onSubmit={criar} style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="campo">
                <label>Título *</label>
                <input autoFocus value={form.titulo} onChange={set('titulo')} placeholder="Ex: Coletânea de Direito do Trabalho" required />
              </div>
              <div className="pub-edicao-row">
                <div className="campo pub-edicao-campo">
                  <label>Edição <span className="campo-opcional">(opcional)</span></label>
                  <input value={form.edicao} onChange={set('edicao')} placeholder="Ex: 1ª edição" />
                </div>
                <label className={`home-check pub-ultima-edicao-check${form.ultima_edicao ? ' ativo' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.ultima_edicao)}
                    onChange={e => setForm(f => ({ ...f, ultima_edicao: e.target.checked }))}
                  />
                  <span>Última edição</span>
                </label>
              </div>
              <div className="campo">
                <label>Organizador <span className="campo-opcional">(opcional)</span></label>
                <input value={form.organizador} onChange={set('organizador')} placeholder="Nome do organizador" />
              </div>
              <div className="campo">
                <label>Lançado em <span className="campo-opcional">(opcional)</span></label>
                <input type="date" value={form.lancado_em} onChange={set('lancado_em')} />
              </div>
              <div className="campo">
                <label>Descrição <span className="campo-opcional">(opcional)</span></label>
                <textarea rows={3} value={form.descricao} onChange={set('descricao')} placeholder="Descrição da publicação…" />
              </div>
              <div className="campo">
                <label>Status</label>
                <select className="status-select" value={form.status} onChange={set('status')}>
                  <option value="previsto">Previsto</option>
                  <option value="solicitado">Solicitado</option>
                  <option value="em produção">Em produção</option>
                  <option value="parado">Parado</option>
                  <option value="concluído">Concluído</option>
                </select>
              </div>
              {erro && <p className="form-erro">{erro}</p>}
              <div className="form-acoes">
                <button type="button" className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={salvando || !form.titulo.trim()}>
                  {salvando ? 'Criando…' : duplicando ? 'Criar cópia →' : 'Criar →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
