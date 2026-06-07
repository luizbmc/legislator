/**
 * PainelAtualizarNorma.jsx
 * Modal com fluxo completo de atualização de norma:
 *
 * Fonte "docx":
 *   Passo 1 — Upload do novo arquivo DOCX
 *   Passo 2 — Execução das rotinas de limpeza
 *   Passo 3 — Comparação com a versão atual
 *
 * Fonte "catalogo":
 *   Passo 1 — Busca e seleção de norma do catálogo
 *   Passo 2 — Comparação com a versão atual
 */
import { useState, useRef, useEffect } from 'react'
import mammoth from 'mammoth'
import { pipeline, linhasParaTiptap, normalizarDocNotas } from '../../services/limpeza/index.js'
import { compararNormas }              from '../../services/compararNorma.js'
import { aplicarCitacoes }             from '../../services/aplicarCitacoes.js'
import { aplicarNotasVadeMecum }       from '../../services/notasVadeMecum.js'
import { xmlParaTiptap }               from '../../services/importarXml.js'
import { htmlInDesignParaTiptap }      from '../../services/importarHtmlInDesign.js'

// ── Configuração dos fluxos ───────────────────────────────────────
const FLUXO_DOCX = {
  passos: ['upload', 'pipeline', 'comparando'],
  labels: ['Arquivo', 'Rotinas', 'Comparação'],
}
const FLUXO_CAT = {
  passos: ['catalogo', 'comparando'],
  labels: ['Catálogo', 'Comparação'],
}

function textoDeNodeTiptap(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(textoDeNodeTiptap).join('')
}

