import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'
import { descricaoDisponibilidade } from '../constants/estilosLegislator.js'
import {
  FORMATO_CARACTERE_PADRAO,
  FORMATO_PARAGRAFO_PADRAO,
  OPCOES_FORMATACAO,
  carregarPreferenciasEstilo,
  cssFormatoCaractere,
  cssFormatoParagrafo,
  estilosCaractereConfigurados,
  estilosParagrafoConfigurados,
  idEstiloCustom,
  normalizarTiposNorma,
  salvarPreferenciasEstilo,
  slugEstilo,
  tiposNormaTexto,
} from '../services/preferenciasEstilo.js'
import {
  carregarUsuarioComentarioAtual,
  carregarUsuariosComentarios,
  CORES_USUARIO_COMENTARIO,
  criarUsuarioComentario,
  iniciaisUsuario,
  limparUsuarioComentarioAtual,
  salvarUsuariosComentarios,
  selecionarUsuarioComentario,
} from '../services/usuariosComentarios.js'

function tagText(valor) {
  if (!valor) return '-'
  if (String(valor).includes('+')) {
    return String(valor).split('+').map(parte => `<${parte.trim()}>`).join(' + ')
  }
  return `<${valor}>`
}

function codeText(valor) {
  return valor || '-'
}

function campoId(tipo) {
  return tipo === 'paragrafo' ? 'node' : 'id'
}

function valorBase(estilo, campo) {
  if (campo === 'importTag') return estilo.importTag ?? estilo.xmlTag ?? ''
  if (campo === 'exportTag') return estilo.exportTag ?? estilo.xmlTag ?? ''
  return estilo[campo] ?? ''
}

function formatoPadrao(tipo) {
  return tipo === 'paragrafo' ? FORMATO_PARAGRAFO_PADRAO : FORMATO_CARACTERE_PADRAO
}

function estiloNovo(tipo) {
  return {
    label: '',
    importTag: '',
    exportTag: '',
    htmlImport: '',
    cssClass: '',
    tiposNorma: [],
    format: { ...formatoPadrao(tipo) },
  }
}

function formatResumo(tipo, format) {
  const f = { ...formatoPadrao(tipo), ...(format || {}) }
  if (tipo === 'paragrafo') {
    return `Fonte ${f.tamanhoFonte}, ${f.corFonte}, ${f.alinhamento}, indentação ${f.indentacao ? 'sim' : 'não'}`
  }
  return `Fonte ${f.tamanhoFonte}, ${f.corFonte}, itálico ${f.italico ? 'sim' : 'não'}, negrito ${f.negrito ? 'sim' : 'não'}`
}

function LinhaEstilo({ estilo, tipo, onEditar, onExcluir }) {
  const classe = tipo === 'paragrafo'
    ? `leg-${estilo.cssClass || estilo.node || estilo.id}`
    : (estilo.cssClass || estilo.id)
  const disponibilidade = tiposNormaTexto(estilo) || descricaoDisponibilidade(estilo)

  return (
    <tr className={estilo.interno ? 'config-estilo-interno' : ''}>
      <td>
        <div className="config-estilo-nome">{estilo.label}</div>
        <div className="config-estilo-id">{estilo[campoId(tipo)]}</div>
      </td>
      <td>{disponibilidade}</td>
      <td><code>{tagText(valorBase(estilo, 'importTag'))}</code></td>
      <td className="config-html-import"><code>{codeText(estilo.htmlImport)}</code></td>
      <td><code>{tagText(valorBase(estilo, 'exportTag'))}</code></td>
      <td><code>{classe}</code></td>
      <td>{estilo.custom ? formatResumo(tipo, estilo.format) : '-'}</td>
      <td>
        {estilo.interno ? (
          <span className="config-badge config-badge-muted">Interno</span>
        ) : estilo.custom ? (
          <span className="config-badge config-badge-ok">Personalizado</span>
        ) : estilo.combinado ? (
          <span className="config-badge">Combinado</span>
        ) : (
          <span className="config-badge config-badge-muted">Nativo</span>
        )}
      </td>
      <td className="config-acoes">
        {!estilo.interno && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onEditar(estilo)}>
            Editar
          </button>
        )}
        {estilo.custom && (
          <button type="button" className="btn-ghost btn-sm danger" onClick={() => onExcluir(estilo)}>
            Excluir
          </button>
        )}
      </td>
    </tr>
  )
}

