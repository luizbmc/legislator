import { useState, useEffect } from 'react'

const NIVEIS = {
  epigrafe:         1,
  partelivroTitCap: 2,
  secaoSubsecao:    3,
}

function extrairItens(editor) {
  const itens = []
  if (!editor) return itens
  let pos = 0
  editor.state.doc.forEach(node => {
    if (node.type.name in NIVEIS) {
      itens.push({
        nivel: NIVEIS[node.type.name],
        texto: node.textContent.slice(0, 55) || '—',
        pos,
      })
    }
    pos += node.nodeSize
  })
  return itens
}

export default function PainelSumario({ editor }) {
  const [itens, setItens] = useState(() => extrairItens(editor))

  // Recalcula o sumário sempre que o documento é editado
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => setItens(extrairItens(editor))
    editor.on('update', onUpdate)
    return () => editor.off('update', onUpdate)
  }, [editor])

  // Sincroniza quando o editor é trocado (ex.: ao abrir outra norma)
  useEffect(() => {
    setItens(extrairItens(editor))
  }, [editor])

  function irPara(pos) {
    if (!editor) return
    // Define a seleção no ponto correto
    editor.chain().focus().setTextSelection(pos + 1).run()
    // Usa o DOM diretamente para garantir scroll no contêiner .legislator-editor
    requestAnimationFrame(() => {
      try {
        const { node } = editor.view.domAtPos(pos + 1)
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (_) { /* posição inválida */ }
    })
  }

  return (
    <div className="painel-sumario">
      <div className="painel-titulo">Sumário</div>
      {itens.length === 0
        ? <p className="painel-vazio">—</p>
        : (
          <ul className="sumario-lista">
            {itens.map((item, i) => (
              <li key={i}
                className={`sumario-item nivel-${item.nivel}`}
                onClick={() => irPara(item.pos)}
                title={item.texto}>
                {item.texto}
              </li>
            ))}
          </ul>
        )
      }
    </div>
  )
}
