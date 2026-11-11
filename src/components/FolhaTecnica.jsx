import { useState, useEffect } from 'react'

/**
 * Folha técnica da publicação (livro com pasta do livro): créditos institucionais, créditos da
 * publicação, informações editoriais, ficha catalográfica, direitos e endereço. Os textos entram
 * nos estilos do .indd (pretextuaisLivro.js); campo vazio mantém o texto do livro. Na primeira
 * abertura, os campos vêm com o que está no livro.
 */

// sem pasta do livro: os textos da CF de bolso, como ponto de partida
const PADRAO = {
  creditosInstitucionais: [
    { rotulo: 'Diretoria-Geral', nome: 'Guilherme Barbosa Brandão' },
    { rotulo: 'Consultoria-Geral', nome: 'José Evande Carvalho Araujo' },
    { rotulo: 'Consultoria Legislativa', nome: 'Aurelio Guimarães Cruvinel e Palos' },
    { rotulo: 'Centro de Documentação e Informação', nome: 'Sergio Sampaio Contreiras de Almeida' },
    { rotulo: 'Coordenação de Organização da Informação Legislativa', nome: 'Thiago Gomes Eirão' },
    { rotulo: 'Coordenação Edições Câmara', nome: 'Ana Lígia Mendes' },
  ],
  creditosPublicacao: [
    { rotulo: 'Edição', nome: 'Luisa Souto' },
    { rotulo: 'Preparação e revisão', nome: 'Danielle Ribeiro' },
    { rotulo: 'Capa', nome: 'Leandro Sacramento' },
    { rotulo: 'Projeto gráfico', nome: 'Leandro Sacramento e Luiz Eduardo Maklouf' },
    { rotulo: 'Diagramação', nome: 'Luiz Eduardo Maklouf' },
  ],
  informacoes: ['', '', ''],
  ficha: [],
  copyright: [
    'Direitos reservados e protegidos pela Lei 9.610, de 19/2/1998.',
    'Nenhuma parte desta publicação pode ser reproduzida por qualquer meio sem prévia autorização da Câmara dos Deputados, exceto nos casos de breves citações, desde que indicada a fonte.',
    'Venda exclusiva pela Edições Câmara.',
  ],
  endereco: [
    'Câmara dos Deputados',
    'Centro de Documentação e Informação – Cedi',
    'Coordenação Edições Câmara – Coedi',
    'Palácio do Congresso Nacional – Anexo 2 – Térreo',
    'Praça dos Três Poderes – Brasília (DF) – CEP 70160-900',
    'Telefone: (61) 3216-5833',
    'livraria.camara.leg.br',
  ],
}

const ROTULOS_INFO = ['Nota do editor', 'Edições anteriores', 'Linha e série']

const copia = v => JSON.parse(JSON.stringify(v))

