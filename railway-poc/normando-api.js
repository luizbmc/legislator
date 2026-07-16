const crypto = require('crypto')

const SECOES_PADRAO = ['Normas principais', 'Normas correlatas', 'Outras normas']
const EXPORTACOES_VALIDAS = new Set(['ignorar', 'atualizacao', 'completa'])
const BLOQUEIO_DURACAO_MS = 10 * 60 * 1000

function colunaExiste(db, tabela, coluna) {
  return db.prepare(`PRAGMA table_info("${tabela}")`).all().some(item => item.name === coluna)
}

function prepararEsquema(db) {
  if (!colunaExiste(db, 'normas', 'revisao')) {
    db.exec('ALTER TABLE normas ADD COLUMN revisao INTEGER NOT NULL DEFAULT 1')
  }
  if (!colunaExiste(db, 'normas', 'normas_alteradoras_pendentes')) {
    db.exec('ALTER TABLE normas ADD COLUMN normas_alteradoras_pendentes TEXT')
  }
  if (!colunaExiste(db, 'publicacoes', 'revisao')) {
    db.exec('ALTER TABLE publicacoes ADD COLUMN revisao INTEGER NOT NULL DEFAULT 1')
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      cor TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS norma_bloqueios (
      norma_id INTEGER PRIMARY KEY REFERENCES normas(id) ON DELETE CASCADE,
      usuario_id TEXT NOT NULL,
      usuario_nome TEXT NOT NULL,
      cliente_id TEXT NOT NULL,
      adquirido_em TEXT NOT NULL,
      renovado_em TEXT NOT NULL,
      expira_em TEXT NOT NULL
    );
  `)
}

function bloqueioAtivo(db, normaId, agora = new Date()) {
  const bloqueio = db.prepare(`
    SELECT norma_id, usuario_id, usuario_nome, cliente_id,
           adquirido_em, renovado_em, expira_em
    FROM norma_bloqueios
    WHERE norma_id = ?
  `).get(normaId)
  if (!bloqueio) return null
  if (new Date(bloqueio.expira_em).getTime() > agora.getTime()) return bloqueio
  db.prepare('DELETE FROM norma_bloqueios WHERE norma_id = ?').run(normaId)
  return null
}

function dadosBloqueio(body = {}) {
  const usuarioId = String(body.usuarioId || body.usuario_id || '').trim()
  const usuarioNome = String(body.usuarioNome || body.usuario_nome || '').trim()
  const clienteId = String(body.clienteId || body.cliente_id || '').trim()
  if (!usuarioId || !usuarioNome || !clienteId) {
    const error = new Error('Não foi possível identificar o usuário e este computador.')
    error.status = 400
    throw error
  }
  return { usuarioId, usuarioNome, clienteId }
}

function novoPrazoBloqueio(agora = new Date()) {
  return new Date(agora.getTime() + BLOQUEIO_DURACAO_MS).toISOString()
}

function idValido(valor) {
  const id = Number(valor)
  return Number.isInteger(id) && id > 0 ? id : null
}

function tagsNorma(db, normaId) {
  return db.prepare(`
    SELECT t.nome
    FROM tags t
    JOIN norma_tags nt ON nt.tag_id = t.id
    WHERE nt.norma_id = ?
    ORDER BY t.nome COLLATE NOCASE
  `).all(normaId).map(item => item.nome)
}

function normaCompleta(db, id) {
  const norma = db.prepare('SELECT * FROM normas WHERE id = ?').get(id)
  if (!norma) return null
  norma.tags = tagsNorma(db, id)
  return norma
}

function substituirTags(db, normaId, tags) {
  db.prepare('DELETE FROM norma_tags WHERE norma_id = ?').run(normaId)
  for (const valor of tags || []) {
    const nome = String(valor || '').trim()
    if (!nome) continue
    db.prepare('INSERT OR IGNORE INTO tags (nome) VALUES (?)').run(nome)
    const tag = db.prepare('SELECT id FROM tags WHERE nome = ? COLLATE NOCASE').get(nome)
    db.prepare('INSERT OR IGNORE INTO norma_tags (norma_id, tag_id) VALUES (?, ?)').run(normaId, tag.id)
  }
}

function salvarVersaoNorma(db, norma, agora) {
  if (!norma?.conteudo_doc || norma.conteudo_doc === '{"type":"doc","content":[]}') return
  const ultima = db.prepare(`
    SELECT COALESCE(MAX(versao), 0) AS versao
    FROM normas_versoes
    WHERE norma_id = ?
  `).get(norma.id)
  db.prepare(`
    INSERT INTO normas_versoes (norma_id, versao, doc_json, criado_em)
    VALUES (?, ?, ?, ?)
  `).run(norma.id, Number(ultima?.versao || 0) + 1, norma.conteudo_doc, agora)
}

function conflitoRevisao(res, atual) {
  return res.status(409).json({
    error: 'Este registro foi salvo por outra sessão. Recarregue antes de tentar novamente.',
    atual,
  })
}

function validarBloqueioEscrita(db, req, res) {
  const bloqueio = bloqueioAtivo(db, req.params.id)
  if (!bloqueio) return true
  const clienteId = String(
    req.body?.bloqueioClienteId || req.body?.bloqueio_cliente_id || '',
  ).trim()
  if (clienteId && clienteId === bloqueio.cliente_id) return true
  res.status(423).json({
    error: `Norma em edição por ${bloqueio.usuario_nome}.`,
    bloqueio,
  })
  return false
}

function exportacaoParaSalvar(norma) {
  if (norma?.status !== 'finalizado' || norma?.atualizacao_pendente) return 'ignorar'
  return EXPORTACOES_VALIDAS.has(norma?.exportacao) ? norma.exportacao : 'completa'
}

function buscarPublicacao(db, id, { incluirConteudo = false } = {}) {
  const publicacao = db.prepare('SELECT * FROM publicacoes WHERE id = ?').get(id)
  if (!publicacao) return null
  const camposNorma = incluirConteudo
    ? 'n.*'
    : `
      n.id, n.tipo, n.epigrafe, n.apelido, n.ementa, n.status,
      n.atualizacao_pendente, n.normas_alteradoras_pendentes,
      n.vigencia, n.link_acesso, n.anexo,
      n.observacoes, n.atualizado_por, n.criado_em, n.atualizado_em,
      n.revisao
    `
  publicacao.secoes = db.prepare(`
    SELECT *
    FROM publicacao_secoes
    WHERE publicacao_id = ?
    ORDER BY ordem, id
  `).all(id).map(secao => ({
    ...secao,
    normas: db.prepare(`
      SELECT pn.id AS pn_id, pn.norma_id, pn.ordem, pn.exportacao, ${camposNorma}
      FROM publicacao_normas pn
      JOIN normas n ON n.id = pn.norma_id
      WHERE pn.secao_id = ?
      ORDER BY pn.ordem, pn.id
    `).all(secao.id),
  }))
  return publicacao
}

function salvarSecoes(db, publicacaoId, secoes) {
  const atuais = db.prepare(`
    SELECT id, titulo, ordem FROM publicacao_secoes WHERE publicacao_id = ?
  `).all(publicacaoId)
  const porId = new Map(atuais.map(item => [Number(item.id), item]))
  const mantidas = new Set()

  for (let i = 0; i < secoes.length; i++) {
    const secao = secoes[i]
    let secaoId = idValido(secao.id)
    if (secaoId && porId.has(secaoId)) {
      mantidas.add(secaoId)
      db.prepare(`
        UPDATE publicacao_secoes SET titulo = ?, ordem = ?
        WHERE id = ? AND publicacao_id = ?
      `).run(secao.titulo || '', i, secaoId, publicacaoId)
    } else {
      secaoId = Number(db.prepare(`
        INSERT INTO publicacao_secoes (publicacao_id, titulo, ordem)
        VALUES (?, ?, ?)
      `).run(publicacaoId, secao.titulo || '', i).lastInsertRowid)
      mantidas.add(secaoId)
    }

    const vinculos = db.prepare(`
      SELECT id, norma_id FROM publicacao_normas WHERE secao_id = ?
    `).all(secaoId)
    const vinculosPorId = new Map(vinculos.map(item => [Number(item.id), item]))
    const mantidos = new Set()
    for (let j = 0; j < (secao.normas || []).length; j++) {
      const norma = secao.normas[j]
      const normaId = idValido(norma.norma_id ?? norma.normaId ?? norma.id)
      if (!normaId) continue
      const pnId = idValido(norma.pn_id)
      const exportacao = exportacaoParaSalvar(norma)
      if (pnId && vinculosPorId.has(pnId)) {
        db.prepare(`
          UPDATE publicacao_normas
          SET norma_id = ?, ordem = ?, exportacao = ?
          WHERE id = ? AND secao_id = ?
        `).run(normaId, j, exportacao, pnId, secaoId)
        mantidos.add(pnId)
      } else {
        const novoId = Number(db.prepare(`
          INSERT INTO publicacao_normas (secao_id, norma_id, ordem, exportacao)
          VALUES (?, ?, ?, ?)
        `).run(secaoId, normaId, j, exportacao).lastInsertRowid)
        mantidos.add(novoId)
      }
    }
    for (const vinculo of vinculos) {
      if (!mantidos.has(Number(vinculo.id))) {
        db.prepare('DELETE FROM publicacao_normas WHERE id = ?').run(vinculo.id)
      }
    }
  }
  for (const secao of atuais) {
    if (!mantidas.has(Number(secao.id))) {
      db.prepare('DELETE FROM publicacao_secoes WHERE id = ?').run(secao.id)
    }
  }
}

function registrarNormandoApi(app, db) {
  prepararEsquema(db)

  app.get('/api/normas', (req, res) => {
    const { busca, tipo, status, buscarConteudo, publicacaoId } = req.query
    const where = []
    const params = []
    if (busca) {
      const like = `%${String(busca).trim()}%`
      if (buscarConteudo === 'true') {
        where.push(`(
          n.epigrafe LIKE ? OR n.apelido LIKE ? OR n.ementa LIKE ? OR n.conteudo_txt LIKE ?
          OR n.dados_publicacao LIKE ? OR n.vigencia LIKE ? OR n.link_acesso LIKE ?
          OR n.anexo LIKE ? OR n.observacoes LIKE ?
        )`)
        params.push(like, like, like, like, like, like, like, like, like)
      } else {
        where.push('(n.epigrafe LIKE ? OR n.apelido LIKE ?)')
        params.push(like, like)
      }
    }
    if (tipo) {
      where.push('n.tipo = ?')
      params.push(tipo)
    }
    if (status) {
      where.push('n.status = ?')
      params.push(status)
    }
    if (publicacaoId) {
      where.push(`EXISTS (
        SELECT 1
        FROM publicacao_secoes psf
        JOIN publicacao_normas pnf ON pnf.secao_id = psf.id
        WHERE psf.publicacao_id = ? AND pnf.norma_id = n.id
      )`)
      params.push(publicacaoId)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const items = db.prepare(`
      SELECT
        n.id, n.tipo, n.epigrafe, n.apelido, n.ementa, n.status,
        n.dados_publicacao, n.data_ultima_alteracao, n.vigencia,
        n.atualizacao_pendente, n.normas_alteradoras_pendentes,
        n.link_acesso, n.anexo, n.observacoes,
        n.caminho_rede, n.atualizado_por, n.criado_em, n.atualizado_em,
        n.revisao,
        GROUP_CONCAT(t.nome, '|||') AS tags_str
      FROM normas n
      LEFT JOIN norma_tags nt ON nt.norma_id = n.id
      LEFT JOIN tags t ON t.id = nt.tag_id
      ${clause}
      GROUP BY n.id
      ORDER BY n.atualizado_em DESC, n.id DESC
    `).all(...params).map(({ tags_str, ...norma }) => ({
      ...norma,
      tags: tags_str ? tags_str.split('|||') : [],
    }))
    res.json(items)
  })

  app.get('/api/normas/:id', (req, res) => {
    const norma = normaCompleta(db, req.params.id)
    if (!norma) return res.status(404).json({ error: 'Norma não encontrada.' })
    res.json(norma)
  })

  app.get('/api/normas/:id/bloqueio', (req, res) => {
    if (!normaCompleta(db, req.params.id)) {
      return res.status(404).json({ error: 'Norma não encontrada.' })
    }
    res.json({ bloqueio: bloqueioAtivo(db, req.params.id) })
  })

  app.post('/api/normas/:id/bloqueio', (req, res) => {
    if (!normaCompleta(db, req.params.id)) {
      return res.status(404).json({ error: 'Norma não encontrada.' })
    }
    const dados = dadosBloqueio(req.body)
    const forcar = req.body?.forcar === true
    const agora = new Date()
    const existente = bloqueioAtivo(db, req.params.id, agora)
    const mesmoCliente = existente?.cliente_id === dados.clienteId
    if (existente && !mesmoCliente && !forcar) {
      return res.status(423).json({
        error: `Norma em edição por ${existente.usuario_nome}.`,
        bloqueio: existente,
      })
    }
    const adquiridoEm = mesmoCliente ? existente.adquirido_em : agora.toISOString()
    db.prepare(`
      INSERT INTO norma_bloqueios (
        norma_id, usuario_id, usuario_nome, cliente_id,
        adquirido_em, renovado_em, expira_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(norma_id) DO UPDATE SET
        usuario_id = excluded.usuario_id,
        usuario_nome = excluded.usuario_nome,
        cliente_id = excluded.cliente_id,
        adquirido_em = excluded.adquirido_em,
        renovado_em = excluded.renovado_em,
        expira_em = excluded.expira_em
    `).run(
      req.params.id,
      dados.usuarioId,
      dados.usuarioNome,
      dados.clienteId,
      adquiridoEm,
      agora.toISOString(),
      novoPrazoBloqueio(agora),
    )
    res.json({ bloqueio: bloqueioAtivo(db, req.params.id, agora) })
  })

  app.put('/api/normas/:id/bloqueio', (req, res) => {
    const dados = dadosBloqueio(req.body)
    const agora = new Date()
    const existente = bloqueioAtivo(db, req.params.id, agora)
    if (!existente || existente.cliente_id !== dados.clienteId) {
      return res.status(423).json({
        error: existente
          ? `Norma em edição por ${existente.usuario_nome}.`
          : 'O bloqueio desta norma expirou.',
        bloqueio: existente,
      })
    }
    db.prepare(`
      UPDATE norma_bloqueios
      SET usuario_id = ?, usuario_nome = ?, renovado_em = ?, expira_em = ?
      WHERE norma_id = ? AND cliente_id = ?
    `).run(
      dados.usuarioId,
      dados.usuarioNome,
      agora.toISOString(),
      novoPrazoBloqueio(agora),
      req.params.id,
      dados.clienteId,
    )
    res.json({ bloqueio: bloqueioAtivo(db, req.params.id, agora) })
  })

  app.delete('/api/normas/:id/bloqueio', (req, res) => {
    const clienteId = String(req.body?.clienteId || req.body?.cliente_id || '').trim()
    if (!clienteId) return res.status(400).json({ error: 'Identificação do computador ausente.' })
    db.prepare(`
      DELETE FROM norma_bloqueios WHERE norma_id = ? AND cliente_id = ?
    `).run(req.params.id, clienteId)
    res.json({ ok: true })
  })

  app.post('/api/normas', (req, res) => {
    const dados = req.body || {}
    if (!String(dados.epigrafe || '').trim()) {
      return res.status(400).json({ error: 'Informe a epígrafe.' })
    }
    const agora = new Date().toISOString()
    const result = db.prepare(`
      INSERT INTO normas (
        tipo, epigrafe, apelido, ementa, dados_publicacao,
        data_ultima_alteracao, atualizacao_pendente, normas_alteradoras_pendentes,
        vigencia, link_acesso,
        anexo, observacoes, caminho_rede, conteudo_raw, conteudo_doc,
        conteudo_txt, status, data_atualizacao, atualizado_por,
        criado_em, atualizado_em, revisao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      dados.tipo || '',
      String(dados.epigrafe).trim(),
      dados.apelido || null,
      dados.ementa || null,
      dados.dados_publicacao || null,
      dados.data_ultima_alteracao || null,
      dados.atualizacao_pendente ? 1 : 0,
      dados.normas_alteradoras_pendentes || null,
      dados.vigencia || 'Vigente',
      dados.link_acesso || null,
      dados.anexo || null,
      dados.observacoes || null,
      dados.caminho_rede || null,
      dados.conteudo_raw || null,
      dados.conteudo_doc || '{"type":"doc","content":[]}',
      dados.conteudo_txt || '',
      dados.status || 'rascunho',
      dados.data_atualizacao || null,
      dados.atualizado_por || null,
      agora,
      agora,
    )
    substituirTags(db, result.lastInsertRowid, dados.tags)
    res.status(201).json(normaCompleta(db, result.lastInsertRowid))
  })

  app.put('/api/normas/:id', (req, res) => {
    const atual = normaCompleta(db, req.params.id)
    if (!atual) return res.status(404).json({ error: 'Norma não encontrada.' })
    if (!validarBloqueioEscrita(db, req, res)) return
    const revisao = Number(req.body?.revisao)
    if (Number.isInteger(revisao) && revisao !== Number(atual.revisao)) {
      return conflitoRevisao(res, atual)
    }
    const agora = new Date().toISOString()
    db.transaction(() => {
      salvarVersaoNorma(db, atual, agora)
      const result = db.prepare(`
        UPDATE normas SET
          conteudo_doc = ?, conteudo_txt = ?, status = ?,
          data_atualizacao = ?, atualizado_por = ?, atualizado_em = ?,
          revisao = revisao + 1
        WHERE id = ? AND revisao = ?
      `).run(
        req.body?.conteudo_doc || '{"type":"doc","content":[]}',
        req.body?.conteudo_txt || '',
        req.body?.status ?? atual.status,
        req.body?.data_atualizacao ?? atual.data_atualizacao ?? null,
        req.body?.atualizado_por || atual.atualizado_por || null,
        agora,
        atual.id,
        atual.revisao,
      )
      if (!result.changes) throw Object.assign(new Error('CONFLITO'), { conflito: true })
    })()
    res.json(normaCompleta(db, atual.id))
  })

  app.patch('/api/normas/:id/meta', (req, res) => {
    const atual = normaCompleta(db, req.params.id)
    if (!atual) return res.status(404).json({ error: 'Norma não encontrada.' })
    if (!validarBloqueioEscrita(db, req, res)) return
    const revisao = Number(req.body?.revisao)
    if (Number.isInteger(revisao) && revisao !== Number(atual.revisao)) {
      return conflitoRevisao(res, atual)
    }
    const dados = req.body || {}
    const agora = new Date().toISOString()
    db.transaction(() => {
      db.prepare(`
        UPDATE normas SET
          tipo = ?, epigrafe = ?, apelido = ?, ementa = ?,
          dados_publicacao = ?, data_ultima_alteracao = ?,
          atualizacao_pendente = ?, normas_alteradoras_pendentes = ?,
          vigencia = ?, link_acesso = ?,
          anexo = ?, observacoes = ?, caminho_rede = ?,
          atualizado_por = ?, atualizado_em = ?, revisao = revisao + 1
        WHERE id = ? AND revisao = ?
      `).run(
        dados.tipo ?? atual.tipo,
        dados.epigrafe ?? atual.epigrafe,
        dados.apelido || null,
        dados.ementa || null,
        dados.dados_publicacao || null,
        dados.data_ultima_alteracao || null,
        dados.atualizacao_pendente ? 1 : 0,
        dados.normas_alteradoras_pendentes || null,
        dados.vigencia || 'Vigente',
        dados.link_acesso || null,
        dados.anexo || null,
        dados.observacoes || null,
        dados.caminho_rede || null,
        dados.atualizado_por || atual.atualizado_por || null,
        agora,
        atual.id,
        atual.revisao,
      )
      substituirTags(db, atual.id, dados.tags ?? atual.tags)
    })()
    res.json(normaCompleta(db, atual.id))
  })

  app.delete('/api/normas/:id', (req, res) => {
    db.prepare('DELETE FROM normas WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  app.get('/api/normas/:id/versoes', (req, res) => {
    res.json(db.prepare(`
      SELECT id, norma_id, versao, diff_json, criado_em
      FROM normas_versoes
      WHERE norma_id = ?
      ORDER BY versao DESC
    `).all(req.params.id))
  })

  app.post('/api/normas/:normaId/restaurar/:versaoId', (req, res) => {
    const atual = normaCompleta(db, req.params.normaId)
    const versao = db.prepare('SELECT * FROM normas_versoes WHERE id = ? AND norma_id = ?')
      .get(req.params.versaoId, req.params.normaId)
    if (!atual || !versao) return res.status(404).json({ error: 'Versão não encontrada.' })
    const agora = new Date().toISOString()
    db.transaction(() => {
      salvarVersaoNorma(db, atual, agora)
      db.prepare(`
        UPDATE normas
        SET conteudo_doc = ?, atualizado_em = ?, revisao = revisao + 1
        WHERE id = ?
      `).run(versao.doc_json, agora, atual.id)
    })()
    res.json(normaCompleta(db, atual.id))
  })

  app.put('/api/normas/:id/excecoes', (req, res) => {
    const agora = new Date().toISOString()
    db.transaction(() => {
      db.prepare('DELETE FROM excecoes WHERE norma_id = ?').run(req.params.id)
      for (const item of req.body || []) {
        db.prepare(`
          INSERT INTO excecoes (norma_id, tipo, descricao, linha, node_id, resolvida, criado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.params.id,
          item.tipo || '',
          item.descricao || '',
          item.linha ?? null,
          item.nodeId ?? item.node_id ?? null,
          item.resolvida ? 1 : 0,
          agora,
        )
      }
    })()
    res.json({ ok: true })
  })

  app.patch('/api/excecoes/:id/resolver', (req, res) => {
    db.prepare('UPDATE excecoes SET resolvida = 1 WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  app.get('/api/tags', (req, res) => {
    res.json(db.prepare('SELECT nome FROM tags ORDER BY nome').all().map(item => item.nome))
  })

  app.get('/api/publicacoes', (req, res) => {
    const { busca, status, ultimaEdicao } = req.query
    const params = []
    let where = 'WHERE 1=1'
    if (busca) {
      const like = `%${String(busca).trim()}%`
      where += ` AND (
        p.titulo LIKE ? OR p.edicao LIKE ? OR p.organizador LIKE ?
        OR p.descricao LIKE ? OR p.caminho_rede LIKE ?
        OR EXISTS (
          SELECT 1 FROM publicacao_secoes ps2
          JOIN publicacao_normas pn2 ON pn2.secao_id = ps2.id
          JOIN normas n2 ON n2.id = pn2.norma_id
          WHERE ps2.publicacao_id = p.id
          AND (n2.epigrafe LIKE ? OR n2.apelido LIKE ? OR n2.ementa LIKE ?)
        )
      )`
      params.push(like, like, like, like, like, like, like, like)
    }
    if (status) {
      where += ' AND p.status = ?'
      params.push(status)
    }
    if (ultimaEdicao === 'true' || ultimaEdicao === '1') {
      where += ' AND COALESCE(p.ultima_edicao, 0) = 1'
    }
    res.json(db.prepare(`
      SELECT p.*, COUNT(DISTINCT pn.id) AS total_normas
      FROM publicacoes p
      LEFT JOIN publicacao_secoes ps ON ps.publicacao_id = p.id
      LEFT JOIN publicacao_normas pn ON pn.secao_id = ps.id
      ${where}
      GROUP BY p.id
      ORDER BY p.atualizado_em DESC, p.id DESC
    `).all(...params))
  })

  app.get('/api/publicacoes/:id', (req, res) => {
    const publicacao = buscarPublicacao(db, req.params.id, {
      incluirConteudo: req.query.incluirConteudo === 'true',
    })
    if (!publicacao) return res.status(404).json({ error: 'Publicação não encontrada.' })
    res.json(publicacao)
  })

  app.post('/api/publicacoes', (req, res) => {
    const dados = req.body || {}
    const agora = new Date().toISOString()
    const id = Number(db.prepare(`
      INSERT INTO publicacoes (
        titulo, edicao, organizador, lancado_em, descricao, caminho_rede,
        cor_capa, status, ultima_edicao, criado_em, atualizado_em, revisao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      dados.titulo || '',
      dados.edicao || null,
      dados.organizador || null,
      dados.lancado_em || null,
      dados.descricao || null,
      dados.caminho_rede || null,
      dados.cor_capa || null,
      dados.status || 'previsto',
      dados.ultima_edicao ? 1 : 0,
      agora,
      agora,
    ).lastInsertRowid)
    salvarSecoes(db, id, SECOES_PADRAO.map(titulo => ({ titulo, normas: [] })))
    res.status(201).json(buscarPublicacao(db, id))
  })

  app.put('/api/publicacoes/:id', (req, res) => {
    const atual = buscarPublicacao(db, req.params.id)
    if (!atual) return res.status(404).json({ error: 'Publicação não encontrada.' })
    const revisao = Number(req.body?.revisao)
    if (Number.isInteger(revisao) && revisao !== Number(atual.revisao)) {
      return conflitoRevisao(res, atual)
    }
    const dados = req.body || {}
    const agora = new Date().toISOString()
    db.transaction(() => {
      const result = db.prepare(`
        UPDATE publicacoes SET
          titulo = ?, edicao = ?, organizador = ?, lancado_em = ?,
          descricao = ?, caminho_rede = ?, cor_capa = ?, status = ?,
          ultima_edicao = ?, atualizado_em = ?, revisao = revisao + 1
        WHERE id = ? AND revisao = ?
      `).run(
        dados.titulo ?? atual.titulo,
        dados.edicao || null,
        dados.organizador || null,
        dados.lancado_em || null,
        dados.descricao || null,
        dados.caminho_rede || null,
        dados.cor_capa || null,
        dados.status || 'previsto',
        dados.ultima_edicao ? 1 : 0,
        agora,
        atual.id,
        atual.revisao,
      )
      if (!result.changes) throw Object.assign(new Error('CONFLITO'), { conflito: true })
      if (Array.isArray(dados.secoes)) salvarSecoes(db, atual.id, dados.secoes)
    })()
    res.json(buscarPublicacao(db, atual.id))
  })

  app.delete('/api/publicacoes/:id', (req, res) => {
    db.prepare('DELETE FROM publicacoes WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  app.post('/api/publicacoes/:id/duplicar', (req, res) => {
    const original = buscarPublicacao(db, req.params.id)
    if (!original) return res.status(404).json({ error: 'Publicação não encontrada.' })
    const agora = new Date().toISOString()
    const id = Number(db.prepare(`
      INSERT INTO publicacoes (
        titulo, edicao, organizador, lancado_em, descricao, caminho_rede,
        cor_capa, status, ultima_edicao, criado_em, atualizado_em, revisao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      `Cópia de ${original.titulo}`,
      original.edicao,
      original.organizador,
      original.lancado_em,
      original.descricao,
      original.caminho_rede,
      original.cor_capa,
      original.status,
      original.ultima_edicao ? 1 : 0,
      agora,
      agora,
    ).lastInsertRowid)
    salvarSecoes(db, id, original.secoes)
    res.status(201).json(buscarPublicacao(db, id))
  })

  app.get('/api/usuarios', (req, res) => {
    res.json(db.prepare(`
      SELECT id, nome, cor, ativo, criado_em, atualizado_em
      FROM usuarios
      WHERE ativo = 1
      ORDER BY nome COLLATE NOCASE
    `).all().map(item => ({ ...item, ativo: Boolean(item.ativo) })))
  })

  app.post('/api/usuarios', (req, res) => {
    const nome = String(req.body?.nome || '').trim()
    const cor = String(req.body?.cor || '#2563eb').trim()
    if (!nome) return res.status(400).json({ error: 'Informe o nome do usuário.' })
    const agora = new Date().toISOString()
    const usuario = {
      id: String(req.body?.id || '').trim() || crypto.randomUUID(),
      nome,
      cor,
      ativo: 1,
      criado_em: agora,
      atualizado_em: agora,
    }
    db.prepare(`
      INSERT INTO usuarios (id, nome, cor, ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(usuario.id, usuario.nome, usuario.cor, 1, agora, agora)
    res.status(201).json({ ...usuario, ativo: true })
  })

  app.put('/api/usuarios/:id', (req, res) => {
    const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id)
    if (!atual) return res.status(404).json({ error: 'Usuário não encontrado.' })
    db.prepare(`
      UPDATE usuarios SET nome = ?, cor = ?, atualizado_em = ? WHERE id = ?
    `).run(
      String(req.body?.nome || atual.nome).trim(),
      String(req.body?.cor || atual.cor),
      new Date().toISOString(),
      atual.id,
    )
    res.json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(atual.id))
  })

  app.delete('/api/usuarios/:id', (req, res) => {
    db.prepare(`
      UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?
    `).run(new Date().toISOString(), req.params.id)
    res.json({ ok: true })
  })
}

module.exports = {
  prepararEsquema,
  registrarNormandoApi,
}
