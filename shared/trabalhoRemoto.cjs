const { createHash, randomUUID } = require('crypto')

const FORMATO = 'normando-trabalho-remoto'
const VERSAO = 1

const CAMPOS_NORMA = [
  'tipo',
  'epigrafe',
  'apelido',
  'ementa',
  'dados_publicacao',
  'data_ultima_alteracao',
  'atualizacao_pendente',
  'vigencia',
  'link_acesso',
  'anexo',
  'observacoes',
  'caminho_rede',
  'conteudo_raw',
  'conteudo_doc',
  'conteudo_txt',
  'status',
  'data_atualizacao',
]

const CAMPOS_PUBLICACAO = [
  'titulo',
  'edicao',
  'organizador',
  'lancado_em',
  'descricao',
  'caminho_rede',
  'cor_capa',
  'status',
  'ultima_edicao',
]

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hashSnapshot(snapshot) {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex')
}

function validarPacote(pacote, tipo) {
  if (!pacote || pacote.formato !== FORMATO || pacote.versao !== VERSAO) {
    throw new Error('O arquivo selecionado não é um pacote de trabalho remoto válido do Normando.')
  }
  if (tipo && pacote.tipo !== tipo) {
    throw new Error(`Este arquivo não é um pacote de ${tipo === 'retirada' ? 'retirada' : 'devolução'}.`)
  }
  if (!pacote.id || !Array.isArray(pacote.normas)) {
    throw new Error('O pacote está incompleto ou danificado.')
  }
}

function tagsDaNorma(db, normaId) {
  return db.prepare(`
    SELECT t.nome
    FROM tags t
    JOIN norma_tags nt ON nt.tag_id = t.id
    WHERE nt.norma_id = ?
    ORDER BY t.nome COLLATE NOCASE
  `).all(normaId).map(row => row.nome)
}

function excecoesDaNorma(db, normaId) {
  return db.prepare(`
    SELECT tipo, descricao, linha, node_id, resolvida
    FROM excecoes
    WHERE norma_id = ?
    ORDER BY id
  `).all(normaId).map(item => ({
    ...item,
    resolvida: Boolean(item.resolvida),
  }))
}

function snapshotNorma(db, normaId) {
  const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(normaId)
  if (!norma) return null

  const snapshot = {}
  for (const campo of CAMPOS_NORMA) snapshot[campo] = norma[campo] ?? null
  snapshot.tags = tagsDaNorma(db, normaId)
  snapshot.excecoes = excecoesDaNorma(db, normaId)
  return snapshot
}

function snapshotPublicacao(db, publicacaoId) {
  const publicacao = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(publicacaoId)
  if (!publicacao) return null

  const snapshot = {}
  for (const campo of CAMPOS_PUBLICACAO) snapshot[campo] = publicacao[campo] ?? null
  snapshot.secoes = db.prepare(`
    SELECT id, titulo, ordem
    FROM publicacao_secoes
    WHERE publicacao_id = ?
    ORDER BY ordem, id
  `).all(publicacaoId).map(secao => ({
    titulo: secao.titulo || '',
    ordem: Number(secao.ordem || 0),
    normas: db.prepare(`
      SELECT norma_id, ordem, exportacao
      FROM publicacao_normas
      WHERE secao_id = ?
      ORDER BY ordem, id
    `).all(secao.id).map(item => ({
      normaOrigemId: Number(item.norma_id),
      ordem: Number(item.ordem || 0),
      exportacao: item.exportacao || 'completa',
    })),
  }))
  return snapshot
}

function normaIdsDaPublicacao(snapshot) {
  return [...new Set((snapshot?.secoes || [])
    .flatMap(secao => secao.normas || [])
    .map(item => Number(item.normaOrigemId))
    .filter(Number.isInteger))]
}

function salvarVersaoAnterior(db, normaId, conteudoDoc, agora) {
  if (!conteudoDoc || conteudoDoc === '{"type":"doc","content":[]}') return
  const ultima = db.prepare(`
    SELECT COALESCE(MAX(versao), 0) AS versao
    FROM normas_versoes
    WHERE norma_id = ?
  `).get(normaId)
  db.prepare(`
    INSERT INTO normas_versoes (norma_id, versao, doc_json, criado_em)
    VALUES (?, ?, ?, ?)
  `).run(normaId, Number(ultima?.versao || 0) + 1, conteudoDoc, agora)
}

