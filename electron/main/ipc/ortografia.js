import { ipcMain }               from 'electron'
import { Worker }                from 'worker_threads'
import { existsSync, readFileSync } from 'fs'
import { join, dirname }         from 'path'
import { fileURLToPath }         from 'url'

// ── Localizar dictionary-pt sem importá-lo ───────────────────────────
function encontrarDictionaryPt() {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (true) {
    const candidate = join(dir, 'node_modules', 'dictionary-pt')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('dictionary-pt não encontrado em node_modules')
    dir = parent
  }
}

// ── Worker Thread (código inline, CJS) ──────────────────────────────
//
// Implementação própria de verificação ortográfica via busca reversa de
// regras de afixo Hunspell.  Não usa nspell — cuja inicialização com o
// dicionário VERO (312k entradas, 25k regras SFX) levaria >30 segundos.
//
// Algoritmo em 2 fases:
//   1. Indexação (≈ 230 ms):
//      - Lê os stems do .dic em um Set<string>
//      - Parseia SFX/PFX do .aff indexados pelo sufixo/prefixo gerado
//   2. Verificação por palavra (< 1 ms):
//      - Se a palavra está diretamente no Set de stems → correta
//      - Senão tenta remover cada sufixo/prefixo conhecido e reconstituir
//        o stem base; se o stem resultante existe no Set e carrega o
//        flag que gera aquele sufixo/prefixo → correta
//      - Whitelist cobre lacunas genuínas do dicionário VERO
//        (contrações e formas pronominais não representadas como stems)
//
const WORKER_CODE = /* javascript */ `
const { parentPort, workerData } = require('worker_threads')

// Palavras reconhecidamente corretas mas ausentes do dicionário VERO
// (contrações, pronomes e formas que o Hunspell gera via regras que
//  não são revertíveis pela nossa busca reversa simples)
const WHITELIST = new Set([
  // contrações de+artigo e em+artigo
  'da','das','na','nas',
  // pronomes possessivos femininos de seu/seus
  'sua','suas',
  // formas nominais curtas
  'lhe','lhes','vos',
  // conjunções/advérbios comuns
  'embora','contudo','todavia','entretanto','tampouco',
  // contrações informais comuns em textos oficiais
  'num','numa','nuns','numas',
])

function buildChecker(dicContent, affContent) {
  // ── 1. Stems Set ────────────────────────────────────────────────
  const stems     = new Set()
  const stemFlags = new Map()   // stem (lower) -> flag characters string

  const dicLines = dicContent.split('\\n')
  for (let i = 1; i < dicLines.length; i++) {   // i=0 é a contagem
    const trimmed = dicLines[i].trim()
    if (!trimmed) continue
    const slash = trimmed.indexOf('/')
    const stem  = (slash >= 0 ? trimmed.slice(0, slash) : trimmed).toLowerCase()
    const flags = slash >= 0 ? trimmed.slice(slash + 1) : ''
    if (!stem) continue            // ignora linhas vazias
    stems.add(stem)
    if (flags) stemFlags.set(stem, flags)
  }

  // ── 2. Parseia SFX e PFX do .aff ───────────────────────────────
  const sfxByAdd = new Map()   // add-suffix  -> [{flag, strip}]
  const pfxByAdd = new Map()   // add-prefix  -> [{flag, strip}]

  const affLines = affContent.split('\\n')
  let i = 0
  while (i < affLines.length) {
    const line  = affLines[i].trim()
    const parts = line.split(/\\s+/).filter(Boolean)

    if ((parts[0] === 'SFX' || parts[0] === 'PFX') && parts.length >= 4) {
      const numRules = parseInt(parts[3], 10)
      if (!isNaN(numRules)) {
        const type = parts[0]
        const flag = parts[1]
        const byAdd = type === 'SFX' ? sfxByAdd : pfxByAdd

        for (let j = 1; j <= numRules && i + j < affLines.length; j++) {
          const rParts = affLines[i + j].trim().split(/\\s+/).filter(Boolean)
          if (rParts[0] === type && rParts[1] === flag && rParts.length >= 4) {
            const strip = rParts[2] === '0' ? '' : rParts[2]
            const add   = (rParts[3] === '0' ? '' : rParts[3]).split('/')[0]
            if (!byAdd.has(add)) byAdd.set(add, [])
            byAdd.get(add).push({ flag, strip })
          }
        }
        i += numRules + 1
        continue
      }
    }
    i++
  }

  // ── 3. Função de verificação ────────────────────────────────────
  function isCorrect(word) {
    const w = word.toLowerCase()

    // (a) Whitelist de lacunas do VERO
    if (WHITELIST.has(w)) return true

    // (b) Stem direto
    if (stems.has(w)) return true

    // (c) Busca reversa de sufixo: tenta remover len=1..8 chars do final
    //     Preserva ao menos 1 char de base (w.length - 1) para evitar
    //     falsos positivos com add vazio.
    const sfxMax = Math.min(w.length - 1, 8)
    for (let len = sfxMax; len >= 1; len--) {
      const add   = w.slice(-len)
      const rules = sfxByAdd.get(add)
      if (!rules) continue

      const base = w.slice(0, -len)
      for (const { flag, strip } of rules) {
        const candidate = base + strip
        if (stems.has(candidate)) {
          const f = stemFlags.get(candidate)
          if (f && f.includes(flag)) return true
        }
      }
    }

    // (d) Regras de sufixo vazio (add = '') — o stem é a palavra + strip
    //     Ex.: "faz" + strip "er" → candidato "fazer" (stem real)
    //     Ex.: "programa" + strip "r" → candidato "programar" (stem real)
    const emptySfx = sfxByAdd.get('') || []
    for (const { flag, strip } of emptySfx) {
      if (!strip) continue
      const candidate = w + strip
      if (stems.has(candidate)) {
        const f = stemFlags.get(candidate)
        if (f && f.includes(flag)) return true
      }
    }

    // (e) Busca reversa de prefixo: tenta remover len=1..6 chars do início
    const pfxMax = Math.min(w.length - 1, 6)
    for (let len = pfxMax; len >= 1; len--) {
      const add   = w.slice(0, len)
      const rules = pfxByAdd.get(add)
      if (!rules) continue

      const base = w.slice(len)
      for (const { flag, strip } of rules) {
        const candidate = strip + base
        if (stems.has(candidate)) {
          const f = stemFlags.get(candidate)
          if (f && f.includes(flag)) return true
        }
      }
    }

    return false
  }

  return { isCorrect }
}

try {
  const checker = buildChecker(workerData.dic, workerData.aff)
  parentPort.postMessage({ type: 'ready' })

  parentPort.on('message', ({ id, palavras }) => {
    const result = palavras.filter(p => !checker.isCorrect(p))
    parentPort.postMessage({ type: 'result', id, result })
  })
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message })
}
`

