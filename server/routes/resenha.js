const express = require('express')
const fs = require('fs')
const path = require('path')

const router = express.Router()
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Normando/1.0'
const URL_PADRAO = 'https://www4.planalto.gov.br/legislacao/portal-legis/resenha-diaria/julho-resenha-diaria'
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizarComparacao(valor) {
  return normalizarBusca(valor)
    .replace(/n[º°o]\.?/g, 'n')
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tipoCanonico(valor) {
  const t = normalizarBusca(valor)
  if (t.includes('emenda constitucional')) return 'emenda constitucional'
  if (t.includes('lei complementar')) return 'lei complementar'
  if (t.includes('medida provisoria')) return 'medida provisoria'
  if (t.includes('decreto-lei')) return 'decreto-lei'
  if (t.includes('decreto')) return 'decreto'
  if (t.includes('lei ordinaria') || /\blei\b/.test(t)) return 'lei'
  return t
}

function chaveAto(valor) {
  const text = normalizarComparacao(valor)
  const tipoMatch = text.match(/\b(emenda constitucional|lei complementar|medida provisoria|decreto-lei|decreto|lei ordinaria|lei)\b/)
  const aposTipo = tipoMatch ? text.slice(tipoMatch.index + tipoMatch[0].length) : text
  const numero = (aposTipo.match(/\b(?:n\s*)?(\d[\d.]*[a-z-]*)\b/) || [])[1] || ''
  return {
    tipo: tipoCanonico(tipoMatch?.[0] || ''),
    numero: numero.replace(/\./g, '').replace(/^-+|-+$/g, ''),
  }
}

function validarUrlResenha(valor) {
  const url = new URL(String(valor || URL_PADRAO))
  if (url.protocol !== 'https:') throw new Error('Use uma URL HTTPS.')
  if (!/planalto\.gov\.br$/i.test(url.hostname)) {
    throw new Error('Por segurança, informe uma URL do domínio planalto.gov.br.')
  }
  return url.toString()
}

function validarUrlCamara(valor) {
  const url = new URL(String(valor || ''))
  if (url.protocol !== 'https:') throw new Error('Use uma URL HTTPS.')
  if (!/camara\.leg\.br$/i.test(url.hostname)) {
    throw new Error('Por seguranca, informe uma URL do dominio camara.leg.br.')
  }
  return url.toString()
}

function erroAcessoPlanalto(error) {
  const texto = String(error?.message || error || '')
  return error?.name === 'TypeError' ||
    /fetch failed|econnreset|etimedout|socket|network/i.test(texto)
}

function lerJson(caminho) {
  try {
    if (!fs.existsSync(caminho)) return null
    return JSON.parse(fs.readFileSync(caminho, 'utf8'))
  } catch {
    return null
  }
}

function credenciaisGoogle() {
  const rootSecrets = path.join(process.cwd(), 'secrets')
  const oauth = lerJson(path.join(rootSecrets, 'normando-gmail-oauth.json')) || {}
  const token = lerJson(path.join(rootSecrets, 'normando-gmail-token.json')) || {}
  const config = lerJson(path.join(rootSecrets, 'normando-gmail-config.json')) || {}
  const oauthCfg = oauth.installed || oauth.web || oauth
  return {
    clientId: process.env.NORMANDO_GOOGLE_CLIENT_ID || config.client_id || oauthCfg.client_id,
    clientSecret: process.env.NORMANDO_GOOGLE_CLIENT_SECRET || config.client_secret || oauthCfg.client_secret,
    refreshToken: process.env.NORMANDO_GMAIL_REFRESH_TOKEN || config.refresh_token || token.refresh_token,
    query: process.env.NORMANDO_GMAIL_QUERY || config.query || '',
    label: process.env.NORMANDO_GMAIL_LABEL || config.label || '',
  }
}

async function obterAccessToken() {
  const cfg = credenciaisGoogle()
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error('Gmail nao configurado. Gere o token e informe client_id, client_secret e refresh_token.')
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  })
  const resposta = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await resposta.json().catch(() => ({}))
  if (!resposta.ok) {
    throw new Error(data.error_description || data.error || `Falha ao renovar token Gmail: HTTP ${resposta.status}`)
  }
  return data.access_token
}

function decodeBase64Url(valor) {
  if (!valor) return ''
  return Buffer.from(String(valor).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/tr|\/div|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
}

function extrairLinksVideNormas(html) {
  const links = []
  const inicio = html.search(/Vide Norma\(s\)/i)
  const fim = inicio >= 0 ? html.indexOf('</ul>', inicio) : -1
  const trecho = inicio >= 0
    ? html.slice(inicio, fim > inicio ? fim + 5 : undefined)
    : html
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of trecho.matchAll(re)) {
    const href = match[1]
    const texto = htmlParaTexto(match[2]).replace(/\s+/g, ' ').trim()
    if (!/norma-[a-z]+\.html/i.test(href)) continue
    if (!/\b(Lei|Medida Provis[oó]ria|Decreto|Emenda Constitucional)\b/i.test(texto)) continue
    links.push({ texto, href, chave: chaveAto(texto) })
  }
  return links
}

const MESES_PT = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

