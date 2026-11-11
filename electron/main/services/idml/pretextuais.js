/**
 * pretextuais.js — preenche os campos {{…}} das páginas pré-textuais do modelo.
 *
 * Os campos ficam no texto do próprio modelo (scripts/idml/criar-modelo-normando.mjs), então
 * a diagramação dessas páginas continua sendo a do InDesign. Regras:
 *   • campo de texto: troca no lugar; "\n" no valor vira novo parágrafo com o mesmo estilo;
 *   • campo de bloco (Mesa, créditos, equipe) sozinho num parágrafo: o parágrafo é trocado
 *     pelos parágrafos gerados;
 *   • parágrafo que só tinha campos vazios sai;
 *   • campo sem valor obrigatório (ex.: CDU) aparece como [a preencher: …] para a revisão.
 *
 * Dados:
 *   institucional (comum a todas as publicações) = { legislatura, mesa, creditos }
 *   pretextuais (da publicação) = { tituloRosto, organizadores, atualizacao, equipe, notaEditor,
 *     historicoEdicoes, linhaSerie, serie, serieNumero, bibliotecaria, fichaEntrada,
 *     fichaDescricao, paginas, assuntos, cdu, isbnPapel, isbnEbook, mesImpressao }
 */

const SEM_CHAR = 'CharacterStyle/$ID/[No character style]'
const escXml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const selfPar = nome => 'ParagraphStyle/' + nome.replace(/%/g, '%25').replace(/:/g, '%3a')
const faltando = rotulo => `[a preencher: ${rotulo}]`
const linhas = t => String(t || '').split(/\r?\n/).map(s => s.trim())
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// ── valores ──────────────────────────────────────────────────────

/** "2026-07-07" → "7/7/2026" */
export function dataCurta(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : String(iso || '')
}

/** Alteração mais recente entre as normas da publicação (sugestão de "atualizada até"). */
export function ultimaAlteracao(publicacao) {
  let max = ''
  for (const s of publicacao.secoes || []) for (const n of s.normas || []) {
    if (n.pular || n.exportacao === 'ignorar') continue
    const d = String(n.data_ultima_alteracao || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > max) max = d
  }
  return max
}

/** Título em até 3 linhas, para o rosto (palavras curtas ficam com a seguinte). */
export function linhasDoTitulo(titulo) {
  const palavras = String(titulo || '').trim().split(/\s+/).filter(Boolean)
  if (palavras.length <= 3) return palavras
  const total = palavras.join(' ').length
  const out = [[], [], []]
  let i = 0, acumulado = 0
  for (const p of palavras) {
    if (i < 2 && acumulado > (total / 3) * (i + 1) && out[i].length) i++
    out[i].push(p)
    acumulado += p.length + 1
  }
  return out.map(l => l.join(' ')).filter(Boolean)
}

/** "Linha Legislativo; Série Legislação, n. 9" → { linha, serie, numero } */
function lerDescricao(descricao) {
  const d = String(descricao || '')
  const serie = d.match(/S[ée]rie\s+[^,;.]+/i)?.[0]?.trim() || ''
  const numero = d.match(/\bn\.\s*\d+/i)?.[0] || ''
  const linha = d.replace(/,\s*n\.\s*\d+/i, '').trim()
  return { serie, numero, linha }
}