// ── Gerenciamento do worker ──────────────────────────────────────────
let worker          = null
let workerPromise   = null           // Promise<void> que resolve quando pronto
let reqId           = 0
const pendentes     = new Map()      // id → resolve

function iniciarWorker() {
  if (workerPromise) return workerPromise

  workerPromise = new Promise((resolve, reject) => {
    let dictDir
    try { dictDir = encontrarDictionaryPt() }
    catch (err) { workerPromise = null; reject(err); return }

    // Lê como string UTF-8 — Buffer enviado via workerData chega como
    // Uint8Array no worker; toString() num Uint8Array produz "83,69,84,..."
    // em vez do conteúdo real, corrompendo as regras Hunspell.
    const aff = readFileSync(join(dictDir, 'index.aff')).toString('utf8')
    const dic  = readFileSync(join(dictDir, 'index.dic')).toString('utf8')

    worker = new Worker(WORKER_CODE, { eval: true, workerData: { aff, dic } })

    worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        resolve()
      } else if (msg.type === 'error') {
        workerPromise = null
        reject(new Error(msg.message))
      } else if (msg.type === 'result') {
        const res = pendentes.get(msg.id)
        if (res) { res(msg.result); pendentes.delete(msg.id) }
      }
    })

    worker.on('error', (err) => { workerPromise = null; reject(err) })
    worker.on('exit',  (code) => {
      if (code !== 0) { worker = null; workerPromise = null }
    })
  })

  return workerPromise
}

function verificarNaWorker(palavras) {
  return new Promise((resolve) => {
    const id = reqId++
    pendentes.set(id, resolve)
    worker.postMessage({ id, palavras })
  })
}

// ── Handlers IPC ─────────────────────────────────────────────────────
export function registerOrtografiaHandlers() {
  // Pré-inicia o worker em background assim que o app sobe;
  // como a inicialização leva ≈ 230 ms o dicionário estará pronto
  // bem antes de o usuário clicar em "Escanear".
  iniciarWorker().catch(err =>
    console.warn('[ortografia] falha ao pré-carregar dicionário:', err.message)
  )

  ipcMain.handle('ortografia:verificar', async (_, palavras) => {
    await iniciarWorker()                  // no-op se já pronto
    return verificarNaWorker(palavras)
  })

  ipcMain.handle('ortografia:aceitar', (event, palavra) => {
    try { event.sender.session.addWordToSpellCheckerDictionary(palavra) } catch { /* sem suporte */ }
  })

  ipcMain.handle('ortografia:rejeitar', (event, palavra) => {
    try { event.sender.session.removeWordFromSpellCheckerDictionary(palavra) } catch { /* sem suporte */ }
  })
}