function dataIsoDeTextoCamara(texto) {
  const match = String(texto || '').match(/\bde\s+(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})\b/i)
  if (!match) return ''
  const dia = Number(match[1])
  const mes = MESES_PT[normalizarBusca(match[2])]
  const ano = Number(match[3])
  if (!dia || !mes || !ano) return ''
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

async function buscarVideNormasCamara(url) {
  const pagina = validarUrlCamara(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const resposta = await fetch(pagina, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      },
      signal: controller.signal,
    })
    const html = await resposta.text()
    if (!resposta.ok) throw new Error(`Camara respondeu HTTP ${resposta.status}.`)
    const videNormas = extrairLinksVideNormas(html).map(item => ({
      texto: item.texto,
      href: new URL(item.href, pagina).toString(),
      data: dataIsoDeTextoCamara(item.texto),
      chave: item.chave,
    }))
    return { url: pagina, total: videNormas.length, videNormas }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Tempo esgotado ao acessar a pagina da Camara.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function confirmarAlteradoraNaCamara({ url, alteradora } = {}) {
  const pagina = validarUrlCamara(url)
  const chaveAlteradora = chaveAto(alteradora)
  if (!chaveAlteradora.numero) throw new Error('Norma alteradora nao identificada.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const resposta = await fetch(pagina, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      },
      signal: controller.signal,
    })
    const html = await resposta.text()
    if (!resposta.ok) throw new Error(`Camara respondeu HTTP ${resposta.status}.`)
    const videNormas = extrairLinksVideNormas(html)
    const correspondencias = videNormas.filter(item => (
      item.chave.numero === chaveAlteradora.numero &&
      (!item.chave.tipo || !chaveAlteradora.tipo || item.chave.tipo === chaveAlteradora.tipo)
    ))
    return {
      url: pagina,
      encontrado: correspondencias.length > 0,
      total: videNormas.length,
      correspondencias,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Tempo esgotado ao acessar a pagina da Camara.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function coletarTextoPayload(payload, partes = []) {
  if (!payload) return partes
  if (payload.body?.data) {
    const texto = decodeBase64Url(payload.body.data)
    if (payload.mimeType === 'text/html') partes.push(htmlParaTexto(texto))
    else if (!payload.mimeType || payload.mimeType === 'text/plain') partes.push(texto)
  }
  ;(payload.parts || []).forEach(parte => coletarTextoPayload(parte, partes))
  return partes
}

function headerMensagem(headers, nome) {
  return (headers || []).find(h => String(h.name || '').toLowerCase() === nome)?.value || ''
}

async function buscarMensagemGmail(accessToken, id) {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`
  const resposta = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  const data = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(data.error?.message || `Falha ao ler mensagem Gmail: HTTP ${resposta.status}`)
  const headers = data.payload?.headers || []
  const texto = coletarTextoPayload(data.payload)
    .join('\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    id: data.id,
    threadId: data.threadId,
    subject: headerMensagem(headers, 'subject'),
    from: headerMensagem(headers, 'from'),
    date: headerMensagem(headers, 'date'),
    snippet: data.snippet || '',
    texto,
  }
}

async function buscarResenhasGmail(opcoes = {}) {
  const accessToken = await obterAccessToken()
  const cfg = credenciaisGoogle()
  const maxResults = Math.max(1, Math.min(Number(opcoes.maxResults || 20), 50))
  const queryBase = opcoes.query || cfg.query || `${cfg.label ? `label:${cfg.label} ` : ''}newer_than:30d`
  const url = new URL(`${GMAIL_API}/messages`)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('q', queryBase)
  const resposta = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  const data = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(data.error?.message || `Falha ao buscar Gmail: HTTP ${resposta.status}`)
  const mensagens = await Promise.all((data.messages || []).map(m => buscarMensagemGmail(accessToken, m.id)))
  return { query: queryBase, total: data.resultSizeEstimate || mensagens.length, mensagens }
}

router.get('/buscar', async (req, res) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const url = validarUrlResenha(req.query.url)
    const resposta = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      },
      signal: controller.signal,
    })
    const html = await resposta.text()
    if (!resposta.ok) throw new Error(`Planalto respondeu HTTP ${resposta.status}.`)
    res.json({ url, html })
  } catch (err) {
    let msg = err?.message || 'Nao foi possivel acessar a resenha do Planalto.'
    if (err?.name === 'AbortError') {
      msg = 'Tempo esgotado ao acessar a resenha do Planalto.'
    } else if (erroAcessoPlanalto(err)) {
      msg = 'Nao foi possivel acessar automaticamente a resenha do Planalto.'
    }
    res.status(502).json({ error: msg })
  } finally {
    clearTimeout(timeout)
  }
})

router.get('/gmail', async (req, res) => {
  try {
    const resultado = await buscarResenhasGmail({
      query: req.query.query,
      maxResults: req.query.maxResults,
    })
    res.json(resultado)
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao buscar mensagens no Gmail.' })
  }
})

router.post('/confirmar-camara', async (req, res) => {
  try {
    res.json(await confirmarAlteradoraNaCamara(req.body || {}))
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao confirmar alteracao na Camara.' })
  }
})

router.get('/vide-normas', async (req, res) => {
  try {
    res.json(await buscarVideNormasCamara(req.query.url))
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar Vide Norma(s) na Camara.' })
  }
})

module.exports = router
