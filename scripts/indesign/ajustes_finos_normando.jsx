// ajustes_finos_normando.jsx — ajuste fino de linhas abertas, como o diagramador (e como o PDF do Normando)
//
// Para cada parágrafo justificado, mede o espaço entre palavras de cada linha (pela posição dos
// caracteres: largura média dos espaços da linha ÷ largura do espaço na última linha do parágrafo,
// que não é justificada). Linha acima de ABERTA (170%): tenta apertar o parágrafo com os mesmos
// passos do PDF (tracking -3 a -12, espaço entre palavras 97%). Só aceita um passo que mantém o
// número de linhas do parágrafo (a paginação não muda) e que resolve a linha ou melhora pelo menos
// MELHORA_MINIMA. Parágrafo alterado ganha a condição "Normando - ajuste fino".
//
// Relatório: <documento>_ajustes-finos.txt ao lado do documento (ou na Área de trabalho), com o tempo.
// Tudo fica num passo só de Desfazer.
//
// ExtendScript (ECMAScript 3): todas as instruções terminam com ";" (o ExtendScript não aceita
// "continue" ou "return" seguidos de quebra de linha sem ";").

#target indesign

var ABERTA = 1.70;
var MELHORA_MINIMA = 0.10;
// [tracking (milésimos de em), espaço entre palavras desejado (%)] — os mesmos AJUSTES do PDF
var PASSOS = [[-3, 100], [-5, 100], [-5, 97], [-8, 97], [-10, 97], [-12, 97]];
var NOME_CONDICAO = "Normando - ajuste fino";
// true: só mede e relata (nenhuma alteração), para comparar o tempo
var SOMENTE_MEDIR = false;

// quebras de parágrafo e de linha forçada (U+2028), para o começo do parágrafo no relatório
var QUEBRAS = new RegExp("[\\r\\n" + String.fromCharCode(0x2028) + "]+", "g");

main();

function main() {
  if (!app.documents.length) { alert("Abra um documento."); return; }
  var doc = app.activeDocument;
  var stories = escolherStories(doc);
  if (!stories) { return; }
  var unidade = app.scriptPreferences.measurementUnit;
  var redesenho = app.scriptPreferences.enableRedraw;
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  app.scriptPreferences.enableRedraw = false;
  var rel = null;
  try {
    app.doScript(function () { rel = executar(doc, stories); }, ScriptLanguage.JAVASCRIPT, undefined,
      UndoModes.ENTIRE_SCRIPT, "Normando - ajustes finos");
  } finally {
    app.scriptPreferences.measurementUnit = unidade;
    app.scriptPreferences.enableRedraw = redesenho;
  }
  if (!rel) { return; }
  var texto = relatorio(doc, rel);
  var arq = salvar(doc, texto);
  alert(resumo(rel) + "\n\nRelatório: " + arq.fsName);
}

// documento inteiro, ou só a história do cursor/seleção
function escolherStories(doc) {
  var sel = app.selection.length ? app.selection[0] : null;
  var story = null;
  try { if (sel && sel.parentStory && sel.parentStory.isValid) { story = sel.parentStory; } } catch (e) {}
  if (story && !confirm("Processar o documento inteiro?\n\nSim: todas as histórias\nNão: só a história selecionada")) { return [story]; }
  var out = [];
  for (var i = 0; i < doc.stories.length; i++) { out.push(doc.stories[i]); }
  return out;
}

function executar(doc, stories) {
  var t0 = new Date().getTime();
  var cond = SOMENTE_MEDIR ? null : condicao(doc);
  var r = {
    paragrafos: 0, justificados: 0, linhas: 0, abertas: 0, parsAbertos: 0,
    alterados: [], semSolucao: [], pulados: { overset: 0, semReferencia: 0 },
    msMedir: 0, msAjustar: 0, msTotal: 0
  };
  // largura do espaço "normal" por estilo/corpo/tracking/espaço, para parágrafos sem última linha útil
  var referencias = {};
  for (var s = 0; s < stories.length; s++) {
    var story = stories[s];
    if (!story.textContainers.length) { continue; }
    var pars = story.paragraphs;
    var n = pars.length;
    if (!n) { continue; }
    r.paragrafos += n;
    var just = lista(pars.everyItem().justification);
    for (var i = 0; i < n; i++) {
      if (!justificado(just[i])) { continue; }
      var p = pars[i];
      r.justificados++;
      var ta = new Date().getTime();
      var m = medir(p, null, referencias);
      r.msMedir += new Date().getTime() - ta;
      if (!m) { continue; }
      if (m.pulado) { r.pulados[m.pulado]++; continue; }
      r.linhas += m.linhas;
      r.abertas += m.quais.length;
      if (m.pior <= ABERTA) { continue; }
      r.parsAbertos++;
      if (SOMENTE_MEDIR) { r.semSolucao.push(item(p, m, null, "só medição")); continue; }
      var tb = new Date().getTime();
      var res = ajustar(p, m, referencias);
      r.msAjustar += new Date().getTime() - tb;
      if (res.passo) {
        p.applyConditions([cond], false);
        r.alterados.push(item(p, m, res, null));
      } else {
        r.semSolucao.push(item(p, m, res, res.motivo));
      }
    }
  }
  r.msTotal = new Date().getTime() - t0;
  return r;
}

