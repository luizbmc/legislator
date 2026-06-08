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
      throw new Error(err.error || res.statusText)
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

  window.legislator = {
    normas: {
      listar:        (filtros = {}) => api('GET', `/normas${toQuery(filtros)}`),
      buscar:        (id)           => api('GET', `/normas/${id}`),
      criar:         (dados)        => api('POST', '/normas', dados),
      salvar:        (id, payload)  => api('PUT', `/normas/${id}`, payload),
      atualizarMeta: (id, meta)     => api('PATCH', `/normas/${id}/meta`, meta),
      tags:          ()             => api('GET', '/tags'),
      excluir:       (id)           => api('DELETE', `/normas/${id}`),
      versoes:       (id)           => api('GET', `/normas/${id}/versoes`),
      restaurar:     (nId, vId)     => api('POST', `/normas/${nId}/restaurar/${vId}`),
    },
    excecoes: {
      salvar:  (normaId, lista) => api('PUT', `/normas/${normaId}/excecoes`, lista),
      resolver:(id)             => api('PATCH', `/excecoes/${id}/resolver`),
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
    publicacoes: {
      listar:       (filtros = {}) => api('GET', `/publicacoes${toQuery(filtros)}`),
      buscar:       (id)         => api('GET', `/publicacoes/${id}`),
      criar:        (dados)      => api('POST', '/publicacoes', dados),
      salvar:       (id, dados)  => api('PUT', `/publicacoes/${id}`, dados),
      excluir:      (id)         => api('DELETE', `/publicacoes/${id}`),
      duplicar:     (id)         => api('POST', `/publicacoes/${id}/duplicar`),
      exportarDocx: (id)         => download(`/exportar/publicacao/docx/${id}`),
      exportarHtml: (id)         => download(`/exportar/publicacao/html/${id}`),
      exportarWord: (id)         => download(`/exportar/publicacao/docx/${id}`),
      exportarInDesign: (id)     => download(`/exportar/publicacao/html/${id}`),
    },
  }
}
