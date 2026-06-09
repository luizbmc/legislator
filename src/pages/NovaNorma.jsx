import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'

const DOC_VAZIO = '{"type":"doc","content":[]}'

function formInicial(origem) {
  if (!origem) {
    return {
      tipo: 'Lei Ordinária',
      epigrafe: '',
      apelido: '',
      ementa: '',
      dados_publicacao: '',
      data_ultima_alteracao: '',
      atualizacao_pendente: false,
      vigencia: 'Vigente',
      link_acesso: '',
      anexo: '',
      observacoes: '',
    }
  }

  return {
    tipo: origem.tipo || 'Lei Ordinária',
    epigrafe: `Cópia de ${origem.epigrafe || ''}`.trim(),
    apelido: origem.apelido || '',
    ementa: origem.ementa || '',
    dados_publicacao: origem.dados_publicacao || '',
    data_ultima_alteracao: origem.data_ultima_alteracao || '',
    atualizacao_pendente: Boolean(origem.atualizacao_pendente),
    vigencia: origem.vigencia || 'Vigente',
    link_acesso: origem.link_acesso || '',
    anexo: origem.anexo || '',
    observacoes: origem.observacoes || '',
  }
}

export default function NovaNorma() {
  const nav = useNavigate()
  const location = useLocation()
  const duplicarNorma = location.state?.duplicarNorma || null
  const [form,     setForm]     = useState(() => formInicial(duplicarNorma))
  const [tags,     setTags]     = useState(() => duplicarNorma?.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [sugestoes, setSugestoes] = useState([])
  const [todasTags, setTodasTags] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState('')

  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))
  const setCheck = campo => e => setForm(f => ({ ...f, [campo]: e.target.checked }))

  useEffect(() => {
    window.legislator.normas.tags().then(setTodasTags).catch(() => {})
  }, [])

  function calcSugestoes(val) {
    const q = val.trim().toLowerCase()
    return todasTags
      .filter(t => !tags.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 8)
  }

  function onTagInputChange(val) {
    setTagInput(val)
    setSugestoes(calcSugestoes(val))
  }

  function adicionarTag(nome) {
    const nomeTrim = nome.trim()
    if (!nomeTrim || tags.includes(nomeTrim)) return
    setTags(prev => [...prev, nomeTrim])
    setTagInput('')
    setSugestoes([])
  }

  function removerTag(nome) {
    setTags(prev => prev.filter(t => t !== nome))
  }

  function onTagKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      adicionarTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removerTag(tags[tags.length - 1])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.epigrafe.trim()) { setErro('A epígrafe é obrigatória.'); return }
    setSalvando(true)
    setErro('')
    try {
      const norma = await window.legislator.normas.criar({ ...form, tags })
      if (duplicarNorma) {
        await window.legislator.normas.salvar(norma.id, {
          conteudo_doc: duplicarNorma.conteudo_doc || DOC_VAZIO,
          conteudo_txt: duplicarNorma.conteudo_txt || '',
          status: duplicarNorma.status || 'rascunho',
          data_atualizacao: duplicarNorma.data_atualizacao || null,
        })
      }
      nav(`/editor/${norma.id}`)
    } catch (err) {
      setErro(err.message || 'Erro ao criar norma.')
      setSalvando(false)
    }
  }

  return (
    <div className="nova-norma-page">
      <div className="nova-norma-card">
        <div className="nova-norma-header">
          <button className="btn-ghost" onClick={() => nav('/')}>← Voltar</button>
          <h2>{duplicarNorma ? 'Duplicar norma' : 'Nova norma'}</h2>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="campo">
            <label>Tipo *</label>
            <select value={form.tipo} onChange={set('tipo')}>
              {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="campo">
            <label>Epígrafe *</label>
            <input
              autoFocus
              placeholder="Ex: Lei nº 9.610, de 19 de fevereiro de 1998"
              value={form.epigrafe}
              onChange={set('epigrafe')}
              required
            />
          </div>

          <div className="campo">
            <label>Apelido <span className="campo-opcional">(opcional)</span></label>
            <input
              placeholder="Ex: Lei de Direitos Autorais"
              value={form.apelido}
              onChange={set('apelido')}
            />
          </div>

          <div className="campo">
            <label>Ementa <span className="campo-opcional">(opcional)</span></label>
            <textarea
              rows={3}
              placeholder="Dispõe sobre…"
              value={form.ementa}
              onChange={set('ementa')}
            />
          </div>

          <div className="form-secao">
            <h3>Dados complementares</h3>
            <div className="campo">
              <label>Dados de publicação, republicação e retificação <span className="campo-opcional">(opcional)</span></label>
              <textarea
                rows={3}
                value={form.dados_publicacao}
                onChange={set('dados_publicacao')}
              />
            </div>

            <div className="form-grid-2">
              <div className="campo">
                <label>Data da última alteração <span className="campo-opcional">(opcional)</span></label>
                <input
                  type="date"
                  value={form.data_ultima_alteracao}
                  onChange={set('data_ultima_alteracao')}
                />
              </div>
              <div className="campo campo-check">
                <label className={`home-check pendente-check${form.atualizacao_pendente ? ' ativo' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.atualizacao_pendente)}
                    onChange={setCheck('atualizacao_pendente')}
                  />
                  {form.atualizacao_pendente && <span className="pendente-check-alerta" aria-hidden="true">⚠️</span>}
                  <span>Atualização pendente</span>
                </label>
              </div>
              <div className="campo">
                <label>Vigência</label>
                <input
                  value={form.vigencia}
                  onChange={set('vigencia')}
                />
              </div>
            </div>

            <div className="campo">
              <label>Link para acesso <span className="campo-opcional">(opcional)</span></label>
              <input
                type="url"
                value={form.link_acesso}
                onChange={set('link_acesso')}
              />
            </div>

            <div className="campo">
              <label>Anexo <span className="campo-opcional">(opcional)</span></label>
              <input
                value={form.anexo}
                onChange={set('anexo')}
              />
            </div>

            <div className="campo">
              <label>Outras observações <span className="campo-opcional">(opcional)</span></label>
              <textarea
                rows={3}
                value={form.observacoes}
                onChange={set('observacoes')}
              />
            </div>
          </div>

          <div className="campo">
            <label>Tags <span className="campo-opcional">(opcional)</span></label>
            <div className="tag-input-wrap">
              {tags.map(t => (
                <span key={t} className="tag-chip">
                  {t}
                  <button type="button" className="tag-chip-remover" onClick={() => removerTag(t)}>×</button>
                </span>
              ))}
              <input
                className="tag-input"
                placeholder={tags.length === 0 ? 'Adicionar tag…' : ''}
                value={tagInput}
                onChange={e => onTagInputChange(e.target.value)}
                onFocus={() => setSugestoes(calcSugestoes(tagInput))}
                onBlur={() => setTimeout(() => setSugestoes([]), 150)}
                onKeyDown={onTagKeyDown}
              />
            </div>
            {sugestoes.length > 0 && (
              <ul className="tag-sugestoes">
                {sugestoes.map(t => (
                  <li key={t}>
                    <button type="button" onClick={() => adicionarTag(t)}>{t}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {erro && <p className="form-erro">{erro}</p>}

          <div className="form-acoes">
            <button type="button" className="btn-ghost" onClick={() => nav('/')}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary"
              disabled={salvando || !form.epigrafe.trim()}>
              {salvando ? 'Criando…' : duplicarNorma ? 'Criar cópia e editar →' : 'Criar e editar →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