// ── medição ──────────────────────────────────────────────────────

// everyItem() de uma coleção com um item só pode não vir como array
function lista(v) { return (v instanceof Array) ? v : [v]; }

function justificado(j) {
  return j === Justification.LEFT_JUSTIFIED || j === Justification.CENTER_JUSTIFIED || j === Justification.RIGHT_JUSTIFIED;
}

// chave da referência do espaço normal (parágrafos de mesmo estilo, corpo, tracking e espaço)
function chaveReferencia(p) {
  return p.appliedParagraphStyle.name + "|" + p.pointSize + "|" + p.tracking + "|" + p.desiredWordSpacing;
}

/**
 * Espaço entre palavras de cada linha do parágrafo, em relação ao espaço normal.
 * natural: largura do espaço normal (null = medir na última linha, que não é justificada).
 * Retorna { pior, quais: [linhas acima de ABERTA], linhas, natural } ou { pulado } ou null.
 */
function medir(p, natural, referencias) {
  var nl = p.lines.length;
  if (nl < 2) { return null; }
  var offs, conts, inicios;
  try {
    offs = lista(p.characters.everyItem().horizontalOffset);
    conts = lista(p.characters.everyItem().contents);
    inicios = lista(p.lines.everyItem().index);
  } catch (e) { return { pulado: "overset" }; }
  var base = p.index;
  var medias = [];
  for (var L = 0; L < nl; L++) {
    var a = inicios[L] - base;
    var b = (L + 1 < nl) ? inicios[L + 1] - base : conts.length;
    // espaços dentro da linha (o último caractere da linha fica de fora: o espaço da quebra)
    var soma = 0, qtd = 0;
    for (var j = a; j < b - 1; j++) {
      if (conts[j] !== " ") { continue; }
      soma += offs[j + 1] - offs[j];
      qtd++;
    }
    medias.push({ media: qtd ? soma / qtd : 0, qtd: qtd });
  }
  if (natural == null) {
    var ult = medias[nl - 1];
    var chave = chaveReferencia(p);
    if (ult.qtd >= 1) { natural = ult.media; referencias[chave] = natural; }
    else if (referencias[chave]) { natural = referencias[chave]; }
    else { return { pulado: "semReferencia" }; }
  }
  var pior = 0, quais = [];
  // a última linha não é justificada: fica de fora
  for (var k = 0; k < nl - 1; k++) {
    if (medias[k].qtd < 2) { continue; }
    var razao = medias[k].media / natural;
    if (razao > pior) { pior = razao; }
    if (razao > ABERTA) { quais.push(k); }
  }
  return { pior: pior, quais: quais, linhas: nl, natural: natural };
}

// ── ajuste ───────────────────────────────────────────────────────

function aplicar(p, tr, ws, min) {
  if (ws < p.minimumWordSpacing) { p.minimumWordSpacing = min; p.desiredWordSpacing = ws; }
  else { p.desiredWordSpacing = ws; p.minimumWordSpacing = min; }
  p.tracking = tr;
}