function ListaCreditos({ titulo, itens, onChange }) {
  const set = (i, k) => e => onChange(itens.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))
  const mover = (i, d) => {
    const j = i + d
    if (j < 0 || j >= itens.length) return
    const n = [...itens]; [n[i], n[j]] = [n[j], n[i]]; onChange(n)
  }
  return (
    <div className="pub-pretextuais-grupo">
      <h3>{titulo}</h3>
      {itens.map((x, i) => (
        <div key={i} className="folha-tecnica-linha">
          <input value={x.rotulo} onChange={set(i, 'rotulo')} placeholder="Função ou órgão" />
          <input value={x.nome} onChange={set(i, 'nome')} placeholder="Nome" />
          <button type="button" className="btn-ghost" title="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
          <button type="button" className="btn-ghost" title="Descer" onClick={() => mover(i, 1)} disabled={i === itens.length - 1}>↓</button>
          <button type="button" className="btn-ghost" title="Remover" onClick={() => onChange(itens.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => onChange([...itens, { rotulo: '', nome: '' }])}>+ adicionar campo</button>
    </div>
  )
}

function Paragrafos({ titulo, itens, rotulos, onChange }) {
  const set = i => e => onChange(itens.map((x, j) => (j === i ? e.target.value : x)))
  return (
    <div className="pub-pretextuais-grupo">
      <h3>{titulo}</h3>
      {itens.map((x, i) => (
        <div key={i} className="campo">
          <label>{rotulos?.[i] || `Parágrafo ${i + 1}`}</label>
          <textarea rows={Math.min(6, Math.max(1, Math.ceil(String(x || '').length / 90)))} value={x || ''} onChange={set(i)} />
        </div>
      ))}
    </div>
  )
}

export default function FolhaTecnica({ publicacaoId, publicacao, valor, onSalvar, onFechar }) {
  const [dados, setDados] = useState(null)
  const [origem, setOrigem] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      // com pasta do livro: os parágrafos do .indd; sem ela: as páginas como o modelo do Normando sai
      let doLivro = null, deOnde = 'livro'
      try { doLivro = await window.legislator.publicacoes.pretextuaisDoLivro?.(publicacaoId) } catch { doLivro = null }
      if (!doLivro) {
        deOnde = 'modelo'
        try {
          const inst = (await window.legislator.configuracoes.buscar('institucional'))?.valor || {}
          const { folhaTecnica, ...resto } = publicacao?.pretextuais || {}
          doLivro = await window.legislator.publicacoes.pretextuaisDoModelo?.({ ...publicacao, pretextuais: JSON.stringify(resto) }, inst)
        } catch { doLivro = null }
      }
      if (!vivo) return
      const base = doLivro?.folhaTecnica || {}
      // parte que o livro (ou o modelo) não tem: os textos padrão
      const inicial = Object.fromEntries(Object.keys(PADRAO).map(k => [k, Array.isArray(base[k]) && base[k].length ? copia(base[k]) : copia(PADRAO[k])]))
      if (valor && Object.keys(valor).length) { setDados({ ...inicial, ...copia(valor) }); setOrigem('salvo') }
      else { setDados(inicial); setOrigem(deOnde) }
    })()
    return () => { vivo = false }
  }, [publicacaoId, valor])

  const set = k => v => setDados(d => ({ ...d, [k]: v }))

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="modal-box" style={{ width: 'min(860px, 96vw)' }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Folha técnica</h3>
          <button className="btn-ghost modal-fechar" onClick={onFechar}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '78vh', overflow: 'auto' }}>
          {!dados ? <p className="pub-vazio">Carregando…</p> : (
            <>
              <p className="pub-pretextuais-dica">
                {origem === 'livro' ? 'Os campos vêm do livro (pasta do livro). ' : origem === 'modelo' ? 'Sem pasta do livro: os campos vêm como o modelo do Normando sai para esta publicação. ' : ''}
                Os textos entram nos estilos do .indd. Campo vazio mantém o texto do livro. Na ficha, cada campo é um parágrafo.
              </p>
              <ListaCreditos titulo="a) Créditos institucionais" itens={dados.creditosInstitucionais || []} onChange={set('creditosInstitucionais')} />
              <ListaCreditos titulo="b) Créditos da publicação" itens={dados.creditosPublicacao || []} onChange={set('creditosPublicacao')} />
              <Paragrafos titulo="c) Informações editoriais" itens={dados.informacoes || []} rotulos={ROTULOS_INFO} onChange={set('informacoes')} />
              <Paragrafos titulo="d) Ficha catalográfica" itens={dados.ficha || []} onChange={set('ficha')} />
              <Paragrafos titulo="e) Copyright" itens={dados.copyright || []} onChange={set('copyright')} />
              <Paragrafos titulo="f) Endereço" itens={dados.endereco || []} onChange={set('endereco')} />
            </>
          )}
          <div className="form-acoes">
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button className="btn-primary" disabled={!dados} onClick={() => { onSalvar(dados); onFechar() }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
