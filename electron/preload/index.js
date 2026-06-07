import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('legislator', {
  normas: {
    listar:    (filtros)          => ipcRenderer.invoke('normas:listar',    filtros),
    buscar:    (id)               => ipcRenderer.invoke('normas:buscar',    id),
    criar:     (dados)            => ipcRenderer.invoke('normas:criar',     dados),
    salvar:       (id, payload)      => ipcRenderer.invoke('normas:salvar',          id, payload),
    atualizarMeta:(id, meta)        => ipcRenderer.invoke('normas:atualizar-meta',   id, meta),
    tags:         ()                => ipcRenderer.invoke('tags:listar'),
    excluir:      (id)               => ipcRenderer.invoke('normas:excluir',          id),
    versoes:   (id)               => ipcRenderer.invoke('normas:versoes',   id),
    restaurar: (normaId, versaoId)=> ipcRenderer.invoke('normas:restaurar', normaId, versaoId),
  },
  excecoes: {
    salvar:   (normaId, lista)    => ipcRenderer.invoke('excecoes:salvar',  normaId, lista),
    resolver: (id)                => ipcRenderer.invoke('excecoes:resolver', id),
  },
  exportar: {
    docx: (id) => ipcRenderer.invoke('exportar:docx', id),
    html: (id) => ipcRenderer.invoke('exportar:html', id),
    docxSelecao: (payload) => ipcRenderer.invoke('exportar:docx-selecao', payload),
    htmlSelecao: (payload) => ipcRenderer.invoke('exportar:html-selecao', payload),
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
    listar:   (filtros)     => ipcRenderer.invoke('publicacoes:listar', filtros),
    buscar:   (id)          => ipcRenderer.invoke('publicacoes:buscar',   id),
    criar:    (dados)       => ipcRenderer.invoke('publicacoes:criar',    dados),
    salvar:   (id, dados)   => ipcRenderer.invoke('publicacoes:salvar',   id, dados),
    excluir:  (id)          => ipcRenderer.invoke('publicacoes:excluir',  id),
    duplicar: (id)          => ipcRenderer.invoke('publicacoes:duplicar', id),
    exportarDocx: (id)      => ipcRenderer.invoke('exportar:publicacao:docx', id),
    exportarHtml: (id)      => ipcRenderer.invoke('exportar:publicacao:html', id),
    exportarWord: (id)      => ipcRenderer.invoke('exportar:publicacao:word-pasta', id),
    exportarInDesign: (id)  => ipcRenderer.invoke('exportar:publicacao:indesign', id),
  },
  backup: {
    exportarBanco: () => ipcRenderer.invoke('backup:exportar-banco'),
    importarBanco: () => ipcRenderer.invoke('backup:importar-banco'),
    reiniciarApp:  () => ipcRenderer.invoke('backup:reiniciar-app'),
  },
})