function ajustar(p, m, referencias) {
  var trackings = lista(p.textStyleRanges.everyItem().tracking);
  for (var t = 1; t < trackings.length; t++) {
    if (trackings[t] !== trackings[0]) { return { motivo: "tracking misto no parágrafo (ajuste manual): não mexido" }; }
  }
  var orig = { tr: trackings[0], ws: p.desiredWordSpacing, min: p.minimumWordSpacing };
  var melhor = null, tentados = 0;
  for (var k = 0; k < PASSOS.length; k++) {
    var tr = PASSOS[k][0];
    var ws = Math.min(orig.ws, PASSOS[k][1]);
    // só apertar
    if (tr >= orig.tr && ws >= orig.ws) { continue; }
    tr = Math.min(tr, orig.tr);
    tentados++;
    aplicar(p, tr, ws, Math.min(orig.min, ws));
    var m2 = medir(p, m.natural, referencias);
    if (!m2 || m2.pulado || m2.linhas !== m.linhas) { continue; }
    if (!melhor || m2.pior < melhor.pior) { melhor = { pior: m2.pior, tr: tr, ws: ws }; }
    if (m2.pior <= ABERTA) { break; }
  }
  if (melhor && (melhor.pior <= ABERTA || melhor.pior <= m.pior - MELHORA_MINIMA)) {
    aplicar(p, melhor.tr, melhor.ws, Math.min(orig.min, melhor.ws));
    return { passo: melhor, orig: orig };
  }
  aplicar(p, orig.tr, orig.ws, orig.min);
  if (!tentados) { return { motivo: "já estava no aperto máximo (tracking " + orig.tr + ", espaço " + orig.ws + "%)" }; }
  return { motivo: melhor ? "melhor aperto ficou em " + pct(melhor.pior) : "todo aperto mudava o número de linhas" };
}

// ── relatório ────────────────────────────────────────────────────

function pct(r) { return Math.round(r * 100) + "%"; }

function pagina(p) {
  try {
    var f = p.parentTextFrames;
    if (f.length && f[0].parentPage) { return f[0].parentPage.name; }
  } catch (e) {}
  return "?";
}

function item(p, m, res, motivo) {
  var t = String(p.contents).replace(QUEBRAS, " ");
  return {
    pagina: pagina(p), inicio: t.length > 70 ? t.substr(0, 70) + "…" : t,
    antes: m.pior, depois: (res && res.passo) ? res.passo.pior : null,
    passo: (res && res.passo) ? "tracking " + res.orig.tr + " → " + res.passo.tr + ", espaço " + res.orig.ws + "% → " + res.passo.ws + "%" : null,
    motivo: motivo
  };
}

function seg(ms) { return (ms / 1000).toFixed(1) + " s"; }

function resumo(r) {
  return "Ajustes finos" + (SOMENTE_MEDIR ? " (só medição)" : "") + "\n\n" +
    "Tempo total: " + seg(r.msTotal) + " (medição " + seg(r.msMedir) + ", ajustes " + seg(r.msAjustar) + ")\n" +
    "Parágrafos: " + r.paragrafos + " (" + r.justificados + " justificados, " + r.linhas + " linhas medidas)\n" +
    "Parágrafos com linha acima de " + pct(ABERTA) + ": " + r.parsAbertos + "\n" +
    "Alterados: " + r.alterados.length + "\n" +
    "Sem solução: " + r.semSolucao.length + "\n" +
    "Pulados: " + r.pulados.overset + " com texto excedente, " + r.pulados.semReferencia + " sem referência de espaço";
}

function relatorio(doc, r) {
  var l = [resumo(r), "", "Documento: " + doc.name, "Data: " + new Date().toString(), ""];
  l.push("******** ALTERADOS (" + r.alterados.length + ") — condição \"" + NOME_CONDICAO + "\" ********");
  for (var i = 0; i < r.alterados.length; i++) {
    var a = r.alterados[i];
    l.push("p. " + a.pagina + " — " + pct(a.antes) + " → " + pct(a.depois) + " — " + a.passo + " — " + a.inicio);
  }
  l.push("", "******** SEM SOLUÇÃO (" + r.semSolucao.length + ") ********");
  for (var j = 0; j < r.semSolucao.length; j++) {
    var b = r.semSolucao[j];
    l.push("p. " + b.pagina + " — " + pct(b.antes) + " — " + b.motivo + " — " + b.inicio);
  }
  return l.join("\n");
}

function salvar(doc, texto) {
  var pasta = Folder.desktop, nome = doc.name.replace(/\.indd$/i, "");
  try { if (doc.saved) { pasta = doc.filePath; } } catch (e) {}
  var f = new File(pasta.fsName + "/" + nome + "_ajustes-finos.txt");
  f.encoding = "UTF-8";
  f.lineFeed = "Windows";
  f.open("w");
  f.write(String.fromCharCode(0xFEFF) + texto);
  f.close();
  return f;
}

function condicao(doc) {
  var c = doc.conditions.itemByName(NOME_CONDICAO);
  if (!c.isValid) {
    c = doc.conditions.add({ name: NOME_CONDICAO, indicatorMethod: ConditionIndicatorMethod.USE_HIGHLIGHT, indicatorColor: UIColors.CYAN });
  }
  c.visible = true;
  return c;
}
