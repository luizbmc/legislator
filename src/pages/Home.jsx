import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'
import logoNormando from '../logo.png'

const STATUS_LABELS = {
  rascunho:   { label: 'Rascunho',   cor: '#f59e0b' },
  revisao:    { label: 'Em revisão', cor: '#3b82f6' },
  finalizado: { label: 'Finalizado', cor: '#10b981' },
}

const AJUDA_TOPICOS = [
  {
    titulo: 'Como atualizar uma norma',
    itens: [
      'Abra a norma no catálogo. O editor inicia em modo de leitura para evitar alterações acidentais.',
      'Clique em Atualizar norma para abrir o painel de atualização.',
      'No painel, escolha se a nova versão virá de arquivo externo ou de uma norma já cadastrada no catálogo.',
      'Quando o texto novo estiver carregado, confira as opções de comparação antes de confirmar a substituição.',
      'Use Ignorar alterações de nota quando quiser evitar que mudanças apenas em notas sejam computadas como alteração do parágrafo.',
      'Depois da confirmação, salve a norma para gravar a versão atualizada no banco.',
    ],
    botoes: ['Atualizar norma', 'Arquivo', 'Do catálogo', 'Ignorar alterações de nota', 'Confirmar atualização', 'Salvar'],
  },
  {
    titulo: 'Como organizar uma nova publicação',
    itens: [
      'Entre em Publicações, crie uma publicação e preencha os dados principais.',
      'Crie seções, adicione normas existentes ou cadastre uma nova norma diretamente no painel de adição.',
      'Ordene as normas por arrastar e soltar e defina, em Exportação, se cada norma será ignorada, atualização ou completa.',
    ],
  },
  {
    titulo: 'Função dos botões do editor de normas',
    itens: [
      'Buscar abre o painel de localização, substituição, regex, aplicação de estilo e buscas salvas.',
      'O buscador de artigo leva direto ao dispositivo informado, por exemplo Art. 15 ou 15.',
      'Padronização abre verificações de palavras compostas, siglas, acentuação e itálicos, com navegação pelas ocorrências.',
      'Exibir caracteres ocultos alterna marcas visuais de espaços, quebras e outros caracteres de controle.',
      'Indicador de estilo mostra, ao lado da página, o estilo aplicado a cada parágrafo.',
      'Ver notas abre o navegador de notas legislativas; + Nota de rodapé insere uma nota na posição do cursor.',
      'Exportar gera saídas da norma atual; Salvar grava as alterações no banco.',
      'Zoom aumenta ou reduz a página apenas na visualização do editor.',
    ],
    botoes: ['Buscar', 'Artigo', 'Padronização', 'Exibir caracteres ocultos', 'Indicador de estilo', 'Ver notas', '+ Nota de rodapé', 'Exportar', 'Salvar', 'Zoom'],
  },
  {
    titulo: 'Como exportar uma norma',
    itens: [
      'Abra a norma no editor e use Exportar.',
      'Escolha o formato desejado, como XML, Word ou HTML, conforme o fluxo de diagramação ou revisão.',
      'Também é possível exportar apenas a seleção ativa quando houver texto selecionado no editor.',
    ],
  },
  {
    titulo: 'Como exportar uma publicação completa',
    itens: [
      'Abra a publicação, confira seções, ordem das normas e o campo Exportação de cada item.',
      'Clique em Exportar e escolha Word ou InDesign.',
      'Para InDesign, o sistema cria pastas por seção e exporta XML completo, XML de atualização ou arquivos vazios marcados como PULAR.',
      'Para Word, as normas finalizadas são exportadas completas; itens marcados como Ignorar não entram na saída.',
    ],
  },
]

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

function AvisoAtualizacaoPendente({ norma }) {
  if (!norma?.atualizacao_pendente) return null
  return <span className="norma-pendente-icone" title="Atualização pendente">⚠️</span>
}

export default function Home() {
  const nav = useNavigate()
  const [normas,  setNormas]  = useState([])
  const [busca,   setBusca]   = useState('')
  const [tipo,    setTipo]    = useState('')
  const [status,  setStatus]  = useState('')
  const [tagFiltro, setTagFiltro] = useState('')
  const [todasTags, setTodasTags] = useState([])
  const [buscarConteudo, setBuscarConteudo] = useState(false)
  const [somenteVm, setSomenteVm] = useState(false)
  const [visao,   setVisao]   = useState('cards')
  const [loading, setLoading] = useState(true)
  const [ajudaAberta, setAjudaAberta] = useState(false)

  useEffect(() => {
    setLoading(true)
    window.legislator.normas.listar({ busca, tipo, status, buscarConteudo })
      .then(setNormas)
      .finally(() => setLoading(false))
  }, [busca, tipo, status, buscarConteudo])

  useEffect(() => {
    window.legislator.normas.tags()
      .then(tags => setTodasTags(Array.isArray(tags) ? tags : []))
      .catch(() => setTodasTags([]))
  }, [])

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
  const tagsDisponiveis = useMemo(() => {
    const mapa = new Map()
    todasTags.forEach(tag => {
      const nome = String(tag || '').trim()
      if (nome) mapa.set(normalizarBusca(nome), nome)
    })
    normas.forEach(norma => {
      const tagsNorma = norma.tags || []
      tagsNorma.forEach(tag => {
        const nome = String(tag || '').trim()
        if (nome) mapa.set(normalizarBusca(nome), nome)
      })
    })
    return Array.from(mapa.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [normas, todasTags])
  const normasFiltradasPorBusca = buscarConteudo
    ? normas
    : normas.filter(n => normaBateNaBuscaPrincipal(n, termoBuscaPrincipal))
  const tagFiltroNormalizada = normalizarBusca(tagFiltro)
  const normasFiltradasPorTag = tagFiltro
    ? normasFiltradasPorBusca.filter(n => (n.tags || []).some(tag => normalizarBusca(tag) === tagFiltroNormalizada))
    : normasFiltradasPorBusca
  const normasVisiveis = somenteVm
    ? normasFiltradasPorTag.filter(normaTemTagVm)
    : normasFiltradasPorTag

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-brand">
          <img className="home-logo-img" src={logoNormando} alt="" />
          <h1 className="home-logo">Normando</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => setAjudaAberta(true)}>
            Ajuda
          </button>
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
        <select className="home-tag-select" value={tagFiltro} onChange={e => setTagFiltro(e.target.value)}>
          <option value="">Todas as tags</option>
          {tagsDisponiveis.map(tag => <option key={tag} value={tag}>{tag}</option>)}
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
                <div className="norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</div>
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
                    <td className="catalog-table-title"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</td>
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

      {ajudaAberta && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAjudaAberta(false) }}>
          <div className="modal-box ajuda-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ajuda do Normando</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setAjudaAberta(false)}>×</button>
            </div>
            <div className="ajuda-conteudo">
              {AJUDA_TOPICOS.map(topico => (
                <section key={topico.titulo} className="ajuda-topico">
                  <h4>{topico.titulo}</h4>
                  {topico.botoes && (
                    <div className="ajuda-botoes" aria-label={`Botões relacionados a ${topico.titulo}`}>
                      {topico.botoes.map(botao => <span key={botao} className="ajuda-botao">{botao}</span>)}
                    </div>
                  )}
                  <ul>
                    {topico.itens.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
