import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'

const COVER_COLORS = [
  'hsl(0 42% 78%)',
  'hsl(23 42% 78%)',
  'hsl(45 42% 78%)',
  'hsl(68 42% 78%)',
  'hsl(90 42% 78%)',
  'hsl(113 42% 78%)',
  'hsl(135 42% 78%)',
  'hsl(158 42% 78%)',
  'hsl(180 42% 78%)',
  'hsl(203 42% 78%)',
  'hsl(225 42% 78%)',
  'hsl(248 42% 78%)',
  'hsl(270 42% 78%)',
  'hsl(293 42% 78%)',
  'hsl(315 42% 78%)',
  'hsl(338 42% 78%)',
]

const DEFAULT_COVER_COLOR = COVER_COLORS[4]
const NOVA_NORMA_FORM_INICIAL = {
  tipo: 'Lei Ordinária',
  epigrafe: '',
  apelido: '',
}

const STATUS_NORMA = {
  rascunho:   { label: 'Rascunho',   cls: 'rascunho' },
  revisao:    { label: 'Em revisão', cls: 'revisao' },
  finalizado: { label: 'Finalizado', cls: 'finalizado' },
}

const EXPORTACAO_OPCOES = [
  { valor: 'ignorar', label: 'Ignorar' },
  { valor: 'atualizacao', label: 'Atualização' },
  { valor: 'completa', label: 'Completa' },
]

function statusNormaInfo(status) {
  return STATUS_NORMA[status] || STATUS_NORMA.rascunho
}

function exportacaoBloqueada(norma) {
  return norma?.status !== 'finalizado' || Boolean(norma?.atualizacao_pendente)
}

function exportacaoEfetiva(norma) {
  if (exportacaoBloqueada(norma)) return 'ignorar'
  return norma?.exportacao || 'completa'
}

