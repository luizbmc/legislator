/**
 * livroBase.js — pasta do livro de uma publicação (preparar_livro_normando.jsx: livro.idml, livro.pdf
 * e livro.json). A pasta fica guardada neste computador, por publicação: com ela, o PDF, a tela de
 * paginação e o IDML passam a ser os do livro completo (livroCompleto.js, pdfLivroCompleto.js).
 */

import { app, dialog } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { publicacaoDoLivro, modeloDoLivro, formatoDoLivro, normasDoLivro } from './livroCompleto.js'

const arquivoConfig = () => join(app.getPath('userData'), 'livros-base.json')
const lerConfig = () => {
  try { return JSON.parse(readFileSync(arquivoConfig(), 'utf8')) } catch { return {} }
}
const ARQUIVOS = ['livro.json', 'livro.idml', 'livro.pdf']

export const pastaDoLivro = id => lerConfig()[id] || null

/** Diálogo: escolhe a pasta preparada no InDesign, ou tira a pasta da publicação (`remover`). */
export async function escolherPastaDoLivro(id, { remover = false } = {}) {
  const cfg = lerConfig()
  if (remover) {
    delete cfg[id]
    writeFileSync(arquivoConfig(), JSON.stringify(cfg, null, 2))
    return { ok: true, pasta: null }
  }
  const r = await dialog.showOpenDialog({ title: 'Pasta do livro (preparar_livro_normando.jsx)', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths?.[0]) return { cancelado: true }
  const pasta = r.filePaths[0]
  const falta = ARQUIVOS.filter(n => !existsSync(join(pasta, n)))
  if (falta.length) throw new Error(`Faltam nesta pasta: ${falta.join(', ')}. Rode preparar_livro_normando.jsx no InDesign.`)
  writeFileSync(arquivoConfig(), JSON.stringify({ ...cfg, [id]: pasta }, null, 2))
  return { ok: true, pasta }
}

/**
 * Ação de cada norma no livro: todo o texto vem do Normando — cada norma que tem parte no livro é
 * gerada inteira (CF, ADCT, emendas, tratados e convenções); do InDesign ficam só o projeto gráfico,
 * as pré-textuais e o que não é norma. Num livro dividido pelas epígrafes (Regimento), `noLivro` são
 * as normas que o livro tem: elas são geradas e as outras ficam de fora (o de bolso tem só as normas
 * principais). Não depende da "exportação" gravada na publicação.
 */
const comAcoes = (publicacao, noLivro = null) => ({
  ...publicacao,
  secoes: (publicacao.secoes || []).map(s => ({
    ...s,
    normas: (s.normas || []).map(n => ({
      ...n,
      exportacao: noLivro && !noLivro.has(n.id) ? 'ignorar' : 'completa',
    })),
  })),
})

/** null se a publicação não tem pasta do livro; senão o que muda na exportação. */
export async function opcoesDoLivro(publicacao, pastaModelo) {
  const pasta = pastaDoLivro(publicacao.id)
  if (!pasta) return null
  const base = readFileSync(join(pasta, 'livro.idml'))
  const dados = JSON.parse(readFileSync(join(pasta, 'livro.json'), 'utf8').replace(/^﻿/, ''))
  const { modo, ids } = await normasDoLivro(base, publicacao)
  const completa = comAcoes(publicacao, modo === 'epigrafe' ? ids : null)
  const destino = join(app.getPath('userData'), 'livros-base', String(publicacao.id))
  const modelo = await modeloDoLivro(base, pastaModelo, destino, { paginasPreTextuais: dados.partes[0].pagina - 1 })
  return {
    publicacaoPlano: await publicacaoDoLivro(base, completa, { paginasPartes: dados.partes }),
    opcoes: {
      pastaModelo: modelo,
      formato: await formatoDoLivro(base),
      livro: { pasta, dados, base, publicacao: completa, cabecalhoPar: String(publicacao.titulo || '').toUpperCase() },
    },
  }
}

/** Páginas pré-textuais como estão no livro da publicação (null sem pasta do livro). */
export async function pretextuaisDaPasta(id) {
  const pasta = pastaDoLivro(id)
  if (!pasta || !existsSync(join(pasta, 'livro.idml'))) return null
  const { default: JSZip } = await import('jszip')
  const { lerPretextuaisDoLivro } = await import('./pretextuaisLivro.js')
  return lerPretextuaisDoLivro(await JSZip.loadAsync(readFileSync(join(pasta, 'livro.idml'))))
}

/** Mesa do livro com mais cargos entre as pastas configuradas (valores iniciais do formulário). */
export async function mesaDosLivros() {
  let melhor = null
  for (const id of Object.keys(lerConfig())) {
    try {
      const p = await pretextuaisDaPasta(id)
      if (p?.mesa?.cargos?.length > (melhor?.cargos?.length || 0)) melhor = p.mesa
    } catch { /* pasta que sumiu: segue */ }
  }
  return melhor
}
