import { useState, useEffect } from 'react'

/**
 * Páginas pré-textuais da publicação (exportação IDML): rosto, créditos, ficha catalográfica e
 * colofão. Campo vazio = valor automático (mostrado em cinza) ou, na ficha, "[a preencher]" no
 * IDML. Mesa e créditos da Câmara são comuns a todas as publicações (cadastro institucional).
 */

const GRUPOS = [
  {
    titulo: 'Rosto',
    campos: [
      { k: 'tituloRosto', rot: 'Título no rosto (uma linha por linha)', tipo: 'area', linhas: 3, auto: p => tituloEmLinhas(p.titulo).join('\n') },
      { k: 'organizadores', rot: 'Organizadores (uma linha por nome)', tipo: 'area', linhas: 3, auto: p => (p.organizador || '').split(/\s+e\s+|;\s*/).join('\n') },
      { k: 'atualizacao', rot: 'Edição atualizada até', auto: () => 'data da alteração mais recente das normas' },
    ],
  },
  {
    titulo: 'Créditos',
    campos: [
      { k: 'equipe', rot: 'Equipe (uma linha por função: "Revisão: Nome")', tipo: 'area', linhas: 5, largo: true },
      { k: 'notaEditor', rot: 'Nota do editor', tipo: 'area', linhas: 2, largo: true },
      { k: 'historicoEdicoes', rot: 'Edições anteriores', tipo: 'area', linhas: 2, largo: true },
      { k: 'linhaSerie', rot: 'Linha e série', auto: p => linhaDaDescricao(p.descricao) },
    ],
  },
  {
    titulo: 'Ficha catalográfica',
    campos: [
      { k: 'serie', rot: 'Série', auto: p => p.descricao?.match(/S[ée]rie\s+[^,;.]+/i)?.[0] || '' },
      { k: 'serieNumero', rot: 'Número na série', auto: p => p.descricao?.match(/\bn\.\s*\d+/i)?.[0] || '' },
      { k: 'bibliotecaria', rot: 'Bibliotecária (nome – CRB)' },
      { k: 'paginas', rot: 'Nº de páginas', auto: () => 'conferir depois da diagramação' },
      { k: 'fichaEntrada', rot: 'Entrada principal', auto: () => 'Brasil. Congresso Nacional. Câmara dos Deputados.' },
      { k: 'fichaDescricao', rot: 'Descrição', tipo: 'area', linhas: 2, largo: true, auto: p => `${p.titulo || ''}. -- ${(String(p.edicao || '').match(/\d+/) || [''])[0]}. ed. -- Brasília : Câmara dos Deputados, Edições Câmara, ${new Date().getFullYear()}.` },
      { k: 'assuntos', rot: 'Assuntos', tipo: 'area', linhas: 2, largo: true },
      { k: 'cdu', rot: 'CDU' },
      { k: 'isbnPapel', rot: 'ISBN (papel)' },
      { k: 'isbnEbook', rot: 'ISBN (e-book)' },
    ],
  },
  {
    titulo: 'Colofão',
    campos: [
      { k: 'mesImpressao', rot: 'Impresso em', auto: () => mesAtual() },
    ],
  },
]

function tituloEmLinhas(titulo) {
  const palavras = String(titulo || '').trim().split(/\s+/).filter(Boolean)
  if (palavras.length <= 3) return palavras.map(p => p.toLocaleUpperCase('pt-BR'))
  const total = palavras.join(' ').length
  const out = [[], [], []]
  let i = 0, acumulado = 0
  for (const p of palavras) {
    if (i < 2 && acumulado > (total / 3) * (i + 1) && out[i].length) i++
    out[i].push(p)
    acumulado += p.length + 1
  }
  return out.map(l => l.join(' ').toLocaleUpperCase('pt-BR')).filter(Boolean)
}
const linhaDaDescricao = d => String(d || '').replace(/,\s*n\.\s*\d+/i, '').trim().replace(/(.)\.?$/, '$1.')
const mesAtual = () => `${new Date().toLocaleString('pt-BR', { month: 'long' })} de ${new Date().getFullYear()}`

