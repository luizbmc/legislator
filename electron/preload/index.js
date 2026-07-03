import { contextBridge, ipcRenderer } from 'electron'

async function invokeRailway(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result?.ok) return result.data
  const error = new Error(result?.error || 'Falha na conexão Railway.')
  error.status = result?.status
  error.payload = result?.payload
  throw error
}

async function usarRailway() {
  return (await ipcRenderer.invoke('railway:modo')) === 'railway'
}

function queryString(filtros = {}) {
  const params = new URLSearchParams()
  for (const [chave, valor] of Object.entries(filtros || {})) {
    if (valor !== undefined && valor !== null && valor !== '') {
      params.set(chave, String(valor))
    }
  }
  const texto = params.toString()
  return texto ? `?${texto}` : ''
}

async function invokeDados(localChannel, remoteMethod, remotePath, localArgs = [], remoteBody) {
  if (await usarRailway()) {
    return invokeRailway('railway:request', remoteMethod, remotePath, remoteBody)
  }
  return ipcRenderer.invoke(localChannel, ...localArgs)
}

contextBridge.exposeInMainWorld('legislator', {
  onRestoreRendererFocus: callback => {
    const listener = () => callback()
    ipcRenderer.on('normando:restore-renderer-focus', listener)
    return () => ipcRenderer.removeListener('normando:restore-renderer-focus', listener)
  },
  normas: {
    listar: (filtros = {}) => invokeDados(
      'normas:listar', 'GET', `/api/normas${queryString(filtros)}`, [filtros],
    ),
    buscar: id => invokeDados('normas:buscar', 'GET', `/api/normas/${id}`, [id]),
    criar: dados => invokeDados('normas:criar', 'POST', '/api/normas', [dados], dados),
    salvar: (id, payload) => invokeDados(
      'normas:salvar', 'PUT', `/api/normas/${id}`, [id, payload], payload,
    ),
    atualizarMeta: (id, meta) => invokeDados(
      'normas:atualizar-meta', 'PATCH', `/api/normas/${id}/meta`, [id, meta], meta,
    ),
    tags: () => invokeDados('tags:listar', 'GET', '/api/tags'),
    excluir: id => invokeDados('normas:excluir', 'DELETE', `/api/normas/${id}`, [id]),
    versoes: id => invokeDados('normas:versoes', 'GET', `/api/normas/${id}/versoes`, [id]),
    restaurar: (normaId, versaoId) => invokeDados(
      'normas:restaurar',
      'POST',
      `/api/normas/${normaId}/restaurar/${versaoId}`,
      [normaId, versaoId],
      {},
    ),
  },
  excecoes: {
    salvar: (normaId, lista) => invokeDados(
      'excecoes:salvar', 'PUT', `/api/normas/${normaId}/excecoes`, [normaId, lista], lista,
    ),
    resolver: id => invokeDados(
      'excecoes:resolver', 'PATCH', `/api/excecoes/${id}/resolver`, [id], {},
    ),
  },
  exportar: {
    docx: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:docx', id)
        : ipcRenderer.invoke('exportar:docx', id)
    ),
    html: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:html', id)
        : ipcRenderer.invoke('exportar:html', id)
    ),
    docxSelecao: async payload => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:docx-selecao', payload)
        : ipcRenderer.invoke('exportar:docx-selecao', payload)
    ),
    htmlSelecao: async payload => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:html-selecao', payload)
        : ipcRenderer.invoke('exportar:html-selecao', payload)
    ),
  },
  arquivos: {
    salvarTxt: (payload) => ipcRenderer.invoke('arquivos:salvar-txt', payload),
  },
  ortografia: {
    verificar: (palavras) => ipcRenderer.invoke('ortografia:verificar', palavras),
    aceitar:   (palavra)  => ipcRenderer.invoke('ortografia:aceitar',   palavra),
    rejeitar:  (palavra)  => ipcRenderer.invoke('ortografia:rejeitar',  palavra),
  },
  publicacoes: {
    listar: (filtros = {}) => invokeDados(
      'publicacoes:listar', 'GET', `/api/publicacoes${queryString(filtros)}`, [filtros],
    ),
    buscar: id => invokeDados('publicacoes:buscar', 'GET', `/api/publicacoes/${id}`, [id]),
    criar: dados => invokeDados('publicacoes:criar', 'POST', '/api/publicacoes', [dados], dados),
    salvar: (id, dados) => invokeDados(
      'publicacoes:salvar', 'PUT', `/api/publicacoes/${id}`, [id, dados], dados,
    ),
    excluir: id => invokeDados(
      'publicacoes:excluir', 'DELETE', `/api/publicacoes/${id}`, [id],
    ),
    duplicar: id => invokeDados(
      'publicacoes:duplicar', 'POST', `/api/publicacoes/${id}/duplicar`, [id], {},
    ),
    exportarDocx: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:publicacao:docx', id)
        : ipcRenderer.invoke('exportar:publicacao:docx', id)
    ),
    exportarHtml: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:publicacao:html', id)
        : ipcRenderer.invoke('exportar:publicacao:html', id)
    ),
    exportarWord: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:publicacao:word-pasta', id)
        : ipcRenderer.invoke('exportar:publicacao:word-pasta', id)
    ),
    exportarInDesign: async id => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:exportar:publicacao:indesign', id)
        : ipcRenderer.invoke('exportar:publicacao:indesign', id)
    ),
  },
  backup: {
    exportarBanco: async () => (
      await usarRailway()
        ? ipcRenderer.invoke('railway:backup:exportar')
        : ipcRenderer.invoke('backup:exportar-banco')
    ),
    importarBanco: async () => {
      if (await usarRailway()) {
        throw new Error('A restauração direta do banco Railway está bloqueada por segurança. Use o volume do Railway durante uma janela de manutenção.')
      }
      return ipcRenderer.invoke('backup:importar-banco')
    },
    reiniciarApp:  () => ipcRenderer.invoke('backup:reiniciar-app'),
  },
  trabalhoRemoto: {
    listar: () => ipcRenderer.invoke('trabalho-remoto:listar'),
    criarRetirada: (normaIds, criadoPor, publicacaoIds) => ipcRenderer.invoke('trabalho-remoto:criar-retirada', normaIds, criadoPor, publicacaoIds),
    importarRetirada: (pacote, atualizadoPor) => ipcRenderer.invoke('trabalho-remoto:importar-retirada', pacote, atualizadoPor),
    criarDevolucao: (pacoteId, criadoPor, novaNormaIds) => ipcRenderer.invoke('trabalho-remoto:criar-devolucao', pacoteId, criadoPor, novaNormaIds),
    listarNormasNovas: (pacoteId) => ipcRenderer.invoke('trabalho-remoto:listar-normas-novas', pacoteId),
    importarDevolucao: (pacote, atualizadoPor) => ipcRenderer.invoke('trabalho-remoto:importar-devolucao', pacote, atualizadoPor),
  },
  railway: {
    configuracao: () => ipcRenderer.invoke('railway:configuracao'),
    salvarConfiguracao: dados => invokeRailway('railway:salvar-configuracao', dados),
    testar: () => invokeRailway('railway:testar'),
    listarNormas: filtros => invokeRailway('railway:listar-normas', filtros),
    listarEdicoes: () => invokeRailway('railway:listar-edicoes'),
    criarEdicao: (normaId, usuario) => invokeRailway('railway:criar-edicao', normaId, usuario),
    buscarEdicao: id => invokeRailway('railway:buscar-edicao', id),
    salvarEdicao: (id, dados) => invokeRailway('railway:salvar-edicao', id, dados),
    listarVersoes: id => invokeRailway('railway:listar-versoes', id),
    restaurarVersao: (id, versaoId, dados) => (
      invokeRailway('railway:restaurar-versao', id, versaoId, dados)
    ),
    consultarBloqueio: normaId => invokeRailway(
      'railway:request', 'GET', `/api/normas/${normaId}/bloqueio`,
    ),
    adquirirBloqueio: (normaId, dados) => invokeRailway(
      'railway:request', 'POST', `/api/normas/${normaId}/bloqueio`, dados,
    ),
    renovarBloqueio: (normaId, dados) => invokeRailway(
      'railway:request', 'PUT', `/api/normas/${normaId}/bloqueio`, dados,
    ),
    liberarBloqueio: (normaId, clienteId) => invokeRailway(
      'railway:request', 'DELETE', `/api/normas/${normaId}/bloqueio`, { clienteId },
    ),
  },
  usuarios: {
    listar: () => invokeDados('usuarios:listar', 'GET', '/api/usuarios'),
    criar: dados => invokeDados('usuarios:criar', 'POST', '/api/usuarios', [dados], dados),
    salvar: (id, dados) => invokeDados(
      'usuarios:salvar', 'PUT', `/api/usuarios/${id}`, [id, dados], dados,
    ),
    excluir: id => invokeDados('usuarios:excluir', 'DELETE', `/api/usuarios/${id}`, [id]),
  },
  atualizacoes: {
    estado: () => ipcRenderer.invoke('atualizacoes:estado'),
    verificar: () => ipcRenderer.invoke('atualizacoes:verificar'),
    baixar: () => ipcRenderer.invoke('atualizacoes:baixar'),
    instalar: () => ipcRenderer.invoke('atualizacoes:instalar'),
    acompanhar: callback => {
      const listener = (_event, estado) => callback(estado)
      ipcRenderer.on('atualizacoes:estado', listener)
      return () => ipcRenderer.removeListener('atualizacoes:estado', listener)
    },
  },
})
