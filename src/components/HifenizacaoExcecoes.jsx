import { useState, useEffect, useMemo } from 'react'

/**
 * Exceções de hifenização (Configurações → Hifenização): uma palavra por linha, com "_" nos pontos
 * onde ela pode ser dividida. Vale para todas as publicações: compositor do Normando, PDF e o
 * dicionário do documento no IDML (hifenizacaoExcecoes.js).
 */

// a mesma leitura do processo principal (hifenizacaoExcecoes.js), para mostrar o que vai valer
function ler(texto) {
  const validas = [], invalidas = []
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const l = bruta.trim()
    if (!l || l.startsWith('#')) continue
    if (!/^[\p{L}_-]+$/u.test(l) || /__|^_|_$|_-|-_/.test(l)) invalidas.push(l)
    else validas.push(l)
  }
  return { validas, invalidas }
}

const comHifens = l => {
  const partes = l.split('_')
  if (partes.length === 1) return `${l} (não divide)`
  return partes.map((_, i) => i === 0 ? null : `${partes.slice(0, i).join('')}-${partes.slice(i).join('')}`).filter(Boolean).join(' · ')
}

export default function HifenizacaoExcecoes() {
  const [texto, setTexto] = useState(null)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    window.legislator.configuracoes.buscar('hifenizacao')
      .then(r => setTexto(r?.valor?.palavras || ''))
      .catch(e => { setTexto(''); setErro(`Não foi possível carregar: ${e?.message || e}`) })
  }, [])

  const { validas, invalidas } = useMemo(() => ler(texto), [texto])

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      await window.legislator.configuracoes.salvar('hifenizacao', { palavras: texto })
      setSalvo(`Lista salva: ${validas.length} palavra(s). Vale para as próximas exportações de todas as publicações.`)
    } catch (e) {
      setErro(`Não foi possível salvar: ${e?.message || e}`)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="config-card">
      <div className="config-card-header">
        <div>
          <h2>Exceções de hifenização</h2>
          <p>
            Uma palavra por linha, com <code>_</code> nos pontos onde ela pode ser dividida. Exemplo: <code>aero_es_pa_cial</code> permite
            aero-espacial, aeroes-pacial e aeroespa-cial. Sem <code>_</code>, a palavra não é dividida. Maiúsculas e minúsculas não
            importam; o plural é outra palavra (escreva as duas formas). Linhas começadas por <code>#</code> são comentários.
          </p>
          <p>Vale para todas as publicações: na paginação e no PDF do Normando e no dicionário do documento do IDML, para o InDesign dividir igual.</p>
        </div>
      </div>
      {texto == null ? <p className="pub-vazio">Carregando…</p> : (
        <div className="hifen-excecoes">
          <textarea
            rows={16}
            spellCheck={false}
            value={texto}
            onChange={e => { setTexto(e.target.value); setSalvo('') }}
            placeholder={'aero_es_pa_cial\naero_es_pa_ciais\n# não dividir:\nperuca'}
          />
          <div className="hifen-excecoes-previa">
            {invalidas.length > 0 && (
              <p className="pub-pretextuais-erro">
                Linha(s) que não valem (só letras, hífen da palavra composta e <code>_</code> entre letras): {invalidas.join(', ')}
              </p>
            )}
            {validas.length > 0 && (
              <ul>
                {validas.slice(0, 200).map(l => <li key={l}><strong>{l.replace(/_/g, '')}</strong>: {comHifens(l)}</li>)}
              </ul>
            )}
          </div>
          {erro && <p className="pub-pretextuais-erro">{erro}</p>}
          {salvo && <p className="pub-pretextuais-dica">{salvo}</p>}
          <div className="form-acoes">
            <button className="btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </section>
  )
}
