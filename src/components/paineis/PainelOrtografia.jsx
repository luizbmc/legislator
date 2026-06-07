import { useState, useCallback } from 'react'

// Chave de armazenamento local das exceções (palavras aceitas pelo usuário)
const STORAGE_KEY = 'legislator_ortografia_excecoes'

function carregarExcecoes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function salvarExcecoes(conjunto) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...conjunto]))
}

export default function PainelOrtografia({ editor }) {
  const [escaneando,    setEscaneando]    = useState(false)
  const [palavrasErradas, setPalavrasErradas] = useState(null)   // null = ainda não escaneou
  const [contagemMap,   setContagemMap]   = useState(new Map())
  const [excecoes,      setExcecoes]      = useState(carregarExcecoes)
  const [expandirAceitas, setExpandirAceitas] = useState(false)
  const [erro,          setErro]          = useState(null)

  // ── Escanear ──────────────────────────────────────────────────────
  const escanear = useCallback(async () => {
    if (!editor) return
    setEscaneando(true)
    setErro(null)
    try {
      const texto = editor.getText()

      // Tokeniza: sequências de 2+ letras Unicode (inclui acentuadas)
      const tokens = texto.match(/\p{L}{2,}/gu) ?? []

      // Conta ocorrências por palavra normalizada (minúscula)
      const contagem = new Map()
      for (const token of tokens) {
        const lower = token.toLowerCase()
        contagem.set(lower, (contagem.get(lower) ?? 0) + 1)
      }

      // Envia todas as palavras únicas ao processo principal para checagem
      const todasPalavras     = [...contagem.keys()]
      const naoReconhecidas   = await window.legislator.ortografia.verificar(todasPalavras)

      setContagemMap(contagem)
      setPalavrasErradas(new Set(naoReconhecidas))
    } catch (e) {
      setErro('Erro ao escanear: ' + (e?.message ?? String(e)))
    } finally {
      setEscaneando(false)
    }
  }, [editor])

  // ── Aceitar palavra ───────────────────────────────────────────────
  function aceitar(palavra) {
    const novo = new Set(excecoes)
    novo.add(palavra)
    setExcecoes(novo)
    salvarExcecoes(novo)
    // Adiciona ao dicionário pessoal do Chromium → para de sublinhar
    window.legislator.ortografia.aceitar(palavra).catch(() => {})
  }

  // ── Remover exceção ───────────────────────────────────────────────
  function removerExcecao(palavra) {
    const novo = new Set(excecoes)
    novo.delete(palavra)
    setExcecoes(novo)
    salvarExcecoes(novo)
    // Remove do dicionário pessoal do Chromium → volta a sublinhar
    window.legislator.ortografia.rejeitar(palavra).catch(() => {})
  }

  // ── Lista filtrada (não reconhecida e não aceita pelo usuário) ────
  const listaPalavras = palavrasErradas
    ? [...palavrasErradas]
        .filter(p => !excecoes.has(p))
        .sort((a, b) => (contagemMap.get(b) ?? 0) - (contagemMap.get(a) ?? 0))
    : []

  return (
    <div className="painel-ortografia">

      {/* Botão escanear */}
      <button
        className="btn-primary painel-ort-escanear"
        onClick={escanear}
        disabled={escaneando || !editor}
      >
        {escaneando ? 'Escaneando…' : '🔍 Escanear documento'}
      </button>

      {erro && <p className="painel-ort-erro">{erro}</p>}

      {palavrasErradas !== null && !escaneando && (
        <>
          {/* Resumo */}
          <div className="painel-ort-resumo">
            {listaPalavras.length === 0
              ? <span className="painel-ort-ok">✓ Nenhuma palavra desconhecida</span>
              : <span>{listaPalavras.length} palavra{listaPalavras.length !== 1 ? 's' : ''} não reconhecida{listaPalavras.length !== 1 ? 's' : ''}</span>
            }
          </div>

          {/* Lista de palavras desconhecidas */}
          {listaPalavras.length > 0 && (
            <div className="painel-ort-lista">
              {listaPalavras.map(p => (
                <div key={p} className="painel-ort-item">
                  <span className="painel-ort-palavra">{p}</span>
                  <span className="painel-ort-count" title="Ocorrências no documento">
                    {contagemMap.get(p) ?? 1}×
                  </span>
                  <button
                    className="painel-ort-btn-aceitar"
                    onClick={() => aceitar(p)}
                    title="Aceitar — adicionar ao dicionário pessoal"
                  >Aceitar</button>
                </div>
              ))}
            </div>
          )}

          {/* Seção de palavras aceitas (exceções) */}
          {excecoes.size > 0 && (
            <div className="painel-ort-secao-aceitas">
              <button
                className="painel-ort-secao-toggle"
                onClick={() => setExpandirAceitas(v => !v)}
              >
                {expandirAceitas ? '▾' : '▸'} Aceitas ({excecoes.size})
              </button>
              {expandirAceitas && (
                <div className="painel-ort-aceitas-lista">
                  {[...excecoes].sort().map(p => (
                    <div key={p} className="painel-ort-item painel-ort-item-aceita">
                      <span className="painel-ort-palavra">{p}</span>
                      <button
                        className="painel-ort-btn-remover"
                        onClick={() => removerExcecao(p)}
                        title="Remover do dicionário pessoal"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
