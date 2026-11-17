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
  fichaCat: {
    serie: 'Série Legislação', numero: '',
    cip: 'Dados Internacionais de Catalogação-na-publicação (CIP)',
    local: 'Coordenação de Biblioteca. Seção de Catalogação.', bibliotecario: '',
    autor: 'Brasil. Congresso Nacional. Câmara dos Deputados.', titulo: '', paginas: '',
    infos: ['Disponível, também, em formato digital (e-book).'], isbn: '',
    assuntos: '', cdu: '', isbns: '',
  },
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
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

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

// ficha catalográfica: [campo, rótulo, linhas do campo] (estilos no InDesign: pretextuaisLivro.js)
const PARTES_FICHA = [
  ['Cabeçalho', [
    ['serie', 'Série'], ['numero', 'Número'],
    ['cip', 'CIP'], ['local', 'Local'],
    ['bibliotecario', 'Bibliotecário(a)'],
  ]],
  ['Dados da publicação', [
    ['autor', 'Autor'], ['titulo', 'Título', 3], ['paginas', 'Páginas'],
  ]],
  ['Outras informações e ISBN', null],
  ['Assuntos', [['assuntos', 'Assuntos', 2]]],
  ['CDU', [['cdu', 'CDU']]],
  ['Lista de ISBNs', [['isbns', 'ISBNs']]],
]

function CampoFicha({ rotulo, linhas, valor, onChange, dica, acoes }) {
  return (
    <div className="campo" style={{ marginBottom: 8 }}>
      <label>{rotulo}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        {linhas
          ? <textarea style={{ flex: 1 }} rows={Math.max(linhas, Math.min(6, String(valor || '').split('\n').length + Math.floor(String(valor || '').length / 110)))} value={valor || ''} onChange={e => onChange(e.target.value)} />
          : <input style={{ flex: 1 }} value={valor || ''} onChange={e => onChange(e.target.value)} placeholder={dica} />}
        {acoes}
      </div>
    </div>
  )
}

// prévia da ficha: os mesmos parágrafos e estilos da exportação (pretextuaisLivro.js, paragrafosDaFicha)
const limpoFicha = v => String(v ?? '').replace(/\s+/g, ' ').trim()
function paragrafosDaFicha(f) {
  const infos = (Array.isArray(f.infos) ? f.infos : []).map(limpoFicha).filter(Boolean)
  const parte3 = [...infos, limpoFicha(f.isbn)].filter(Boolean)
  return [
    ['fcat-centro-separa', f.serie], ['fcat-centro', f.numero], ['fcat-centro-separa', f.cip],
    ['fcat-centro', f.local], ['fcat-centro', f.bibliotecario],
    ['fcat-1linha', f.autor], ...String(f.titulo ?? '').split(/\r?\n/).map(x => ['fcat-texto', x]), ['fcat-texto', f.paginas],
    ...parte3.map((x, i) => [i === 0 ? 'fcat-texto-separa' : 'fcat-texto', x]),
    ['fcat-texto-separa', f.assuntos], ['fcat-cdu', f.cdu], ['fcat-centro', f.isbns],
  ].map(([e, x]) => [e, limpoFicha(x)]).filter(([, x]) => x)
}

// medidas dos estilos fcat-* no InDesign (pt): Source Sans 3 6,5/7,5, quadro de 258 pt
const PT = 2   // px por pt na prévia
const ESTILOS_FICHA = {
  'fcat-centro': { textAlign: 'center' },
  'fcat-centro-separa': { textAlign: 'center', marginTop: 1.42 },
  'fcat-1linha': { textAlign: 'left', paddingLeft: 11.34, textIndent: -11.34, marginTop: 8.5, filete: 'acima' },
  'fcat-texto': { textAlign: 'justify', textIndent: 11.34 },
  'fcat-texto-separa': { textAlign: 'justify', textIndent: 11.34, marginTop: 2.83 },
  'fcat-cdu': { textAlign: 'right', marginTop: 4.25, marginBottom: 5.67, filete: 'abaixo' },
}

