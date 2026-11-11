import { useState, useEffect } from 'react'

/**
 * Mesa diretora (Configurações): legislatura e os cargos da Mesa, comuns a todas as publicações.
 * Entra na página da Mesa dos livros nos estilos do .indd (pretextuaisLivro.js); cada livro mostra
 * só os cargos que já tem (o bolso não tem o Presidente do Conselho Editorial). Fica no cadastro
 * "institucional", que também guarda a Mesa em texto para o modelo do Normando.
 */

// chaves de pretextuaisLivro.js (CARGOS_MESA); nomes da CF 70ª edição
const CARGOS = [
  ['presidente', 'Presidente', 'Hugo Motta'],
  ['vice1', '1º Vice-Presidente', 'Altineu Côrtes'],
  ['vice2', '2º Vice-Presidente', 'Elmar Nascimento'],
  ['sec1', '1º Secretário', 'Carlos Veras'],
  ['sec2', '2º Secretário', 'Lula da Fonte'],
  ['sec3', '3ª Secretária', 'Delegada Katarina'],
  ['sec4', '4º Secretário', 'Sergio Souza'],
  ['sup1', '1º Suplente', 'Antonio Carlos Rodrigues'],
  ['sup2', '2º Suplente', 'Paulo Folletto'],
  ['sup3', '3º Suplente', 'Dr. Victor Linhalis'],
  ['sup4', '4º Suplente', 'Paulo Alexandre Barbosa'],
  ['sgm', 'Secretário-Geral da Mesa', 'Lucas Ribeiro Almeida Júnior'],
  ['dg', 'Diretor-Geral', 'Guilherme Barbosa Brandão'],
  ['pce', 'Presidente do Conselho Editorial', 'Lafayette de Andrada'],
]
const GRUPO = { sup1: 'Suplentes de secretários', sgm: '', pce: '' }

/** Mesa em texto, no formato do modelo do Normando (pretextuais.js): "Cargo: Nome", grupos. */
export function mesaEmTexto(cargos) {
  const linhas = []
  for (const c of cargos) {
    if (!c.nome?.trim()) continue
    if (c.chave in GRUPO) { linhas.push(''); if (GRUPO[c.chave]) linhas.push(GRUPO[c.chave]) }
    linhas.push(`${c.cargo}: ${c.nome}`)
  }
  return linhas.join('\n').replace(/^\n+/, '')
}

export default function MesaDiretora() {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    ;(async () => {
      let inst = {}
      try { inst = (await window.legislator.configuracoes.buscar('institucional'))?.valor || {} } catch (e) { setErro(`Não foi possível carregar: ${e?.message || e}`) }
      let livro = null
      if (!inst.cargos?.length) { try { livro = await window.legislator.publicacoes.mesaDosLivros?.() } catch { livro = null } }
      const doLivro = new Map((livro?.cargos || []).map(c => [c.chave, c]))
      const salvos = new Map((inst.cargos || []).map(c => [c.chave, c]))
      const cargos = CARGOS.map(([chave, cargo, nome]) => {
        const s = salvos.get(chave) || doLivro.get(chave)
        return { chave, cargo: s?.cargo || cargo, nome: s ? s.nome || '' : nome }
      })
      setDados({ ...inst, legislatura: inst.legislatura || livro?.legislatura || '57ª Legislatura | 2023-2027', cargos })
    })()
  }, [])

  const setCargo = (i, k) => e => { const v = e.target.value; setDados(d => ({ ...d, cargos: d.cargos.map((c, j) => (j === i ? { ...c, [k]: v } : c)) })); setSalvo('') }

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      await window.legislator.configuracoes.salvar('institucional', { ...dados, mesa: mesaEmTexto(dados.cargos) })
      setSalvo('Mesa salva. Vale para as próximas exportações de todas as publicações.')
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
          <h2>Mesa diretora</h2>
          <p>Página da Mesa nos livros (CF, Regimento e os demais com pasta do livro). Cada livro mostra só os cargos que já tem no .indd, nos estilos dele. Cargo sem nome mantém o do livro.</p>
        </div>
      </div>
      {!dados ? <p className="pub-vazio">Carregando…</p> : (
        <div className="mesa-diretora">
          <div className="campo">
            <label>Legislatura</label>
            <input value={dados.legislatura || ''} onChange={e => { const v = e.target.value; setDados(d => ({ ...d, legislatura: v })); setSalvo('') }} placeholder="57ª Legislatura | 2023-2027" />
          </div>
          {dados.cargos.map((c, i) => (
            <div key={c.chave} className="mesa-diretora-linha">
              {c.chave in GRUPO && GRUPO[c.chave] && <div className="mesa-diretora-grupo">{GRUPO[c.chave]}</div>}
              <input value={c.cargo} onChange={setCargo(i, 'cargo')} title="Cargo (ex.: 3ª Secretária)" />
              <input value={c.nome} onChange={setCargo(i, 'nome')} placeholder="Nome" />
            </div>
          ))}
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
