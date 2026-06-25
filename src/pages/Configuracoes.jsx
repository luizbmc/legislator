import { useEffect, useMemo, useRef, useState } from 'react'
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
  criarUsuarioComentarioNoBanco,
  excluirUsuarioComentarioNoBanco,
  iniciaisUsuario,
  limparUsuarioComentarioAtual,
  selecionarUsuarioComentario,
  sincronizarUsuariosComentarios,
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

function nomeArquivoPacote(tipo, pacote) {
  const data = String(pacote?.criadoEm || new Date().toISOString()).slice(0, 10)
  const id = String(pacote?.id || '').slice(0, 8)
  return `normando-${tipo}-${data}-${id}.json`
}

function baixarPacote(pacote) {
  const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nomeArquivoPacote(pacote.tipo, pacote)
  link.click()
  URL.revokeObjectURL(url)
}

async function lerPacote(file) {
  if (!file) return null
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new Error('O arquivo selecionado não contém um pacote JSON válido.')
  }
}

function rotuloStatusPacote(status) {
  return {
    retirado: 'Retirado',
    em_edicao: 'Em edição',
    devolvido: 'Devolução gerada',
    concluido: 'Concluído',
    com_conflito: 'Concluído com conflito',
  }[status] || status
}

function RelatorioDevolucao({ relatorio }) {
  if (!relatorio) return null
  const grupos = [
    ['Aplicadas', relatorio.aplicadas, 'ok'],
    ['Normas novas criadas', relatorio.novasCriadas, 'ok'],
    ['Normas novas já recebidas anteriormente', relatorio.novasJaImportadas, 'neutro'],
    ['Publicações atualizadas', relatorio.publicacoesAplicadas, 'ok'],
    ['Publicações sem alterações', relatorio.publicacoesInalteradas, 'neutro'],
    ['Conflitos - nenhuma alteração aplicada', relatorio.conflitos, 'erro'],
    ['Conflitos em publicações', relatorio.conflitosPublicacoes, 'erro'],
    ['Sem alterações', relatorio.inalteradas, 'neutro'],
    ['Não encontradas no banco oficial', relatorio.ausentes, 'erro'],
  ]

  return (
    <div className="trabalho-remoto-relatorio">
      <h3>Relatório da devolução</h3>
      {grupos.map(([titulo, itens, classe]) => (
        <section key={titulo} className={`trabalho-remoto-relatorio-grupo ${classe}`}>
          <strong>{titulo}: {itens?.length || 0}</strong>
          {!!itens?.length && (
            <ul>
              {itens.map(item => (
                <li key={`${titulo}-${item.normaId || item.publicacaoId}`}>
                  {item.epigrafe || item.titulo || `Item ${item.normaId || item.publicacaoId}`}
                  {item.motivo ? ` - ${item.motivo}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function TrabalhoRemoto() {
  const api = window.legislator?.trabalhoRemoto
  const usuario = carregarUsuarioComentarioAtual()
  const retiradaInputRef = useRef(null)
  const devolucaoInputRef = useRef(null)
  const [normas, setNormas] = useState([])
  const [publicacoes, setPublicacoes] = useState([])
  const [pacotes, setPacotes] = useState([])
  const [selecionadas, setSelecionadas] = useState(new Set())
  const [publicacoesSelecionadas, setPublicacoesSelecionadas] = useState(new Set())
  const [novasPorPacote, setNovasPorPacote] = useState({})
  const [novasSelecionadas, setNovasSelecionadas] = useState({})
  const [busca, setBusca] = useState('')
  const [processando, setProcessando] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [relatorio, setRelatorio] = useState(null)

  async function carregar() {
    if (!api) return
    const [listaNormas, listaPublicacoes, listaPacotes] = await Promise.all([
      window.legislator.normas.listar(),
      window.legislator.publicacoes.listar(),
      api.listar(),
    ])
    setNormas(listaNormas || [])
    setPublicacoes(listaPublicacoes || [])
    setPacotes(listaPacotes || [])
    const copiasImportadas = (listaPacotes || []).filter(pacote => pacote.papel === 'copia')
    const paresNovas = await Promise.all(copiasImportadas.map(async pacote => [
      pacote.id,
      await api.listarNormasNovas(pacote.id),
    ]))
    setNovasPorPacote(Object.fromEntries(paresNovas))
  }

  useEffect(() => {
    carregar().catch(err => setMensagem(err.message || 'Não foi possível carregar o trabalho remoto.'))
  }, [])

  const normasFiltradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return normas
    return normas.filter(norma => (
      String(norma.epigrafe || '').toLocaleLowerCase('pt-BR').includes(termo) ||
      String(norma.apelido || '').toLocaleLowerCase('pt-BR').includes(termo)
    ))
  }, [busca, normas])

  const publicacoesFiltradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return publicacoes
    return publicacoes.filter(publicacao => (
      String(publicacao.titulo || '').toLocaleLowerCase('pt-BR').includes(termo) ||
      String(publicacao.edicao || '').toLocaleLowerCase('pt-BR').includes(termo)
    ))
  }, [busca, publicacoes])

  function alternarNorma(id) {
    setSelecionadas(atual => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  function alternarPublicacao(id) {
    setPublicacoesSelecionadas(atual => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  function alternarNormaNova(pacoteId, normaId) {
    setNovasSelecionadas(atual => {
      const conjunto = new Set(atual[pacoteId] || [])
      if (conjunto.has(normaId)) conjunto.delete(normaId)
      else conjunto.add(normaId)
      return { ...atual, [pacoteId]: conjunto }
    })
  }

  async function criarRetirada() {
    if (!selecionadas.size && !publicacoesSelecionadas.size) return
    setProcessando('retirada')
    setMensagem('')
    setRelatorio(null)
    try {
      const pacote = await api.criarRetirada(
        [...selecionadas],
        usuario?.nome || 'Convidado',
        [...publicacoesSelecionadas],
      )
      baixarPacote(pacote)
      setMensagem(
        `Pacote criado com ${pacote.normas.length} norma(s) e ${pacote.publicacoes?.length || 0} publicação(ões). Leve este arquivo para o computador de casa.`,
      )
      setSelecionadas(new Set())
      setPublicacoesSelecionadas(new Set())
      await carregar()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível criar o pacote de retirada.')
    } finally {
      setProcessando('')
    }
  }

  async function importarRetirada(file) {
    setProcessando('importar-retirada')
    setMensagem('')
    setRelatorio(null)
    try {
      const pacote = await lerPacote(file)
      if (!confirm('Importar esta retirada substituirá as cópias locais das normas incluídas pelo conteúdo levado do escritório. Continuar?')) return
      const resultado = await api.importarRetirada(pacote, usuario?.nome || 'Convidado')
      setMensagem(
        `${resultado.importadas.length} norma(s) e ${resultado.publicacoesImportadas?.length || 0} publicação(ões) prontas para edição neste computador.`,
      )
      await carregar()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível importar a retirada.')
    } finally {
      setProcessando('')
      if (retiradaInputRef.current) retiradaInputRef.current.value = ''
    }
  }

  async function criarDevolucao(pacoteId) {
    setProcessando(`devolucao-${pacoteId}`)
    setMensagem('')
    setRelatorio(null)
    try {
      const pacote = await api.criarDevolucao(
        pacoteId,
        usuario?.nome || 'Convidado',
        [...(novasSelecionadas[pacoteId] || [])],
      )
      baixarPacote(pacote)
      setMensagem(
        `Devolução criada com ${pacote.normas.length} norma(s) existentes, ${pacote.normasNovas?.length || 0} nova(s) e ${pacote.publicacoes?.length || 0} publicação(ões).`,
      )
      await carregar()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível criar a devolução.')
    } finally {
      setProcessando('')
    }
  }

  async function importarDevolucao(file) {
    setProcessando('importar-devolucao')
    setMensagem('')
    setRelatorio(null)
    try {
      const pacote = await lerPacote(file)
      if (!confirm('O Normando comparará cada norma com a versão da retirada. Conflitos não serão sobrescritos. Continuar?')) return
      const resultado = await api.importarDevolucao(pacote, usuario?.nome || pacote.criadoPor || 'Convidado')
      setRelatorio(resultado)
      setMensagem(
        resultado.conflitos.length || resultado.conflitosPublicacoes?.length || resultado.ausentes.length
          ? 'Devolução processada com pendências. Confira o relatório abaixo.'
          : 'Devolução processada com segurança.',
      )
      await carregar()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível processar a devolução.')
    } finally {
      setProcessando('')
      if (devolucaoInputRef.current) devolucaoInputRef.current.value = ''
    }
  }

  const copias = pacotes.filter(pacote => pacote.papel === 'copia')
  const historico = pacotes.filter(pacote => pacote.papel === 'origem')

  return (
    <div className="trabalho-remoto">
      <section className="config-card">
        <div className="config-card-header">
          <div>
            <h2>1. Retirar conteúdo no escritório</h2>
            <p>Publicações selecionadas levam automaticamente todas as normas vinculadas.</p>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={(!selecionadas.size && !publicacoesSelecionadas.size) || !!processando || !api}
            onClick={criarRetirada}
          >
            {processando === 'retirada'
              ? 'Gerando...'
              : `Gerar retirada (${selecionadas.size + publicacoesSelecionadas.size})`}
          </button>
        </div>
        <input
          className="trabalho-remoto-busca"
          value={busca}
          onChange={event => setBusca(event.target.value)}
          placeholder="Buscar norma ou publicação"
        />
        <div className="trabalho-remoto-seletores">
          <div>
            <h3>Normas avulsas</h3>
            <div className="trabalho-remoto-normas">
              {normasFiltradas.map(norma => (
                <label key={norma.id} className="trabalho-remoto-norma">
                  <input
                    type="checkbox"
                    checked={selecionadas.has(Number(norma.id))}
                    onChange={() => alternarNorma(Number(norma.id))}
                  />
                  <span>
                    <strong>{norma.epigrafe}</strong>
                    {norma.apelido && <small>({norma.apelido})</small>}
                  </span>
                  <em>{norma.status}</em>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3>Publicações completas</h3>
            <div className="trabalho-remoto-normas">
              {publicacoesFiltradas.map(publicacao => (
                <label key={publicacao.id} className="trabalho-remoto-norma">
                  <input
                    type="checkbox"
                    checked={publicacoesSelecionadas.has(Number(publicacao.id))}
                    onChange={() => alternarPublicacao(Number(publicacao.id))}
                  />
                  <span>
                    <strong>{publicacao.titulo}</strong>
                    {publicacao.edicao && <small>{publicacao.edicao}</small>}
                  </span>
                  <em>{publicacao.total_normas || 0} normas</em>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="trabalho-remoto-colunas">
        <section className="config-card">
          <div className="config-card-header">
            <div>
              <h2>2. Trabalhar em casa</h2>
              <p>Importe a retirada, edite e gere uma devolução.</p>
            </div>
          </div>
          <input
            ref={retiradaInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={event => importarRetirada(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={!!processando || !api}
            onClick={() => retiradaInputRef.current?.click()}
          >
            Importar retirada
          </button>
          <div className="trabalho-remoto-pacotes">
            {copias.length === 0 && <p className="config-vazio">Nenhuma retirada importada neste computador.</p>}
            {copias.map(pacote => (
              <div key={pacote.id} className="trabalho-remoto-pacote">
                <div>
                  <strong>
                    {pacote.total_normas} norma(s)
                    {Number(pacote.total_publicacoes) > 0 ? ` · ${pacote.total_publicacoes} publicação(ões)` : ''}
                  </strong>
                  <span>{rotuloStatusPacote(pacote.status)}</span>
                  <small>{new Date(pacote.criado_em).toLocaleString('pt-BR')}</small>
                  {!!novasPorPacote[pacote.id]?.length && (
                    <fieldset className="trabalho-remoto-novas">
                      <legend>Normas criadas em casa para incluir</legend>
                      {novasPorPacote[pacote.id].map(norma => (
                        <label key={norma.id}>
                          <input
                            type="checkbox"
                            checked={(novasSelecionadas[pacote.id] || new Set()).has(Number(norma.id))}
                            onChange={() => alternarNormaNova(pacote.id, Number(norma.id))}
                          />
                          <span>{norma.epigrafe}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!!processando}
                  onClick={() => criarDevolucao(pacote.id)}
                >
                  {processando === `devolucao-${pacote.id}` ? 'Gerando...' : 'Gerar devolução'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="config-card">
          <div className="config-card-header">
            <div>
              <h2>3. Receber no escritório</h2>
              <p>Aplique a devolução somente se a versão-base ainda for a mesma.</p>
            </div>
          </div>
          <input
            ref={devolucaoInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={event => importarDevolucao(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!!processando || !api}
            onClick={() => devolucaoInputRef.current?.click()}
          >
            {processando === 'importar-devolucao' ? 'Conferindo...' : 'Receber devolução'}
          </button>
          <div className="trabalho-remoto-pacotes">
            {historico.length === 0 && <p className="config-vazio">Nenhuma retirada gerada neste banco.</p>}
            {historico.map(pacote => (
              <div key={pacote.id} className="trabalho-remoto-pacote somente-info">
                <div>
                  <strong>
                    {pacote.total_normas} norma(s)
                    {Number(pacote.total_publicacoes) > 0 ? ` · ${pacote.total_publicacoes} publicação(ões)` : ''}
                  </strong>
                  <span>{rotuloStatusPacote(pacote.status)}</span>
                  <small>{new Date(pacote.criado_em).toLocaleString('pt-BR')}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {mensagem && <div className="trabalho-remoto-mensagem">{mensagem}</div>}
      <RelatorioDevolucao relatorio={relatorio} />
    </div>
  )
}

function IntegracaoRailway() {
  const nav = useNavigate()
  const api = window.legislator?.railway
  const usuario = carregarUsuarioComentarioAtual()
  const [config, setConfig] = useState({ url: '', chave: '', modo: 'local' })
  const [chaveConfigurada, setChaveConfigurada] = useState(false)
  const [busca, setBusca] = useState('')
  const [normas, setNormas] = useState([])
  const [edicoes, setEdicoes] = useState([])
  const [mensagem, setMensagem] = useState('')
  const [processando, setProcessando] = useState('')

  useEffect(() => {
    api?.configuracao()
      .then(atual => {
        setConfig({ url: atual.url || '', chave: '', modo: atual.modo || 'local' })
        setChaveConfigurada(Boolean(atual.chaveConfigurada))
      })
      .catch(err => setMensagem(err.message || 'Não foi possível ler a configuração Railway.'))
  }, [])

  async function salvarConexao(e) {
    e.preventDefault()
    if (!api) {
      setMensagem('A integração Railway não está disponível nesta execução. Reinicie o Normando.')
      return
    }
    setProcessando('config')
    setMensagem('')
    try {
      const resultado = await api.salvarConfiguracao(config)
      setChaveConfigurada(Boolean(resultado.chaveConfigurada))
      setConfig(prev => ({ ...prev, chave: '' }))
      if (resultado.modo === 'railway') {
        setMensagem('Conexão Railway salva e validada.')
        await carregarListas()
      } else {
        setMensagem('Configuração salva. O aplicativo usará o banco local.')
      }
    } catch (err) {
      setMensagem(err.message || 'Não foi possível conectar ao Railway.')
    } finally {
      setProcessando('')
    }
  }

  async function testarConexao() {
    if (!api) {
      setMensagem('A integração Railway não está disponível nesta execução. Reinicie o Normando.')
      return
    }
    setProcessando('teste')
    setMensagem('')
    try {
      const info = await api.testar()
      setMensagem(
        `Conexão ativa. Banco remoto com ${info.normas ?? 0} norma(s) e ${info.publicacoes ?? 0} publicação(ões).`,
      )
      await carregarListas()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível conectar ao Railway.')
    } finally {
      setProcessando('')
    }
  }

  async function carregarListas() {
    const [catalogo, copias] = await Promise.all([
      api.listarNormas({ busca, page: 1, limit: 100 }),
      api.listarEdicoes(),
    ])
    setNormas(catalogo.items || [])
    setEdicoes(copias.items || [])
  }

  async function buscarNormas(e) {
    e?.preventDefault()
    setProcessando('listas')
    setMensagem('')
    try {
      await carregarListas()
    } catch (err) {
      setMensagem(err.message || 'Não foi possível carregar o catálogo remoto.')
    } finally {
      setProcessando('')
    }
  }

  async function criarEAbrir(normaId) {
    setProcessando(`norma-${normaId}`)
    setMensagem('')
    try {
      const resultado = await api.criarEdicao(normaId, usuario?.nome || 'Convidado')
      nav(`/editor-remoto/${resultado.edicao.id}`, {
        state: { origem: 'railway' },
      })
    } catch (err) {
      setMensagem(err.message || 'Não foi possível criar a cópia remota.')
      setProcessando('')
    }
  }

  function abrirEdicao(id) {
    nav(`/editor-remoto/${id}`, { state: { origem: 'railway' } })
  }

  return (
    <div className="railway-integracao">
      <section className="config-card">
        <div className="config-card-header">
          <div>
            <h2>Conexão Railway</h2>
            <p>A chave fica armazenada somente neste computador.</p>
          </div>
        </div>
        <form className="railway-config-form" onSubmit={salvarConexao}>
          <label className="config-form-campo">
            <span>Endereço do serviço</span>
            <input
              type="url"
              value={config.url}
              onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://seu-servico.up.railway.app"
              required
            />
          </label>
          <label className={`railway-modo-toggle${config.modo === 'railway' ? ' ativo' : ''}`}>
            <input
              type="checkbox"
              checked={config.modo === 'railway'}
              onChange={e => setConfig(prev => ({
                ...prev,
                modo: e.target.checked ? 'railway' : 'local',
              }))}
            />
            <span>
              <strong>Usar banco Railway no aplicativo</strong>
              <small>
                Quando ativo, normas, publicações, tags, exceções e usuários serão lidos e salvos no banco online.
              </small>
            </span>
          </label>
          <label className="config-form-campo">
            <span>Chave de acesso</span>
            <input
              type="password"
              value={config.chave}
              onChange={e => setConfig(prev => ({ ...prev, chave: e.target.value }))}
              placeholder={chaveConfigurada ? 'Chave já configurada; deixe vazio para manter' : 'POC_API_KEY'}
              required={!chaveConfigurada}
            />
          </label>
          <div className="config-form-actions">
            <button type="submit" className="btn-primary" disabled={!!processando}>
              {processando === 'config' ? 'Validando...' : 'Salvar configuração e testar'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!chaveConfigurada || !!processando}
              onClick={testarConexao}
            >
              {processando === 'teste' ? 'Testando...' : 'Testar conexão atual'}
            </button>
          </div>
          {mensagem && (
            <div
              className={`railway-conexao-mensagem${
                /salva e validada|Configuração salva|Conexão ativa/i.test(mensagem) ? ' sucesso' : ' erro'
              }`}
              role="status"
            >
              {mensagem}
            </div>
          )}
        </form>
      </section>

      <section className="config-card">
        <div className="config-card-header">
          <div>
            <h2>Cópias remotas em edição</h2>
            <p>Abra uma cópia no editor completo do Normando.</p>
          </div>
          <button type="button" className="btn-ghost" onClick={buscarNormas} disabled={!!processando}>
            Atualizar
          </button>
        </div>
        <div className="railway-lista">
          {!edicoes.length && <p className="config-vazio">Nenhuma cópia remota carregada.</p>}
          {edicoes.map(edicao => (
            <button
              type="button"
              className="railway-item"
              key={edicao.id}
              onClick={() => abrirEdicao(edicao.id)}
            >
              <span>
                <strong>{edicao.epigrafe}</strong>
                <small>{edicao.tipo} · revisão {edicao.revisao} · {edicao.total_versoes} versão(ões)</small>
              </span>
              <em>Abrir</em>
            </button>
          ))}
        </div>
      </section>

      <section className="config-card">
        <div className="config-card-header">
          <div>
            <h2>Catálogo remoto</h2>
            <p>Selecione uma norma real para criar ou reabrir sua cópia isolada.</p>
          </div>
        </div>
        <form className="toolbar railway-busca" onSubmit={buscarNormas}>
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Epígrafe ou apelido"
          />
          <button type="submit" className="btn-primary" disabled={!!processando}>Buscar</button>
        </form>
        <div className="railway-lista">
          {!normas.length && <p className="config-vazio">Conecte-se para carregar as normas.</p>}
          {normas.map(norma => (
            <div className="railway-item" key={norma.id}>
              <span>
                <strong>{norma.epigrafe}</strong>
                <small>
                  {norma.tipo}
                  {norma.apelido ? ` · ${norma.apelido}` : ''}
                  {` · ${norma.status}`}
                </small>
              </span>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!!processando}
                onClick={() => criarEAbrir(norma.id)}
              >
                {processando === `norma-${norma.id}` ? 'Abrindo...' : 'Criar cópia'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function UsuariosComentarios() {
  const [usuarios, setUsuarios] = useState(() => carregarUsuariosComentarios())
  const [atual, setAtual] = useState(() => carregarUsuarioComentarioAtual())
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState(CORES_USUARIO_COMENTARIO[0])

  async function recarregar() {
    try {
      setUsuarios(await sincronizarUsuariosComentarios())
    } catch {
      setUsuarios(carregarUsuariosComentarios())
    }
    setAtual(carregarUsuarioComentarioAtual())
  }

  async function adicionar(e) {
    e.preventDefault()
    const usuario = await criarUsuarioComentarioNoBanco(nome, cor)
    if (!usuario) return
    setNome('')
    setCor(CORES_USUARIO_COMENTARIO[(usuarios.length + 1) % CORES_USUARIO_COMENTARIO.length])
    selecionarUsuarioComentario(usuario)
    await recarregar()
  }

  function selecionar(usuario) {
    selecionarUsuarioComentario(usuario)
    recarregar()
  }

  async function excluir(usuario) {
    if (!confirm(`Excluir o usuario "${usuario.nome}"?`)) return
    await excluirUsuarioComentarioNoBanco(usuario)
    if (atual?.id === usuario.id) limparUsuarioComentarioAtual()
    await recarregar()
  }

  useEffect(() => {
    recarregar()
  }, [])

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
          <button type="button" className={aba === 'remoto' ? 'ativo' : ''} onClick={() => { setAba('remoto'); setEdicao(null) }}>
            Trabalho remoto
          </button>
          <button type="button" className={aba === 'railway' ? 'ativo' : ''} onClick={() => { setAba('railway'); setEdicao(null) }}>
            Railway
          </button>
        </aside>

        <div className="config-content">
          <div className="config-pref-intro">
            <h2>{aba === 'backup' ? 'Backup e restauração' : aba === 'remoto' ? 'Retirada e devolução' : aba === 'railway' ? 'Edição remota experimental' : 'Preferências de estilo'}</h2>
            <p>
              {aba === 'backup'
                ? 'Crie cópias de segurança do banco local e restaure um arquivo de backup quando necessário.'
                : aba === 'remoto'
                  ? 'Leve normas selecionadas para outro computador e devolva as edições sem substituir alterações feitas no escritório.'
                  : aba === 'railway'
                    ? 'Abra no editor do Normando cópias isoladas do banco hospedado no Railway, com revisão e proteção contra sobrescrita concorrente.'
                  : 'Estilos nativos permitem edição apenas das tags XML de importação/exportação. Estilos novos permitem definir formatação, classes, HTML e tipos de livro ativos.'}
            </p>
          </div>

          {aba === 'backup' ? (
            <BackupBanco />
          ) : aba === 'remoto' ? (
            <TrabalhoRemoto />
          ) : aba === 'railway' ? (
            <IntegracaoRailway />
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