function PreviaFicha({ ficha }) {
  const pars = paragrafosDaFicha(ficha || {})
  const px = v => (v == null ? undefined : `${v * PT}px`)
  const filete = { position: 'absolute', left: 0, right: 0, borderTop: `${Math.max(1, 0.5 * PT)}px dotted #000` }
  return (
    <div style={{ margin: '4px 4px 10px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, margin: '0 0 6px' }}>Prévia</div>
      <div style={{ background: '#fff', color: '#000', border: '1px solid var(--border)', borderRadius: 4, padding: '14px 0', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
        <div lang="pt-BR" style={{ width: px(258), flex: 'none', fontFamily: "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', sans-serif", fontSize: px(6.5), lineHeight: px(7.5), hyphens: 'auto' }}>
          {pars.length ? pars.map(([e, t], i) => {
            const s = ESTILOS_FICHA[e] || {}
            const partes = t.split(/\s*⇥\s*/)
            return (
              <div key={i} style={{ position: 'relative', textAlign: s.textAlign, textIndent: px(s.textIndent), paddingLeft: px(s.paddingLeft), marginTop: px(s.marginTop), marginBottom: px(s.marginBottom) }}>
                {/* filete acima: 11,34 pt acima da linha de base da 1ª linha; abaixo: 5,67 pt abaixo da base da última */}
                {s.filete === 'acima' && <div style={{ ...filete, top: px(5.9 - 11.34) }} />}
                {partes.length > 1
                  ? <div style={{ display: 'flex', justifyContent: 'space-between', textIndent: 0 }}>{partes.map((x, j) => <span key={j}>{x}</span>)}</div>
                  : t}
                {s.filete === 'abaixo' && <div style={{ ...filete, bottom: px(-(5.67 - 1.6)) }} />}
              </div>
            )
          }) : <div style={{ textAlign: 'center', color: '#888' }}>Ficha vazia</div>}
        </div>
      </div>
    </div>
  )
}

function FichaCatalografica({ ficha, onChange }) {
  const f = ficha || {}
  const set = k => v => onChange({ ...f, [k]: v })
  const infos = Array.isArray(f.infos) ? f.infos : []
  const setInfos = n => onChange({ ...f, infos: n })
  const mover = (i, d) => {
    const j = i + d
    if (j < 0 || j >= infos.length) return
    const n = [...infos]; [n[i], n[j]] = [n[j], n[i]]; setInfos(n)
  }
  const campo = ([k, rot, linhas]) => (
    <CampoFicha key={k} rotulo={rot} linhas={linhas} valor={f[k]} onChange={set(k)}
      dica={k === 'isbns' ? 'ISBN … (papel) ⇥ ISBN … (e-book)' : undefined}
      acoes={k === 'isbns' && (
        <button type="button" className="btn-ghost" title="Inserir tabulação à direita (⇥): o que vem depois fica alinhado à direita"
          onClick={() => set('isbns')(`${String(f.isbns || '').trimEnd()} ⇥ `)}>⇥</button>
      )} />
  )
  return (
    <div className="pub-pretextuais-grupo">
      <h3>d) Ficha catalográfica</h3>
      <p className="pub-pretextuais-dica" style={{ margin: '0 4px 8px' }}>
        Cada campo é um parágrafo. Campo vazio sai da ficha. No título, cada linha vira um parágrafo.
      </p>
      {PARTES_FICHA.map(([titulo, campos], n) => (
        <fieldset key={titulo} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px 4px', margin: '0 4px 10px' }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, padding: '0 4px' }}>Parte {n + 1}: {titulo}</legend>
          {campos ? campos.map(campo) : (
            <>
              {infos.map((x, i) => (
                <CampoFicha key={i} rotulo={`Info ${i + 1}`} valor={x}
                  onChange={v => setInfos(infos.map((y, j) => (j === i ? v : y)))}
                  acoes={<>
                    <button type="button" className="btn-ghost" title="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn-ghost" title="Descer" onClick={() => mover(i, 1)} disabled={i === infos.length - 1}>↓</button>
                    <button type="button" className="btn-ghost" title="Remover" onClick={() => setInfos(infos.filter((_, j) => j !== i))}>✕</button>
                  </>} />
              ))}
              <button type="button" className="btn-ghost" style={{ margin: '0 0 8px' }} onClick={() => setInfos([...infos, ''])}>+ adicionar informação</button>
              <CampoFicha rotulo="ISBN" valor={f.isbn} onChange={set('isbn')} dica="ISBN 978-…" />
            </>
          )}
        </fieldset>
      ))}
      <PreviaFicha ficha={f} />
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
      // ficha catalográfica: os campos lidos da ficha do livro (fora do padrão: os textos padrão)
      if (base.fichaCat && typeof base.fichaCat === 'object') inicial.fichaCat = copia(base.fichaCat)
      // colofão: mês e ano do "Lançado em"; sem ele, o que o livro (ou o modelo) mostra
      const lancado = String(publicacao?.lancado_em || '').match(/^(\d{4})-(\d{2})/)
      inicial.impresso = lancado ? `${MESES[Number(lancado[2]) - 1]} de ${lancado[1]}`
        : String(doLivro?.colofao?.impresso || publicacao?.pretextuais?.mesImpressao || '').replace(/^impresso em\s*/i, '').trim()
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
                {origem === 'livro' ? 'Os campos vêm da pasta do modelo. ' : origem === 'modelo' ? 'Sem pasta do modelo: os campos vêm como o modelo padrão do Normando sai para esta publicação. ' : ''}
                Os textos entram nos estilos do .indd. Campo vazio mantém o texto do livro (na ficha catalográfica, o parágrafo sai).
              </p>
              <ListaCreditos titulo="a) Créditos institucionais" itens={dados.creditosInstitucionais || []} onChange={set('creditosInstitucionais')} />
              <ListaCreditos titulo="b) Créditos da publicação" itens={dados.creditosPublicacao || []} onChange={set('creditosPublicacao')} />
              <Paragrafos titulo="c) Informações editoriais" itens={dados.informacoes || []} rotulos={ROTULOS_INFO} onChange={set('informacoes')} />
              <FichaCatalografica ficha={dados.fichaCat} onChange={set('fichaCat')} />
              <Paragrafos titulo="e) Copyright" itens={dados.copyright || []} onChange={set('copyright')} />
              <Paragrafos titulo="f) Endereço" itens={dados.endereco || []} onChange={set('endereco')} />
              <div className="pub-pretextuais-grupo">
                <h3>g) Colofão</h3>
                <div className="campo">
                  <label>Impresso em</label>
                  <input value={dados.impresso || ''} onChange={e => set('impresso')(e.target.value)} placeholder="novembro de 2026" />
                </div>
              </div>
            </>
          )}
          <div className="form-acoes">
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button className="btn-primary" disabled={!dados} onClick={() => { const { ficha, ...resto } = dados; onSalvar(resto); onFechar() }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
