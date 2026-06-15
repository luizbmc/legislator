import { useEffect, useState } from 'react'

function textoCompacto(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim()
}

function ocultoPorModoVm(node, modoVadeMecum = false) {
  const role = node?.attrs?.vmRole
  return (role === 'vm' && !modoVadeMecum) || (role === 'original' && modoVadeMecum)
}

function labelAlteracao(node) {
  const alterado = node?.attrs?.alterado
  const diffType = node?.attrs?.diffType
  if (alterado === 'remocaoApos') return 'Remoção abaixo'
  if (diffType === 'added') return 'Adicionado'
  if (diffType === 'modified') return 'Modificado'
  return 'Alterado'
}

function classeAlteracao(node) {
  const alterado = node?.attrs?.alterado
  const diffType = node?.attrs?.diffType
  if (alterado === 'remocaoApos') return 'remocao'
  if (diffType === 'added') return 'adicionado'
  if (diffType === 'modified') return 'modificado'
  return 'alterado'
}

function estiloParagrafo(node) {
  return node?.attrs?.styleName || node?.attrs?.styleId || node?.type?.name || 'Parágrafo'
}

function coletarAlteracoes(editor, modoVadeMecum = false) {
  const itens = []
  if (!editor) return itens

  editor.state.doc.forEach((node, offset, index) => {
    if (!node?.attrs?.alterado) return
    if (ocultoPorModoVm(node, modoVadeMecum)) return

    const from = offset + 1
    const to = Math.max(from, offset + node.nodeSize - 1)
    itens.push({
      id: `${index}-${from}-${node.attrs.alterado}-${node.attrs.diffType || ''}`,
      index,
      from,
      to,
      tipo: labelAlteracao(node),
      classe: classeAlteracao(node),
      estilo: estiloParagrafo(node),
      texto: textoCompacto(node.textContent || ''),
    })
  })

  return itens
}

function scrollToSelection(editor, from) {
  requestAnimationFrame(() => {
    try {
      const { node } = editor.view.domAtPos(from)
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      editor.commands.scrollIntoView()
    }
  })
}

export default function PainelAlteracoes({
  editor,
  aberto,
  onFechar,
  modoVadeMecum = false,
  marcasVisiveis = true,
  onMarcasVisiveisChange,
}) {
  const [alteracoes, setAlteracoes] = useState(() => coletarAlteracoes(editor, modoVadeMecum))
  const [ativa, setAtiva] = useState(-1)

  useEffect(() => {
    if (!editor || !aberto) return
    const update = () => setAlteracoes(coletarAlteracoes(editor, modoVadeMecum))
    update()
    editor.on('update', update)
    return () => editor.off('update', update)
  }, [editor, aberto, modoVadeMecum])

  useEffect(() => {
    if (!aberto) setAtiva(-1)
  }, [aberto])

  if (!aberto) return null

  function irParaAlteracao(item, idx) {
    if (!editor || !item) return
    setAtiva(idx)
    editor.chain().focus().setTextSelection({ from: item.from, to: item.to }).run()
    scrollToSelection(editor, item.from)
  }

  return (
    <div className="notas-painel notas-navegador-painel alteracoes-painel" role="dialog" aria-label="Navegador de alterações">
      <div className="notas-topo">
        <div>
          <span className="notas-titulo">Alterações</span>
          <span className="notas-contador alteracoes-contador">{alteracoes.length}</span>
        </div>
        <button className="btn-ghost notas-fechar" onClick={onFechar} title="Fechar">x</button>
      </div>

      <label className="alteracoes-toggle">
        <input
          type="checkbox"
          checked={!marcasVisiveis}
          onChange={e => onMarcasVisiveisChange?.(!e.target.checked)}
        />
        <span>Ocultar marcações de alteração</span>
      </label>

      {alteracoes.length === 0 ? (
        <p className="notas-vazio">Nenhuma alteração marcada.</p>
      ) : (
        <ul className="notas-lista alteracoes-lista">
          {alteracoes.map((item, idx) => (
            <li key={item.id}>
              <button
                className={`nota-item alteracao-item alteracao-${item.classe}${idx === ativa ? ' ativa' : ''}`}
                onClick={() => irParaAlteracao(item, idx)}
                title={item.texto}
              >
                <span className="alteracao-meta">
                  <span className={`alteracao-tipo alteracao-tipo-${item.classe}`}>{item.tipo}</span>
                  <span className="alteracao-estilo">{item.estilo}</span>
                </span>
                <span className="nota-texto alteracao-texto">{item.texto || '(sem texto)'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
