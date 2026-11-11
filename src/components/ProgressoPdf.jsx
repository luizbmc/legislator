import { useState, useEffect } from 'react'

/**
 * Barra de progresso da geração do PDF: ouve o andamento que o processo principal manda
 * (salvarPdf.js / exportPdf.js) e mostra a etapa, a porcentagem e o tempo decorrido.
 * Fica aberta enquanto `ativo`; quem chama fecha quando a geração termina.
 */
export default function ProgressoPdf({ ativo, titulo = 'Gerando o PDF' }) {
  const [p, setP] = useState({ texto: 'Escolha onde salvar o arquivo…', fracao: 0 })
  const [inicio, setInicio] = useState(null)
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => {
    if (!ativo) return undefined
    setP({ texto: 'Escolha onde salvar o arquivo…', fracao: 0 })
    setInicio(null)
    const parar = window.legislator.publicacoes.aoProgressoPdf?.(novo => {
      setInicio(i => i ?? Date.now())
      setP(novo)
    })
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => { parar?.(); clearInterval(t) }
  }, [ativo])

  if (!ativo) return null
  const pct = Math.round((p.fracao || 0) * 100)
  const seg = inicio ? Math.max(0, Math.round((agora - inicio) / 1000)) : 0
  const tempo = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`
  return (
    <div className="modal-overlay progresso-pdf-fundo">
      <div className="modal-box progresso-pdf" role="dialog" aria-live="polite" aria-label={titulo}>
        <h3>{titulo}</h3>
        <div className="progresso-pdf-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="progresso-pdf-cheio" style={{ width: `${pct}%` }} />
        </div>
        <div className="progresso-pdf-linha">
          <span>{p.texto}</span>
          <span>{inicio ? `${pct}% · ${tempo}` : ''}</span>
        </div>
        <p className="progresso-pdf-dica">O PDF abre sozinho quando terminar.</p>
      </div>
    </div>
  )
}
