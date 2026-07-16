import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIPOS_NORMA } from '../constants/normas.js'
import logoNormando from '../logo.png'
import UsuarioAtualBadge from '../components/UsuarioAtualBadge.jsx'

const RESENHA_PLANALTO_URL = 'https://www4.planalto.gov.br/legislacao/portal-legis/resenha-diaria/julho-resenha-diaria'

const STATUS_LABELS = {
  rascunho:   { label: 'Rascunho',   cor: '#f59e0b' },
  revisao:    { label: 'Em revisão', cor: '#3b82f6' },
  finalizado: { label: 'Finalizado', cor: '#10b981' },
}

const AJUDA_TOPICOS = [
  {
    titulo: 'Como atualizar uma norma',
    itens: [
      'Abra a norma no catálogo. O editor inicia em modo de leitura para evitar alterações acidentais.',
      'Clique em Atualizar norma para abrir o painel de atualização.',
      'No painel, escolha se a nova versão virá de arquivo externo ou de uma norma já cadastrada no catálogo.',
      'Quando o texto novo estiver carregado, confira as opções de comparação antes de confirmar a substituição.',
      'Use Ignorar alterações de nota quando quiser evitar que mudanças apenas em notas sejam computadas como alteração do parágrafo.',
      'Depois da confirmação, salve a norma para gravar a versão atualizada no banco.',
    ],
    botoes: ['Atualizar norma', 'Arquivo', 'Do catálogo', 'Ignorar alterações de nota', 'Confirmar atualização', 'Salvar'],
  },
  {
    titulo: 'Como organizar uma nova publicação',
    itens: [
      'Entre em Publicações, crie uma publicação e preencha os dados principais.',
      'Crie seções, adicione normas existentes ou cadastre uma nova norma diretamente no painel de adição.',
      'Ordene as normas por arrastar e soltar e defina, em Exportação, se cada norma será ignorada, atualização ou completa.',
    ],
  },
  {
    titulo: 'Função dos botões do editor de normas',
    itens: [
      'Buscar abre o painel de localização, substituição, regex, aplicação de estilo e buscas salvas.',
      'O buscador de artigo leva direto ao dispositivo informado, por exemplo Art. 15 ou 15.',
      'Padronização abre verificações de palavras compostas, siglas, acentuação e itálicos, com navegação pelas ocorrências.',
      'Exibir caracteres ocultos alterna marcas visuais de espaços, quebras e outros caracteres de controle.',
      'Indicador de estilo mostra, ao lado da página, o estilo aplicado a cada parágrafo.',
      'Ver notas abre o navegador de notas legislativas; + Nota de rodapé insere uma nota na posição do cursor.',
      'Exportar gera saídas da norma atual; Salvar grava as alterações no banco.',
      'Zoom aumenta ou reduz a página apenas na visualização do editor.',
    ],
    botoes: ['Buscar', 'Artigo', 'Padronização', 'Exibir caracteres ocultos', 'Indicador de estilo', 'Ver notas', '+ Nota de rodapé', 'Exportar', 'Salvar', 'Zoom'],
  },
  {
    titulo: 'Como exportar uma norma',
    itens: [
      'Abra a norma no editor e use Exportar.',
      'Escolha o formato desejado, como XML, Word ou HTML, conforme o fluxo de diagramação ou revisão.',
      'Também é possível exportar apenas a seleção ativa quando houver texto selecionado no editor.',
    ],
  },
  {
    titulo: 'Como exportar uma publicação completa',
    itens: [
      'Abra a publicação, confira seções, ordem das normas e o campo Exportação de cada item.',
      'Clique em Exportar e escolha Word ou InDesign.',
      'Para InDesign, o sistema cria pastas por seção e exporta XML completo, XML de atualização ou arquivos vazios marcados como PULAR.',
      'Para Word, as normas finalizadas são exportadas completas; itens marcados como Ignorar não entram na saída.',
    ],
  },
]

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

function normaBateNaBuscaPrincipal(norma, termo) {
  if (!termo) return true
  return normalizarBusca(norma.epigrafe).includes(termo) ||
    normalizarBusca(norma.apelido).includes(termo)
}

function normaTemTagVm(norma) {
  return (norma.tags || []).some(tag => normalizarBusca(tag) === 'vm')
}