function CampoTexto({ label, value, onChange, disabled = false, placeholder = '' }) {
  return (
    <label className="config-form-campo">
      <span>{label}</span>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </label>
  )
}

function CampoSelect({ label, value, opcoes, onChange }) {
  return (
    <label className="config-form-campo">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {opcoes.map(op => (
          typeof op === 'string'
            ? <option key={op} value={op}>{op}</option>
            : <option key={op.id} value={op.id}>{op.label}</option>
        ))}
      </select>
    </label>
  )
}

function CampoBooleano({ label, checked, onChange }) {
  return (
    <label className="config-check">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function EditorFormato({ tipo, format, onChange }) {
  const f = { ...formatoPadrao(tipo), ...(format || {}) }
  const set = (campo, valor) => onChange({ ...f, [campo]: valor })

  return (
    <div className="config-form-bloco">
      <h3>Formatação</h3>
      <div className="config-form-grid">
        <CampoSelect label="Tamanho da fonte" value={f.tamanhoFonte} opcoes={OPCOES_FORMATACAO.tamanhos} onChange={v => set('tamanhoFonte', v)} />
        <CampoSelect label="Cor da fonte" value={f.corFonte} opcoes={OPCOES_FORMATACAO.cores} onChange={v => set('corFonte', v)} />
        {tipo === 'paragrafo' && (
          <>
            <CampoSelect label="Alinhamento" value={f.alinhamento} opcoes={OPCOES_FORMATACAO.alinhamentos} onChange={v => set('alinhamento', v)} />
            <CampoSelect label="Espaço anterior" value={f.espacoAntes} opcoes={OPCOES_FORMATACAO.espacamentos} onChange={v => set('espacoAntes', v)} />
            <CampoSelect label="Espaço posterior" value={f.espacoDepois} opcoes={OPCOES_FORMATACAO.espacamentos} onChange={v => set('espacoDepois', v)} />
          </>
        )}
      </div>
      <div className="config-check-grid">
        {tipo === 'paragrafo' && <CampoBooleano label="Indentação" checked={f.indentacao} onChange={v => set('indentacao', v)} />}
        <CampoBooleano label="Itálico" checked={f.italico} onChange={v => set('italico', v)} />
        <CampoBooleano label="Negrito" checked={f.negrito} onChange={v => set('negrito', v)} />
      </div>
      <div
        className="config-preview-aplicada"
        style={Object.fromEntries(
          (tipo === 'paragrafo' ? cssFormatoParagrafo(f) : cssFormatoCaractere(f))
            .split(';')
            .map(regra => regra.trim())
            .filter(Boolean)
            .map(regra => {
              const idx = regra.indexOf(':')
              const prop = regra.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())
              return [prop, regra.slice(idx + 1).trim()]
            })
        )}
      >
        {tipo === 'paragrafo' ? 'Parágrafo de exemplo do estilo personalizado.' : 'Trecho de exemplo'}
      </div>
    </div>
  )
}

function EditorTiposNorma({ value, onChange }) {
  const selecionados = new Set(value || [])
  const todos = selecionados.size === 0

  function alternar(tipo) {
    const prox = new Set(selecionados)
    if (prox.has(tipo)) prox.delete(tipo)
    else prox.add(tipo)
    onChange(normalizarTiposNorma([...prox]))
  }

  return (
    <div className="config-form-bloco">
      <h3>Tipos de livro ativos</h3>
      <label className="config-check">
        <input type="checkbox" checked={todos} onChange={() => onChange([])} />
        <span>Todos os tipos</span>
      </label>
      <div className={`config-tipos-grid${todos ? ' desabilitado' : ''}`}>
        {TIPOS_NORMA.map(tipo => (
          <label key={tipo} className="config-check">
            <input
              type="checkbox"
              checked={todos || selecionados.has(tipo)}
              disabled={todos}
              onChange={() => alternar(tipo)}
            />
            <span>{tipo}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function PainelEdicao({ tipo, modo, inicial, onSalvar, onCancelar }) {
  const existente = modo === 'editar-nativo'
  const [form, setForm] = useState(() => ({
    ...estiloNovo(tipo),
    ...inicial,
    importTag: valorBase(inicial || {}, 'importTag'),
    exportTag: valorBase(inicial || {}, 'exportTag'),
    format: { ...formatoPadrao(tipo), ...(inicial?.format || {}) },
  }))

  const set = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }))
  const titulo = existente
    ? `Editar mapeamentos de ${inicial.label}`
    : `${inicial?.custom ? 'Editar' : 'Criar'} estilo de ${tipo === 'paragrafo' ? 'parágrafo' : 'caractere'}`

  function salvar() {
    if (!existente && !form.label.trim()) {
      alert('Informe o nome do estilo.')
      return
    }
    const id = form.id || idEstiloCustom(tipo, form.label)
    onSalvar({
      ...form,
      id,
      label: form.label.trim(),
      cssClass: form.cssClass || slugEstilo(form.label),
      importTag: form.importTag || form.label.replace(/\s+/g, ''),
      exportTag: form.exportTag || form.importTag || form.label.replace(/\s+/g, ''),
      tiposNorma: normalizarTiposNorma(form.tiposNorma || []),
      format: { ...formatoPadrao(tipo), ...(form.format || {}) },
    })
  }

  return (
    <aside className="config-editor">
      <div className="config-editor-header">
        <h2>{titulo}</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancelar}>Fechar</button>
      </div>

      <div className="config-form">
        <CampoTexto label="Nome do estilo" value={form.label} disabled={existente} onChange={v => set('label', v)} />
        <div className="config-form-grid">
          <CampoTexto label="Tag de importação XML" value={form.importTag} onChange={v => set('importTag', v)} placeholder="Ex.: MinhaTag" />
          <CampoTexto label="Tag de exportação XML" value={form.exportTag} onChange={v => set('exportTag', v)} placeholder="Ex.: MinhaTag" />
        </div>
        <CampoTexto label="Importação HTML" value={form.htmlImport} onChange={v => set('htmlImport', v)} placeholder="Ex.: p.minha-classe" />

        {!existente && (
          <>
            <div className="config-form-grid">
              <CampoTexto label="Classe" value={form.cssClass} onChange={v => set('cssClass', v)} placeholder="Ex.: minha-classe" />
            </div>
            <EditorTiposNorma value={form.tiposNorma} onChange={v => set('tiposNorma', v)} />
            <EditorFormato tipo={tipo} format={form.format} onChange={v => set('format', v)} />
          </>
        )}

        <div className="config-form-actions">
          <button type="button" className="btn-primary" onClick={salvar}>Salvar</button>
          <button type="button" className="btn-ghost" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </aside>
  )
}

function TabelaEstilos({ titulo, subtitulo, tipo, estilos, onNovo, onEditar, onExcluir }) {
  return (
    <section className="config-card">
      <div className="config-card-header">
        <div>
          <h2>{titulo}</h2>
          <p>{subtitulo}</p>
        </div>
        <button type="button" className="btn-primary" onClick={onNovo}>
          + Novo estilo
        </button>
      </div>

      <div className="config-table-wrap">
        <table className="config-table">
          <thead>
            <tr>
              <th>Estilo</th>
              <th>Tipos de norma</th>
              <th>Importação XML</th>
              <th>Importação HTML</th>
              <th>Exportação XML</th>
              <th>Classe / marca</th>
              <th>Formato</th>
              <th>Uso</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {estilos.map(estilo => (
              <LinhaEstilo
                key={tipo === 'paragrafo' ? (estilo.node || estilo.id) : estilo.id}
                estilo={estilo}
                tipo={tipo}
                onEditar={onEditar}
                onExcluir={onExcluir}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BackupBanco() {
  const [processando, setProcessando] = useState('')
  const [mensagem, setMensagem] = useState('')
  const backupApi = window.legislator?.backup
  const disponivel = Boolean(backupApi?.exportarBanco && backupApi?.importarBanco)

  async function exportarBanco() {
    if (!disponivel) return
    setProcessando('exportar')
    setMensagem('')
    try {
      const result = await backupApi.exportarBanco()
      if (!result?.canceled) {
        setMensagem(`Backup exportado para: ${result.filePath}`)
      }
    } catch (err) {
      alert(err.message || 'Não foi possível exportar o backup.')
    } finally {
      setProcessando('')
    }
  }

  async function importarBanco() {
    if (!disponivel) return
    if (!confirm('Importar um backup substituirá o banco atual. Um backup automático do banco atual será criado antes da substituição. Continuar?')) return

    setProcessando('importar')
    setMensagem('')
    try {
      const result = await backupApi.importarBanco()
      if (result?.canceled) return
      if (result?.unchanged) {
        setMensagem(result.message || 'O arquivo selecionado já é o banco em uso.')
        return
      }

      const texto = [
        'Backup importado com sucesso.',
        result?.backupAnterior ? `Banco anterior salvo em: ${result.backupAnterior}` : '',
        'O aplicativo precisa reiniciar para carregar o banco importado.',
      ].filter(Boolean).join('\n\n')

      if (confirm(`${texto}\n\nReiniciar agora?`)) {
        await backupApi.reiniciarApp?.()
      } else {
        setMensagem(`${texto} Reinicie o aplicativo antes de continuar editando.`)
      }
    } catch (err) {
      alert(err.message || 'Não foi possível importar o backup.')
    } finally {
      setProcessando('')
    }
  }

  return (
    <section className="config-card config-backup-card">
      <div className="config-card-header">
        <div>
          <h2>Backup do banco de dados</h2>
          <p>Exporte uma cópia completa do banco ou restaure um backup anterior.</p>
        </div>
      </div>

      <div className="config-backup-body">
        {!disponivel && (
          <p className="config-backup-aviso">
            Backup do banco está disponível apenas no aplicativo Electron.
          </p>
        )}

        <div className="config-backup-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!disponivel || !!processando}
            onClick={exportarBanco}
          >
            {processando === 'exportar' ? 'Exportando...' : 'Exportar backup'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!disponivel || !!processando}
            onClick={importarBanco}
          >
            {processando === 'importar' ? 'Importando...' : 'Importar backup'}
          </button>
        </div>

        <div className="config-backup-notas">
          <p>O backup inclui normas, publicações, tags, versões e configurações salvas no banco.</p>
          <p>Ao importar, o banco atual é preservado automaticamente antes da substituição.</p>
        </div>

        {mensagem && <pre className="config-backup-mensagem">{mensagem}</pre>}
      </div>
    </section>
  )
}

function UsuariosComentarios() {
  const [usuarios, setUsuarios] = useState(() => carregarUsuariosComentarios())
  const [atual, setAtual] = useState(() => carregarUsuarioComentarioAtual())
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState(CORES_USUARIO_COMENTARIO[0])

  function recarregar() {
    setUsuarios(carregarUsuariosComentarios())
    setAtual(carregarUsuarioComentarioAtual())
  }

  function adicionar(e) {
    e.preventDefault()
    const usuario = criarUsuarioComentario(nome, cor)
    if (!usuario) return
    setNome('')
    setCor(CORES_USUARIO_COMENTARIO[(usuarios.length + 1) % CORES_USUARIO_COMENTARIO.length])
    selecionarUsuarioComentario(usuario)
    recarregar()
  }

  function selecionar(usuario) {
    selecionarUsuarioComentario(usuario)
    recarregar()
  }

  function excluir(usuario) {
    if (!confirm(`Excluir o usuario "${usuario.nome}"?`)) return
    const restantes = usuarios.filter(u => u.id !== usuario.id)
    salvarUsuariosComentarios(restantes)
    if (atual?.id === usuario.id) limparUsuarioComentarioAtual()
    recarregar()
  }

  return (
    <section className="config-card config-usuarios-card">
      <div className="config-card-header">
        <div>
          <h2>Usuarios de comentarios</h2>
          <p>Cadastre os nomes usados para identificar comentarios nas normas.</p>
        </div>
      </div>

      <form className="config-usuario-form" onSubmit={adicionar}>
        <input
          value={nome}
          onChange={e => setNome(e.target.value)}
          placeholder="Nome do usuario"
        />
        <select value={cor} onChange={e => setCor(e.target.value)}>
          {CORES_USUARIO_COMENTARIO.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="usuario-badge" style={{ backgroundColor: cor }}>{iniciaisUsuario(nome)}</span>
        <button type="submit" className="btn-primary" disabled={!nome.trim()}>
          Adicionar usuario
        </button>
      </form>

      {usuarios.length === 0 ? (
        <p className="config-vazio">Nenhum usuario cadastrado.</p>
      ) : (
        <div className="config-usuarios-lista">
          {usuarios.map(usuario => (
            <div key={usuario.id} className={`config-usuario-item${atual?.id === usuario.id ? ' ativo' : ''}`}>
              <span className="usuario-badge" style={{ backgroundColor: usuario.cor }}>
                {iniciaisUsuario(usuario.nome)}
              </span>
              <strong>{usuario.nome}</strong>
              {atual?.id === usuario.id && <span className="config-badge config-badge-ok">Atual</span>}
              <button type="button" className="btn-ghost btn-sm" onClick={() => selecionar(usuario)}>
                Usar
              </button>
              <button type="button" className="btn-ghost btn-sm danger" onClick={() => excluir(usuario)}>
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Configuracoes() {
  const nav = useNavigate()
  const [aba, setAba] = useState('paragrafos')
  const [prefs, setPrefs] = useState(() => carregarPreferenciasEstilo())
  const [edicao, setEdicao] = useState(null)

  const estilosParagrafo = useMemo(() => estilosParagrafoConfigurados(), [prefs])
  const estilosCaractere = useMemo(() => estilosCaractereConfigurados(), [prefs])
  const tipoAtual = aba === 'paragrafos' ? 'paragrafo' : 'caractere'

  function salvarPrefs(prox) {
    const salvas = salvarPreferenciasEstilo(prox)
    setPrefs(salvas)
    setEdicao(null)
  }

  function editarEstilo(estilo) {
    const tipo = aba === 'paragrafos' ? 'paragrafo' : 'caractere'
    setEdicao({ tipo, modo: estilo.custom ? 'editar-custom' : 'editar-nativo', estilo })
  }

  function novoEstilo() {
    setEdicao({ tipo: tipoAtual, modo: 'novo', estilo: estiloNovo(tipoAtual) })
  }

  function salvarEstilo(estilo) {
    const tipo = edicao.tipo
    if (edicao.modo === 'editar-nativo') {
      const chave = edicao.estilo[campoId(tipo)]
      salvarPrefs({
        ...prefs,
        overrides: {
          ...prefs.overrides,
          [tipo]: {
            ...prefs.overrides[tipo],
            [chave]: {
              ...(prefs.overrides[tipo]?.[chave] || {}),
              importTag: estilo.importTag,
              exportTag: estilo.exportTag,
              htmlImport: estilo.htmlImport,
            },
          },
        },
      })
      return
    }

    const lista = prefs.custom[tipo] || []
    const existe = lista.some(e => e.id === estilo.id)
    salvarPrefs({
      ...prefs,
      custom: {
        ...prefs.custom,
        [tipo]: existe
          ? lista.map(e => e.id === estilo.id ? estilo : e)
          : [...lista, { ...estilo, custom: true }],
      },
    })
  }

  function excluirEstilo(estilo) {
    if (!estilo.custom) return
    if (!confirm(`Excluir o estilo "${estilo.label}"?`)) return
    const tipo = aba === 'paragrafos' ? 'paragrafo' : 'caractere'
    salvarPrefs({
      ...prefs,
      custom: {
        ...prefs.custom,
        [tipo]: (prefs.custom[tipo] || []).filter(e => e.id !== estilo.id),
      },
    })
  }

  return (
    <div className="config-page">
      <header className="home-header config-header">
        <button className="btn-ghost" onClick={() => nav('/')}>Voltar</button>
        <div className="config-title">
          <h1>Configurações</h1>
          <p>Preferências de estilo e mapeamento de importação/exportação.</p>
        </div>
        <div className="config-header-spacer" />
      </header>

      <main className="config-main">
        <aside className="config-sidebar">
          <button type="button" className={aba === 'paragrafos' ? 'ativo' : ''} onClick={() => { setAba('paragrafos'); setEdicao(null) }}>
            Estilos de parágrafo
          </button>
          <button type="button" className={aba === 'caracteres' ? 'ativo' : ''} onClick={() => { setAba('caracteres'); setEdicao(null) }}>
            Estilos de caractere
          </button>
          <button type="button" className={aba === 'usuarios' ? 'ativo' : ''} onClick={() => { setAba('usuarios'); setEdicao(null) }}>
            Usuarios
          </button>
          <button type="button" className={aba === 'backup' ? 'ativo' : ''} onClick={() => { setAba('backup'); setEdicao(null) }}>
            Backup do banco
          </button>
        </aside>

        <div className="config-content">
          <div className="config-pref-intro">
            <h2>{aba === 'backup' ? 'Backup e restauração' : 'Preferências de estilo'}</h2>
            <p>
              {aba === 'backup'
                ? 'Crie cópias de segurança do banco local e restaure um arquivo de backup quando necessário.'
                : 'Estilos nativos permitem edição apenas das tags XML de importação/exportação. Estilos novos permitem definir formatação, classes, HTML e tipos de livro ativos.'}
            </p>
          </div>

          {aba === 'backup' ? (
            <BackupBanco />
          ) : aba === 'usuarios' ? (
            <UsuariosComentarios />
          ) : aba === 'paragrafos' ? (
            <TabelaEstilos
              titulo="Estilos de parágrafo"
              subtitulo="Nós de bloco usados pelo editor e pelas rotinas de importação/exportação."
              tipo="paragrafo"
              estilos={estilosParagrafo}
              onNovo={novoEstilo}
              onEditar={editarEstilo}
              onExcluir={excluirEstilo}
            />
          ) : (
            <TabelaEstilos
              titulo="Estilos de caractere"
              subtitulo="Marcas inline usadas no editor, no painel de busca e no XML."
              tipo="caractere"
              estilos={estilosCaractere}
              onNovo={novoEstilo}
              onEditar={editarEstilo}
              onExcluir={excluirEstilo}
            />
          )}
        </div>

        {edicao && (
          <PainelEdicao
            key={`${edicao.tipo}-${edicao.modo}-${edicao.estilo?.id || edicao.estilo?.node || 'novo'}`}
            tipo={edicao.tipo}
            modo={edicao.modo}
            inicial={edicao.estilo}
            onSalvar={salvarEstilo}
            onCancelar={() => setEdicao(null)}
          />
        )}
      </main>
    </div>
  )
}
