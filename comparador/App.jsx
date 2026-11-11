import { useRef, useState } from 'react'
import { compararDoisXmlComProgresso } from '../src/services/compararXmlInDesign.js'

function SeletorArquivo({ titulo, arquivo, onChange }) {
  const ref = useRef(null)
  function selecionar(file) {
    if (file) onChange(file)
  }
  return (
    <section className={`arquivo${arquivo ? ' selecionado' : ''}`}>
      <div>
        <strong>{titulo}</strong>
        <span>{arquivo?.name || 'Nenhum arquivo selecionado'}</span>
      </div>
      <button type="button" onClick={() => ref.current?.click()}>{arquivo ? 'Trocar' : 'Selecionar XML'}</button>
      <input ref={ref} type="file" accept=".xml,application/xml" onChange={e => { selecionar(e.target.files?.[0]); e.target.value = '' }} />
    </section>
  )
}

function TextoComDiferencas({ partes, lado }) {
  return partes.map((parte, idx) => parte.diferente
    ? <mark className={`char char-${lado}`} key={idx}>{parte.texto || '∅'}</mark>
    : <span key={idx}>{parte.texto}</span>)
}

function Diferenca({ diff }) {
  const titulo = diff.tipo === 'modificado'
    ? 'Conteúdo diferente'
    : diff.tipo === 'removido' ? 'Ausente no InDesign' : 'Somente no InDesign'
  return (
    <article className="diferenca">
      <strong>{titulo}</strong>
      {diff.normando && <p><b>Normando ({diff.normando.indice + 1}):</b>{' '}
        {diff.detalheCaracteres
          ? <TextoComDiferencas partes={diff.detalheCaracteres.normando} lado="normando" />
          : diff.normando.texto || '(vazio)'}
      </p>}
      {diff.indesign && <p><b>InDesign ({diff.indesign.indice + 1}):</b>{' '}
        {diff.detalheCaracteres
          ? <TextoComDiferencas partes={diff.detalheCaracteres.indesign} lado="indesign" />
          : diff.indesign.texto || '(vazio)'}
      </p>}
      {diff.detalheCaracteres && <small>{(diff.detalheCaracteres.similaridade * 100).toFixed(1).replace('.', ',')}% do conteúdo idêntico</small>}
    </article>
  )
}

export default function App() {
  const [normando, setNormando] = useState(null)
  const [indesign, setIndesign] = useState(null)
  const [relatorio, setRelatorio] = useState(null)
  const [erro, setErro] = useState('')
  const [processando, setProcessando] = useState(false)
  const [progresso, setProgresso] = useState({ percentual: 0, etapa: '' })

  function trocar(setter) {
    return file => { setter(file); setRelatorio(null); setErro(''); setProgresso({ percentual: 0, etapa: '' }) }
  }

  async function comparar() {
    if (!normando || !indesign || processando) return
    setProcessando(true)
    setErro('')
    setRelatorio(null)
    setProgresso({ percentual: 2, etapa: 'Lendo os arquivos…' })
    try {
      const [xmlNormando, xmlInDesign] = await Promise.all([normando.text(), indesign.text()])
      const resultado = await compararDoisXmlComProgresso(xmlNormando, xmlInDesign, (percentual, etapa) => {
        setProgresso({ percentual, etapa })
      })
      setRelatorio(resultado)
    } catch (err) {
      setErro(err?.message || String(err))
    } finally {
      setProcessando(false)
    }
  }

  return (
    <main>
      <header>
        <div className="marca">N</div>
        <div><h1>Comparador XML Normando</h1><p>Compare normas individuais ou publicações completas após a diagramação no InDesign.</p></div>
      </header>

      <div className="seletores">
        <SeletorArquivo titulo="XML exportado pelo Normando" arquivo={normando} onChange={trocar(setNormando)} />
        <SeletorArquivo titulo="XML exportado pelo InDesign" arquivo={indesign} onChange={trocar(setIndesign)} />
      </div>
      <button className="comparar" type="button" disabled={!normando || !indesign || processando} onClick={comparar}>
        {processando ? 'Comparando…' : 'Comparar integridade'}
      </button>
      {processando && <div className="progresso" role="status" aria-live="polite">
        <div className="progresso-topo"><span>{progresso.etapa}</span><strong>{progresso.percentual}%</strong></div>
        <progress max="100" value={progresso.percentual}>{progresso.percentual}%</progress>
      </div>}

      <p className="regra">A comparação não altera os arquivos nem executa rotinas. Tags, metadados, tipos de espaço e espaços ao final dos trechos são ignorados.</p>
      {erro && <div className="erro">{erro}</div>}
      {relatorio && <section className="resultado">
        <div className={`status ${relatorio.integro ? 'ok' : 'alerta'}`}>
          {relatorio.integro ? '✓ Integridade confirmada: os conteúdos são idênticos.' : `⚠ ${relatorio.diferencas.length} diferença(s) de conteúdo encontrada(s).`}
        </div>
        <p className="resumo">Normando: {relatorio.totalNormando} blocos · InDesign: {relatorio.totalInDesign} blocos</p>
        {!relatorio.integro && <div className="lista">
          {relatorio.diferencas.slice(0, 500).map((diff, idx) => <Diferenca diff={diff} key={idx} />)}
          {relatorio.diferencas.length > 500 && <p className="limite">Exibindo as primeiras 500 de {relatorio.diferencas.length} diferenças.</p>}
        </div>}
      </section>}
    </main>
  )
}
