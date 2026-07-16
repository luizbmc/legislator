export const __webBridge = true

if (!window.legislator) {
  const BASE = '/api'

  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body !== undefined) {
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(BASE + path, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const error = new Error(err.error || res.statusText)
      error.status = res.status
      error.payload = err.remoto || err
      throw error
    }
    return res.json()
  }

  async function download(path) {
    const res = await fetch(BASE + path)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Erro ao exportar: ${res.statusText}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const disposition = res.headers.get('Content-Disposition') || ''
    let filename = path.split('/').pop()
    const match = disposition.match(/filename\*=UTF-8''(.+)/)
    if (match) filename = decodeURIComponent(match[1])
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true }
  }

  async function downloadPost(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Erro ao exportar: ${res.statusText}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const disposition = res.headers.get('Content-Disposition') || ''
    let filename = path.split('/').pop()
    const match = disposition.match(/filename\*=UTF-8''(.+)/)
    if (match) filename = decodeURIComponent(match[1])
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true }
  }

  function toQuery(filtros) {
    const params = new URLSearchParams()
    for (const [key, val] of Object.entries(filtros)) {
      if (val !== undefined && val !== '') {
        params.append(key, val)
      }
    }
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

  let fonteCache = null
  let fonteCacheEm = 0

  async function usarRailway() {
    if (fonteCache && Date.now() - fonteCacheEm < 2000) {
      return fonteCache === 'railway'
    }
    const config = await api('GET', '/railway/configuracao')
    fonteCache = config.modo || 'local'
    fonteCacheEm = Date.now()
    return fonteCache === 'railway'
  }

  async function dadosApi(method, path, body) {
    if (await usarRailway()) {
      return api(method, `/railway/dados${path}`, body)
    }
    return api(method, path, body)
  }

  window.legislator = {
    normas: {
      listar:        (filtros = {}) => dadosApi('GET', `/normas${toQuery(filtros)}`),
      buscar:        (id)           => dadosApi('GET', `/normas/${id}`),
      criar:         (dados)        => dadosApi('POST', '/normas', dados),
      salvar:        (id, payload)  => dadosApi('PUT', `/normas/${id}`, payload),
      atualizarMeta: (id, meta)     => dadosApi('PATCH', `/normas/${id}/meta`, meta),
      tags:          ()             => dadosApi('GET', '/tags'),
      excluir:       (id)           => dadosApi('DELETE', `/normas/${id}`),
      versoes:       (id)           => dadosApi('GET', `/normas/${id}/versoes`),
      restaurar:     (nId, vId)     => dadosApi('POST', `/normas/${nId}/restaurar/${vId}`, {}),
    },
    excecoes: {
      salvar:  (normaId, lista) => dadosApi('PUT', `/normas/${normaId}/excecoes`, lista),
      resolver:(id)             => dadosApi('PATCH', `/excecoes/${id}/resolver`, {}),
    },
    exportar: {
      docx: (id) => download(`/exportar/norma/docx/${id}`),
      html: (id) => download(`/exportar/norma/html/${id}`),
      docxSelecao: (payload) => downloadPost('/exportar/norma/docx-selecao', payload),
      htmlSelecao: (payload) => downloadPost('/exportar/norma/html-selecao', payload),
    },
    arquivos: {
      salvarTxt: async ({ filename = 'relatorio.txt', conteudo = '' } = {}) => {
        const blob = new Blob([String(conteudo || '')], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        return { ok: true }
      },
    },
    resenha: {
      buscar: url => api('GET', `/resenha/buscar${toQuery({ url })}`),
      gmail: (opcoes = {}) => api('GET', `/resenha/gmail${toQuery(opcoes)}`),
      confirmarCamara: payload => api('POST', '/resenha/confirmar-camara', payload),
      videNormas: url => api('GET', `/resenha/vide-normas${toQuery({ url })}`),
    },
    publicacoes: {
      listar:       (filtros = {}) => dadosApi('GET', `/publicacoes${toQuery(filtros)}`),
      buscar:       (id)         => dadosApi('GET', `/publicacoes/${id}`),
      criar:        (dados)      => dadosApi('POST', '/publicacoes', dados),
      salvar:       (id, dados)  => dadosApi('PUT', `/publicacoes/${id}`, dados),
      excluir:      (id)         => dadosApi('DELETE', `/publicacoes/${id}`),
      duplicar:     (id)         => dadosApi('POST', `/publicacoes/${id}/duplicar`, {}),
      exportarDocx: (id)         => download(`/exportar/publicacao/docx/${id}`),
      exportarHtml: (id)         => download(`/exportar/publicacao/html/${id}`),
      exportarWord: (id)         => download(`/exportar/publicacao/docx/${id}`),
      exportarInDesign: (id)     => download(`/exportar/publicacao/html/${id}`),
    },
    trabalhoRemoto: {
      listar: () => api('GET', '/trabalho-remoto/pacotes'),
      criarRetirada: (normaIds, criadoPor, publicacaoIds) => api('POST', '/trabalho-remoto/retirada', { normaIds, criadoPor, publicacaoIds }),
      importarRetirada: (pacote, atualizadoPor) => api('POST', '/trabalho-remoto/retirada/importar', { pacote, atualizadoPor }),
      criarDevolucao: (pacoteId, criadoPor, novaNormaIds) => api('POST', `/trabalho-remoto/devolucao/${pacoteId}`, { criadoPor, novaNormaIds }),
      listarNormasNovas: (pacoteId) => api('GET', `/trabalho-remoto/pacotes/${pacoteId}/normas-novas`),
      importarDevolucao: (pacote, atualizadoPor) => api('POST', '/trabalho-remoto/devolucao/importar', { pacote, atualizadoPor }),
    },
    railway: {
      configuracao: () => api('GET', '/railway/configuracao'),
      salvarConfiguracao: async dados => {
        const resultado = await api('PUT', '/railway/configuracao', dados)
        fonteCache = resultado.modo || 'local'
        fonteCacheEm = Date.now()
        return resultado
      },
      testar: () => api('GET', '/railway/testar'),
      listarNormas: (filtros = {}) => api('GET', `/railway/normas${toQuery(filtros)}`),
      listarEdicoes: () => api('GET', '/railway/edicoes'),
      criarEdicao: (normaId, usuario) => api('POST', '/railway/edicoes', { normaId, usuario }),
      buscarEdicao: id => api('GET', `/railway/edicoes/${id}`),
      salvarEdicao: (id, dados) => api('PUT', `/railway/edicoes/${id}`, dados),
      listarVersoes: id => api('GET', `/railway/edicoes/${id}/versoes`),
      restaurarVersao: (id, versaoId, dados) => (
        api('POST', `/railway/edicoes/${id}/restaurar/${versaoId}`, dados)
      ),
      consultarBloqueio: normaId => api(
        'GET', `/railway/dados/normas/${normaId}/bloqueio`,
      ),
      adquirirBloqueio: (normaId, dados) => api(
        'POST', `/railway/dados/normas/${normaId}/bloqueio`, dados,
      ),
      renovarBloqueio: (normaId, dados) => api(
        'PUT', `/railway/dados/normas/${normaId}/bloqueio`, dados,
      ),
      liberarBloqueio: (normaId, clienteId) => api(
        'DELETE', `/railway/dados/normas/${normaId}/bloqueio`, { clienteId },
      ),
    },
    usuarios: {
      listar: () => dadosApi('GET', '/usuarios'),
      criar: dados => dadosApi('POST', '/usuarios', dados),
      salvar: (id, dados) => dadosApi('PUT', `/usuarios/${id}`, dados),
      excluir: id => dadosApi('DELETE', `/usuarios/${id}`),
    },
    atualizacoes: {
      estado: async () => ({
        disponivelNoApp: false,
        status: 'indisponivel',
        versaoAtual: null,
        novaVersao: null,
        progresso: 0,
        mensagem: 'As atualizações automáticas funcionam somente no aplicativo instalado.',
      }),
      verificar: async () => ({
        disponivelNoApp: false,
        status: 'indisponivel',
        mensagem: 'As atualizações automáticas funcionam somente no aplicativo instalado.',
      }),
      baixar: async () => {
        throw new Error('Abra o aplicativo instalado para baixar atualizações.')
      },
      instalar: async () => {
        throw new Error('Abra o aplicativo instalado para instalar atualizações.')
      },
      acompanhar: () => () => {},
    },
  }
}
