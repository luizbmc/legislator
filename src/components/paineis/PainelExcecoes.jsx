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

export default function PainelExcecoes({ excecoes = [], onResolver, editor }) {
  const pendentes = excecoes.filter(e => !e.resolvida)

  return (
    <div className="painel painel-excecoes">
      <div className="painel-titulo">
        Exceções
        {pendentes.length > 0 && (
          <span className="excecoes-badge">{pendentes.length}</span>
        )}
      </div>

      {pendentes.length === 0 ? (
        <p className="painel-vazio">✓ Sem exceções pendentes</p>
      ) : (
        <ul className="excecoes-lista">
          {excecoes.map((exc, i) => exc.resolvida ? null : (
            <li key={i} className="excecao-item">
              <div
                className="excecao-corpo"
                onClick={() => irParaExcecao(editor, exc)}
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