function substituirTags(db, normaId, tags) {
  db.prepare('DELETE FROM norma_tags WHERE norma_id = ?').run(normaId)
  for (const nomeBruto of tags || []) {
    const nome = String(nomeBruto || '').trim()
    if (!nome) continue
    db.prepare('INSERT OR IGNORE INTO tags (nome) VALUES (?)').run(nome)
    const tag = db.prepare('SELECT id FROM tags WHERE nome = ? COLLATE NOCASE').get(nome)
    db.prepare('INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)').run(normaId, tag.id)
  }
}

function substituirExcecoes(db, normaId, excecoes, agora) {
  db.prepare('DELETE FROM excecoes WHERE norma_id = ?').run(normaId)
  for (const item of excecoes || []) {
    db.prepare(`
      INSERT INTO excecoes (norma_id, tipo, descricao, linha, node_id, resolvida, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      normaId,
      item.tipo || '',
      item.descricao || '',
      item.linha ?? null,
      item.node_id ?? item.nodeId ?? null,
      item.resolvida ? 1 : 0,
      agora,
    )
  }
}

function atualizarNorma(db, normaId, snapshot, atualizadoPor, agora, guardarVersao = true) {
  const atual = db.prepare('SELECT * FROM normas WHERE id = ?').get(normaId)
  if (!atual) throw new Error('Norma local não encontrada.')
  if (guardarVersao) salvarVersaoAnterior(db, normaId, atual.conteudo_doc, agora)

  db.prepare(`
    UPDATE normas SET
      tipo = ?, epigrafe = ?, apelido = ?, ementa = ?, dados_publicacao = ?,
      data_ultima_alteracao = ?, atualizacao_pendente = ?, vigencia = ?,
      link_acesso = ?, anexo = ?, observacoes = ?, caminho_rede = ?,
      conteudo_raw = ?, conteudo_doc = ?, conteudo_txt = ?, status = ?,
      data_atualizacao = ?, atualizado_por = ?, atualizado_em = ?
    WHERE id = ?
  `).run(
    snapshot.tipo || '',
    snapshot.epigrafe || '',
    snapshot.apelido || null,
    snapshot.ementa || null,
    snapshot.dados_publicacao || null,
    snapshot.data_ultima_alteracao || null,
    snapshot.atualizacao_pendente ? 1 : 0,
    snapshot.vigencia || 'Vigente',
    snapshot.link_acesso || null,
    snapshot.anexo || null,
    snapshot.observacoes || null,
    snapshot.caminho_rede || null,
    snapshot.conteudo_raw || null,
    snapshot.conteudo_doc || '{"type":"doc","content":[]}',
    snapshot.conteudo_txt || '',
    snapshot.status || 'rascunho',
    snapshot.data_atualizacao || null,
    atualizadoPor || atual.atualizado_por || null,
    agora,
    normaId,
  )
  substituirTags(db, normaId, snapshot.tags)
  substituirExcecoes(db, normaId, snapshot.excecoes, agora)
}

function criarNormaLocal(db, snapshot, atualizadoPor, agora, idPreferido) {
  let result
  if (idPreferido && !db.prepare('SELECT id FROM normas WHERE id = ?').get(idPreferido)) {
    result = db.prepare(`
      INSERT INTO normas (
        id, tipo, epigrafe, apelido, ementa, dados_publicacao,
        data_ultima_alteracao, atualizacao_pendente, vigencia, link_acesso,
        anexo, observacoes, caminho_rede, conteudo_raw, conteudo_doc,
        conteudo_txt, status, data_atualizacao, atualizado_por, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      idPreferido,
      snapshot.tipo || '',
      snapshot.epigrafe || '',
      snapshot.apelido || null,
      snapshot.ementa || null,
      snapshot.dados_publicacao || null,
      snapshot.data_ultima_alteracao || null,
      snapshot.atualizacao_pendente ? 1 : 0,
      snapshot.vigencia || 'Vigente',
      snapshot.link_acesso || null,
      snapshot.anexo || null,
      snapshot.observacoes || null,
      snapshot.caminho_rede || null,
      snapshot.conteudo_raw || null,
      snapshot.conteudo_doc || '{"type":"doc","content":[]}',
      snapshot.conteudo_txt || '',
      snapshot.status || 'rascunho',
      snapshot.data_atualizacao || null,
      atualizadoPor || null,
      agora,
      agora,
    )
    result.lastInsertRowid = idPreferido
  } else {
    result = db.prepare(`
      INSERT INTO normas (
        tipo, epigrafe, apelido, ementa, dados_publicacao,
        data_ultima_alteracao, atualizacao_pendente, vigencia, link_acesso,
        anexo, observacoes, caminho_rede, conteudo_raw, conteudo_doc,
        conteudo_txt, status, data_atualizacao, atualizado_por, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.tipo || '',
      snapshot.epigrafe || '',
      snapshot.apelido || null,
      snapshot.ementa || null,
      snapshot.dados_publicacao || null,
      snapshot.data_ultima_alteracao || null,
      snapshot.atualizacao_pendente ? 1 : 0,
      snapshot.vigencia || 'Vigente',
      snapshot.link_acesso || null,
      snapshot.anexo || null,
      snapshot.observacoes || null,
      snapshot.caminho_rede || null,
      snapshot.conteudo_raw || null,
      snapshot.conteudo_doc || '{"type":"doc","content":[]}',
      snapshot.conteudo_txt || '',
      snapshot.status || 'rascunho',
      snapshot.data_atualizacao || null,
      atualizadoPor || null,
      agora,
      agora,
    )
  }

  const normaId = Number(result.lastInsertRowid)
  substituirTags(db, normaId, snapshot.tags)
  substituirExcecoes(db, normaId, snapshot.excecoes, agora)
  return normaId
}

function criarPublicacaoLocal(db, snapshot, agora, idPreferido) {
  let result
  const valores = [
    snapshot.titulo || '',
    snapshot.edicao || null,
    snapshot.organizador || null,
    snapshot.lancado_em || null,
    snapshot.descricao || null,
    snapshot.caminho_rede || null,
    snapshot.cor_capa || null,
    snapshot.status || 'previsto',
    snapshot.ultima_edicao ? 1 : 0,
    agora,
    agora,
  ]

  if (idPreferido && !db.prepare('SELECT id FROM publicacoes WHERE id = ?').get(idPreferido)) {
    result = db.prepare(`
      INSERT INTO publicacoes (
        id, titulo, edicao, organizador, lancado_em, descricao, caminho_rede,
        cor_capa, status, ultima_edicao, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(idPreferido, ...valores)
    result.lastInsertRowid = idPreferido
  } else {
    result = db.prepare(`
      INSERT INTO publicacoes (
        titulo, edicao, organizador, lancado_em, descricao, caminho_rede,
        cor_capa, status, ultima_edicao, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...valores)
  }
  return Number(result.lastInsertRowid)
}

function aplicarSnapshotPublicacao(db, publicacaoId, snapshot, resolverNormaId, agora) {
  const atual = db.prepare('SELECT id FROM publicacoes WHERE id = ?').get(publicacaoId)
  if (!atual) throw new Error('Publicação local não encontrada.')

  db.prepare(`
    UPDATE publicacoes SET
      titulo = ?, edicao = ?, organizador = ?, lancado_em = ?, descricao = ?,
      caminho_rede = ?, cor_capa = ?, status = ?, ultima_edicao = ?, atualizado_em = ?
    WHERE id = ?
  `).run(
    snapshot.titulo || '',
    snapshot.edicao || null,
    snapshot.organizador || null,
    snapshot.lancado_em || null,
    snapshot.descricao || null,
    snapshot.caminho_rede || null,
    snapshot.cor_capa || null,
    snapshot.status || 'previsto',
    snapshot.ultima_edicao ? 1 : 0,
    agora,
    publicacaoId,
  )

  db.prepare(`
    DELETE FROM publicacao_normas
    WHERE secao_id IN (SELECT id FROM publicacao_secoes WHERE publicacao_id = ?)
  `).run(publicacaoId)
  db.prepare('DELETE FROM publicacao_secoes WHERE publicacao_id = ?').run(publicacaoId)

  for (let i = 0; i < (snapshot.secoes || []).length; i++) {
    const secao = snapshot.secoes[i]
    const resultadoSecao = db.prepare(`
      INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem)
      VALUES (?, ?, ?)
    `).run(publicacaoId, secao.titulo || '', i)
    const secaoId = Number(resultadoSecao.lastInsertRowid)

    for (let j = 0; j < (secao.normas || []).length; j++) {
      const item = secao.normas[j]
      const normaId = resolverNormaId(item)
      if (!normaId) {
        throw new Error(`Não foi possível vincular uma norma da seção "${secao.titulo}".`)
      }
      db.prepare(`
        INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao)
        VALUES (?, ?, ?, ?)
      `).run(secaoId, normaId, j, item.exportacao || 'completa')
    }
  }
}

function snapshotPublicacaoLocalParaDevolucao(db, publicacaoId, origemPorLocal, chaveNovaPorLocal) {
  const snapshot = snapshotPublicacao(db, publicacaoId)
  if (!snapshot) return null
  snapshot.secoes = snapshot.secoes.map(secao => ({
    ...secao,
    normas: secao.normas.map(item => {
      const localId = Number(item.normaOrigemId)
      const origemId = origemPorLocal.get(localId)
      const chaveNova = chaveNovaPorLocal.get(localId)
      if (!origemId && !chaveNova) {
        throw new Error(`A norma ${localId} da publicação "${snapshot.titulo}" não pertence à retirada nem foi selecionada como nova.`)
      }
      return {
        ...(origemId ? { normaOrigemId: origemId } : { normaNovaChave: chaveNova }),
        ordem: item.ordem,
        exportacao: item.exportacao,
      }
    }),
  }))
  return snapshot
}

function registrarPacote(db, pacote, papel, status, agora) {
  db.prepare(`
    INSERT OR REPLACE INTO trabalho_remoto_pacotes
      (id, papel, status, criado_em, criado_por, importado_em, concluido_em)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(
      (SELECT concluido_em FROM trabalho_remoto_pacotes WHERE id = ?),
      NULL
    ))
  `).run(
    pacote.id,
    papel,
    status,
    pacote.criadoEm || agora,
    pacote.criadoPor || null,
    papel === 'copia' ? agora : null,
    pacote.id,
  )
}

function criarRetirada(db, normaIds, criadoPor = '', publicacaoIds = []) {
  const ids = new Set((normaIds || []).map(Number).filter(Number.isInteger))
  const pubsIds = [...new Set((publicacaoIds || []).map(Number).filter(Number.isInteger))]
  const publicacoes = []

  for (const publicacaoId of pubsIds) {
    const snapshot = snapshotPublicacao(db, publicacaoId)
    if (!snapshot) continue
    for (const normaId of normaIdsDaPublicacao(snapshot)) ids.add(normaId)
    publicacoes.push({
      publicacaoOrigemId: publicacaoId,
      titulo: snapshot.titulo,
      baseHash: hashSnapshot(snapshot),
      baseAtualizadoEm: db.prepare('SELECT atualizado_em FROM publicacoes WHERE id = ?').get(publicacaoId)?.atualizado_em || null,
      snapshot,
    })
  }
  if (!ids.size && !publicacoes.length) {
    throw new Error('Selecione ao menos uma norma ou publicação para a retirada.')
  }

  const agora = new Date().toISOString()
  const pacote = {
    formato: FORMATO,
    versao: VERSAO,
    tipo: 'retirada',
    id: randomUUID(),
    criadoEm: agora,
    criadoPor: criadoPor || '',
    normas: [],
    publicacoes,
  }

  for (const normaId of ids) {
    const snapshot = snapshotNorma(db, normaId)
    if (!snapshot) continue
    pacote.normas.push({
      normaOrigemId: normaId,
      epigrafe: snapshot.epigrafe,
      baseHash: hashSnapshot(snapshot),
      baseAtualizadoEm: db.prepare('SELECT atualizado_em FROM normas WHERE id = ?').get(normaId)?.atualizado_em || null,
      snapshot,
    })
  }
  if (!pacote.normas.length && !pacote.publicacoes.length) {
    throw new Error('Nenhuma das normas ou publicações selecionadas foi encontrada.')
  }

  db.transaction(() => {
    registrarPacote(db, pacote, 'origem', 'retirado', agora)
    for (const item of pacote.normas) {
      db.prepare(`
        INSERT OR REPLACE INTO trabalho_remoto_normas
          (pacote_id, norma_local_id, norma_origem_id, epigrafe, base_hash, base_atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pacote.id,
        item.normaOrigemId,
        item.normaOrigemId,
        item.epigrafe,
        item.baseHash,
        item.baseAtualizadoEm,
      )
    }
    for (const item of pacote.publicacoes) {
      db.prepare(`
        INSERT OR REPLACE INTO trabalho_remoto_publicacoes
          (pacote_id, publicacao_local_id, publicacao_origem_id, titulo, base_hash, base_atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pacote.id,
        item.publicacaoOrigemId,
        item.publicacaoOrigemId,
        item.titulo,
        item.baseHash,
        item.baseAtualizadoEm,
      )
    }
  })()

  return pacote
}

function importarRetirada(db, pacote, atualizadoPor = '') {
  validarPacote(pacote, 'retirada')
  for (const item of pacote.normas) {
    if (!item.snapshot || hashSnapshot(item.snapshot) !== item.baseHash) {
      throw new Error(`A norma "${item.epigrafe || item.normaOrigemId}" está corrompida no pacote de retirada.`)
    }
  }
  for (const item of pacote.publicacoes || []) {
    if (!item.snapshot || hashSnapshot(item.snapshot) !== item.baseHash) {
      throw new Error(`A publicação "${item.titulo || item.publicacaoOrigemId}" está corrompida no pacote de retirada.`)
    }
  }
  const agora = new Date().toISOString()
  const importadas = []
  const publicacoesImportadas = []
  const normaLocalPorOrigem = new Map()

  db.transaction(() => {
    registrarPacote(db, pacote, 'copia', 'em_edicao', agora)
    db.prepare('DELETE FROM trabalho_remoto_normas WHERE pacote_id = ?').run(pacote.id)
    db.prepare('DELETE FROM trabalho_remoto_publicacoes WHERE pacote_id = ?').run(pacote.id)

    for (const item of pacote.normas) {
      const existente = db.prepare('SELECT * FROM normas WHERE id = ?').get(item.normaOrigemId)
      let normaLocalId
      if (existente && String(existente.epigrafe || '') === String(item.snapshot?.epigrafe || '')) {
        atualizarNorma(db, existente.id, item.snapshot, atualizadoPor || pacote.criadoPor, agora, true)
        normaLocalId = Number(existente.id)
      } else {
        normaLocalId = criarNormaLocal(
          db,
          item.snapshot,
          atualizadoPor || pacote.criadoPor,
          agora,
          existente ? null : item.normaOrigemId,
        )
      }

      db.prepare(`
        INSERT INTO trabalho_remoto_normas
          (pacote_id, norma_local_id, norma_origem_id, epigrafe, base_hash, base_atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pacote.id,
        normaLocalId,
        item.normaOrigemId,
        item.epigrafe || item.snapshot?.epigrafe || '',
        item.baseHash,
        item.baseAtualizadoEm || null,
      )
      normaLocalPorOrigem.set(Number(item.normaOrigemId), normaLocalId)
      importadas.push({ normaLocalId, normaOrigemId: item.normaOrigemId, epigrafe: item.epigrafe })
    }

    for (const item of pacote.publicacoes || []) {
      const existente = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(item.publicacaoOrigemId)
      let publicacaoLocalId
      if (existente && String(existente.titulo || '') === String(item.snapshot?.titulo || '')) {
        publicacaoLocalId = Number(existente.id)
      } else {
        publicacaoLocalId = criarPublicacaoLocal(
          db,
          item.snapshot,
          agora,
          existente ? null : item.publicacaoOrigemId,
        )
      }

      aplicarSnapshotPublicacao(
        db,
        publicacaoLocalId,
        item.snapshot,
        ref => normaLocalPorOrigem.get(Number(ref.normaOrigemId)),
        agora,
      )
      db.prepare(`
        INSERT INTO trabalho_remoto_publicacoes
          (pacote_id, publicacao_local_id, publicacao_origem_id, titulo, base_hash, base_atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pacote.id,
        publicacaoLocalId,
        item.publicacaoOrigemId,
        item.titulo || item.snapshot?.titulo || '',
        item.baseHash,
        item.baseAtualizadoEm || null,
      )
      publicacoesImportadas.push({
        publicacaoLocalId,
        publicacaoOrigemId: item.publicacaoOrigemId,
        titulo: item.titulo,
      })
    }
  })()

  return { pacoteId: pacote.id, importadas, publicacoesImportadas }
}

function criarDevolucao(db, pacoteId, criadoPor = '', novaNormaIds = []) {
  const pacote = db.prepare('SELECT * FROM trabalho_remoto_pacotes WHERE id = ?').get(pacoteId)
  if (!pacote || pacote.papel !== 'copia') {
    throw new Error('Retirada importada não encontrada neste computador.')
  }
  const itens = db.prepare(`
    SELECT * FROM trabalho_remoto_normas
    WHERE pacote_id = ?
    ORDER BY norma_origem_id
  `).all(pacoteId)
  const publicacoes = db.prepare(`
    SELECT * FROM trabalho_remoto_publicacoes
    WHERE pacote_id = ?
    ORDER BY publicacao_origem_id
  `).all(pacoteId)

  const origemPorLocal = new Map(itens.map(item => [
    Number(item.norma_local_id),
    Number(item.norma_origem_id),
  ]))
  const idsNovos = [...new Set((novaNormaIds || []).map(Number).filter(Number.isInteger))]
    .filter(id => !origemPorLocal.has(id))
  const chaveNovaPorLocal = new Map(idsNovos.map(id => [id, `local:${id}`]))

  if (!itens.length && !publicacoes.length && !idsNovos.length) {
    throw new Error('A retirada não possui normas ou publicações vinculadas.')
  }

  const agora = new Date().toISOString()
  const devolucao = {
    formato: FORMATO,
    versao: VERSAO,
    tipo: 'devolucao',
    id: pacoteId,
    retiradaCriadaEm: pacote.criado_em,
    criadoEm: agora,
    criadoPor: criadoPor || '',
    normas: itens.map(item => {
      const snapshot = snapshotNorma(db, item.norma_local_id)
      if (!snapshot) throw new Error(`A norma local "${item.epigrafe}" não foi encontrada.`)
      return {
        normaOrigemId: Number(item.norma_origem_id),
        normaLocalId: Number(item.norma_local_id),
        epigrafe: item.epigrafe,
        baseHash: item.base_hash,
        baseAtualizadoEm: item.base_atualizado_em,
        editadoHash: hashSnapshot(snapshot),
        snapshot,
      }
    }),
    normasNovas: idsNovos.map(normaLocalId => {
      const snapshot = snapshotNorma(db, normaLocalId)
      if (!snapshot) throw new Error(`A norma local ${normaLocalId} não foi encontrada.`)
      return {
        chaveLocal: chaveNovaPorLocal.get(normaLocalId),
        normaLocalId,
        epigrafe: snapshot.epigrafe,
        editadoHash: hashSnapshot(snapshot),
        snapshot,
      }
    }),
    publicacoes: publicacoes.map(item => {
      const snapshot = snapshotPublicacaoLocalParaDevolucao(
        db,
        item.publicacao_local_id,
        origemPorLocal,
        chaveNovaPorLocal,
      )
      if (!snapshot) throw new Error(`A publicação local "${item.titulo}" não foi encontrada.`)
      return {
        publicacaoOrigemId: Number(item.publicacao_origem_id),
        publicacaoLocalId: Number(item.publicacao_local_id),
        titulo: item.titulo,
        baseHash: item.base_hash,
        baseAtualizadoEm: item.base_atualizado_em,
        editadoHash: hashSnapshot(snapshot),
        snapshot,
      }
    }),
  }

  db.prepare(`
    UPDATE trabalho_remoto_pacotes
    SET status = 'devolvido', concluido_em = ?
    WHERE id = ?
  `).run(agora, pacoteId)
  return devolucao
}

function aplicarDevolucao(db, pacote, atualizadoPor = '') {
  validarPacote(pacote, 'devolucao')
  const retiradaOriginal = db.prepare(`
    SELECT id
    FROM trabalho_remoto_pacotes
    WHERE id = ? AND papel = 'origem'
  `).get(pacote.id)
  if (!retiradaOriginal) {
    throw new Error('Este banco não reconhece a retirada que originou a devolução. Nenhuma norma foi alterada.')
  }

  for (const item of pacote.normas) {
    if (!item.snapshot || hashSnapshot(item.snapshot) !== item.editadoHash) {
      throw new Error(`A norma "${item.epigrafe || item.normaOrigemId}" está corrompida no pacote de devolução.`)
    }
  }
  for (const item of pacote.normasNovas || []) {
    if (!item.snapshot || hashSnapshot(item.snapshot) !== item.editadoHash) {
      throw new Error(`A norma nova "${item.epigrafe || item.chaveLocal}" está corrompida no pacote de devolução.`)
    }
  }
  for (const item of pacote.publicacoes || []) {
    if (!item.snapshot || hashSnapshot(item.snapshot) !== item.editadoHash) {
      throw new Error(`A publicação "${item.titulo || item.publicacaoOrigemId}" está corrompida no pacote de devolução.`)
    }
  }

  const agora = new Date().toISOString()
  const relatorio = {
    pacoteId: pacote.id,
    aplicadas: [],
    novasCriadas: [],
    novasJaImportadas: [],
    publicacoesAplicadas: [],
    publicacoesInalteradas: [],
    conflitos: [],
    conflitosPublicacoes: [],
    inalteradas: [],
    ausentes: [],
  }

  db.transaction(() => {
    for (const item of pacote.normas) {
      const vinculo = db.prepare(`
        SELECT base_hash
        FROM trabalho_remoto_normas
        WHERE pacote_id = ? AND norma_origem_id = ?
      `).get(pacote.id, item.normaOrigemId)
      if (!vinculo || vinculo.base_hash !== item.baseHash) {
        relatorio.conflitos.push({
          normaId: item.normaOrigemId,
          epigrafe: item.epigrafe,
          motivo: 'A norma não corresponde ao registro original desta retirada.',
        })
        continue
      }

      const atualSnapshot = snapshotNorma(db, item.normaOrigemId)
      if (!atualSnapshot) {
        relatorio.ausentes.push({ normaId: item.normaOrigemId, epigrafe: item.epigrafe })
        continue
      }

      const atualHash = hashSnapshot(atualSnapshot)
      if (atualHash !== item.baseHash) {
        relatorio.conflitos.push({
          normaId: item.normaOrigemId,
          epigrafe: item.epigrafe,
          motivo: 'A norma foi alterada no banco oficial depois da retirada.',
        })
        continue
      }
      if (item.editadoHash === item.baseHash) {
        relatorio.inalteradas.push({ normaId: item.normaOrigemId, epigrafe: item.epigrafe })
        continue
      }

      atualizarNorma(
        db,
        item.normaOrigemId,
        item.snapshot,
        pacote.criadoPor || atualizadoPor,
        agora,
        true,
      )
      relatorio.aplicadas.push({ normaId: item.normaOrigemId, epigrafe: item.epigrafe })
    }

    const novaOficialPorChave = new Map()
    for (const item of pacote.normasNovas || []) {
      const importada = db.prepare(`
        SELECT norma_oficial_id
        FROM trabalho_remoto_novas_normas
        WHERE pacote_id = ? AND chave_local = ?
      `).get(pacote.id, item.chaveLocal)
      if (importada) {
        novaOficialPorChave.set(item.chaveLocal, Number(importada.norma_oficial_id))
        relatorio.novasJaImportadas.push({
          normaId: Number(importada.norma_oficial_id),
          epigrafe: item.epigrafe,
        })
        continue
      }

      const normaOficialId = criarNormaLocal(
        db,
        item.snapshot,
        pacote.criadoPor || atualizadoPor,
        agora,
        null,
      )
      db.prepare(`
        INSERT INTO trabalho_remoto_novas_normas
          (pacote_id, chave_local, norma_oficial_id)
        VALUES (?, ?, ?)
      `).run(pacote.id, item.chaveLocal, normaOficialId)
      novaOficialPorChave.set(item.chaveLocal, normaOficialId)
      relatorio.novasCriadas.push({ normaId: normaOficialId, epigrafe: item.epigrafe })
    }

    for (const item of pacote.publicacoes || []) {
      const vinculo = db.prepare(`
        SELECT base_hash
        FROM trabalho_remoto_publicacoes
        WHERE pacote_id = ? AND publicacao_origem_id = ?
      `).get(pacote.id, item.publicacaoOrigemId)
      if (!vinculo || vinculo.base_hash !== item.baseHash) {
        relatorio.conflitosPublicacoes.push({
          publicacaoId: item.publicacaoOrigemId,
          titulo: item.titulo,
          motivo: 'A publicação não corresponde ao registro original desta retirada.',
        })
        continue
      }

      const atualSnapshot = snapshotPublicacao(db, item.publicacaoOrigemId)
      if (!atualSnapshot) {
        relatorio.conflitosPublicacoes.push({
          publicacaoId: item.publicacaoOrigemId,
          titulo: item.titulo,
          motivo: 'A publicação não foi encontrada no banco oficial.',
        })
        continue
      }
      if (hashSnapshot(atualSnapshot) !== item.baseHash) {
        relatorio.conflitosPublicacoes.push({
          publicacaoId: item.publicacaoOrigemId,
          titulo: item.titulo,
          motivo: 'A estrutura da publicação foi alterada no escritório depois da retirada.',
        })
        continue
      }
      if (item.editadoHash === item.baseHash) {
        relatorio.publicacoesInalteradas.push({
          publicacaoId: item.publicacaoOrigemId,
          titulo: item.titulo,
        })
        continue
      }

      const referenciasInvalidas = (item.snapshot.secoes || [])
        .flatMap(secao => secao.normas || [])
        .filter(ref => {
          if (ref.normaOrigemId) {
            return !db.prepare('SELECT id FROM normas WHERE id = ?').get(ref.normaOrigemId)
          }
          return !novaOficialPorChave.has(ref.normaNovaChave)
        })
      if (referenciasInvalidas.length) {
        relatorio.conflitosPublicacoes.push({
          publicacaoId: item.publicacaoOrigemId,
          titulo: item.titulo,
          motivo: 'Uma ou mais normas da publicação não puderam ser vinculadas no banco oficial.',
        })
        continue
      }

      aplicarSnapshotPublicacao(
        db,
        item.publicacaoOrigemId,
        item.snapshot,
        ref => (
          ref.normaOrigemId
            ? Number(ref.normaOrigemId)
            : novaOficialPorChave.get(ref.normaNovaChave)
        ),
        agora,
      )
      relatorio.publicacoesAplicadas.push({
        publicacaoId: item.publicacaoOrigemId,
        titulo: item.titulo,
      })
    }

    const existente = db.prepare('SELECT id FROM trabalho_remoto_pacotes WHERE id = ?').get(pacote.id)
    if (existente) {
      db.prepare(`
        UPDATE trabalho_remoto_pacotes
        SET status = ?, concluido_em = ?
        WHERE id = ?
      `).run(
        relatorio.conflitos.length || relatorio.conflitosPublicacoes.length || relatorio.ausentes.length
          ? 'com_conflito'
          : 'concluido',
        agora,
        pacote.id,
      )
    }
  })()

  return relatorio
}

function listarPacotes(db) {
  return db.prepare(`
    SELECT
      p.*,
      (
        SELECT COUNT(*)
        FROM trabalho_remoto_normas n
        WHERE n.pacote_id = p.id
      ) AS total_normas,
      (
        SELECT COUNT(*)
        FROM trabalho_remoto_publicacoes pub
        WHERE pub.pacote_id = p.id
      ) AS total_publicacoes
    FROM trabalho_remoto_pacotes p
    ORDER BY COALESCE(p.importado_em, p.criado_em) DESC
  `).all()
}

function listarNormasNovasCandidatas(db, pacoteId) {
  const pacote = db.prepare(`
    SELECT importado_em
    FROM trabalho_remoto_pacotes
    WHERE id = ? AND papel = 'copia'
  `).get(pacoteId)
  if (!pacote) return []

  return db.prepare(`
    SELECT n.id, n.tipo, n.epigrafe, n.apelido, n.status, n.criado_em
    FROM normas n
    WHERE datetime(n.criado_em) >= datetime(?)
      AND NOT EXISTS (
        SELECT 1
        FROM trabalho_remoto_normas trn
        WHERE trn.pacote_id = ? AND trn.norma_local_id = n.id
      )
    ORDER BY n.criado_em, n.id
  `).all(pacote.importado_em || '0000-01-01', pacoteId)
}

module.exports = {
  FORMATO,
  VERSAO,
  aplicarDevolucao,
  criarDevolucao,
  criarRetirada,
  hashSnapshot,
  importarRetirada,
  listarNormasNovasCandidatas,
  listarPacotes,
  snapshotPublicacao,
  snapshotNorma,
  validarPacote,
}