function normalizarTag(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normaTemTagVm(norma) {
  return (norma.tags || []).some(tag => normalizarTag(tag) === 'vm')
}

function AvisoAtualizacaoPendente({ norma }) {
  if (!norma?.atualizacao_pendente) return null
  return <span className="norma-pendente-icone" title="Atualização pendente">⚠️</span>
}

function primeiraNormaComAtualizacaoPendente(secoes = []) {
  for (const secao of secoes) {
    for (const norma of secao.normas || []) {
      if (norma?.atualizacao_pendente) return norma
    }
  }
  return null
}

export default function PublicacaoPage() {
  const { id } = useParams()
  const nav    = useNavigate()

  const [pub,       setPub]       = useState(null)
  const [form,      setForm]      = useState({ titulo: '', edicao: '', organizador: '', lancado_em: '', descricao: '', caminho_rede: '', status: 'previsto', cor_capa: DEFAULT_COVER_COLOR, ultima_edicao: false })
  const [secoes,    setSecoes]    = useState([])
  const [salvando,  setSalvando]  = useState(false)
  const [modificado,setModificado]= useState(false)
  const [dragNorma, setDragNorma] = useState(null)

  // Modal adicionar norma
  const [modalSecaoIdx, setModalSecaoIdx] = useState(null)  // índice da seção alvo
  const [buscaNorma,    setBuscaNorma]    = useState('')
  const [somenteVm,     setSomenteVm]     = useState(false)
  const [normasDisponiveis, setNormasDisponiveis] = useState([])
  const [loadingNormas, setLoadingNormas] = useState(false)
  const [abaModalNorma, setAbaModalNorma] = useState('catalogo')
  const [novaNormaForm, setNovaNormaForm] = useState(NOVA_NORMA_FORM_INICIAL)
  const [novaNormaTags, setNovaNormaTags] = useState([])
  const [novaNormaTagInput, setNovaNormaTagInput] = useState('')
  const [novaNormaSugestoes, setNovaNormaSugestoes] = useState([])
  const [todasTags, setTodasTags] = useState([])
  const [criandoNorma, setCriandoNorma] = useState(false)
  const [erroNovaNorma, setErroNovaNorma] = useState('')

  // Modal nova seção
  const [modalSecao,    setModalSecao]    = useState(false)
  const [novaSecaoTit,  setNovaSecaoTit]  = useState('')

  // Edição inline de seção
  const [editandoSecao, setEditandoSecao] = useState(null) // idx

  useEffect(() => { carregar() }, [id])

  async function carregar() {
    const data = await window.legislator.publicacoes.buscar(parseInt(id))
    if (!data) { nav('/publicacoes'); return }
    setPub(data)
    setForm({
      titulo:      data.titulo      ?? '',
      edicao:      data.edicao      ?? '',
      organizador: data.organizador ?? '',
      lancado_em:  data.lancado_em  ?? '',
      descricao:   data.descricao   ?? '',
      caminho_rede: data.caminho_rede ?? '',
      status:      data.status      ?? 'previsto',
      cor_capa:    data.cor_capa    ?? DEFAULT_COVER_COLOR,
      ultima_edicao: Boolean(data.ultima_edicao),
    })
    setSecoes(data.secoes ?? [])
    setModificado(false)
  }

  // ── Salvar ──────────────────────────────────────────────────────
  const salvar = useCallback(async () => {
    setSalvando(true)
    try {
      const atualizada = await window.legislator.publicacoes.salvar(parseInt(id), { ...form, secoes })
      setPub(atualizada)
      setModificado(false)
    } finally {
      setSalvando(false)
    }
  }, [id, form, secoes])

  function marcarModificado() { setModificado(true) }
  const setField = campo => e => { setForm(f => ({ ...f, [campo]: e.target.value })); marcarModificado() }
  const setCorCapa = cor => { setForm(f => ({ ...f, cor_capa: cor })); marcarModificado() }

  // ── Seções ──────────────────────────────────────────────────────
  function moverSecao(idx, dir) {
    const s = [...secoes]
    const destino = idx + dir
    if (destino < 0 || destino >= s.length) return;
    [s[idx], s[destino]] = [s[destino], s[idx]]
    setSecoes(s); marcarModificado()
  }

  function excluirSecao(idx) {
    if (!confirm(`Excluir a seção "${secoes[idx].titulo}"? As normas serão removidas dela.`)) return
    setSecoes(s => s.filter((_, i) => i !== idx)); marcarModificado()
  }

  function renomearSecao(idx, titulo) {
    setSecoes(s => s.map((sec, i) => i === idx ? { ...sec, titulo } : sec))
    marcarModificado()
  }

  function adicionarSecao() {
    if (!novaSecaoTit.trim()) return
    setSecoes(s => [...s, { titulo: novaSecaoTit.trim(), normas: [] }])
    setNovaSecaoTit('')
    setModalSecao(false)
    marcarModificado()
  }

  // ── Normas nas seções ───────────────────────────────────────────
  function removerNormaDaSecao(secaoIdx, pnId) {
    setSecoes(s => s.map((sec, i) =>
      i === secaoIdx ? { ...sec, normas: sec.normas.filter(n => n.pn_id !== pnId) } : sec
    ))
    marcarModificado()
  }

  function moverNorma(secaoIdx, normaIdx, dir) {
    const s = secoes.map((sec, i) => {
      if (i !== secaoIdx) return sec
      const ns = [...sec.normas]
      const dest = normaIdx + dir
      if (dest < 0 || dest >= ns.length) return sec;
      [ns[normaIdx], ns[dest]] = [ns[dest], ns[normaIdx]]
      return { ...sec, normas: ns }
    })
    setSecoes(s); marcarModificado()
  }

  function alterarExportacaoNorma(secaoIdx, normaIdx, exportacao) {
    setSecoes(s => s.map((sec, i) => {
      if (i !== secaoIdx) return sec
      return {
        ...sec,
        normas: sec.normas.map((norma, j) =>
          j === normaIdx ? { ...norma, exportacao } : norma
        ),
      }
    }))
    marcarModificado()
  }

  function moverNormaPorDrag(origem, destino) {
    if (!origem || !destino) return
    if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx === destino.normaIdx) return
    if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx + 1 === destino.normaIdx) return
    if (!secoes[origem.secaoIdx]?.normas?.[origem.normaIdx]) return
    if (!secoes[destino.secaoIdx]) return

    setSecoes(prev => {
      if (!prev[origem.secaoIdx]?.normas?.[origem.normaIdx]) return prev
      if (!prev[destino.secaoIdx]) return prev
      const next = prev.map(sec => ({ ...sec, normas: [...(sec.normas || [])] }))
      const [item] = next[origem.secaoIdx].normas.splice(origem.normaIdx, 1)
      if (!item) return prev

      let destinoIdx = destino.normaIdx
      if (origem.secaoIdx === destino.secaoIdx && origem.normaIdx < destino.normaIdx) {
        destinoIdx -= 1
      }
      destinoIdx = Math.max(0, Math.min(destinoIdx, next[destino.secaoIdx].normas.length))
      next[destino.secaoIdx].normas.splice(destinoIdx, 0, item)
      return next
    })
    marcarModificado()
  }

  function moverNormaParaFimPorDrag(origem, secaoIdx) {
    if (!origem) return
    const total = secoes[secaoIdx]?.normas?.length || 0
    moverNormaPorDrag(origem, { secaoIdx, normaIdx: total })
  }

  function iniciarDragNorma(e, secaoIdx, normaIdx) {
    setDragNorma({ secaoIdx, normaIdx })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${secaoIdx}:${normaIdx}`)
  }

  function encerrarDragNorma() {
    setDragNorma(null)
  }

  // ── Modal adicionar norma ───────────────────────────────────────
  function resetarNovaNormaForm() {
    setNovaNormaForm(NOVA_NORMA_FORM_INICIAL)
    setNovaNormaTags([])
    setNovaNormaTagInput('')
    setNovaNormaSugestoes([])
    setErroNovaNorma('')
  }

  function fecharModalNorma() {
    setModalSecaoIdx(null)
    setAbaModalNorma('catalogo')
    resetarNovaNormaForm()
  }

  function calcSugestoesTags(val, tagsAtuais) {
    const q = val.trim().toLowerCase()
    return todasTags
      .filter(t => !tagsAtuais.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 8)
  }

  function onNovaNormaTagInputChange(val) {
    setNovaNormaTagInput(val)
    setNovaNormaSugestoes(calcSugestoesTags(val, novaNormaTags))
  }

  function adicionarNovaNormaTag(nome) {
    const nomeTrim = nome.trim()
    if (!nomeTrim || novaNormaTags.includes(nomeTrim)) return
    setNovaNormaTags(prev => [...prev, nomeTrim])
    setNovaNormaTagInput('')
    setNovaNormaSugestoes([])
  }

  function removerNovaNormaTag(nome) {
    setNovaNormaTags(prev => prev.filter(t => t !== nome))
  }

  function onNovaNormaTagKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      adicionarNovaNormaTag(novaNormaTagInput)
    } else if (e.key === 'Backspace' && !novaNormaTagInput && novaNormaTags.length > 0) {
      removerNovaNormaTag(novaNormaTags[novaNormaTags.length - 1])
    }
  }

  async function abrirModalNorma(secaoIdx) {
    setModalSecaoIdx(secaoIdx)
    setAbaModalNorma('catalogo')
    resetarNovaNormaForm()
    setBuscaNorma('')
    setSomenteVm(false)
    setLoadingNormas(true)
    const [normas, tags] = await Promise.all([
      window.legislator.normas.listar({}),
      window.legislator.normas.tags().catch(() => []),
    ])
    setNormasDisponiveis(normas)
    setTodasTags(tags)
    setLoadingNormas(false)
  }

  function normaJaNaPublicacao(normaId) {
    return secoes.some(s => s.normas.some(n => n.norma_id === normaId))
  }

  function adicionarNorma(norma) {
    setSecoes(s => s.map((sec, i) =>
      i === modalSecaoIdx
        ? { ...sec, normas: [...sec.normas, { pn_id: Date.now(), norma_id: norma.id, tipo: norma.tipo, epigrafe: norma.epigrafe, apelido: norma.apelido, status: norma.status, atualizacao_pendente: norma.atualizacao_pendente, exportacao: exportacaoEfetiva(norma) }] }
        : sec
    ))
    marcarModificado()
  }

  // ── Export ──────────────────────────────────────────────────────
  async function criarNormaEAdicionar(e) {
    e.preventDefault()
    if (!novaNormaForm.epigrafe.trim()) {
      setErroNovaNorma('A epígrafe é obrigatória.')
      return
    }
    setCriandoNorma(true)
    setErroNovaNorma('')
    try {
      const criada = await window.legislator.normas.criar({
        tipo: novaNormaForm.tipo,
        epigrafe: novaNormaForm.epigrafe.trim(),
        apelido: novaNormaForm.apelido.trim(),
        ementa: '',
        tags: novaNormaTags,
      })
      const normaCriada = {
        ...criada,
        tags: novaNormaTags,
        status: criada.status || 'rascunho',
      }
      adicionarNorma(normaCriada)
      setNormasDisponiveis(prev => [...prev, normaCriada])
      fecharModalNorma()
    } catch (err) {
      setErroNovaNorma(err.message || 'Erro ao criar norma.')
    } finally {
      setCriandoNorma(false)
    }
  }

  async function exportar(tipo) {
    try {
      if (modificado) {
        if (!confirm('Há alterações não salvas. Salvar antes de exportar?')) return
        await salvar()
      }

      const pendente = primeiraNormaComAtualizacaoPendente(secoes)
      if (pendente) {
        alert(`A publicação contém norma com Atualização pendente:\n${pendente.epigrafe}\n\nRemova essa marcação nos dados da norma antes de exportar a publicação.`)
        return
      }

      if (tipo === 'word') {
        const result = await window.legislator.publicacoes.exportarWord(parseInt(id))
        if (result?.ok && result.gerados === 0) {
          alert('Nenhuma norma foi exportada. Todas as normas estão configuradas como Ignorar.')
        }
      }
      if (tipo === 'indesign') {
        const result = await window.legislator.publicacoes.exportarInDesign(parseInt(id))
        if (result?.semExportacao) {
          alert('Todas as normas estão configuradas como Ignorar. Nada foi exportado.')
        }
      }
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar a publicação.')
    }
  }

  const normasFiltradas = normasDisponiveis.filter(n =>
    !normaJaNaPublicacao(n.id) &&
    (!somenteVm || normaTemTagVm(n)) &&
    (n.epigrafe.toLowerCase().includes(buscaNorma.toLowerCase()) ||
     (n.apelido ?? '').toLowerCase().includes(buscaNorma.toLowerCase()))
  )

  if (!pub) return <div className="loading">Carregando…</div>

  return (
    <div className="pub-page">

      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="editor-topbar">
        <button
          className="btn-ghost btn-voltar"
          onClick={() => {
            if (modificado && !confirm('Há alterações não salvas. Deseja sair?')) return
            nav('/publicacoes')
          }}
        >← Publicações</button>

        <div className="editor-titulo">
          <div className="editor-titulo-l1">
            <span className="editor-tipo">Publicação</span>
          </div>
          <div className="editor-titulo-l2">
            <span className="editor-epigrafe">{pub.titulo}</span>
          </div>
        </div>

        <div className="editor-acoes">
          <div className="dropdown">
            <button className="btn-ghost">⬇ Exportar ▾</button>
            <div className="dropdown-menu">
              <button onClick={() => exportar('word')}>Word</button>
              <button onClick={() => exportar('indesign')}>InDesign</button>
            </div>
          </div>
          <button
            className={`btn-primary${modificado ? ' btn-salvar-modificado' : ''}`}
            onClick={salvar}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : '💾 Salvar'}
          </button>
        </div>
      </header>

      <div className="pub-body">

        {/* ── Metadados ─────────────────────────────────────────── */}
        <section className="pub-meta-section">
          <h2 className="pub-section-title">Dados da publicação</h2>
          <div className="pub-meta-grid">
            <div className="campo">
              <label>Título *</label>
              <input value={form.titulo} onChange={setField('titulo')} />
            </div>
            <div className="pub-edicao-row">
              <div className="campo pub-edicao-campo">
                <label>Edição</label>
                <input value={form.edicao} onChange={setField('edicao')} placeholder="Ex: 1ª edição" />
              </div>
              <label className={`home-check pub-ultima-edicao-check${form.ultima_edicao ? ' ativo' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(form.ultima_edicao)}
                  onChange={e => { setForm(f => ({ ...f, ultima_edicao: e.target.checked })); marcarModificado() }}
                />
                <span>Última edição</span>
              </label>
            </div>
            <div className="campo">
              <label>Organizador</label>
              <input value={form.organizador} onChange={setField('organizador')} placeholder="Nome do organizador" />
            </div>
            <div className="campo">
              <label>Lançado em</label>
              <input type="date" value={form.lancado_em} onChange={setField('lancado_em')} />
            </div>
            <div className="campo pub-meta-descricao">
              <label>Descrição</label>
              <textarea rows={3} value={form.descricao} onChange={setField('descricao')} placeholder="Descrição da publicação…" />
            </div>
            <div className="campo">
              <label>Caminho na rede</label>
              <input
                value={form.caminho_rede}
                onChange={setField('caminho_rede')}
                placeholder={'Ex: \\\\servidor\\pasta\\publicacao.indd'}
              />
            </div>
            <div className="campo">
              <label>Status</label>
              <select className="status-select" value={form.status} onChange={setField('status')}>
                <option value="previsto">Previsto</option>
                <option value="solicitado">Solicitado</option>
                <option value="em produção">Em produção</option>
                <option value="parado">Parado</option>
                <option value="concluído">Concluído</option>
              </select>
            </div>
          </div>
        </section>

        {/* ── Seções ────────────────────────────────────────────── */}
        <section className="pub-cover-section">
          <h2 className="pub-section-title">Cor da capa</h2>
          <div className="pub-cover-colors">
            {COVER_COLORS.map((cor, idx) => (
              <button
                key={cor}
                type="button"
                className={`pub-cover-color${(form.cor_capa || DEFAULT_COVER_COLOR) === cor ? ' ativa' : ''}`}
                style={{ '--cover-option-color': cor }}
                onClick={() => setCorCapa(cor)}
                title={`Cor ${idx + 1}`}
              />
            ))}
          </div>
        </section>

        <section className="pub-secoes-section">
          <div className="pub-secoes-header">
            <h2 className="pub-section-title">Seções</h2>
            <button className="btn-ghost" onClick={() => { setNovaSecaoTit(''); setModalSecao(true) }}>
              + Nova seção
            </button>
          </div>

          {secoes.length === 0 && (
            <p className="pub-vazio">Nenhuma seção. Clique em "+ Nova seção" para começar.</p>
          )}

          {secoes.map((secao, si) => (
            <div key={si} className="pub-secao">
              <div className="pub-secao-header">
                {editandoSecao === si ? (
                  <input
                    className="pub-secao-titulo-input"
                    autoFocus
                    value={secao.titulo}
                    onChange={e => renomearSecao(si, e.target.value)}
                    onBlur={() => setEditandoSecao(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditandoSecao(null) }}
                  />
                ) : (
                  <h3 className="pub-secao-titulo" onDoubleClick={() => setEditandoSecao(si)}>
                    {secao.titulo}
                  </h3>
                )}
                <div className="pub-secao-controles">
                  <button className="btn-ghost btn-sm" onClick={() => moverSecao(si, -1)} disabled={si === 0} title="Mover para cima">↑</button>
                  <button className="btn-ghost btn-sm" onClick={() => moverSecao(si, 1)} disabled={si === secoes.length - 1} title="Mover para baixo">↓</button>
                  <button className="btn-ghost btn-sm" onClick={() => setEditandoSecao(si)} title="Renomear">✏️</button>
                  <button className="btn-ghost btn-sm" onClick={() => excluirSecao(si)} title="Excluir seção">🗑</button>
                </div>
              </div>

              {/* Lista de normas */}
              <div
                className="pub-normas-lista"
                onDragOver={e => {
                  if (!dragNorma) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={e => {
                  if (!dragNorma) return
                  e.preventDefault()
                  moverNormaParaFimPorDrag(dragNorma, si)
                  encerrarDragNorma()
                }}
              >
                {secao.normas.length === 0 && (
                  <p className="pub-norma-vazio">Nenhuma norma nesta seção.</p>
                )}
                {secao.normas.length > 0 && (
                  <div className="pub-norma-lista-header">
                    <span></span>
                    <span>Norma</span>
                    <span>Exportação</span>
                    <span>Ações</span>
                  </div>
                )}
                {secao.normas.map((n, ni) => {
                  const st = statusNormaInfo(n.status)
                  const exportacao = exportacaoEfetiva(n)
                  const bloqueada = exportacaoBloqueada(n)
                  return (
                    <div
                      key={n.pn_id}
                      className={`pub-norma-item${dragNorma?.secaoIdx === si && dragNorma?.normaIdx === ni ? ' arrastando' : ''}`}
                      onDragOver={e => {
                        if (!dragNorma) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={e => {
                        if (!dragNorma) return
                        e.preventDefault()
                        e.stopPropagation()
                        moverNormaPorDrag(dragNorma, { secaoIdx: si, normaIdx: ni })
                        encerrarDragNorma()
                      }}
                    >
                      <span
                        className="pub-norma-drag-handle"
                        title="Arrastar para reordenar"
                        draggable
                        onDragStart={e => iniciarDragNorma(e, si, ni)}
                        onDragEnd={encerrarDragNorma}
                      >⋮⋮</span>
                      <div
                        className="pub-norma-info pub-norma-info-link"
                        title="Abrir no editor"
                        onClick={() => nav(`/editor/${n.norma_id}`)}
                      >
                        <span className="pub-norma-tipo">{n.tipo}</span>
                        <span className={`pub-norma-status pub-norma-status-${st.cls}`}>{st.label}</span>
                        <span className="pub-norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</span>
                        {n.apelido && <span className="pub-norma-apelido">{n.apelido}</span>}
                      </div>
                      <div className="pub-norma-exportacao">
                        <select
                          value={exportacao}
                          disabled={bloqueada}
                          onChange={e => alterarExportacaoNorma(si, ni, e.target.value)}
                          title={n.atualizacao_pendente ? 'Bloqueada por Atualização pendente' : bloqueada ? 'Disponível apenas para normas finalizadas' : 'Configurar exportação'}
                        >
                          {EXPORTACAO_OPCOES.map(op => (
                            <option key={op.valor} value={op.valor}>{op.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="pub-norma-controles">
                        <button className="btn-ghost btn-sm" onClick={() => moverNorma(si, ni, -1)} disabled={ni === 0}>↑</button>
                        <button className="btn-ghost btn-sm" onClick={() => moverNorma(si, ni, 1)} disabled={ni === secao.normas.length - 1}>↓</button>
                        <button className="btn-ghost btn-sm" onClick={() => removerNormaDaSecao(si, n.pn_id)}>✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button className="btn-ghost pub-add-norma" onClick={() => abrirModalNorma(si)}>
                + Adicionar norma
              </button>
            </div>
          ))}
        </section>
      </div>

      {/* ── Modal: adicionar norma ─────────────────────────────── */}
      {modalSecaoIdx !== null && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) fecharModalNorma() }}>
          <div className="modal-box modal-norma-picker" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Adicionar norma — ${secoes[modalSecaoIdx]?.titulo}</h3>
              <button className="btn-ghost modal-fechar" onClick={fecharModalNorma}>✕</button>
            </div>
            <div className="modal-norma-abas">
              <button
                type="button"
                className={abaModalNorma === 'catalogo' ? 'ativa' : ''}
                onClick={() => setAbaModalNorma('catalogo')}
              >
                Escolher existente
              </button>
              <button
                type="button"
                className={abaModalNorma === 'nova' ? 'ativa' : ''}
                onClick={() => setAbaModalNorma('nova')}
              >
                Criar nova norma
              </button>
            </div>
            <div className="modal-norma-picker-body">
              {abaModalNorma === 'catalogo' ? (
                <>
                  <div className="modal-norma-filtros">
                    <input
                      className="input-busca"
                      autoFocus
                      placeholder="Buscar por epígrafe ou apelido..."
                      value={buscaNorma}
                      onChange={e => setBuscaNorma(e.target.value)}
                    />
                    <label className={`home-check${somenteVm ? ' ativo' : ''}`}>
                      <input
                        type="checkbox"
                        checked={somenteVm}
                        onChange={e => setSomenteVm(e.target.checked)}
                      />
                      <span>Vade mecum</span>
                    </label>
                  </div>
                  <div className="modal-norma-lista">
                    {loadingNormas ? (
                      <p className="pub-vazio">Carregando...</p>
                    ) : normasFiltradas.length === 0 ? (
                      <p className="pub-vazio">Nenhuma norma disponível.</p>
                    ) : normasFiltradas.map(n => {
                      const st = statusNormaInfo(n.status)
                      return (
                        <button
                          key={n.id}
                          className="modal-norma-item"
                          onClick={() => { adicionarNorma(n); fecharModalNorma() }}
                        >
                          <span className="pub-norma-tipo">{n.tipo}</span>
                          <span className={`pub-norma-status pub-norma-status-${st.cls}`}>{st.label}</span>
                          <span className="pub-norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</span>
                          {n.apelido && <span className="pub-norma-apelido">{n.apelido}</span>}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <form className="modal-nova-norma-form" onSubmit={criarNormaEAdicionar}>
                  <div className="campo">
                    <label>Tipo *</label>
                    <select
                      value={novaNormaForm.tipo}
                      onChange={e => setNovaNormaForm(f => ({ ...f, tipo: e.target.value }))}
                    >
                      {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="campo">
                    <label>Epígrafe *</label>
                    <input
                      autoFocus
                      value={novaNormaForm.epigrafe}
                      onChange={e => setNovaNormaForm(f => ({ ...f, epigrafe: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="campo">
                    <label>Apelido <span className="campo-opcional">(opcional)</span></label>
                    <input
                      value={novaNormaForm.apelido}
                      onChange={e => setNovaNormaForm(f => ({ ...f, apelido: e.target.value }))}
                    />
                  </div>
                  <div className="campo">
                    <label>Tags <span className="campo-opcional">(opcional)</span></label>
                    <div className="tag-input-wrap">
                      {novaNormaTags.map(t => (
                        <span key={t} className="tag-chip">
                          {t}
                          <button type="button" className="tag-chip-remover" onClick={() => removerNovaNormaTag(t)}>×</button>
                        </span>
                      ))}
                      <input
                        className="tag-input"
                        placeholder={novaNormaTags.length === 0 ? 'Adicionar tag...' : ''}
                        value={novaNormaTagInput}
                        onChange={e => onNovaNormaTagInputChange(e.target.value)}
                        onFocus={() => setNovaNormaSugestoes(calcSugestoesTags(novaNormaTagInput, novaNormaTags))}
                        onBlur={() => setTimeout(() => setNovaNormaSugestoes([]), 150)}
                        onKeyDown={onNovaNormaTagKeyDown}
                      />
                    </div>
                    {novaNormaSugestoes.length > 0 && (
                      <ul className="tag-sugestoes">
                        {novaNormaSugestoes.map(t => (
                          <li key={t}>
                            <button type="button" onClick={() => adicionarNovaNormaTag(t)}>{t}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {erroNovaNorma && <p className="form-erro">{erroNovaNorma}</p>}
                  <div className="form-acoes">
                    <button type="button" className="btn-ghost" onClick={fecharModalNorma}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={criandoNorma || !novaNormaForm.epigrafe.trim()}>
                      {criandoNorma ? 'Criando...' : 'Criar e adicionar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nova seção ──────────────────────────────────── */}
      {modalSecao && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModalSecao(false) }}>
          <div className="modal-box" style={{ width: 'min(380px, 96vw)' }} onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nova seção</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setModalSecao(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="campo">
                <label>Título da seção</label>
                <input
                  autoFocus
                  value={novaSecaoTit}
                  onChange={e => setNovaSecaoTit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') adicionarSecao() }}
                  placeholder="Ex: Jurisprudência"
                />
              </div>
              <div className="form-acoes">
                <button className="btn-ghost" onClick={() => setModalSecao(false)}>Cancelar</button>
                <button className="btn-primary" onClick={adicionarSecao} disabled={!novaSecaoTit.trim()}>Adicionar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