export function valoresDosCampos(publicacao, pre = {}, inst = {}, hoje = new Date()) {
  // folha técnica (botão "Folha técnica…"): créditos e informações editoriais entram nos blocos do modelo
  const ft = pre.folhaTecnica || {}
  const linhasFt = lista => (Array.isArray(lista) && lista.length ? lista.map(c => (c.rotulo ? `${c.rotulo}: ${c.nome || ''}` : c.nome || '')).filter(t => t.trim()).join('\n') : null)
  const desc = lerDescricao(publicacao.descricao)
  const edNum = String(publicacao.edicao || '').match(/\d+/)?.[0] || ''
  const ano = hoje.getFullYear()
  // "Atualizado até" da publicação (Dados da publicação); o campo antigo, se houver; senão a alteração mais recente
  const atualizacao = pre.atualizacao || dataCurta(pre.atualizadoAte) || dataCurta(ultimaAlteracao(publicacao)) || ''
  const titulo = linhas(pre.tituloRosto).filter(Boolean)
  const tituloLinhas = (titulo.length ? titulo : linhasDoTitulo(publicacao.titulo)).map(t => t.toLocaleUpperCase('pt-BR'))
  const serie = pre.serie || desc.serie
  const numero = pre.serieNumero || desc.numero
  const organizadores = pre.organizadores ?? (publicacao.organizador ? publicacao.organizador.split(/\s+e\s+|;\s*/).join('\n') : '')
  const isbnPapel = pre.isbnPapel || ''
  const isbnEbook = pre.isbnEbook || ''

  return {
    titulo_linha1: tituloLinhas[0] || '',
    titulo_linha2: tituloLinhas[1] || '',
    titulo_linha3: tituloLinhas[2] || '',
    edicao_rosto: String(publicacao.edicao || '').toLocaleUpperCase('pt-BR'),
    organizadores,
    atualizacao: atualizacao || faltando('data de atualização'),
    atualizacao_rosto: atualizacao ? `Edição atualizada até ${atualizacao}` : '',
    // Mesa e créditos institucionais
    legislatura: inst.legislatura || faltando('legislatura'),
    mesa: { bloco: 'mesa', texto: inst.mesa || '' },
    creditos_institucionais: { bloco: 'creditos', texto: linhasFt(ft.creditosInstitucionais) ?? inst.creditos ?? '' },
    // créditos da publicação
    equipe: { bloco: 'equipe', texto: linhasFt(ft.creditosPublicacao) ?? pre.equipe ?? '' },
    nota_editor: ft.informacoes?.[0] || pre.notaEditor || '',
    historico_edicoes: ft.informacoes?.[1] || pre.historicoEdicoes || '',
    linha_serie: ft.informacoes?.[2] || pre.linhaSerie || (desc.linha ? desc.linha.replace(/\.?$/, '.') : ''),
    // ficha catalográfica
    serie: serie || faltando('série'),
    serie_numero: numero || '',
    bibliotecaria: pre.bibliotecaria ? `Bibliotecária: ${pre.bibliotecaria}` : faltando('bibliotecária (nome – CRB)'),
    ficha_entrada: pre.fichaEntrada || 'Brasil. Congresso Nacional. Câmara dos Deputados.',
    ficha_descricao: pre.fichaDescricao ||
      `${publicacao.titulo || ''}. -- ${edNum ? edNum + '. ed. -- ' : ''}Brasília : Câmara dos Deputados, Edições Câmara, ${ano}.`,
    // na ficha, a série vai em minúsculas depois da 1ª letra: "(Série legislação ; n. 9)"
    ficha_paginas: `${pre.paginas ? pre.paginas + ' p.' : faltando('nº de páginas')}${serie ? ` -- (${serie.charAt(0).toUpperCase() + serie.slice(1).toLocaleLowerCase('pt-BR')}${numero ? ' ; ' + numero : ''})` : ''}`,
    ficha_ebook: isbnEbook ? `Disponível, também, em formato digital (e-book).\nISBN ${isbnEbook}` : '',
    ficha_assuntos: pre.assuntos || faltando('assuntos'),
    ficha_cdu: pre.cdu || faltando('CDU'),
    isbn_rodape: isbnPapel || isbnEbook
      ? { xml: [isbnPapel && `ISBN ${escXml(isbnPapel)} (papel)`, isbnEbook && `ISBN ${escXml(isbnEbook)} (e-book)`].filter(Boolean).join('<?ACE 8?>') }
      : faltando('ISBN'),
    // colofão
    mes_impressao: pre.mesImpressao || `${MESES[hoje.getMonth()]} de ${ano}`,
  }
}

// ── blocos gerados ───────────────────────────────────────────────