function textoDeDocTiptap(doc) {
  return (doc?.content ?? [])
    .map(textoDeNodeTiptap)
    .map(t => t.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
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

export default function PainelAtualizarNorma({ editorDoc, tipoNorma = '', tags = [], onIniciarRevisao, onFechar, onEditarManual }) {
  const [fonte,       setFonte]       = useState('docx')      // 'docx' | 'catalogo'
  const [passo,       setPasso]       = useState('upload')
  const [nomeArq,     setNomeArq]     = useState('')
  const [novoDoc,     setNovoDoc]     = useState(null)
  const [logPipeline, setLogPipeline] = useState([])
  const [processando, setProcessando] = useState(false)
  const [erroMsg,     setErroMsg]     = useState('')
  const [incluirEstiloVadeMecum, setIncluirEstiloVadeMecum] = useState(false)
  const [incluirVadeMecum, setIncluirVadeMecum] = useState(false)

  // ── Opções de comparação ──────────────────────────────────────────
  const [opcoesComp, setOpcoesComp] = useState({
    ignorarCapitulacao: true,
    ignorarAcentuacao:  true,
    ignorarAspas:       true,
    ignorarHifens:      true,
    ignorarEspacos:     true,
    ignorarAlteracoesNota: false,
  })
  function toggleOpcao(chave) {
    setOpcoesComp(prev => ({ ...prev, [chave]: !prev[chave] }))
  }

  // ── Estado do catálogo ────────────────────────────────────────────
  const [buscaCat,      setBuscaCat]      = useState('')
  const [somenteVmCat,  setSomenteVmCat]  = useState(false)
  const [normasCat,     setNormasCat]     = useState([])
  const [carregandoCat, setCarregandoCat] = useState(false)
  const [normaSel,      setNormaSel]      = useState(null)   // norma selecionada no catálogo

  const fileRef = useRef(null)
  const [arquivo, setArquivo] = useState(null)
  const temTagVm = (tags || []).some(t => String(t).toLowerCase() === 'vm')

  // Fluxo ativo
  const fluxo = fonte === 'docx' ? FLUXO_DOCX : FLUXO_CAT

  // ── Busca no catálogo ─────────────────────────────────────────────
  useEffect(() => {
    if (fonte !== 'catalogo') return
    setCarregandoCat(true)
    window.legislator.normas.listar({ busca: buscaCat })
      .then(r => { setNormasCat(r); setCarregandoCat(false) })
      .catch(() => setCarregandoCat(false))
  }, [buscaCat, fonte])

  // ── Troca de fonte ────────────────────────────────────────────────
  function mudarFonte(nova) {
    setFonte(nova)
    setPasso(nova === 'docx' ? 'upload' : 'catalogo')
    setNovoDoc(null)
    setLogPipeline([])
    setErroMsg('')
    setNormaSel(null)
    setArquivo(null)
    setNomeArq('')
    setSomenteVmCat(false)
  }

  // ── Passo 1 (docx): carregar arquivo ─────────────────────────────
  async function handleArquivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setArquivo(file)
    setNomeArq(file.name)
    setNovoDoc(null)
    setLogPipeline([])
    setErroMsg('')
    setPasso('pipeline')
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (!file) return
    setArquivo(file)
    setNomeArq(file.name)
    setNovoDoc(null)
    setLogPipeline([])
    setErroMsg('')
    setPasso('pipeline')
  }

  // ── Passo 2 (docx): executar rotinas ─────────────────────────────
  async function rodarPipeline() {
    if (processando || !nomeArq) return
    setProcessando(true)
    setErroMsg('')
    setLogPipeline([])

    try {
      if (!arquivo) throw new Error('Arquivo não encontrado. Selecione novamente.')

      let entradaPipeline
      let origemXml = false

      if (/\.xml$/i.test(arquivo.name)) {
        const xml = await arquivo.text()
        const doc = xmlParaTiptap(xml)
        entradaPipeline = textoDeDocTiptap(doc)
        origemXml = true
      } else if (/\.html?$/i.test(arquivo.name)) {
        const html = await arquivo.text()
        const doc = htmlInDesignParaTiptap(html)
        setNovoDoc(normalizarDocNotas(doc))
        setLogPipeline(['[HTML InDesign] Arquivo HTML importado diretamente.'])
        return
      } else {
        const buffer = await arquivo.arrayBuffer()
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer })
        entradaPipeline = html
      }

      const { linhas, etapas } = pipeline(entradaPipeline, {
        tipoNorma,
        estiloVadeMecum: temTagVm || incluirEstiloVadeMecum,
      })
      let doc = linhasParaTiptap(linhas)

      const logs = origemXml ? ['[XML] Arquivo XML usado como entrada das rotinas.'] : []
      logs.push(...etapas.flatMap(e =>
        e.log.map(l => `[${e.nome}] ${l}`)
      ))

      const { doc: docCitacoes, log: logCitacoes } = aplicarCitacoes(doc)
      doc = docCitacoes
      logCitacoes.forEach(l => logs.push(`[Citações] ${l}`))

      if (temTagVm || incluirVadeMecum) {
        const { doc: docVM, log: logVM } = aplicarNotasVadeMecum(doc)
        doc = docVM
        logVM.forEach(l => logs.push(`[Notas Vade Mecum] ${l}`))
      }

      setNovoDoc(normalizarDocNotas(doc))
      setLogPipeline(logs)
    } catch (err) {
      setErroMsg(String(err))
    } finally {
      setProcessando(false)
    }
  }

  // ── Passo 1 (catálogo): selecionar norma ─────────────────────────
  async function selecionarNormaCatalogo(norma) {
    if (processando) return
    setProcessando(true)
    setErroMsg('')
    try {
      const n = await window.legislator.normas.buscar(norma.id)
      const doc = JSON.parse(n.conteudo_doc)
      setNormaSel(norma)
      setNovoDoc(doc)
      setPasso('comparando')
    } catch (err) {
      setErroMsg(String(err))
    } finally {
      setProcessando(false)
    }
  }

  // ── Passo final: comparar e iniciar revisão ───────────────────────
  function iniciarComparacao() {
    if (!novoDoc || !editorDoc) return
    setProcessando(true)
    setErroMsg('')

    try {
      const { mergedDoc, diffs } = compararNormas(editorDoc, novoDoc, opcoesComp)

      if (diffs.length === 0) {
        setErroMsg('Nenhuma diferença encontrada entre as versões.')
        setProcessando(false)
        return
      }

      onIniciarRevisao(mergedDoc, diffs)
    } catch (err) {
      setErroMsg(String(err))
      setProcessando(false)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────
  function OpcoesComparacao() {
    return (
      <div className="modal-comp-opcoes">
        <span className="modal-comp-opcoes-titulo">Opções de comparação</span>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarCapitulacao}
            onChange={() => toggleOpcao('ignorarCapitulacao')} />
          Ignorar capitalização <span className="modal-comp-ex">(ex.: Região = região)</span>
        </label>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarAcentuacao}
            onChange={() => toggleOpcao('ignorarAcentuacao')} />
          Ignorar acentuação <span className="modal-comp-ex">(ex.: óôõ = o)</span>
        </label>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarAspas}
            onChange={() => toggleOpcao('ignorarAspas')} />
          Ignorar tipo de aspas <span className="modal-comp-ex">(ex.: " = " = «)</span>
        </label>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarHifens}
            onChange={() => toggleOpcao('ignorarHifens')} />
          Ignorar hífen entre palavras <span className="modal-comp-ex">(ex.: não-pagamento = não pagamento, co-proprietários = coproprietários)</span>
        </label>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarEspacos}
            onChange={() => toggleOpcao('ignorarEspacos')} />
          Ignorar diferenças de espaço <span className="modal-comp-ex">(ex.: espaço comum = espaço não separável, espaços múltiplos = espaço simples)</span>
        </label>
        <label className="modal-atualizar-opcao">
          <input type="checkbox"
            checked={opcoesComp.ignorarAlteracoesNota}
            onChange={() => toggleOpcao('ignorarAlteracoesNota')} />
          Ignorar alterações de nota <span className="modal-comp-ex">(quando apenas o trecho com estilo nota mudou)</span>
        </label>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  const normasCatFiltradas = somenteVmCat
    ? normasCat.filter(normaTemTagVm)
    : normasCat

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="modal-atualizar">

        {/* Cabeçalho */}
        <div className="modal-atualizar-header">
          <h2 className="modal-atualizar-titulo">🔄 Atualizar norma</h2>
          <button className="btn-ghost modal-fechar" onClick={onFechar} title="Fechar">✕</button>
        </div>

        {/* Barra de progresso */}
        {onEditarManual && (
          <div className="modal-atualizar-manual">
            <button
              className="btn-ghost btn-full"
              onClick={onEditarManual}
              disabled={processando}
            >
              Modificar norma manualmente
            </button>
          </div>
        )}

        <div className="modal-atualizar-progress">
          {fluxo.labels.map((label, idx) => {
            const passoAtual = fluxo.passos.indexOf(passo)
            const estado = idx < passoAtual ? 'done' : idx === passoAtual ? 'active' : 'pending'
            return (
              <div key={label} className={`progress-step progress-${estado}`}>
                <span className="progress-num">{estado === 'done' ? '✓' : idx + 1}</span>
                <span>{label}</span>
              </div>
            )
          })}
        </div>

        {/* ── Seletor de fonte (visível apenas no passo 1) ────────── */}
        {(passo === 'upload' || passo === 'catalogo') && (
          <div className="modal-atualizar-fonte">
            <button
              className={`modal-fonte-btn${fonte === 'docx' ? ' ativa' : ''}`}
              onClick={() => mudarFonte('docx')}
            >
              📄 Arquivo DOCX/XML
            </button>
            <button
              className={`modal-fonte-btn${fonte === 'catalogo' ? ' ativa' : ''}`}
              onClick={() => mudarFonte('catalogo')}
            >
              📚 Do catálogo
            </button>
          </div>
        )}

        {/* ── Passo 1a: Upload DOCX ───────────────────────────────── */}
        {passo === 'upload' && (
          <div className="modal-atualizar-corpo">
            <p className="modal-atualizar-desc">
              Selecione o arquivo DOCX ou XML com a nova versão da norma.
              Arquivos XML também podem passar pelas rotinas antes da comparação.
            </p>
            <div
              className="upload-drop-area"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
              onDrop={handleDrop}
            >
              <input ref={fileRef} type="file" accept=".docx,.xml,.html,.htm"
                style={{ display: 'none' }} onChange={handleArquivo} />
              <span className="upload-icone">📄</span>
              <span className="upload-label">Clique ou arraste um arquivo DOCX ou XML</span>
            </div>
          </div>
        )}

        {/* ── Passo 1b: Busca no catálogo ─────────────────────────── */}
        {passo === 'catalogo' && (
          <div className="modal-atualizar-corpo">
            <div className="modal-cat-filtros">
              <input
                className="modal-cat-busca"
                placeholder="Buscar por epígrafe, apelido ou ementa…"
                value={buscaCat}
                onChange={e => setBuscaCat(e.target.value)}
                autoFocus
              />
              <label className={`home-check${somenteVmCat ? ' ativo' : ''}`}>
                <input
                  type="checkbox"
                  checked={somenteVmCat}
                  onChange={e => setSomenteVmCat(e.target.checked)}
                />
                <span>Vade mecum</span>
              </label>
            </div>
            <div className="modal-cat-lista">
              {carregandoCat && (
                <div className="modal-cat-vazio">Buscando…</div>
              )}
              {!carregandoCat && normasCatFiltradas.length === 0 && (
                <div className="modal-cat-vazio">Nenhuma norma encontrada.</div>
              )}
              {!carregandoCat && normasCatFiltradas.map(n => (
                <button
                  key={n.id}
                  className="modal-cat-item"
                  onClick={() => selecionarNormaCatalogo(n)}
                  disabled={processando}
                >
                  <span className="modal-cat-tipo">{n.tipo}</span>
                  <span className="modal-cat-epigrafe">{n.epigrafe}</span>
                  {n.apelido && <span className="modal-cat-apelido">{n.apelido}</span>}
                  {n.ementa  && <span className="modal-cat-ementa">{n.ementa}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Passo 2 (docx): Pipeline ────────────────────────────── */}
        {passo === 'pipeline' && (
          <div className="modal-atualizar-corpo">
            <div className="modal-arq-selecionado">
              <span>📄 {nomeArq}</span>
              <button className="btn-ghost btn-sm"
                onClick={() => { setArquivo(null); setNomeArq(''); setNovoDoc(null); setLogPipeline([]); setErroMsg(''); setPasso('upload') }}>
                Trocar
              </button>
            </div>

            {!novoDoc ? (
              <>
                <p className="modal-atualizar-desc">
                  {arquivo && /\.xml$/i.test(arquivo.name)
                    ? 'Execute as rotinas de limpeza e classificação sobre o XML antes de comparar com a versão atual.'
                    : 'Execute as rotinas de limpeza e classificação no novo arquivo antes de comparar com a versão atual.'}
                </p>
                <label className="modal-atualizar-opcao">
                  <input
                    type="checkbox"
                    checked={temTagVm || incluirEstiloVadeMecum}
                    onChange={e => setIncluirEstiloVadeMecum(e.target.checked)}
                    disabled={temTagVm}
                  />
                  Incluir rotina Estilo Vade Mecum{temTagVm ? ' (tag vm)' : ''}
                </label>
                <label className="modal-atualizar-opcao">
                  <input
                    type="checkbox"
                    checked={temTagVm || incluirVadeMecum}
                    onChange={e => setIncluirVadeMecum(e.target.checked)}
                    disabled={temTagVm}
                  />
                  Incluir rotina Notas Vade Mecum{temTagVm ? ' (tag vm)' : ''}
                </label>
                <button
                  className="btn-primary btn-full"
                  onClick={rodarPipeline}
                  disabled={processando}
                >
                  {processando ? '⏳ Processando…' : '▶▶ Executar todas as rotinas'}
                </button>
              </>
            ) : (
              <>
                <div className="pipeline-sucesso">
                  ✓ Rotinas executadas com sucesso
                </div>
                {logPipeline.length > 0 && (
                  <ul className="pipeline-log">
                    {logPipeline.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}
                    {logPipeline.length > 12 && (
                      <li className="pipeline-log-mais">+ {logPipeline.length - 12} mensagens…</li>
                    )}
                  </ul>
                )}
                <OpcoesComparacao />
                <div className="modal-atualizar-acoes">
                  <button className="btn-ghost"
                    onClick={() => { setNovoDoc(null); setLogPipeline([]); setErroMsg('') }}>
                    ↺ Repetir
                  </button>
                  <button
                    className="btn-primary"
                    onClick={iniciarComparacao}
                    disabled={processando}
                  >
                    {processando ? '⏳ Comparando…' : '🔍 Iniciar comparação →'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Passo final: Comparação (docx e catálogo) ───────────── */}
        {passo === 'comparando' && (
          <div className="modal-atualizar-corpo">
            {fonte === 'catalogo' && normaSel && (
              <div className="modal-arq-selecionado">
                <span>📚 {normaSel.epigrafe}</span>
                <button className="btn-ghost btn-sm"
                  onClick={() => { setNovoDoc(null); setNormaSel(null); setPasso('catalogo'); setErroMsg('') }}>
                  Trocar
                </button>
              </div>
            )}
            <div className="pipeline-sucesso">
              ✓ {fonte === 'catalogo' ? 'Norma carregada do catálogo' : 'Rotinas executadas com sucesso'}
            </div>
            <p className="modal-atualizar-desc">
              Pronto para comparar com a versão atual no editor.
              As diferenças serão destacadas para revisão.
            </p>
            <OpcoesComparacao />
            <div className="modal-atualizar-acoes">
              <button className="btn-ghost"
                onClick={() => {
                  setNovoDoc(null)
                  setErroMsg('')
                  if (fonte === 'catalogo') { setNormaSel(null); setPasso('catalogo') }
                  else { setPasso('pipeline') }
                }}>
                ↺ Voltar
              </button>
              <button
                className="btn-primary"
                onClick={iniciarComparacao}
                disabled={processando}
              >
                {processando ? '⏳ Comparando…' : '🔍 Iniciar comparação →'}
              </button>
            </div>
          </div>
        )}

        {/* Mensagem de erro */}
        {erroMsg && (
          <div className="modal-atualizar-erro">{erroMsg}</div>
        )}
      </div>
    </div>
  )
}
