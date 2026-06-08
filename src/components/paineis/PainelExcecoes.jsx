import { useEffect, useState } from 'react'

function irParaExcecao(editor, exc) {
  if (!editor) return
  // Busca o nó cujo texto começa com o trecho da exceção
  const prefixo = exc.texto.slice(0, 40)
  let targetPos = null
  editor.state.doc.forEach((node, offset) => {
    if (targetPos != null) return
    if (node.textContent.startsWith(prefixo)) targetPos = offset + 1
  })
  if (targetPos == null) return
  editor.chain().focus().setTextSelection(targetPos).run()
  requestAnimationFrame(() => {
    try {
      const { node } = editor.view.domAtPos(targetPos)
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) {}
  })
}

export default function PainelExcecoes({ excecoes = [], onResolver, editor, aberto = true, onFechar }) {
  const pendentes = excecoes.filter(e => !e.resolvida)
  const [ativa, setAtiva] = useState(-1)

  useEffect(() => {
    if (!aberto) setAtiva(-1)
  }, [aberto])

  if (!aberto) return null

  function selecionarExcecao(exc, idx) {
    setAtiva(idx)
    irParaExcecao(editor, exc)
  }

  return (
    <div className="notas-painel excecoes-painel" role="dialog" aria-label="Navegador de exceções">
      <div className="notas-topo">
        <div>
          <span className="notas-titulo">Exceções</span>
          <span className="notas-contador excecoes-contador">{pendentes.length}</span>
        </div>
        {onFechar && <button className="btn-ghost notas-fechar" onClick={onFechar} title="Fechar">x</button>}
      </div>

      {pendentes.length === 0 ? (
        <p className="notas-vazio">✓ Sem exceções pendentes</p>
      ) : (
        <ul className="notas-lista excecoes-lista">
          {excecoes.map((exc, i) => exc.resolvida ? null : (
            <li key={i} className="excecao-item">
              <div
                className={`excecao-corpo${i === ativa ? ' ativa' : ''}`}
                onClick={() => selecionarExcecao(exc, i)}
                title="Ir para este trecho"
                style={{ cursor: editor ? 'pointer' : 'default' }}
              >
                <span className="excecao-linha">L{exc.linha}</span>
                <span className="excecao-desc">{exc.descricao}</span>
                <code className="excecao-texto">"{exc.texto}"</code>
              </div>
              <button className="excecao-ok" onClick={() => onResolver(i)} title="Marcar como resolvida">
                ✓
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