function psr(estilo, csrs, comBr) {
  return `<ParagraphStyleRange AppliedParagraphStyle="${escXml(selfPar(estilo))}">${csrs}${comBr ? `<CharacterStyleRange AppliedCharacterStyle="${SEM_CHAR}"><Br /></CharacterStyleRange>` : ''}</ParagraphStyleRange>`
}
const csr = (char, texto) => `<CharacterStyleRange AppliedCharacterStyle="${char ? `CharacterStyle/${escXml(char)}` : SEM_CHAR}"><Content>${escXml(texto)}</Content></CharacterStyleRange>`

/**
 * Mesa: uma linha por cargo, "Cargo: Nome". Linha sem ":" = título de grupo (ex.: "Suplentes de
 * secretários"); linha em branco separa grupos (o cargo seguinte ganha espaço antes).
 */
function blocoMesa(texto) {
  const out = []
  let separa = false
  for (const l of linhas(texto)) {
    if (!l) { separa = true; continue }
    const i = l.indexOf(':')
    if (i < 0) { out.push(['folha-tecnica:suplente', csr(null, l)]); separa = false; continue }
    out.push([separa ? 'folha-tecnica:cargo-separa' : 'folha-tecnica:cargo', csr(out.length ? null : 'bold', l.slice(0, i).trim())])
    out.push(['folha-tecnica:nome', csr(null, l.slice(i + 1).trim())])
    separa = false
  }
  return out
}

/** Créditos institucionais: "Órgão: Nome", com o rótulo em negrito, tudo no mesmo estilo. */
function blocoCreditos(texto) {
  return linhas(texto).filter(Boolean).map(l => {
    const i = l.indexOf(':')
    return ['folha-tecnica:creditos', i < 0 ? csr(null, l) : csr('bold', l.slice(0, i + 1)) + csr(null, ' ' + l.slice(i + 1).trim())]
  })
}

/** Equipe da publicação: "Função: Nome"; a 1ª linha abre o grupo (espaço antes). */
function blocoEquipe(texto) {
  return linhas(texto).filter(Boolean).map((l, i) => [i === 0 ? 'folha-tecnica:creditos-separa' : 'folha-tecnica:creditos', csr(null, l)])
}

const BLOCOS = { mesa: blocoMesa, creditos: blocoCreditos, equipe: blocoEquipe }

// ── aplicação na story ───────────────────────────────────────────

const RE_CAMPO = /\{\{(\w+)\}\}/g

/** Troca os campos de uma story. Devolve { xml, desconhecidos }. */
export function aplicarCampos(xml, valores) {
  const desconhecidos = new Set()
  const psrs = /<ParagraphStyleRange[\s\S]*?<\/ParagraphStyleRange>/g
  const novo = xml.replace(psrs, bloco => {
    if (!bloco.includes('{{')) return bloco
    const texto = [...bloco.matchAll(/<Content>([\s\S]*?)<\/Content>/g)].map(m => m[1]).join('')
    const temBr = /<Br\s*\/>/.test(bloco)

    // campo de bloco sozinho no parágrafo → parágrafos gerados
    const so = texto.trim().match(/^\{\{(\w+)\}\}$/)
    const v = so && valores[so[1]]
    if (v && typeof v === 'object' && v.bloco) {
      const pars = BLOCOS[v.bloco](v.texto)
      return pars.map(([estilo, csrs], i) => psr(estilo, csrs, i < pars.length - 1 || temBr)).join('')
    }

    let vazio = true
    const trocado = bloco.replace(/<Content>([\s\S]*?)<\/Content>/g, (m, conteudo) => {
      const c = conteudo.replace(RE_CAMPO, (mm, nome) => {
        if (!(nome in valores)) { desconhecidos.add(nome); return mm }
        const val = valores[nome]
        if (val && typeof val === 'object') return val.xml ?? ''
        // várias linhas: novos parágrafos com o mesmo estilo
        return linhas(val).map(escXml).join('</Content><Br /><Content>')
      })
      if (c.replace(/<[^>]+>/g, '').trim()) vazio = false
      return `<Content>${c}</Content>`
    })
    // parágrafo só com campos vazios: sai
    const soCampos = !texto.replace(RE_CAMPO, '').trim()
    return soCampos && vazio ? '' : trocado
  })
  return { xml: novo, desconhecidos: [...desconhecidos] }
}
