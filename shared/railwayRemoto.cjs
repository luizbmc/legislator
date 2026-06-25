function normalizarBaseUrl(valor) {
  const texto = String(valor || '').trim().replace(/\/+$/, '')
  if (!texto) throw new Error('Informe o endereço do serviço Railway.')

  let url
  try {
    url = new URL(texto)
  } catch {
    throw new Error('O endereço do Railway é inválido.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('O endereço do Railway deve começar com http:// ou https://.')
  }
  return url.toString().replace(/\/+$/, '')
}

function normalizarConfiguracao(config = {}) {
  return {
    url: normalizarBaseUrl(config.url),
    chave: String(config.chave || '').trim(),
    modo: config.modo === 'railway' ? 'railway' : 'local',
  }
}

function configuracaoPublica(config = {}) {
  const url = String(config.url || '').trim()
  const chave = String(config.chave || '').trim()
  return {
    configurado: Boolean(url && chave),
    url,
    chaveConfigurada: Boolean(chave),
    modo: config.modo === 'railway' ? 'railway' : 'local',
  }
}

async function requisitarRailway(config, method, caminho, body) {
  const { url, chave } = normalizarConfiguracao(config)
  if (!chave) throw new Error('Informe a chave de acesso do Railway.')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  let response
  try {
    response = await fetch(`${url}${caminho}`, {
      method,
      headers: {
        'x-api-key': chave,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('O Railway não respondeu em 30 segundos.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const raw = await response.text()
  let payload
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { error: raw || `HTTP ${response.status}` }
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Falha no Railway: HTTP ${response.status}.`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

function criarClienteRailway(config) {
  return {
    requisitar: (method, caminho, body) => requisitarRailway(config, method, caminho, body),
    baixar: async caminho => {
      const { url, chave } = normalizarConfiguracao(config)
      const response = await fetch(`${url}${caminho}`, {
        headers: { 'x-api-key': chave },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const error = new Error(payload.error || `Falha no Railway: HTTP ${response.status}.`)
        error.status = response.status
        throw error
      }
      return Buffer.from(await response.arrayBuffer())
    },
    testar: () => requisitarRailway(config, 'GET', '/api/info'),
    listarNormas: (filtros = {}) => {
      const params = new URLSearchParams()
      for (const [chave, valor] of Object.entries(filtros)) {
        if (valor !== undefined && valor !== null && valor !== '') {
          params.set(chave, String(valor))
        }
      }
      const query = params.toString()
      return requisitarRailway(
        config,
        'GET',
        `/api/homologacao/normas${query ? `?${query}` : ''}`,
      )
    },
    listarEdicoes: () => requisitarRailway(config, 'GET', '/api/homologacao/edicoes'),
    criarEdicao: (normaId, usuario) => requisitarRailway(
      config,
      'POST',
      '/api/homologacao/edicoes',
      { normaId, usuario },
    ),
    buscarEdicao: id => requisitarRailway(config, 'GET', `/api/homologacao/edicoes/${id}`),
    salvarEdicao: (id, dados) => requisitarRailway(
      config,
      'PUT',
      `/api/homologacao/edicoes/${id}`,
      dados,
    ),
    listarVersoes: id => requisitarRailway(
      config,
      'GET',
      `/api/homologacao/edicoes/${id}/versoes`,
    ),
    restaurarVersao: (id, versaoId, dados) => requisitarRailway(
      config,
      'POST',
      `/api/homologacao/edicoes/${id}/restaurar/${versaoId}`,
      dados,
    ),
  }
}

module.exports = {
  configuracaoPublica,
  criarClienteRailway,
  normalizarBaseUrl,
  normalizarConfiguracao,
  requisitarRailway,
}
