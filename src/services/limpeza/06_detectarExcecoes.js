/**
 * Etapa 6 — Detecção de exceções
 * Gera a lista de problemas que o usuário precisa revisar manualmente.
 */

function nomeMarca(marca) {
  return typeof marca?.type === 'string' ? marca.type : marca?.type?.name
}

function temMarca(node, nome) {
  return (node?.marks ?? []).some(marca => nomeMarca(marca) === nome)
}

const RE_TERMO_ITALICO_OBRIGATORIO = /\b(?:Diário|[Cc]aput|DOU)\b/

function temTermoSemItalico(linha) {
  if (!linha.content?.length) {
    return RE_TERMO_ITALICO_OBRIGATORIO.test(linha.text || '')
  }

  return linha.content.some(node =>
    node?.type === 'text' &&
    RE_TERMO_ITALICO_OBRIGATORIO.test(node.text || '') &&
    !temMarca(node, 'italic') &&
    !temMarca(node, 'italicoLight')
  )
}

const PADROES = [
  {
    tipo: 'ordinal_antigo',
    descricao: 'Ordinal na grafia antiga (1o, 2a) — use 1º, 2ª',
    test: l => /\b\d+[oa]\b/.test(l.text),
    estilosExcluidos: ['assinatura-nome', 'assinatura-data', 'assinatura', 'data'],
  },
  {
    tipo: 'traco_simples_inciso',
    descricao: 'Traço simples (-) em inciso — use travessão (–)',
    test: l => l.style === 'inciso' && /^[IVXLCDM]+(?:-[A-Z])? - /.test(l.text),
  },
  {
    // Artigos 1–9 devem ter º logo após o número (ex: "Art. 5º")
    // O número é capturado com separador de milhar opcional (ex: "1.001")
    // para que artigos ≥ 1000 não disparem esta regra.
    tipo: 'artigo_sem_grau',
    descricao: 'Artigo de 1 a 9 sem símbolo de grau (º)',
    test: l => {
      if (l.style !== 'artigo') return false
      const m = l.text.match(/^Arts?\.\s+(\d+(?:\.\d{3})*)/)
      if (!m) return false
      if (parseInt(m[1].replace(/\./g, '')) > 9) return false
      // O caractere imediatamente após os dígitos deve ser º ou °
      const seg = l.text[m[0].length] ?? ''
      return !/[º°]/.test(seg)
    },
  },
  {
    // Artigos 10+ não têm º, mas devem ter ponto após o número (ex: "Art. 169. texto")
    // Arts. (plural/faixa) são ignorados pois têm formato diferente ("Arts. 10 a 15.")
    // O número é capturado com separador de milhar opcional (ex: "1.001").
    tipo: 'artigo_sem_ponto',
    descricao: 'Artigo sem ponto após o identificador',
    test: l => {
      if (l.style !== 'artigo') return false
      if (/^Arts?\./.test(l.text) && /\ba\s+\d/.test(l.text)) return false  // faixa "Arts. X a Y"
      const m = l.text.match(/^Art\.\s+(\d+(?:\.\d{3})*)/)
      if (!m) return false
      if (parseInt(m[1].replace(/\./g, '')) < 10) return false
      // O caractere imediatamente após os dígitos deve ser ponto ou hífen (sufixo "10-A")
      const seg = l.text[m[0].length] ?? ''
      return seg !== '.' && seg !== '-'
    },
  },
  {
    // Parágrafos §1–§9 devem ter º logo após o número (ex: "§ 5º")
    tipo: 'paragrafo_sem_grau',
    descricao: 'Parágrafo de § 1 a § 9 sem símbolo de grau (º)',
    test: l => {
      if (l.style !== 'paragrafo') return false
      const m = l.text.match(/^§{1,2}\s*(\d+)/)
      if (!m) return false
      if (parseInt(m[1]) > 9) return false
      const seg = l.text[m[0].length] ?? ''
      return !/[º°]/.test(seg)
    },
  },
  {
    // Parágrafos §10+ não têm º, mas devem ter ponto após o número (ex: "§ 10. texto")
    tipo: 'paragrafo_sem_ponto',
    descricao: 'Parágrafo sem ponto após o identificador (ex: § 10. texto)',
    test: l => {
      if (l.style !== 'paragrafo') return false
      const m = l.text.match(/^§{1,2}\s*(\d+)/)
      if (!m) return false
      if (parseInt(m[1]) < 10) return false
      const seg = l.text[m[0].length] ?? ''
      return seg !== '.' && seg !== '-'
    },
  },
  {
    tipo: 'alinea_sem_parentese',
    descricao: 'Possível alínea sem fechamento de parêntese',
    test: l => /^[a-z]\s+[^)]/.test(l.text) && l.style === 'texto-lei',
  },
  {
    tipo: 'parenteses_desbalanceados',
    descricao: 'Parênteses não balanceados',
    test: l => {
      // Remove o rótulo de alínea ("a) ") ou item ("1) ") antes de contar,
      // pois o ")" do rótulo não tem "(" correspondente no mesmo parágrafo.
      // A remoção é feita pelo padrão do texto (não pelo style), porque a linha
      // pode estar classificada como 'texto-lei' mesmo tendo formato de alínea.
      let texto = l.text
      if (/^[A-Za-záéíóúâêôîûàèìòùãõçÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ]+\)\s/.test(texto)) {
        texto = texto.replace(/^[A-Za-záéíóúâêôîûàèìòùãõçÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ]+\)\s*/, '')
      } else if (/^\d+\)\s/.test(texto)) {
        texto = texto.replace(/^\d+\)\s*/, '')
      }
      const a = (texto.match(/\(/g) || []).length
      const f = (texto.match(/\)/g) || []).length
      return a !== f
    },
    estilosExcluidos: ['vazio'],
  },
  {
    tipo: 'linha_nao_classificada',
    descricao: 'Linha toda em maiúsculas não reconhecida como título',
    test: l => l.style === 'texto-lei' && /^[A-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ\s\-]{15,}$/.test(l.text),
  },
  {
    // Caractere inicial inesperado — possível artefato de conversão (ex.: ¬, •, →)
    // Caracteres legítimos no início: letras (incl. acentuadas), dígitos, §, (, ", ', «, [
    // Linhas de citação são excluídas: o texto original pode iniciar com aspas
    // que já foram removidas pela rotina de citações antes desta verificação.
    tipo: 'inicio_nao_alfanumerico',
    descricao: 'Parágrafo inicia com caractere inesperado (possível artefato de conversão)',
    test: l => {
      const first = l.text[0]
      return !!first && !/[a-záéíóúâêôîûàèìòùãõçA-ZÁÉÍÓÚÂÊÔÎÛÀÈÌÒÙÃÕÇ0-9§("'«\[]/.test(first)
    },
    estilosExcluidos: ['vazio', 'citacao'],
  },
  {
    tipo: 'termo_sem_italico',
    descricao: 'Diário, Caput, caput ou DOU sem itálico',
    test: temTermoSemItalico,
  },
  {
    // Parágrafo com texto livre que não foi reconhecido como nenhuma estrutura
    // legislativa (artigo, parágrafo, inciso, alínea, item, citação etc.).
    // Indica conteúdo inserido manualmente ou erro de classificação.
    // Exceção: "Pena –" é uma cláusula penal válida em legislação criminal.
    tipo: 'estrutura_nao_identificada',
    descricao: 'Estrutura não identificada — verificar estilo da linha',
    test: l => l.style === 'texto-lei' && !/^Pena\s–/.test(l.text),
    estilosExcluidos: ['vazio'],
  },
]

export function detectarExcecoes(linhas) {
  const excecoes = []

  linhas.forEach((linha, i) => {
    if (!linha.text.trim() || linha.style === 'vazio') return

    for (const padrao of PADROES) {
      if (padrao.estilosExcluidos?.includes(linha.style)) continue
      if (padrao.test(linha)) {
        excecoes.push({
          linha: i + 1,
          tipo: padrao.tipo,
          descricao: padrao.descricao,
          texto: linha.text.slice(0, 80),
          style: linha.style,
          resolvida: false,
        })
      }
    }
  })

  return {
    excecoes,
    log: [`${excecoes.length} exceção(ões) detectada(s)`],
  }
}