function dataCurta(valor) {
  if (!valor) return ''
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return ''
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function textoAtualizacaoNorma(norma) {
  const data = dataCurta(norma?.atualizado_em)
  if (!data) return ''
  const usuario = String(norma?.atualizado_por || '').trim()
  return usuario ? `Atualizado por ${usuario} em ${data}` : `Atualizado em ${data}`
}

function AvisoAtualizacaoPendente({ norma }) {
  if (!norma?.atualizacao_pendente) return null
  return <span className="norma-pendente-icone" title="Atualização pendente">⚠️</span>
}

function textoResenhaDeHtml(html) {
  const bruto = String(html || '')
    .replace(/<(br|\/p|\/li|\/tr|\/td|\/th|\/h[1-6]|\/div)\b[^>]*>/gi, '\n')
  const doc = new DOMParser().parseFromString(bruto, 'text/html')
  doc.querySelectorAll('script, style, noscript').forEach(el => el.remove())
  return String(doc.body?.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
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

function extrairAtosResenha(texto) {
  const linhas = String(texto || '')
    .split(/\n+/)
    .map(linha => linha.trim())
    .filter(Boolean)
  const vistos = new Set()
  const atos = []
  const re = /\b(?:Emenda Constitucional|Lei Complementar|Medida Provis[oó]ria|Decreto-Lei|Decreto|Lei)\s+(?:n[º°o]\.?\s*)?\d[\d.]*[A-Za-z-]*(?:\s*,\s*de\s*[^-–—.;\n]+)?/gi

  linhas.forEach((linha, index) => {
    for (const match of linha.matchAll(re)) {
      const referencia = match[0].replace(/\s+/g, ' ').trim()
      const chave = chaveAto(referencia)
      if (!chave.numero) continue
      const id = `${chave.tipo}:${chave.numero}:${referencia}`
      if (vistos.has(id)) continue
      vistos.add(id)
      atos.push({
        id,
        referencia,
        linha,
        linhaNumero: index + 1,
        chave,
      })
    }
  })

  return atos
}

function encontrarNormasDoAto(ato, normas) {
  return normas.filter(norma => {
    const chaveNorma = chaveAto(`${norma.tipo || ''} ${norma.epigrafe || ''}`)
    if (!chaveNorma.numero || chaveNorma.numero !== ato.chave.numero) return false
    if (ato.chave.tipo && chaveNorma.tipo && ato.chave.tipo !== chaveNorma.tipo) {
      return ato.chave.tipo === 'lei' && chaveNorma.tipo === 'lei'
    }
    return true
  })
}

function atoRegexGlobal() {
  return /\b(?:Emenda Constitucional|Lei Complementar|Medida Provis[o\u00f3]ria|Decreto-Lei|Decreto|Lei)\s+(?:n[º°o]\.?\s*)?\d[\d.]*[A-Za-z-]*(?:\s*,\s*de\s*(?:\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}\s+de\s+[^,.;()]+?\s+de\s+\d{4}))?/gi
}

function atoRegexResenha() {
  return /\b(?:Emenda Constitucional|Lei Complementar|Medida Provis[o\u00f3]ria|Decreto-Lei|Decreto|Lei)\s+(?:n[º°o]\.?\s*)?\d[\d.]*[A-Za-z-]*(?:\s*,\s*de\s*(?:\d{1,2}(?:º|\u00ba)?[./]\d{1,2}[./]\d{4}|\d{1,2}(?:º|\u00ba)?\.?\s+de\s+[^,.;()]+?\s+de\s+\d{4}))?/gi
}

function normalizarReferenciaAto(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim()
}

function tipoPluralParaSingular(valor) {
  const t = normalizarBusca(valor)
  if (t.includes('lei complementar')) return 'Lei Complementar'
  if (t.includes('decreto-lei')) return 'Decreto-Lei'
  if (t.includes('decreto')) return 'Decreto'
  return 'Lei'
}

function extrairAlvosAlteracao(trecho) {
  const alvos = []
  const vistos = new Set()
  const adicionar = (referencia, ordem = Number.MAX_SAFE_INTEGER) => {
    const texto = normalizarReferenciaAto(referencia)
    const chave = chaveAto(texto)
    if (!chave.numero) return
    const id = `${chave.tipo}:${chave.numero}`
    if (vistos.has(id)) return
    vistos.add(id)
    alvos.push({ texto, ordem })
  }

  for (const match of trecho.matchAll(atoRegexResenha())) {
    adicionar(match[0], match.index)
  }

  const pluralRe = /\b(Leis Complementares|Leis|Decretos-Leis|Decretos)\s+n[º°o]s?\.?\s+([\s\S]+?)(?=\b(?:Emenda Constitucional|Lei Complementar|Medida Provis[o\u00f3]ria|Decreto-Lei|Decreto|Lei)\s+(?:n[º°o]\.?\s*)?\d|\bpara\b|$)/gi
  for (const match of trecho.matchAll(pluralRe)) {
    const tipo = tipoPluralParaSingular(match[1])
    const lista = match[2] || ''
    const itemRe = /(\d[\d.]*[A-Za-z-]*)(?:\s*,\s*de\s*(\d{1,2}(?:º|\u00ba)?[./]\d{1,2}[./]\d{4}|\d{1,2}(?:º|\u00ba)?\.?\s+de\s+[^,.;()]+?\s+de\s+\d{4}))?/gi
    for (const item of lista.matchAll(itemRe)) {
      adicionar(`${tipo} nº ${item[1]}${item[2] ? `, de ${item[2]}` : ''}`)
    }
  }

  return alvos
    .sort((a, b) => a.ordem - b.ordem)
    .map(alvo => alvo.texto || alvo)
}

function extrairAtualizacoesResenha(texto) {
  const linhas = String(texto || '')
    .split(/\n+/)
    .map(linha => linha.trim())
    .filter(Boolean)
  const vistos = new Set()
  const atualizacoes = []

  linhas.forEach((linha, index) => {
    const partes = linha.split(/\s+[-–—]\s+/)
    const cabeca = partes[0] || linha
    const ementa = partes.slice(1).join(' - ') || linha
    const alteradora = (cabeca.match(atoRegexResenha()) || [])[0]?.replace(/\s+/g, ' ').trim() || ''
    if (!alteradora) return

    const alteraIndex = ementa.search(/\baltera\b/i)
    if (alteraIndex < 0) {
      const id = `sem-altera:${index}:${alteradora}`
      if (vistos.has(id)) return
      vistos.add(id)
      atualizacoes.push({
        id,
        alteradora,
        alvoReferencia: '',
        linha,
        linhaNumero: index + 1,
        ementa,
        semAlvo: true,
        chave: { tipo: '', numero: '' },
      })
      return
    }

    const trechoAlteracao = ementa.slice(alteraIndex)
    const alvos = extrairAlvosAlteracao(trechoAlteracao)
    if (!alvos.length) {
      const id = `sem-alvo:${index}:${alteradora}`
      if (vistos.has(id)) return
      vistos.add(id)
      atualizacoes.push({
        id,
        alteradora,
        alvoReferencia: '',
        linha,
        linhaNumero: index + 1,
        ementa,
        semAlvo: true,
        chave: { tipo: '', numero: '' },
      })
      return
    }

    alvos.forEach(alvoReferencia => {
      const chave = chaveAto(alvoReferencia)
      const id = `${chave.tipo}:${chave.numero}:${alteradora}:${alvoReferencia}`
      if (vistos.has(id)) return
      vistos.add(id)
      atualizacoes.push({
        id,
        alteradora,
        alvoReferencia,
        linha,
        linhaNumero: index + 1,
        ementa,
        semAlvo: false,
        chave,
      })
    })
  })

  return atualizacoes
}

function textoResenhaDeMensagens(mensagens) {
  return (mensagens || [])
    .map(msg => {
      const cabecalho = [
        msg.subject ? `Assunto: ${msg.subject}` : '',
        msg.date ? `Data: ${msg.date}` : '',
      ].filter(Boolean).join('\n')
      return [cabecalho, msg.texto || msg.snippet || ''].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

function metaNormaPayload(norma, usuarioAtual, extras = {}) {
  return {
    tipo: norma.tipo,
    epigrafe: norma.epigrafe,
    apelido: norma.apelido || '',
    ementa: norma.ementa || '',
    dados_publicacao: norma.dados_publicacao || '',
    data_ultima_alteracao: norma.data_ultima_alteracao || '',
    atualizacao_pendente: Boolean(norma.atualizacao_pendente),
    normas_alteradoras_pendentes: norma.normas_alteradoras_pendentes || '',
    vigencia: norma.vigencia || 'Vigente',
    link_acesso: norma.link_acesso || '',
    anexo: norma.anexo || '',
    observacoes: norma.observacoes || '',
    caminho_rede: norma.caminho_rede || '',
    atualizado_por: usuarioAtual?.nome || usuarioAtual?.name || usuarioAtual || norma.atualizado_por || '',
    tags: norma.tags || [],
    revisao: norma.revisao,
    ...extras,
  }
}

function lerAlteradorasPendentes(valor) {
  if (!valor) return []
  try {
    const parsed = JSON.parse(valor)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return String(valor || '')
      .split(/\n+/)
      .map(texto => ({ texto: texto.trim(), href: '', data: '' }))
      .filter(item => item.texto)
  }
}

function serializarAlteradorasPendentes(lista) {
  if (!lista?.length) return ''
  return JSON.stringify(lista.map(item => ({
    texto: item.texto || '',
    href: item.href || '',
    data: item.data || '',
  })))
}

function dataNormaIso(valor) {
  const texto = String(valor || '').trim()
  if (!texto) return ''
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const data = new Date(texto)
  if (Number.isNaN(data.getTime())) return ''
  return data.toISOString().slice(0, 10)
}

function alteradoraPendente(item, dataUltimaAlteracao) {
  const dataAlteradora = dataNormaIso(item?.data)
  const dataBase = dataNormaIso(dataUltimaAlteracao)
  if (!dataAlteradora) return true
  if (!dataBase) return false
  return dataAlteradora > dataBase
}

export default function Home({ usuarioAtual, onTrocarUsuario }) {
  const nav = useNavigate()
  const [normas,  setNormas]  = useState([])
  const [busca,   setBusca]   = useState('')
  const [tipo,    setTipo]    = useState('')
  const [status,  setStatus]  = useState('')
  const [tagFiltro, setTagFiltro] = useState('')
  const [publicacaoFiltro, setPublicacaoFiltro] = useState('')
  const [todasTags, setTodasTags] = useState([])
  const [publicacoes, setPublicacoes] = useState([])
  const [buscarConteudo, setBuscarConteudo] = useState(false)
  const [somenteVm, setSomenteVm] = useState(false)
  const [visao,   setVisao]   = useState('cards')
  const [loading, setLoading] = useState(true)
  const [ajudaAberta, setAjudaAberta] = useState(false)
  const [resenhaAberta, setResenhaAberta] = useState(false)
  const [resenhaUrl, setResenhaUrl] = useState(RESENHA_PLANALTO_URL)
  const [resenhaTexto, setResenhaTexto] = useState('')
  const [resenhaResultados, setResenhaResultados] = useState([])
  const [resenhaStatus, setResenhaStatus] = useState('')
  const [resenhaLoading, setResenhaLoading] = useState(false)

  useEffect(() => {
    try {
      if (document.activeElement?.isContentEditable) document.activeElement.blur()
      window.getSelection()?.removeAllRanges()
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    window.legislator.normas.listar({ busca, tipo, status, buscarConteudo, publicacaoId: publicacaoFiltro })
      .then(setNormas)
      .finally(() => setLoading(false))
  }, [busca, tipo, status, buscarConteudo, publicacaoFiltro])

  useEffect(() => {
    Promise.all([
      window.legislator.normas.tags().catch(() => []),
      window.legislator.publicacoes.listar().catch(() => []),
    ]).then(([tags, pubs]) => {
      setTodasTags(Array.isArray(tags) ? tags : [])
      setPublicacoes(Array.isArray(pubs) ? pubs : [])
    })
  }, [])

  async function excluir(e, id) {
    e.stopPropagation()
    if (!confirm('Excluir esta norma?')) return
    await window.legislator.normas.excluir(id)
    setNormas(prev => prev.filter(n => n.id !== id))
  }

  async function duplicar(e, id) {
    e.stopPropagation()
    try {
      const origem = await window.legislator.normas.buscar(id)
      if (!origem) {
        alert('Nao foi possivel localizar a norma de origem.')
        return
      }
      nav('/nova', { state: { duplicarNorma: origem } })
    } catch (err) {
      alert(String(err?.message || err))
    }
  }

  async function confirmarResultadosCamara(resultados) {
    const confirmados = []
    for (const item of resultados) {
      const normasConfirmadas = []
      for (const norma of item.normas) {
        if (!norma.link_acesso) {
          normasConfirmadas.push({ ...norma, confirmacaoCamara: { status: 'sem-link' } })
          continue
        }
        try {
          const confirmacao = await window.legislator.resenha.confirmarCamara({
            url: norma.link_acesso,
            alteradora: item.alteradora,
          })
          normasConfirmadas.push({
            ...norma,
            confirmacaoCamara: {
              status: confirmacao.encontrado ? 'confirmada' : 'nao-confirmada',
              ...confirmacao,
            },
          })
        } catch (err) {
          normasConfirmadas.push({
            ...norma,
            confirmacaoCamara: {
              status: 'erro',
              erro: err?.message || 'Falha ao consultar a Camara.',
            },
          })
        }
      }
      confirmados.push({ ...item, normas: normasConfirmadas })
    }
    return confirmados
  }

  async function processarTextoResenha(texto) {
    const textoLimpo = String(texto || '').trim()
    if (!textoLimpo) {
      setResenhaStatus('Cole ou carregue o texto da resenha antes de processar.')
      setResenhaResultados([])
      return
    }
    setResenhaLoading(true)
    setResenhaStatus('Processando resenha...')
    try {
      const catalogo = await window.legislator.normas.listar({})
      const atualizacoes = extrairAtualizacoesResenha(textoLimpo)
      let resultados = atualizacoes.map(ato => ({
        ...ato,
        normas: encontrarNormasDoAto(ato, catalogo),
      }))
      setResenhaResultados(resultados)
      const comAlvo = resultados.filter(r => r.alvoReferencia).length
      const comCatalogo = resultados.filter(r => r.normas.length).length
      setResenhaStatus(`${atualizacoes.length} aviso(s) encontrado(s). ${comAlvo} com norma alterada identificada. ${comCatalogo} com correspondencia no catalogo. Confirmando na Camara...`)
      resultados = await confirmarResultadosCamara(resultados)
      setResenhaResultados(resultados)
      const confirmadas = resultados.reduce((total, item) => (
        total + item.normas.filter(n => n.confirmacaoCamara?.status === 'confirmada').length
      ), 0)
      setResenhaStatus(`${atualizacoes.length} aviso(s) encontrado(s). ${comAlvo} com norma alterada identificada. ${comCatalogo} com correspondencia no catalogo. ${confirmadas} confirmada(s) em Vide Norma(s) da Camara.`)
    } catch (err) {
      setResenhaStatus(err?.message || 'Nao foi possivel processar a resenha.')
    } finally {
      setResenhaLoading(false)
    }
  }

  async function buscarResenhaPlanalto() {
    setResenhaLoading(true)
    setResenhaStatus('Buscando resenha no Planalto...')
    try {
      const resultado = await window.legislator.resenha.buscar(resenhaUrl)
      const texto = textoResenhaDeHtml(resultado.html)
      setResenhaTexto(texto)
      await processarTextoResenha(texto)
    } catch (err) {
      setResenhaStatus(`${err?.message || 'Nao foi possivel acessar o Planalto.'} Cole o texto da pagina no campo abaixo e clique em Processar texto colado.`)
    } finally {
      setResenhaLoading(false)
    }
  }

  async function buscarResenhaGmail() {
    setResenhaLoading(true)
    setResenhaStatus('Buscando mensagens no Gmail...')
    try {
      const resultado = await window.legislator.resenha.gmail({ maxResults: 20 })
      const texto = textoResenhaDeMensagens(resultado.mensagens)
      setResenhaTexto(texto)
      await processarTextoResenha(texto)
      setResenhaStatus(prev => `${prev} Gmail: ${resultado.mensagens.length} mensagem(ns), consulta "${resultado.query}".`)
    } catch (err) {
      setResenhaStatus(err?.message || 'Nao foi possivel buscar mensagens no Gmail.')
    } finally {
      setResenhaLoading(false)
    }
  }

  async function checarAtualizacoesCamara() {
    setResenhaLoading(true)
    setResenhaResultados([])
    setResenhaStatus('Checando links das normas na Camara...')
    try {
      const catalogo = await window.legislator.normas.listar({})
      const normasComLink = catalogo.filter(norma => String(norma.link_acesso || '').trim())
      if (!normasComLink.length) {
        setResenhaStatus('Nenhuma norma com Link para acesso preenchido.')
        return
      }

      const resultados = []
      let atualizadas = 0
      let semData = 0
      for (let i = 0; i < normasComLink.length; i += 1) {
        const norma = normasComLink[i]
        setResenhaStatus(`Checando ${i + 1}/${normasComLink.length}: ${norma.epigrafe}`)
        let completa = norma
        try {
          completa = await window.legislator.normas.buscar(norma.id)
          if (!dataNormaIso(completa.data_ultima_alteracao)) {
            semData += 1
            continue
          }
          const resposta = await window.legislator.resenha.videNormas(completa.link_acesso)
          const pendentes = (resposta.videNormas || [])
            .filter(item => alteradoraPendente(item, completa.data_ultima_alteracao))
          const pendentesAnteriores = lerAlteradorasPendentes(completa.normas_alteradoras_pendentes)
          const novoTexto = serializarAlteradorasPendentes(pendentes)
          const pendenteGeral = pendentes.length
            ? true
            : (pendentesAnteriores.length ? false : Boolean(completa.atualizacao_pendente))
          const textoAnterior = completa.normas_alteradoras_pendentes || ''

          if (novoTexto !== textoAnterior || Boolean(completa.atualizacao_pendente) !== pendenteGeral) {
            const payloadMeta = metaNormaPayload(completa, usuarioAtual, {
              atualizacao_pendente: pendenteGeral,
              normas_alteradoras_pendentes: novoTexto,
            })
            const atualizada = await window.legislator.normas.atualizarMeta(
              completa.id,
              payloadMeta,
            )
            atualizadas += 1
            completa = {
              ...payloadMeta,
              ...atualizada,
              tags: atualizada.tags ?? payloadMeta.tags,
              normas_alteradoras_pendentes: payloadMeta.normas_alteradoras_pendentes,
              atualizacao_pendente: payloadMeta.atualizacao_pendente,
            }
            setNormas(prev => prev.map(n => n.id === completa.id ? { ...n, ...completa } : n))
          }

          if (pendentes.length) {
            resultados.push({
              id: `camara-${completa.id}`,
              tipoResultado: 'checagem-camara',
              alvoReferencia: completa.epigrafe,
              alteradora: `${pendentes.length} norma(s) alteradora(s) pendente(s)`,
              linha: completa.link_acesso,
              linhaNumero: i + 1,
              normas: [{ ...completa, pendentes }],
            })
          }
        } catch (err) {
          resultados.push({
            id: `camara-erro-${norma.id}`,
            tipoResultado: 'checagem-camara',
            alvoReferencia: norma.epigrafe,
            alteradora: 'Falha ao consultar Link para acesso',
            linha: err?.message || 'Falha ao consultar a Camara.',
            linhaNumero: i + 1,
            normas: [{ ...norma, pendentes: [], confirmacaoCamara: { status: 'erro', erro: err?.message } }],
          })
        }
      }

      setResenhaResultados(resultados)
      const pendentes = resultados.reduce((total, item) => (
        total + (item.normas?.[0]?.pendentes?.length || 0)
      ), 0)
      setResenhaStatus(`${normasComLink.length} norma(s) com link analisada(s). ${semData} sem Data da última alteração foram ignorada(s). ${pendentes} pendência(s) encontrada(s). ${atualizadas} registro(s) atualizado(s).`)
    } catch (err) {
      setResenhaStatus(err?.message || 'Nao foi possivel checar atualizacoes.')
    } finally {
      setResenhaLoading(false)
    }
  }

  async function marcarPendentePorResenha(normaId) {
    try {
      const completa = await window.legislator.normas.buscar(normaId)
      const atualizada = await window.legislator.normas.atualizarMeta(
        normaId,
        metaNormaPayload(completa, usuarioAtual, { atualizacao_pendente: true }),
      )
      setNormas(prev => prev.map(n => n.id === normaId ? { ...n, ...atualizada, atualizacao_pendente: 1 } : n))
      setResenhaResultados(prev => prev.map(item => ({
        ...item,
        normas: item.normas.map(n => n.id === normaId ? { ...n, atualizacao_pendente: 1 } : n),
      })))
      setResenhaStatus('Norma marcada como Atualizacao pendente.')
    } catch (err) {
      alert(err?.message || 'Nao foi possivel marcar a norma como pendente.')
    }
  }

  const termoBuscaPrincipal = normalizarBusca(busca)
  const tagsDisponiveis = useMemo(() => {
    const mapa = new Map()
    todasTags.forEach(tag => {
      const nome = String(tag || '').trim()
      if (nome) mapa.set(normalizarBusca(nome), nome)
    })
    normas.forEach(norma => {
      const tagsNorma = norma.tags || []
      tagsNorma.forEach(tag => {
        const nome = String(tag || '').trim()
        if (nome) mapa.set(normalizarBusca(nome), nome)
      })
    })
    return Array.from(mapa.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [normas, todasTags])
  const normasFiltradasPorBusca = buscarConteudo
    ? normas
    : normas.filter(n => normaBateNaBuscaPrincipal(n, termoBuscaPrincipal))
  const tagFiltroNormalizada = normalizarBusca(tagFiltro)
  const normasFiltradasPorTag = tagFiltro
    ? normasFiltradasPorBusca.filter(n => (n.tags || []).some(tag => normalizarBusca(tag) === tagFiltroNormalizada))
    : normasFiltradasPorBusca
  const normasVisiveis = somenteVm
    ? normasFiltradasPorTag.filter(normaTemTagVm)
    : normasFiltradasPorTag

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-brand">
          <img className="home-logo-img" src={logoNormando} alt="" />
          <h1 className="home-logo">Normando</h1>
        </div>
        <div className="home-header-actions">
          <button className="btn-ghost" onClick={() => setAjudaAberta(true)}>
            Ajuda
          </button>
          <button className="btn-ghost" onClick={() => setResenhaAberta(true)}>
            Checar atualizações
          </button>
          <button className="btn-ghost" onClick={() => nav('/configuracoes')} title="Preferências do aplicativo">
            Configurações
          </button>
          <button className="btn-ghost" onClick={() => nav('/publicacoes')}>
            📚 Publicações
          </button>
          <button className="btn-primary" onClick={() => nav('/nova')}>
            + Nova norma
          </button>
          <UsuarioAtualBadge usuario={usuarioAtual} onTrocar={onTrocarUsuario} />
        </div>
      </header>

      <div className="home-filtros">
        <input
          className="input-busca"
          placeholder={buscarConteudo ? 'Buscar por epígrafe, apelido ou conteúdo…' : 'Buscar por epígrafe ou apelido…'}
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onMouseDown={e => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.focus({ preventScroll: true })
            }
          }}
        />
        <label className="home-check">
          <input
            type="checkbox"
            checked={buscarConteudo}
            onChange={e => setBuscarConteudo(e.target.checked)}
          />
          <span>Buscar no conteúdo</span>
        </label>
        <label className={`home-check home-check-vm${somenteVm ? ' ativo' : ''}`}>
          <input
            type="checkbox"
            checked={somenteVm}
            onChange={e => setSomenteVm(e.target.checked)}
          />
          <span>Vade mecum</span>
        </label>
        <select value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {TIPOS_NORMA.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="rascunho">Rascunho</option>
          <option value="revisao">Em revisão</option>
          <option value="finalizado">Finalizado</option>
        </select>
        <select className="home-tag-select" value={tagFiltro} onChange={e => setTagFiltro(e.target.value)}>
          <option value="">Todas as tags</option>
          {tagsDisponiveis.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <select
          className="home-publicacao-select"
          value={publicacaoFiltro}
          onChange={e => setPublicacaoFiltro(e.target.value)}
          title="Filtrar normas por publicação"
        >
          <option value="">Todas as publicações</option>
          {publicacoes.map(pub => (
            <option key={pub.id} value={pub.id}>
              {pub.titulo || `Publicação ${pub.id}`}
              {pub.edicao ? ` — ${pub.edicao}` : ''}
            </option>
          ))}
        </select>
        <div className="view-toggle" aria-label="Visualização">
          <button
            type="button"
            className={visao === 'cards' ? 'ativo' : ''}
            onClick={() => setVisao('cards')}
            title="Visualizar como cards"
          >
            Cards
          </button>
          <button
            type="button"
            className={visao === 'lista' ? 'ativo' : ''}
            onClick={() => setVisao('lista')}
            title="Visualizar como lista"
          >
            Lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="home-loading">Carregando…</p>
      ) : normasVisiveis.length === 0 ? (
        <div className="home-vazio">
          <p>Nenhuma norma encontrada.</p>
          <button className="btn-primary" onClick={() => nav('/nova')}>Cadastrar primeira norma</button>
        </div>
      ) : visao === 'cards' ? (
        <div className="normas-grid">
          {normasVisiveis.map(n => {
            const st = STATUS_LABELS[n.status] ?? STATUS_LABELS.rascunho
            return (
              <div key={n.id} className="norma-card" onClick={() => nav(`/editor/${n.id}`)}>
                <div className="norma-card-top">
                  <span className="norma-tipo">{n.tipo}</span>
                  <span className="norma-status" style={{ color: st.cor }}>{st.label}</span>
                </div>
                <div className="norma-epigrafe"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</div>
                {n.apelido && <div className="norma-apelido">{n.apelido}</div>}
                {n.ementa  && <div className="norma-ementa">{n.ementa}</div>}
                {n.tags?.length > 0 && (
                  <div className="norma-tags">
                    {n.tags.map(t => <span key={t} className="norma-tag">{t}</span>)}
                  </div>
                )}
                <div className="norma-card-footer">
                  <span className="norma-data">
                    {textoAtualizacaoNorma(n)}
                  </span>
                  <div className="norma-card-acoes">
                    <button className="btn-ghost btn-sm" onClick={e => duplicar(e, n.id)} title="Duplicar norma">
                      Duplicar
                    </button>
                    <button className="btn-ghost btn-sm" onClick={e => excluir(e, n.id)}>
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Epígrafe</th>
                <th>Apelido</th>
                <th>Status</th>
                <th>Link para acesso</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {normasVisiveis.map(n => {
                const st = STATUS_LABELS[n.status] ?? STATUS_LABELS.rascunho
                return (
                  <tr key={n.id} onClick={() => nav(`/editor/${n.id}`)}>
                    <td className="catalog-table-type">{n.tipo}</td>
                    <td className="catalog-table-title"><AvisoAtualizacaoPendente norma={n} />{n.epigrafe}</td>
                    <td>{n.apelido || <span className="catalog-table-muted">-</span>}</td>
                    <td>
                      <span className="catalog-table-status" style={{ color: st.cor }}>
                        {st.label}
                      </span>
                    </td>
                    <td>
                      {n.link_acesso ? (
                        <a
                          className="catalog-table-link"
                          href={n.link_acesso}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          title={n.link_acesso}
                        >
                          Abrir
                        </a>
                      ) : (
                        <span className="catalog-table-muted">-</span>
                      )}
                    </td>
                    <td className="catalog-table-actions">
                      <button className="btn-ghost btn-sm" onClick={e => duplicar(e, n.id)} title="Duplicar norma">
                        Duplicar
                      </button>
                      <button className="btn-ghost btn-sm" onClick={e => excluir(e, n.id)} title="Excluir norma">
                        Excluir
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {ajudaAberta && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAjudaAberta(false) }}>
          <div className="modal-box ajuda-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ajuda do Normando</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setAjudaAberta(false)}>×</button>
            </div>
            <div className="ajuda-conteudo">
              {AJUDA_TOPICOS.map(topico => (
                <section key={topico.titulo} className="ajuda-topico">
                  <h4>{topico.titulo}</h4>
                  {topico.botoes && (
                    <div className="ajuda-botoes" aria-label={`Botões relacionados a ${topico.titulo}`}>
                      {topico.botoes.map(botao => <span key={botao} className="ajuda-botao">{botao}</span>)}
                    </div>
                  )}
                  <ul>
                    {topico.itens.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {resenhaAberta && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setResenhaAberta(false) }}>
          <div className="modal-box resenha-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Checar atualizações</h3>
              <button className="btn-ghost modal-fechar" onClick={() => setResenhaAberta(false)}>×</button>
            </div>

            <div className="resenha-form">
              <div className="resenha-actions">
                <button className="btn-primary" onClick={checarAtualizacoesCamara} disabled={resenhaLoading}>
                  Checar atualizações
                </button>
                <button className="btn-ghost" onClick={() => processarTextoResenha(resenhaTexto)} disabled={resenhaLoading}>
                  Analisar texto carregado
                </button>
              </div>
              <textarea
                rows={8}
                value={resenhaTexto}
                onChange={e => setResenhaTexto(e.target.value)}
                placeholder="As mensagens encontradas no Gmail aparecem aqui para conferencia. Tambem e possivel colar um texto de teste."
              />
              {resenhaStatus && <p className="resenha-status">{resenhaStatus}</p>}
            </div>

            <div className="resenha-resultados">
              {resenhaResultados.map(item => (
                <div key={item.id} className={`resenha-item${item.normas.length ? '' : ' sem-correspondencia'}`}>
                  <div className="resenha-item-head">
                    <strong>{item.alvoReferencia ? `Norma alterada: ${item.alvoReferencia}` : 'Sem norma alterada identificada'}</strong>
                    <span>Linha {item.linhaNumero}</span>
                  </div>
                  <div className="resenha-alteradora">Norma alteradora: {item.alteradora}</div>
                  <p>{item.linha}</p>
                  {item.normas.length ? (
                    <div className="resenha-matches">
                      {item.normas.map(norma => (
                        <div key={norma.id} className="resenha-match">
                          <span>
                            <AvisoAtualizacaoPendente norma={norma} />
                            {norma.epigrafe}
                            {norma.apelido ? ` (${norma.apelido})` : ''}
                            {norma.confirmacaoCamara && (
                              <span className={`resenha-confirmacao ${norma.confirmacaoCamara.status}`}>
                                {norma.confirmacaoCamara.status === 'confirmada'
                                  ? 'Confirmada pela Camara'
                                  : norma.confirmacaoCamara.status === 'nao-confirmada'
                                    ? 'Nao confirmada em Vide Norma(s)'
                                    : norma.confirmacaoCamara.status === 'sem-link'
                                      ? 'Sem link da Camara'
                                      : 'Falha ao consultar Camara'}
                              </span>
                            )}
                          </span>
                          {item.tipoResultado === 'checagem-camara' && norma.pendentes?.length ? (
                            <div className="resenha-pendentes">
                              {norma.pendentes.map(pendente => (
                                <a
                                  key={`${pendente.href || pendente.texto}-${pendente.data || ''}`}
                                  href={pendente.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {pendente.texto}
                                </a>
                              ))}
                            </div>
                          ) : null}
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => marcarPendentePorResenha(norma.id)}
                            disabled={Boolean(norma.atualizacao_pendente)}
                          >
                            {norma.atualizacao_pendente ? 'Ja pendente' : 'Marcar pendente'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="resenha-sem-match">
                      {item.semAlvo
                        ? 'Aviso sem ementa de alteracao reconhecida.'
                        : 'Norma alterada nao encontrada no catalogo.'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
