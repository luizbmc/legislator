import { useEffect, useState } from 'react'

function selecionarEExibir(editor, from, to) {
  if (!editor || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return

  editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .scrollIntoView()
    .run()

  requestAnimationFrame(() => {
    try {
      const { node } = editor.view.domAtPos(from)
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) {}
  })
}

function irParaExcecao(editor, exc) {
  if (!editor || !exc) return

  if (Number.isFinite(exc.from) && Number.isFinite(exc.to) && exc.to > exc.from) {
    selecionarEExibir(editor, exc.from, exc.to)
    return
  }

  let bloco = null
  let linhaAtual = 0

  editor.state.doc.forEach((node, offset) => {
    if (bloco) return
    if (node.type?.name === 'table') return
    linhaAtual++
    if (linhaAtual !== exc.linha) return

    bloco = {
      node,
      from: offset + 1,
      to: offset + node.nodeSize - 1,
    }
  })

  if (!bloco) {
    const prefixo = (exc.texto || '').slice(0, 40)
    editor.state.doc.forEach((node, offset) => {
      if (bloco) return
      if (!prefixo || !node.textContent.startsWith(prefixo)) return
      bloco = {
        node,
        from: offset + 1,
        to: offset + node.nodeSize - 1,
      }
    })
  }

  if (!bloco) return

  const candidatos = [
    exc.alvoTexto,
    exc.texto,
    (exc.texto || '').slice(0, 40),
  ].filter(Boolean)

  let targetFrom = null
  let targetTo = null

  editor.state.doc.descendants((node, pos) => {
    if (targetFrom != null) return false
    if (!node.isText || !node.text) return true
    if (pos < bloco.from || pos > bloco.to) return true

    for (const candidato of candidatos) {
      const idx = node.text.indexOf(candidato)
      if (idx >= 0) {
        targetFrom = pos + idx
        targetTo = targetFrom + candidato.length
        return false
      }
    }
    return true
  })

  if (targetFrom == null || targetTo == null) {
    targetFrom = bloco.from
    targetTo = Math.min(bloco.to, bloco.from + Math.max(1, Math.min(bloco.node.textContent.length, exc.texto?.length || 80)))
  }

  selecionarEExibir(editor, targetFrom, targetTo)
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
                <code className="excecao-texto">"{exc.alvoTexto || exc.texto}"</code>
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