export function lerPretextuais(v) {
  if (!v) return {}
  if (typeof v === 'object') return v
  try { return JSON.parse(v) || {} } catch { return {} }
}

export default function PretextuaisPublicacao({ form, valores, onChange }) {
  const [aberto, setAberto] = useState(false)
  const [modalInst, setModalInst] = useState(false)
  const set = k => e => onChange({ ...valores, [k]: e.target.value })
  const preenchidos = Object.values(valores || {}).filter(v => String(v || '').trim()).length

  return (
    <section className="pub-meta-section pub-pretextuais">
      <div className="pub-pretextuais-header">
        <button type="button" className="pub-pretextuais-toggle" onClick={() => setAberto(a => !a)}>
          <span className="pub-section-title" style={{ margin: 0 }}>{aberto ? '▾' : '▸'} Páginas pré-textuais (IDML)</span>
          {!aberto && <span className="pub-pretextuais-resumo">{preenchidos ? `${preenchidos} campo(s) preenchido(s)` : 'valores automáticos'}</span>}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setModalInst(true)}>Créditos da Câmara…</button>
      </div>
      {aberto && (
        <>
          <p className="pub-pretextuais-dica">Campo vazio usa o valor em cinza. Na ficha, o que ficar vazio sai no IDML como “[a preencher: …]”.</p>
          {GRUPOS.map(g => (
            <div key={g.titulo} className="pub-pretextuais-grupo">
              <h3>{g.titulo}</h3>
              <div className="pub-meta-grid">
                {g.campos.map(c => {
                  const ph = c.auto ? c.auto(form) : ''
                  return (
                    <div key={c.k} className={`campo${c.largo ? ' pub-meta-descricao' : ''}`}>
                      <label>{c.rot}</label>
                      {c.tipo === 'area'
                        ? <textarea rows={c.linhas || 2} value={valores[c.k] || ''} onChange={set(c.k)} placeholder={ph} />
                        : <input value={valores[c.k] || ''} onChange={set(c.k)} placeholder={ph} />}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
      {modalInst && <ModalInstitucional onFechar={() => setModalInst(false)} />}
    </section>
  )
}

/** Cadastro institucional: Mesa e créditos da Câmara, comuns a todas as publicações. */
function ModalInstitucional({ onFechar }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    window.legislator.configuracoes.buscar('institucional')
      .then(r => setDados(r?.valor || {}))
      .catch(e => { setDados({}); setErro(`Não foi possível carregar: ${e?.message || e}. Se o servidor ainda não foi atualizado, o cadastro não será salvo.`) })
  }, [])
  const set = k => e => setDados(d => ({ ...d, [k]: e.target.value }))

  async function salvar() {
    setSalvando(true)
    try {
      await window.legislator.configuracoes.salvar('institucional', dados)
      onFechar()
    } catch (e) {
      setErro(`Não foi possível salvar: ${e?.message || e}`)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="modal-box" style={{ width: 'min(640px, 96vw)' }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Créditos da Câmara</h3>
          <button className="btn-ghost modal-fechar" onClick={onFechar}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '75vh', overflow: 'auto' }}>
          <p className="pub-pretextuais-dica">Vale para todas as publicações exportadas em IDML.</p>
          {!dados ? <p className="pub-vazio">Carregando…</p> : (
            <>
              <p className="pub-pretextuais-dica">Legislatura e Mesa ficam em Configurações → Mesa diretora.</p>
              <div className="campo">
                <label>Créditos institucionais — uma linha por órgão (“Órgão: Nome”)</label>
                <textarea rows={7} value={dados.creditos || ''} onChange={set('creditos')}
                  placeholder={'Diretoria-Geral: …\nCentro de Documentação e Informação: …\nCoordenação Edições Câmara: …'} />
              </div>
            </>
          )}
          {erro && <p className="pub-pretextuais-erro">{erro}</p>}
          <div className="form-acoes">
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button className="btn-primary" onClick={salvar} disabled={!dados || salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
