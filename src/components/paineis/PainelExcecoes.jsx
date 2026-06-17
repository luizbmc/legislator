import { useEffect, useState } from 'react'
import { selecionarTextoNoEditor } from '../editor/selecionarTexto.js'

function selecionarEExibir(editor, from, to) {
  selecionarTextoNoEditor(editor, { from, to })
}

function blocoOcultoPorModoVm(node, modoVadeMecum = false) {
  const role = node?.attrs?.vmRole
  return (role === 'vm' && !modoVadeMecum) || (role === 'original' && modoVadeMecum)
}

function textoAlvo(exc) {
  return (exc?.alvoTexto || exc?.texto || '').trim()
}

function blocoContemExcecao(bloco, exc) {
  const alvo = textoAlvo(exc)
  if (!bloco || !alvo) return false
  return (bloco.node.textContent || '').indexOf(alvo) >= 0
}

function blocosVisiveis(editor, modoVadeMecum = false) {
  const blocos = []
  editor.state.doc.forEach((node, offset) => {
    if (node.type?.name === 'table') return
    if (blocoOcultoPorModoVm(node, modoVadeMecum)) return
    blocos.push({
      node,
      from: offset + 1,
      to: offset + node.nodeSize - 1,
    })
  })
  return blocos
}

function blocoPorPosicao(editor, from, modoVadeMecum = false) {
  if (!Number.isFinite(from)) return null
  let bloco = null
  editor.state.doc.forEach((node, offset) => {
    if (bloco) return
    if (node.type?.name === 'table') return
    if (blocoOcultoPorModoVm(node, modoVadeMecum)) return
    const start = offset + 1
    const end = offset + node.nodeSize - 1
    if (from >= start && from <= end) bloco = { node, from: start, to: end }
  })
  return bloco
}

function posicaoDocPorOffsetTexto(editor, bloco, offsetTexto) {
  const alvo = Math.max(0, Number(offsetTexto) || 0)
  let acumulado = 0
  let posicao = null

  editor.state.doc.descendants((node, pos) => {
    if (posicao != null) return false
    if (pos < bloco.from || pos > bloco.to) return true

    if (node.isText && node.text) {
      const len = node.text.length
      if (alvo <= acumulado + len) {
        posicao = pos + Math.max(0, alvo - acumulado)
        return false
      }
      acumulado += len
      return false
    }

    if (node.type?.name === 'hardBreak') {
      if (alvo <= acumulado + 1) {
        posicao = pos
        return false
      }
      acumulado += 1
      return false
    }

    return true
  })

  return posicao ?? bloco.to
}

function intervaloNoBloco(editor, bloco, exc) {
  const texto = bloco.node.textContent || ''
  const candidatos = [
    exc.alvoTexto,
    exc.texto,
    (exc.texto || '').slice(0, 40),
  ].filter(Boolean)

  let inicio = Number.isFinite(exc.alvoInicio) ? exc.alvoInicio : null
  let fim = Number.isFinite(exc.alvoFim) ? exc.alvoFim : null

  if (inicio == null || fim == null || inicio < 0 || fim <= inicio || inicio > texto.length) {
    inicio = null
    fim = null
  }

  if (inicio != null) {
    const trecho = texto.slice(inicio, fim)
    const alvo = textoAlvo(exc)
    if (alvo && trecho.indexOf(alvo) < 0 && alvo.indexOf(trecho) < 0) {
      inicio = null
      fim = null
    }
  }

  if (inicio == null) {
    for (const candidato of candidatos) {
      const idx = texto.indexOf(candidato)
      if (idx >= 0) {
        inicio = idx
        fim = idx + candidato.length
        break
      }
    }
  }

  if (inicio == null) {
    inicio = 0
    fim = Math.min(texto.length, exc.texto?.length || 80)
  }

  return {
    from: posicaoDocPorOffsetTexto(editor, bloco, inicio),
    to: posicaoDocPorOffsetTexto(editor, bloco, fim),
  }
}

function localizarBlocoExcecao(editor, exc, modoVadeMecum = false) {
  const blocos = blocosVisiveis(editor, modoVadeMecum)
  const porPosicao = blocoPorPosicao(editor, exc.from, modoVadeMecum)
  if (blocoContemExcecao(porPosicao, exc)) return porPosicao

  const porLinha = Number.isFinite(exc.linha) ? blocos[exc.linha - 1] : null
  if (blocoContemExcecao(porLinha, exc)) return porLinha

  const alvo = textoAlvo(exc)
  if (alvo) {
    const porAlvo = blocos.find(bloco => (bloco.node.textContent || '').indexOf(alvo) >= 0)
    if (porAlvo) return porAlvo
  }

  const prefixo = (exc.texto || '').slice(0, 40)
  if (prefixo) {
    const porPrefixo = blocos.find(bloco => (bloco.node.textContent || '').startsWith(prefixo))
    if (porPrefixo) return porPrefixo
  }

  return porLinha || porPosicao || null
}

function irParaExcecao(editor, exc, modoVadeMecum = false) {
  if (!editor || !exc) return

  const bloco = localizarBlocoExcecao(editor, exc, modoVadeMecum)
  if (!bloco) return

  const { from, to } = intervaloNoBloco(editor, bloco, exc)
  selecionarEExibir(editor, from, to)
}

export default function PainelExcecoes({
  excecoes = [],
  onResolver,
  onReabrir,
  editor,
  aberto = true,
  onFechar,
  modoVadeMecum = false,
}) {
  const pendentes = excecoes.filter(e => !e.resolvida)
  const concluidas = excecoes.filter(e => e.resolvida)
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false)
  const [ativa, setAtiva] = useState(-1)

  useEffect(() => {
    if (!aberto) {
      setAtiva(-1)
      setMostrarConcluidas(false)
    }
  }, [aberto])

  if (!aberto) return null

  function selecionarExcecao(exc, idx) {
    setAtiva(idx)
    irParaExcecao(editor, exc, modoVadeMecum)
  }

  const visiveis = mostrarConcluidas ? excecoes : pendentes

  return (
    <div className="notas-painel excecoes-painel" role="dialog" aria-label="Navegador de exceções">
      <div className="notas-topo">
        <div>
          <span className="notas-titulo">Exceções</span>
          <span className="notas-contador excecoes-contador">{pendentes.length}</span>
        </div>
        {onFechar && <button className="btn-ghost notas-fechar" onClick={onFechar} title="Fechar">x</button>}
      </div>

      {concluidas.length > 0 && (
        <div className="excecoes-acoes">
          <button
            type="button"
            className="btn-ghost excecoes-toggle-concluidas"
            onClick={() => setMostrarConcluidas(v => !v)}
          >
            {mostrarConcluidas ? 'Ocultar concluídas' : `Exibir concluídas (${concluidas.length})`}
          </button>
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="notas-vazio">✓ Sem exceções pendentes</p>
      ) : (
        <ul className="notas-lista excecoes-lista">
          {excecoes.map((exc, i) => {
            if (!mostrarConcluidas && exc.resolvida) return null
            return (
              <li key={exc.assinatura || i} className={`excecao-item${exc.resolvida ? ' concluida' : ''}`}>
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
                <button
                  className="excecao-ok"
                  onClick={() => exc.resolvida ? onReabrir?.(i) : onResolver?.(i)}
                  title={exc.resolvida ? 'Voltar a exibir como pendente' : 'Marcar como concluída'}
                >
                  {exc.resolvida ? '↺' : '✓'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
