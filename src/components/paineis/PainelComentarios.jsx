import { useEffect, useState } from 'react'
import {
  carregarUsuarioComentarioAtual,
  iniciaisUsuario,
} from '../../services/usuariosComentarios.js'

function textoCompacto(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim()
}

function respostasArray(valor) {
  if (Array.isArray(valor)) return valor
  try {
    const parsed = JSON.parse(valor || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function attrsComentario(mark) {
  return {
    ...mark.attrs,
    respostas: respostasArray(mark.attrs?.respostas),
    concluido: Boolean(mark.attrs?.concluido),
  }
}

function coletarComentarios(editor) {
  const mapa = {}
  if (!editor) return []

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const mark = node.marks.find(m => m.type.name === 'comentario')
    if (!mark?.attrs?.id) return true

    const attrs = attrsComentario(mark)
    const from = pos
    const to = pos + node.text.length
    const id = attrs.id
    if (!mapa[id]) {
      mapa[id] = {
        id,
        attrs,
        from,
        to,
        textoSelecionado: node.text,
        ranges: [{ from, to }],
      }
    } else {
      mapa[id].from = Math.min(mapa[id].from, from)
      mapa[id].to = Math.max(mapa[id].to, to)
      mapa[id].textoSelecionado += node.text
      mapa[id].ranges.push({ from, to })
    }
    return true
  })

  return Object.values(mapa)
    .sort((a, b) => a.from - b.from)
    .map(item => ({
      ...item,
      textoSelecionado: textoCompacto(item.textoSelecionado),
    }))
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

function atualizarComentario(editor, comentario, novosAttrs) {
  const markType = editor?.state?.schema?.marks?.comentario
  if (!editor || !markType) return
  const attrs = { ...comentario.attrs, ...novosAttrs }
  let tr = editor.state.tr
  for (const range of comentario.ranges) {
    tr = tr.removeMark(range.from, range.to, markType)
    if (!attrs.__remover) {
      tr = tr.addMark(range.from, range.to, markType.create(attrs))
    }
  }
  editor.view.dispatch(tr)
}

export default function PainelComentarios({ editor, aberto, onFechar, editable }) {
  const [comentarios, setComentarios] = useState(() => coletarComentarios(editor))
  const [ativo, setAtivo] = useState(-1)
  const [respostas, setRespostas] = useState({})

  useEffect(() => {
    if (!editor || !aberto) return
    const update = () => setComentarios(coletarComentarios(editor))
    update()
    editor.on('update', update)
    return () => editor.off('update', update)
  }, [editor, aberto])

  useEffect(() => {
    if (!aberto) {
      setAtivo(-1)
      setRespostas({})
    }
  }, [aberto])

  if (!aberto) return null

  function irParaComentario(comentario, idx) {
    if (!editor || !comentario) return
    setAtivo(idx)
    editor.chain().focus().setTextSelection({ from: comentario.from, to: comentario.to }).run()
    scrollToSelection(editor, comentario.from)
  }

  function excluirComentario(comentario) {
    if (!editable) return
    if (!confirm('Excluir este comentario?')) return
    atualizarComentario(editor, comentario, { __remover: true })
  }

  function alternarConcluido(comentario) {
    if (!editable) return
    atualizarComentario(editor, comentario, { concluido: !comentario.attrs.concluido })
  }

  function responder(comentario) {
    if (!editable) return
    const texto = String(respostas[comentario.id] || '').trim()
    if (!texto) return
    const usuario = carregarUsuarioComentarioAtual()
    const resposta = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      texto,
      autorId: usuario?.id || null,
      autorNome: usuario?.nome || 'Usuario',
      autorCor: usuario?.cor || '#4b5563',
      criadoEm: new Date().toISOString(),
    }
    atualizarComentario(editor, comentario, {
      respostas: [...respostasArray(comentario.attrs.respostas), resposta],
    })
    setRespostas(prev => ({ ...prev, [comentario.id]: '' }))
  }

  return (
    <div className="notas-painel comentarios-painel" role="dialog" aria-label="Navegador de comentarios">
      <div className="notas-topo">
        <div>
          <span className="notas-titulo">Lista 💬</span>
          <span className="notas-contador comentarios-contador">{comentarios.length}</span>
        </div>
        <button className="btn-ghost notas-fechar" onClick={onFechar} title="Fechar">x</button>
      </div>

      {comentarios.length === 0 ? (
        <p className="notas-vazio">Nenhum comentario encontrado.</p>
      ) : (
        <ul className="notas-lista comentarios-lista">
          {comentarios.map((comentario, idx) => (
            <li key={comentario.id}>
              <button
                className={`nota-item comentario-item${idx === ativo ? ' ativa' : ''}${comentario.attrs.concluido ? ' concluido' : ''}`}
                onClick={() => irParaComentario(comentario, idx)}
                title={comentario.textoSelecionado}
              >
                <span className="comentario-meta">
                  <span className="usuario-badge usuario-badge-mini" style={{ backgroundColor: comentario.attrs.autorCor || '#4b5563' }}>
                    {iniciaisUsuario(comentario.attrs.autorNome)}
                  </span>
                  <strong>{comentario.attrs.autorNome || 'Usuario'}</strong>
                  {comentario.attrs.concluido && <em>Concluido</em>}
                </span>
                <span className="comentario-texto">{comentario.attrs.texto || '(sem texto)'}</span>
                <span className="comentario-selecao">{comentario.textoSelecionado}</span>
              </button>

              {respostasArray(comentario.attrs.respostas).length > 0 && (
                <div className="comentario-respostas">
                  {respostasArray(comentario.attrs.respostas).map(resposta => (
                    <div key={resposta.id} className="comentario-resposta">
                      <span className="usuario-badge usuario-badge-mini" style={{ backgroundColor: resposta.autorCor || '#4b5563' }}>
                        {iniciaisUsuario(resposta.autorNome)}
                      </span>
                      <div>
                        <strong>{resposta.autorNome || 'Usuario'}</strong>
                        <p>{resposta.texto}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {editable && (
                <div className="comentario-acoes">
                  <textarea
                    rows={2}
                    value={respostas[comentario.id] || ''}
                    onChange={e => setRespostas(prev => ({ ...prev, [comentario.id]: e.target.value }))}
                    placeholder="Responder..."
                  />
                  <div>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => responder(comentario)} disabled={!String(respostas[comentario.id] || '').trim()}>
                      Responder
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => alternarConcluido(comentario)}>
                      {comentario.attrs.concluido ? 'Reabrir' : 'Concluir'}
                    </button>
                    <button type="button" className="btn-ghost btn-sm danger" onClick={() => excluirComentario(comentario)}>
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
