/*
  Atualizar norma a partir de XML do Legislator - approach por localizadores.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto da norma no InDesign.
    2. Execute este script.
    3. Escolha o XML exportado pelo Legislator.
    4. Revise os mapeamentos de tags para estilos e confirme.
    5. O XML sera montado na camada temporaria e aplicado pelos atributos local/alterado.
*/

#target "InDesign"
#targetengine "legislatorAtualizarNormaLocal"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var TEMP_LAYER_NAME = "legislator-temporaria";
  var TABLE_STYLE_NAME = "tabela1";
  var CELL_STYLE_NAME = "cel-corpo";
  var CONDITION_NAMES = {
    modificado: "Par\u00e1grafo adicionado/modificado",
    remocaoApos: "Par\u00e1grafo removido ap\u00f3s"
  };
  var DEFAULTS = {
    paragraph: {
      Epigrafe: "tit-subtit/epigrafe",
      EpigrafeApelido: "tit-subtit/epigrafe-apelido",
      Ementa: "corpo-legis/ementa",
      NotaTitulo: "corpo-legis/nota-titulos",
      NotaRodape: "corpo-legis/nota-rodape",
      ParagrafoAbertura: "corpo-legis/texto-lei-sem-indent",
      ParagrafoFacoSaber: "corpo-legis/texto-lei-faco-saber",
      AberturaCapitulo: "tit-subtit/abertura-cap",
      Divisao: "tit-subtit/parte-livro-tit-cap",
      Secao: "tit-subtit/secao-subsecao",
      Artigo: "corpo-legis/art",
      ArtigoTitulo: "corpo-legis/art-tit-centro",
      CorpoTratado: "corpo-legis/texto-lei",
      NomeJuridico: "corpo-legis/nome-juridico",
      Paragrafo: "corpo-legis/texto-lei",
      Tabela: "corpo-legis/texto-lei",
      Inciso: "corpo-legis/texto-lei",
      Alinea: "corpo-legis/texto-lei",
      Item: "corpo-legis/texto-lei",
      Citacao: "corpo-legis/texto-lei-citacao",
      Data: "corpo-legis/ass-data",
      Assinatura: "corpo-legis/ass-nome",
      AssinaturaData: "corpo-legis/ass-data",
      AssinaturaNome: "corpo-legis/ass-nome"
    },
    character: {
      b: "bold",
      Rotulo: "bold-artigo",
      i: "italico",
      Regular: "regular",
      Nota: "nota novo formato",
      NotaEmItalico: "italico light"
    }
  };

  var progressWindow = null;
  var progressStageText = null;
  var progressDetailText = null;
  var progressStartedAt = 0;
  var progressLastUpdate = 0;
  var progressLastStage = "";
  var progressHistory = [];

  function nowMs() {
    return (new Date()).getTime();
  }

  function elapsedText() {
    var elapsed = progressStartedAt ? Math.round((nowMs() - progressStartedAt) / 1000) : 0;
    var minutes = Math.floor(elapsed / 60);
    var seconds = elapsed % 60;
    return minutes + "m " + (seconds < 10 ? "0" : "") + seconds + "s";
  }

  function openProgressWindow() {
    try {
      progressStartedAt = nowMs();
      progressLastUpdate = 0;
      progressLastStage = "";
      progressHistory = [];
      progressWindow = new Window("palette", "Atualizar norma - diagnostico");
      progressWindow.orientation = "column";
      progressWindow.alignChildren = "fill";
      progressWindow.margins = 12;
      progressWindow.spacing = 8;
      progressStageText = progressWindow.add("statictext", undefined, "Preparando...");
      progressStageText.characters = 52;
      progressDetailText = progressWindow.add("statictext", undefined, "");
      progressDetailText.characters = 68;
      progressWindow.show();
      updateProgress("Preparando", "Inicializando diagnostico", 0, 0, true);
    } catch (e) {
      progressWindow = null;
    }
  }

  function updateProgress(stage, detail, current, total, force) {
    var t = nowMs();
    var message;
    if (!progressWindow) return;
    if (!force && t - progressLastUpdate < 250) return;
    progressLastUpdate = t;
    progressLastStage = stage || progressLastStage || "";
    try {
      message = String(stage || "");
      if (total && total > 0) message += " (" + current + " de " + total + ")";
      progressStageText.text = message;
      progressDetailText.text = String(detail || "") + " | tempo: " + elapsedText();
      progressHistory.push(elapsedText() + " - " + message + (detail ? " - " + detail : ""));
      if (progressHistory.length > 40) progressHistory.shift();
      progressWindow.update();
      try { app.refresh(); } catch (e1) {}
    } catch (e2) {}
  }

  function progressSummary() {
    var start = Math.max(0, progressHistory.length - 12);
    var lines = [];
    var i;
    for (i = start; i < progressHistory.length; i++) lines.push(progressHistory[i]);
    if (!lines.length && progressLastStage) lines.push(progressLastStage);
    return lines.join("\n");
  }

  function closeProgressWindow() {
    try {
      if (progressWindow) progressWindow.close();
    } catch (e) {}
    progressWindow = null;
    progressStageText = null;
    progressDetailText = null;
  }

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function normalizeText(s) {
    return trim(String(s || "")
      .replace(/[\u0004\uFEFF\uFFFC]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " "));
  }

  function localName(xml) {
    var n;
    try {
      if (xml.localName) {
        n = xml.localName();
        if (n !== null && n !== undefined) return String(n);
      }
    } catch (e1) {}

    try {
      n = xml.name();
      if (!n) return "";
      if (n.localName) {
        if (typeof n.localName === "function") return String(n.localName());
        return String(n.localName);
      }
      return String(n).replace(/^.*::/, "").replace(/^\{.*\}/, "");
    } catch (e2) {
      return "";
    }
  }

  function readFile(file) {
    file.encoding = "UTF-8";
    if (!file.open("r")) fail("Nao foi possivel abrir o arquivo XML.");
    var text = file.read();
    file.close();
    return text;
  }

  function prepareXmlText(xmlText) {
    return String(xmlText || "")
      .replace(/^\uFEFF/, "")
      .replace(/<\?xml[^>]*\?>/, "")
      .replace(/\sxmlns(:[A-Za-z_][\w.-]*)?="[^"]*"/g, "")
      .replace(/(<\/?)[A-Za-z_][\w.-]*:/g, "$1")
      .replace(/\s[A-Za-z_][\w.-]*:([A-Za-z_][\w.-]*)=/g, " $1=");
  }

  function xmlAttr(xml, name) {
    var value;
    try {
      value = String(xml.attribute(name));
      return value && value !== "undefined" ? value : "";
    } catch (e) {
      return "";
    }
  }

  function normalizeTipoNorma(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[áàâãä]/g, "a")
      .replace(/[éèêë]/g, "e")
      .replace(/[íìîï]/g, "i")
      .replace(/[óòôõö]/g, "o")
      .replace(/[úùûü]/g, "u")
      .replace(/ç/g, "c")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function isEmendaConstitucionalXml(xmlText) {
    var xml, tipo;
    try {
      XML.ignoreWhitespace = false;
      XML.prettyPrinting = false;
      xml = new XML(prepareXmlText(xmlText));
      tipo = String(xml.attribute("tipo"));
      return normalizeTipoNorma(tipo) === "emenda constitucional";
    } catch (e) {
      return false;
    }
  }

  function applyEmendaConstitucionalFields(pFields) {
    if (!pFields) return;
    if (pFields.Epigrafe) pFields.Epigrafe.text = "tit-subtit/epigrafe-emenda";
    if (pFields.Ementa) pFields.Ementa.text = "corpo-legis/emenda-ementa";
  }

  function ensureCondition(doc, name, color, method) {
    var condition;
    try {
      condition = doc.conditions.add({
        name: name,
        indicatorColor: color,
        indicatorMethod: method
      });
    } catch (err) {
      condition = doc.conditions.itemByName(name);
      condition.indicatorColor = color;
      condition.indicatorMethod = method;
    }
    return condition;
  }

  function ensureLegislatorConditions(doc) {
    return {
      modificado: ensureCondition(
        doc,
        CONDITION_NAMES.modificado,
        [167, 200, 55],
        ConditionIndicatorMethod.useUnderline
      ),
      remocaoApos: ensureCondition(
        doc,
        CONDITION_NAMES.remocaoApos,
        [201, 195, 127],
        ConditionIndicatorMethod.useHighlight
      )
    };
  }

  function conditionForAlterado(alterado, conditions) {
    if (alterado === "modificado") return conditions.modificado;
    if (alterado === "remocaoApos") return conditions.remocaoApos;
    return null;
  }

  function applyConditionToRange(textRange, condition) {
    if (!condition || !textRange) return false;
    try {
      textRange.applyConditions(condition, false);
      return true;
    } catch (e) {
      return false;
    }
  }

  function startsWithText(text, prefix) {
    text = String(text || "");
    prefix = String(prefix || "");
    return text.substr(0, prefix.length) === prefix;
  }

  function styleName(paragraph) {
    try {
      return String(paragraph.appliedParagraphStyle.name || "");
    } catch (e) {
      return "";
    }
  }

  function styleHasGroup(style, groupName) {
    var parent, guard = 0;
    try {
      parent = style.parent;
      while (parent && guard < 20) {
        if (String(parent.name || "") === groupName) return true;
        parent = parent.parent;
        guard++;
      }
    } catch (e) {}
    return false;
  }

  function paragraphHasStyleInGroup(paragraph, styleNameExpected, groupName) {
    var style;
    try {
      style = paragraph.appliedParagraphStyle;
      return String(style.name || "") === styleNameExpected && styleHasGroup(style, groupName);
    } catch (e) {
      return false;
    }
  }

  function paragraphStyleStartsWithEpigrafe(paragraph) {
    var name = styleName(paragraph).toLowerCase();
    return startsWithText(name, "epigrafe") || startsWithText(name, "ep\u00edgrafe");
  }

  function shouldAutoSelectNorma(selection) {
    try {
      return selection.paragraphs.length <= 1;
    } catch (e) {
      return true;
    }
  }

  function selectNormaFromCursor(selection) {
    var startParagraph, story, paragraphs, startIndex, startChar, endChar;
    var i, paragraph, paragraphStart, selectionRange;
    var foundStart = false;
    var foundBody = false;

    try {
      startParagraph = selection.paragraphs[0];
      story = startParagraph.parentStory;
      paragraphs = story.paragraphs;
      startIndex = startParagraph.insertionPoints[0].index;
    } catch (e1) {
      fail("Coloque o cursor sobre a epigrafe da norma ou selecione a norma manualmente.");
    }

    if (!paragraphStyleStartsWithEpigrafe(startParagraph)) {
      fail(
        "A selecao automatica deve comecar na epigrafe da norma.\n\n" +
        "Coloque o cursor sobre o paragrafo da epigrafe ou selecione a norma manualmente."
      );
    }

    for (i = 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      paragraphStart = paragraph.insertionPoints[0].index;
      if (paragraphStart < startIndex) continue;

      if (!foundStart) {
        foundStart = true;
        startChar = paragraphStart;
      } else if (paragraphStyleStartsWithEpigrafe(paragraph)) {
        if (foundBody) {
          fail(
            "Nao foi possivel selecionar a norma automaticamente.\n\n" +
            "Encontrei outra epigrafe antes do estilo corpo-legis/ass-nome-espaco-ant. " +
            "Isso indica que a norma pode nao ter terminado da forma padrao.\n\n" +
            "Selecione a norma manualmente e execute o script novamente."
          );
        }
      } else if (trim(paragraph.contents)) {
        foundBody = true;
      }

      if (paragraphHasStyleInGroup(paragraph, "ass-nome-espaco-ant", "corpo-legis")) {
        endChar = paragraph.insertionPoints[-1].index - 1;
        selectionRange = story.characters.itemByRange(startChar, endChar);
        app.select(selectionRange);
        return selectionRange;
      }
    }

    fail(
      "Nao foi possivel selecionar a norma automaticamente.\n\n" +
      "Nao encontrei o paragrafo final com estilo corpo-legis/ass-nome-espaco-ant.\n\n" +
      "Selecione a norma manualmente e execute o script novamente."
    );
  }

  function resolveInitialSelection() {
    var selection;
    if (!app.selection.length || !app.selection[0].hasOwnProperty("parentStory")) {
      fail("Coloque o cursor sobre a epigrafe da norma ou selecione a norma manualmente antes de executar o script.");
    }

    selection = app.selection[0];
    if (shouldAutoSelectNorma(selection)) {
      return selectNormaFromCursor(selection);
    }
    return selection;
  }

  function getLayer(doc, name) {
    var layer;
    try {
      layer = doc.layers.itemByName(name);
      layer.name;
      return layer;
    } catch (e) {
      return doc.layers.add({ name: name });
    }
  }

  function hideTempLayer(tempFrame) {
    try {
      tempFrame.itemLayer.visible = false;
      return;
    } catch (e1) {}

    try {
      app.activeDocument.layers.itemByName(TEMP_LAYER_NAME).visible = false;
    } catch (e2) {}
  }

  function duplicateSelectionToTemp(selection) {
    var doc = app.activeDocument;
    var layer = getLayer(doc, TEMP_LAYER_NAME);
    layer.visible = true;
    layer.locked = false;

    var frame = doc.textFrames.add(layer);
    frame.geometricBounds = ["10mm", "10mm", "250mm", "190mm"];
    frame.label = "Backup Legislator - " + (new Date()).toString();

    app.select(selection);
    app.copy();
    app.select(frame.insertionPoints[0]);
    app.paste();
    try {
      app.select(selection);
    } catch (e) {}
    return frame;
  }

  function getValidItem(collection, name) {
    var item;
    try {
      item = collection.itemByName(name);
      if (item && item.isValid) return item;
      item.name;
      return item;
    } catch (e) {
      return null;
    }
  }

  function collectParagraphStylesByName(container, name, results) {
    var i, style, group;
    try {
      for (i = 0; i < container.paragraphStyles.length; i++) {
        style = container.paragraphStyles[i];
        if (style && style.name === name) results.push(style);
      }
    } catch (e1) {}

    try {
      for (i = 0; i < container.paragraphStyleGroups.length; i++) {
        group = container.paragraphStyleGroups[i];
        collectParagraphStylesByName(group, name, results);
      }
    } catch (e2) {}
  }

  function findParagraphStyleAnywhere(doc, name) {
    var results = [];
    collectParagraphStylesByName(doc, name, results);
    if (results.length === 1) return results[0];
    if (results.length > 1) {
      fail("Mais de um estilo de paragrafo chamado \"" + name + "\" foi encontrado. Informe o caminho como grupo/estilo.");
    }
    return null;
  }

  function findParagraphStyle(doc, path, tagName) {
    var parts = String(path).split("/");
    var group, style, i;
    if (parts.length === 1) {
      style = findParagraphStyleAnywhere(doc, parts[0]);
      if (!style) fail("Estilo de paragrafo nao encontrado para <" + tagName + ">: " + path);
      return style;
    }
    group = getValidItem(doc.paragraphStyleGroups, parts[0]);
    if (!group) {
      style = findParagraphStyleAnywhere(doc, parts[parts.length - 1]);
      if (style) return style;
      fail("Grupo de estilo de paragrafo nao encontrado para <" + tagName + ">: " + parts[0] + "\nMapeamento informado: " + path);
    }
    for (i = 1; i < parts.length - 1; i++) {
      group = getValidItem(group.paragraphStyleGroups, parts[i]);
      if (!group) {
        style = findParagraphStyleAnywhere(doc, parts[parts.length - 1]);
        if (style) return style;
        fail("Subgrupo de estilo de paragrafo nao encontrado para <" + tagName + ">: " + parts[i] + "\nMapeamento informado: " + path);
      }
    }
    style = getValidItem(group.paragraphStyles, parts[parts.length - 1]);
    if (!style) {
      style = findParagraphStyleAnywhere(doc, parts[parts.length - 1]);
      if (style) return style;
      fail("Estilo de paragrafo nao encontrado para <" + tagName + ">: " + path);
    }
    return style;
  }

  function findCharacterStyle(doc, name, tagName) {
    var style = getValidItem(doc.characterStyles, name);
    if (!style) fail("Estilo de caractere nao encontrado para <" + tagName + ">: " + name);
    return style;
  }

  function noneCharacterStyle(doc) {
    var names = ["[Nenhum(a)]", "[Nenhum]", "[None]", "[No character style]"];
    var i, style;
    for (i = 0; i < names.length; i++) {
      style = getValidItem(doc.characterStyles, names[i]);
      if (style) return style;
    }
    try {
      return doc.characterStyles[0];
    } catch (e) {}
    return null;
  }

  function applyNoneCharacterStyle(textRange) {
    var noneStyle = noneCharacterStyle(app.activeDocument);
    if (!noneStyle || !textRange) return false;
    try {
      textRange.appliedCharacterStyle = noneStyle;
      return true;
    } catch (e) {
      return false;
    }
  }

  function applyCharacterStyleToRange(textRange, characterStyle) {
    if (!textRange || !characterStyle) return false;
    try {
      if (textRange.applyCharacterStyle) {
        textRange.applyCharacterStyle(characterStyle, false);
        return true;
      }
    } catch (e1) {}
    try {
      textRange.appliedCharacterStyle = characterStyle;
      return true;
    } catch (e2) {}
    try {
      textRange.texts[0].appliedCharacterStyle = characterStyle;
      return true;
    } catch (e3) {}
    try {
      textRange.characters.everyItem().appliedCharacterStyle = characterStyle;
      return true;
    } catch (e4) {}
    return false;
  }

  function paragraphContentLength(paragraph) {
    var contents;
    try {
      contents = String(paragraph.contents || "");
      if (contents.length && contents.charAt(contents.length - 1) === "\r") return contents.length - 1;
      return contents.length;
    } catch (e) {
      return 0;
    }
  }

  function sameCharacterStyle(a, b) {
    try {
      if (a === b) return true;
      if (a && b && a.id !== undefined && b.id !== undefined && a.id === b.id) return true;
      if (a && b && a.name === b.name) return true;
    } catch (e) {}
    return false;
  }

  function characterStyleAt(paragraph, index) {
    try {
      return paragraph.characters[index].appliedCharacterStyle;
    } catch (e) {
      return null;
    }
  }

  function applyParagraphCharacterStyleRange(paragraph, start, end, style) {
    var range;
    if (!paragraph || !style || start > end) return;
    try {
      range = paragraph.characters.itemByRange(paragraph.characters[start], paragraph.characters[end]);
      applyCharacterStyleToRange(range, style);
      return;
    } catch (e1) {}
    try {
      range = paragraph.characters.itemByRange(start, end);
      applyCharacterStyleToRange(range, style);
    } catch (e2) {}
  }

  function copyCharacterStylesByOffset(sourceParagraph, targetParagraph) {
    var length, i, runStart, currentStyle, nextStyle;
    if (!sourceParagraph || !targetParagraph) return;
    length = Math.min(paragraphContentLength(sourceParagraph), paragraphContentLength(targetParagraph));
    if (length <= 0) return;
    currentStyle = characterStyleAt(sourceParagraph, 0);
    runStart = 0;
    for (i = 1; i < length; i++) {
      nextStyle = characterStyleAt(sourceParagraph, i);
      if (!sameCharacterStyle(currentStyle, nextStyle)) {
        applyParagraphCharacterStyleRange(targetParagraph, runStart, i - 1, currentStyle);
        runStart = i;
        currentStyle = nextStyle;
      }
    }
    applyParagraphCharacterStyleRange(targetParagraph, runStart, length - 1, currentStyle);
  }

  function applyBlockCharacterRuns(story, start, block, styles) {
    var j, run, range, style;
    if (!story || !block || !block.runs || !styles || !styles.character) return;
    for (j = 0; j < block.runs.length; j++) {
      run = block.runs[j];
      if (!run.charKey || !styles.character[run.charKey] || run.start > run.end) continue;
      style = styles.character[run.charKey];
      try {
        range = story.characters.itemByRange(start + run.start, start + run.end);
        applyCharacterStyleToRange(range, style);
      } catch (e) {}
    }
  }

  function reapplyBlockRunsToParagraph(paragraph, block, styles) {
    var start, j, run, range, style;
    try {
      start = paragraph.insertionPoints[0].index;
      applyBlockCharacterRuns(paragraph.parentStory, start, block, styles);
    } catch (e) {}
    if (!paragraph || !block || !block.runs || !styles || !styles.character) return;
    for (j = 0; j < block.runs.length; j++) {
      run = block.runs[j];
      if (!run.charKey || !styles.character[run.charKey] || run.start > run.end) continue;
      style = styles.character[run.charKey];
      try {
        range = paragraph.characters.itemByRange(run.start, run.end);
        applyCharacterStyleToRange(range, style);
      } catch (e2) {}
    }
  }

  function resolveStyleMaps(doc, map) {
    var result = { paragraph: {}, character: {} };
    var key;
    for (key in map.paragraph) {
      if (map.paragraph.hasOwnProperty(key) && trim(map.paragraph[key])) {
        result.paragraph[key] = findParagraphStyle(doc, trim(map.paragraph[key]), key);
      }
    }
    for (key in map.character) {
      if (map.character.hasOwnProperty(key) && trim(map.character[key])) {
        result.character[key] = findCharacterStyle(doc, trim(map.character[key]), key);
      }
    }
    return result;
  }

  function activeCharStyleName(tagName, stack) {
    var i, hasItalic = false;
    for (i = 0; i < stack.length; i++) {
      if (stack[i] === "i") hasItalic = true;
    }
    if (tagName === "Nota" && hasItalic) return "NotaEmItalico";
    if (tagName === "b" || tagName === "i" || tagName === "Regular" || tagName === "Nota" || tagName === "Rotulo") return tagName;
    return null;
  }

  function addRun(runs, text, charKey) {
    if (!text) return;
    if (runs.length && runs[runs.length - 1].charKey === charKey) {
      runs[runs.length - 1].text += text;
    } else {
      runs.push({ text: text, charKey: charKey });
    }
  }

  function runsTextLength(runs) {
    var total = 0;
    var i;
    for (i = 0; i < runs.length; i++) total += String(runs[i].text || "").length;
    return total;
  }

  function collectInline(xml, stack, runs, footnotes) {
    var children = xml.children();
    var i, child, tag, nextStack, key;
    for (i = 0; i < children.length(); i++) {
      child = children[i];
      if (child.nodeKind && child.nodeKind() === "text") {
        key = stack.length ? activeCharStyleName(stack[stack.length - 1], stack.slice(0, stack.length - 1)) : null;
        addRun(runs, String(child), key);
      } else if (child.nodeKind && child.nodeKind() === "element") {
        tag = localName(child);
        if (tag === "br") {
          addRun(runs, "\n", null);
        } else if (tag === "NotaRodape") {
          if (footnotes) {
            footnotes.push({
              index: runsTextLength(runs),
              chamada: xmlAttr(child, "chamada"),
              text: textFromInlineXml(child)
            });
          }
        } else {
          nextStack = stack.slice(0);
          nextStack.push(tag);
          collectInline(child, nextStack, runs, footnotes);
        }
      }
    }
  }

  function childTableXml(xml) {
    var children = xml.children();
    var i;
    for (i = 0; i < children.length(); i++) {
      if (localName(children[i]) === "Tabela") return children[i];
    }
    return null;
  }

  function blockFromXml(xml) {
    var runs = [];
    var footnotes = [];
    var text = "";
    var i, start, end, tableXml, tableBlock;
    if (localName(xml) === "Tabela") return tableBlockFromXml(xml);
    if (localName(xml) === "Paragrafo") {
      tableXml = childTableXml(xml);
      if (tableXml && !textFromInlineXml(xml).replace(textFromInlineXml(tableXml), "").replace(/\s+/g, "")) {
        tableBlock = tableBlockFromXml(tableXml);
        tableBlock.alterado = xmlAttr(xml, "alterado") || tableBlock.alterado;
        tableBlock.local = xmlAttr(xml, "local") || tableBlock.local;
        return tableBlock;
      }
    }
    collectInline(xml, [], runs, footnotes);
    for (i = 0; i < runs.length; i++) {
      start = text.length;
      text += runs[i].text;
      end = text.length - 1;
      runs[i].start = start;
      runs[i].end = end;
    }
    return {
      tag: localName(xml),
      text: text,
      runs: runs,
      footnotes: footnotes,
      alterado: xmlAttr(xml, "alterado"),
      local: xmlAttr(xml, "local")
    };
  }

  function textFromInlineXml(xml) {
    var runs = [];
    var text = "";
    var i;
    collectInline(xml, [], runs, null);
    for (i = 0; i < runs.length; i++) text += runs[i].text;
    return String(text || "").replace(/\t/g, " ").replace(/\r|\n/g, " ");
  }

  function tableBlockFromXml(xml) {
    var rows = [];
    var children = xml.children();
    var rowChildren, cells, i, j, tag;
    for (i = 0; i < children.length(); i++) {
      if (localName(children[i]) !== "Linha") continue;
      rowChildren = children[i].children();
      cells = [];
      for (j = 0; j < rowChildren.length(); j++) {
        tag = localName(rowChildren[j]);
        if (tag === "Celula" || tag === "Cabecalho") {
          cells.push(textFromInlineXml(rowChildren[j]));
        }
      }
      if (cells.length) rows.push(cells);
    }
    return {
      tag: "Tabela",
      isTable: true,
      rows: rows,
      text: tableRowsText(rows),
      runs: [],
      footnotes: [],
      alterado: xmlAttr(xml, "alterado"),
      local: xmlAttr(xml, "local")
    };
  }

  function parseXmlBlocks(xmlText) {
    XML.ignoreWhitespace = false;
    XML.prettyPrinting = false;

    var xml = new XML(prepareXmlText(xmlText));
    var blocks = [];
    var skippedHeadBlocks = [];
    var skippedHead = 0;
    var children = xml.children();
    var references = {};
    var contextOperations = [];
    var i, tag;
    for (i = 0; i < children.length(); i++) {
      tag = localName(children[i]);
      if (tag === "Referencias") {
        collectReferenceBlocks(children[i], references);
        continue;
      }
      if (tag === "Atualizacoes") {
        collectContextOperations(children[i], contextOperations, blocks);
        continue;
      }
      if (tag === "Epigrafe" || tag === "EpigrafeApelido") {
        if (blocks.length === 0) skippedHeadBlocks.push(blockFromXml(children[i]));
        if (blocks.length === 0) skippedHead++;
        continue;
      }
      if (children[i].nodeKind && children[i].nodeKind() === "element") {
        blocks.push(blockFromXml(children[i]));
      }
    }
    return {
      blocks: blocks,
      skippedHead: skippedHead,
      skippedHeadBlocks: skippedHeadBlocks,
      references: references,
      contextOperations: contextOperations
    };
  }

  function collectBlocksFromContainer(containerXml) {
    var children = containerXml.children();
    var blocks = [];
    var i, tag;
    for (i = 0; i < children.length(); i++) {
      tag = localName(children[i]);
      if (tag === "Contexto" || tag === "Novo" || tag === "Alteracao" || tag === "Atualizacoes") continue;
      if (children[i].nodeKind && children[i].nodeKind() === "element") {
        blocks.push(blockFromXml(children[i]));
      }
    }
    return blocks;
  }

  function collectContextOperations(updatesXml, operations, allNewBlocks) {
    var children = updatesXml.children();
    var i, j, opXml, opChildren, child, tag, operation, novos;
    for (i = 0; i < children.length(); i++) {
      opXml = children[i];
      if (localName(opXml) !== "Alteracao") continue;
      operation = {
        type: xmlAttr(opXml, "tipo") || "substituirProximo",
        alterado: xmlAttr(opXml, "alterado"),
        contextBlocks: [],
        blocks: []
      };
      opChildren = opXml.children();
      for (j = 0; j < opChildren.length(); j++) {
        child = opChildren[j];
        tag = localName(child);
        if (tag === "Contexto") {
          operation.contextBlocks = collectBlocksFromContainer(child);
        } else if (tag === "Novo") {
          novos = collectBlocksFromContainer(child);
          operation.blocks = novos;
        }
      }
      for (j = 0; j < operation.blocks.length; j++) {
        if (operation.alterado && !operation.blocks[j].alterado) operation.blocks[j].alterado = operation.alterado;
        allNewBlocks.push(operation.blocks[j]);
      }
      operations.push(operation);
    }
  }

  function collectReferenceBlocks(referencesXml, references) {
    var children = referencesXml.children();
    var refXml, refChildren, blocks, local, i, j, tag;
    for (i = 0; i < children.length(); i++) {
      refXml = children[i];
      if (localName(refXml) !== "Referencia") continue;
      local = xmlAttr(refXml, "local");
      if (!local) continue;
      refChildren = refXml.children();
      blocks = [];
      for (j = 0; j < refChildren.length(); j++) {
        tag = localName(refChildren[j]);
        if (tag === "Referencias" || tag === "Referencia") continue;
        if (refChildren[j].nodeKind && refChildren[j].nodeKind() === "element") {
          blocks.push(blockFromXml(refChildren[j]));
        }
      }
      if (blocks.length) references[normalizeLocatorText(local).toLowerCase()] = blocks;
    }
  }

  function previewXmlTags(xmlText) {
    var xml, children, names, i;
    try {
      XML.ignoreWhitespace = false;
      XML.prettyPrinting = false;
      xml = new XML(prepareXmlText(xmlText));
      children = xml.children();
      names = [];
      for (i = 0; i < children.length() && i < 8; i++) {
        names.push(localName(children[i]) || String(children[i].name()));
      }
      return names.join(", ");
    } catch (e) {
      return "nao foi possivel ler as tags iniciais";
    }
  }

  function tableRowsText(rows) {
    var lines = [];
    var i;
    rows = rows || [];
    for (i = 0; i < rows.length; i++) {
      lines.push(rows[i].join("\t"));
    }
    return lines.join("\r");
  }

  function tableText(block) {
    return tableRowsText(block.rows);
  }

  function isValidObject(obj) {
    try {
      return obj && obj.isValid;
    } catch (e) {
      return false;
    }
  }

  function collectNamedStylesByName(container, itemCollectionName, groupCollectionName, name, results) {
    var i, style, group;
    try {
      for (i = 0; i < container[itemCollectionName].length; i++) {
        style = container[itemCollectionName][i];
        if (style && style.name === name) results.push(style);
      }
    } catch (e1) {}

    try {
      for (i = 0; i < container[groupCollectionName].length; i++) {
        group = container[groupCollectionName][i];
        collectNamedStylesByName(group, itemCollectionName, groupCollectionName, name, results);
      }
    } catch (e2) {}
  }

  function findNamedStyleAnywhere(doc, itemCollectionName, groupCollectionName, name) {
    var results = [];
    collectNamedStylesByName(doc, itemCollectionName, groupCollectionName, name, results);
    if (results.length) return results[0];
    return null;
  }

  function findRootOrNestedStyle(doc, rootCollectionName, itemCollectionName, groupCollectionName, name) {
    var style;
    try {
      style = getValidItem(doc[rootCollectionName], name);
      if (isValidObject(style)) return style;
    } catch (e1) {}
    return findNamedStyleAnywhere(doc, itemCollectionName, groupCollectionName, name);
  }

  function findInsertedTable(story, start) {
    var tables, i, table, index, best = null, bestDistance = 999999;
    try {
      if (isValidObject(app.selection[0]) && String(app.selection[0].constructor.name) === "Table") {
        return app.selection[0];
      }
    } catch (e0) {}
    try {
      tables = story.tables.everyItem().getElements();
    } catch (e1) {
      tables = [];
    }
    for (i = 0; i < tables.length; i++) {
      try {
        table = tables[i];
        index = table.storyOffset.index;
        if (Math.abs(index - start) < bestDistance) {
          best = table;
          bestDistance = Math.abs(index - start);
        }
      } catch (e2) {}
    }
    return best;
  }

  function textFrameInnerWidth(frame) {
    var gb, width, inset, leftInset = 0, rightInset = 0;
    try {
      gb = frame.geometricBounds;
      width = Number(gb[3]) - Number(gb[1]);
    } catch (e1) {
      return 0;
    }
    try {
      inset = frame.textFramePreferences.insetSpacing;
      if (inset instanceof Array) {
        leftInset = Number(inset[1]) || 0;
        rightInset = Number(inset[3]) || 0;
      } else {
        leftInset = Number(inset) || 0;
        rightInset = leftInset;
      }
    } catch (e2) {}
    return width - leftInset - rightInset;
  }

  function textFrameColumnWidth(frame) {
    var innerWidth = textFrameInnerWidth(frame);
    var prefs, count = 1, gutter = 0;
    if (innerWidth <= 0) return 0;
    try {
      prefs = frame.textFramePreferences;
      count = Number(prefs.textColumnCount) || 1;
    } catch (e1) {}
    try {
      gutter = Number(prefs.textColumnGutter) || 0;
    } catch (e2) {}
    if (count < 1) count = 1;
    return (innerWidth - (gutter * (count - 1))) / count;
  }

  function fitTableToTextFrame(table) {
    var frames, frame, width, columns, colWidth, i;
    try {
      frames = table.storyOffset.parentTextFrames;
      if (!frames || !frames.length) return;
      frame = frames[0];
      width = textFrameColumnWidth(frame);
      if (width <= 0) return;
      try {
        table.width = width;
        return;
      } catch (e1) {}
      columns = table.columns.everyItem().getElements();
      if (!columns || !columns.length) return;
      colWidth = width / columns.length;
      for (i = 0; i < columns.length; i++) {
        try {
          columns[i].width = colWidth;
        } catch (e2) {}
      }
    } catch (e3) {}
  }

  function applyTableStyles(table) {
    var doc = app.activeDocument;
    var tableStyle = findRootOrNestedStyle(doc, "tableStyles", "tableStyles", "tableStyleGroups", TABLE_STYLE_NAME);
    var cellStyle = findRootOrNestedStyle(doc, "cellStyles", "cellStyles", "cellStyleGroups", CELL_STYLE_NAME);
    var rows, cells, i, j, tableApplied = false, cellApplied = false;
    if (!isValidObject(table)) {
      alert("A tabela foi criada, mas o script nao conseguiu recuperar uma referencia valida para aplicar estilos.");
      return;
    }
    if (!tableStyle) alert("Estilo de tabela nao encontrado: " + TABLE_STYLE_NAME);
    if (!cellStyle) alert("Estilo de celula nao encontrado: " + CELL_STYLE_NAME);
    try {
      if (tableStyle && table.applyTableStyle) {
        table.applyTableStyle(tableStyle, true);
      } else if (tableStyle) {
        table.appliedTableStyle = tableStyle;
      }
    } catch (e1) {}
    try {
      if (tableStyle) table.appliedTableStyle = tableStyle;
    } catch (e1b) {}
    try {
      if (tableStyle && String(table.appliedTableStyle.name || "") === TABLE_STYLE_NAME) tableApplied = true;
    } catch (e1c) {}
    try {
      rows = table.rows.everyItem().getElements();
    } catch (e2) {
      rows = [];
    }
    try {
      if (cellStyle) table.cells.everyItem().appliedCellStyle = cellStyle;
    } catch (e2b) {}
    try {
      if (cellStyle && table.cells.everyItem().applyCellStyle) table.cells.everyItem().applyCellStyle(cellStyle, false);
    } catch (e2c) {}
    for (i = 0; i < rows.length; i++) {
      try {
        cells = rows[i].cells.everyItem().getElements();
      } catch (e3) {
        cells = [];
      }
      for (j = 0; j < cells.length; j++) {
        try {
          if (cellStyle && cells[j].applyCellStyle) {
            cells[j].applyCellStyle(cellStyle, false);
          }
          if (cellStyle) {
            cells[j].appliedCellStyle = cellStyle;
          }
        } catch (e4) {}
        try {
          if (cellStyle) cells[j].clearCellStyleOverrides(false);
        } catch (e5) {}
        try {
          if (cellStyle) cells[j].appliedCellStyle = cellStyle;
        } catch (e6) {}
        try {
          if (cellStyle && String(cells[j].appliedCellStyle.name || "") === CELL_STYLE_NAME) cellApplied = true;
        } catch (e7) {}
      }
    }
    if (tableStyle && !tableApplied) alert("O estilo de tabela foi encontrado, mas nao foi aplicado: " + TABLE_STYLE_NAME);
    if (cellStyle && !cellApplied) alert("O estilo de celula foi encontrado, mas nao foi aplicado: " + CELL_STYLE_NAME);
    fitTableToTextFrame(table);
  }

  function insertTableBlock(story, ip, block, styles) {
    var start = ip.index;
    var text = tableText(block);
    var end, paraStyle, range, table, nextIndex;

    if (!text) {
      ip.contents = "\r";
      return story.insertionPoints[start + 1];
    }

    ip.contents = text + "\r";
    end = start + text.length - 1;
    try {
      if (end >= start) applyNoneCharacterStyle(story.characters.itemByRange(start, end));
    } catch (e0a) {}
    paraStyle = styles.paragraph.Tabela || styles.paragraph.Paragrafo;
    if (paraStyle) {
      try {
        story.characters.itemByRange(start, start + text.length).appliedParagraphStyle = paraStyle;
      } catch (e0) {}
    }

    range = story.characters.itemByRange(start, end);
    app.select(range);
    table = range.convertToTable("\t", "\r");
    try {
      if (!isValidObject(table)) table = findInsertedTable(story, start);
    } catch (e1a) {}
    if (!isValidObject(table)) table = findInsertedTable(story, start);
    applyTableStyles(table);

    if (paraStyle) {
      try {
        table.storyOffset.paragraphs[0].appliedParagraphStyle = paraStyle;
      } catch (e1) {}
    }

    nextIndex = start + 2;
    try {
      nextIndex = table.storyOffset.index + 2;
    } catch (e2) {}
    if (nextIndex > story.insertionPoints.length - 1) nextIndex = story.insertionPoints.length - 1;
    return story.insertionPoints[nextIndex];
  }

  function insertBlocks(story, insertionIndex, blocks, styles) {
    var ip = story.insertionPoints[insertionIndex];
    var insertStart = insertionIndex;
    var i, block, paraStyle, start, end;

    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      if (block.isTable) {
        ip = insertTableBlock(story, ip, block, styles);
        continue;
      }
      start = ip.index;
      ip.contents = block.text + "\r";
      end = start + block.text.length;
      try {
        if (end > start) applyNoneCharacterStyle(story.characters.itemByRange(start, end - 1));
      } catch (e0a) {}

      paraStyle = styles.paragraph[block.tag];
      if (paraStyle) {
        story.characters.itemByRange(start, end).appliedParagraphStyle = paraStyle;
      }

      applyBlockCharacterRuns(story, start, block, styles);

      end += applyFootnotes(story, start, block.footnotes, styles);

      ip = story.insertionPoints[end + 1];
    }

    return {
      start: insertStart,
      end: ip.index
    };
  }

  function applyFootnotes(story, start, footnotes, styles) {
    var i, note, noteStyle, insertionIndex, added = 0, fallbackText;
    if (!footnotes || !footnotes.length) return 0;
    noteStyle = styles.paragraph.NotaRodape;
    for (i = footnotes.length - 1; i >= 0; i--) {
      insertionIndex = start + footnotes[i].index;
      try {
        note = story.insertionPoints[insertionIndex].footnotes.add();
        note.insertionPoints[-1].contents = footnotes[i].text;
        if (noteStyle) note.texts[0].paragraphs.everyItem().appliedParagraphStyle = noteStyle;
        added++;
      } catch (e1) {
        try {
          fallbackText = "[" + footnotes[i].text + "]";
          story.insertionPoints[insertionIndex].contents = fallbackText;
          added += fallbackText.length;
        } catch (e2) {}
      }
    }
    return added;
  }

  function getReplaceBounds(selection, preserveCount) {
    var story = selection.parentStory;
    var paragraphs = selection.paragraphs;
    var first, last;
    if (!story) {
      fail("Nao foi possivel recuperar a selecao original da norma. Selecione a norma manualmente e execute o script novamente.");
    }
    if (preserveCount > 0 && paragraphs.length > preserveCount) {
      first = paragraphs[preserveCount].insertionPoints[0].index;
    } else {
      first = selection.insertionPoints[0].index;
    }
    last = selection.insertionPoints[-1].index;
    return { story: story, first: first, last: last };
  }

  function replaceSelectedBody(selection, preserveCount, blocks, styles, conditions) {
    var bounds = getReplaceBounds(selection, preserveCount);
    var story = bounds.story;
    var first = bounds.first;
    var lastChar = bounds.last - 1;
    var insertedBounds;

    if (!story || !story.characters) {
      fail("Nao foi possivel substituir o texto da norma porque a selecao original foi perdida. Selecione a norma manualmente e execute o script novamente.");
    }

    if (lastChar >= first) {
      story.characters.itemByRange(first, lastChar).contents = "";
    }
    insertedBounds = insertBlocks(story, first, blocks, styles);
    insertedBounds.story = story;
    return insertedBounds;
  }

  function applyConditionsToInsertedBlocks(story, insertedBounds, blocks, conditions) {
    var insertedText, paragraphs, i, condition, applied = 0;

    if (!story || insertedBounds.end <= insertedBounds.start) return 0;

    insertedText = story.characters.itemByRange(insertedBounds.start, insertedBounds.end - 1);
    paragraphs = insertedText.paragraphs;

    for (i = 0; i < blocks.length && i < paragraphs.length; i++) {
      condition = conditionForAlterado(blocks[i].alterado, conditions);
      if (!condition) continue;
      if (applyConditionToRange(paragraphs[i].texts[0], condition)) applied++;
    }

    return applied;
  }

  function applyConditionsToPreservedHead(selection, skippedHeadBlocks, conditions) {
    var paragraphs = selection.paragraphs;
    var applied = 0;
    var i, condition;

    for (i = 0; i < skippedHeadBlocks.length && i < paragraphs.length; i++) {
      condition = conditionForAlterado(skippedHeadBlocks[i].alterado, conditions);
      if (!condition) continue;
      if (applyConditionToRange(paragraphs[i].texts[0], condition)) applied++;
    }

    return applied;
  }

  function collectChangeItemsFromPreservedHead(selection, skippedHeadBlocks, conditions) {
    var paragraphs = selection.paragraphs;
    var items = [];
    var i, condition, label;

    for (i = 0; i < skippedHeadBlocks.length && i < paragraphs.length; i++) {
      condition = conditionForAlterado(skippedHeadBlocks[i].alterado, conditions);
      if (!condition) continue;
      label = skippedHeadBlocks[i].alterado === "remocaoApos" ? CONDITION_NAMES.remocaoApos : CONDITION_NAMES.modificado;
      items.push({ paragraph: paragraphs[i], label: label });
    }

    return items;
  }

  function collectChangeItemsFromInsertedBlocks(story, insertedBounds, blocks, conditions) {
    var insertedText, paragraphs, items = [];
    var i, condition, label;

    if (!story || insertedBounds.end <= insertedBounds.start) return items;

    insertedText = story.characters.itemByRange(insertedBounds.start, insertedBounds.end - 1);
    paragraphs = insertedText.paragraphs;

    for (i = 0; i < blocks.length && i < paragraphs.length; i++) {
      condition = conditionForAlterado(blocks[i].alterado, conditions);
      if (!condition) continue;
      label = blocks[i].alterado === "remocaoApos" ? CONDITION_NAMES.remocaoApos : CONDITION_NAMES.modificado;
      items.push({ paragraph: paragraphs[i], label: label });
    }

    return items;
  }

  function getParagraphPreview(paragraph) {
    var text = normalizeText(paragraph.contents);
    if (text.length > 72) return text.substr(0, 72) + "...";
    return text;
  }

  function paragraphStartIndex(paragraph) {
    try {
      return paragraph.insertionPoints[0].index;
    } catch (e) {
      return -1;
    }
  }

  function paragraphEndInsertionIndex(paragraph) {
    try {
      return paragraph.insertionPoints[-1].index;
    } catch (e) {
      return -1;
    }
  }

  function sameParagraphStory(a, b) {
    try {
      return a.parentStory === b.parentStory;
    } catch (e) {
      return false;
    }
  }

  function areAdjacentParagraphs(previous, next) {
    var previousEnd, nextStart;
    if (!previous || !next || !sameParagraphStory(previous, next)) return false;
    previousEnd = paragraphEndInsertionIndex(previous);
    nextStart = paragraphStartIndex(next);
    return previousEnd >= 0 && nextStart >= 0 && nextStart <= previousEnd + 1;
  }

  function groupChangeItems(changeItems) {
    var grouped = [];
    var current = null;
    var i, item, lastParagraph;
    for (i = 0; changeItems && i < changeItems.length; i++) {
      item = changeItems[i];
      if (!item || !item.paragraph) continue;
      if (current) {
        lastParagraph = current.paragraphs[current.paragraphs.length - 1];
        if (item.label === current.label && areAdjacentParagraphs(lastParagraph, item.paragraph)) {
          current.paragraphs.push(item.paragraph);
          current.paragraph = current.paragraphs[0];
          continue;
        }
      }
      current = {
        label: item.label,
        paragraph: item.paragraph,
        paragraphs: [item.paragraph]
      };
      grouped.push(current);
    }
    return grouped;
  }

  function getChangeItemPreview(item) {
    var text, count;
    if (item && item.range) {
      text = normalizeText(item.range.contents);
      if (text.length > 72) return text.substr(0, 72) + "...";
      return text;
    }
    if (!item || !item.paragraphs || item.paragraphs.length <= 1) {
      return getParagraphPreview(item.paragraph);
    }
    count = item.paragraphs.length;
    text = normalizeText(item.paragraphs[0].contents);
    if (text.length > 56) text = text.substr(0, 56) + "...";
    return count + " paragrafos: " + text;
  }

  function findParagraphIndexByStart(story, start) {
    var paragraphs, i;
    try {
      paragraphs = story.paragraphs;
      for (i = 0; i < paragraphs.length; i++) {
        if (paragraphStartIndex(paragraphs[i]) === start) return i;
      }
    } catch (e) {}
    return -1;
  }

  function selectLiveParagraphBlock(paragraphs) {
    var first, story, start, firstIndex, lastIndex, liveLast, end;
    if (!paragraphs || !paragraphs.length) return false;
    first = paragraphs[0];
    try {
      story = first.parentStory;
      start = paragraphStartIndex(first);
      firstIndex = findParagraphIndexByStart(story, start);
      if (firstIndex < 0) return false;
      lastIndex = firstIndex + paragraphs.length - 1;
      if (lastIndex >= story.paragraphs.length) return false;
      liveLast = story.paragraphs[lastIndex];
      end = paragraphEndInsertionIndex(liveLast) - 1;
      if (start >= 0 && end >= start) {
        app.select(story.characters.itemByRange(start, end));
        return true;
      }
    } catch (e) {}
    return false;
  }

  function revealChangeItem(item) {
    var paragraphs, first, last, start, end, story, page, frames;
    if (!item) return;
    if (item.range) {
      try {
        frames = item.range.parentTextFrames;
        if (frames && frames.length > 0) {
          page = frames[0].parentPage;
          if (page && app.activeWindow) app.activeWindow.activePage = page;
        }
      } catch (er1) {}
      try {
        app.select(item.range);
        return;
      } catch (er2) {}
    }
    paragraphs = item.paragraphs && item.paragraphs.length ? item.paragraphs : [item.paragraph];
    first = paragraphs[0];
    last = paragraphs[paragraphs.length - 1];

    try {
      frames = first.parentTextFrames;
      if (frames && frames.length > 0) {
        page = frames[0].parentPage;
        if (page && app.activeWindow) app.activeWindow.activePage = page;
      }
    } catch (e1) {}

    if (selectLiveParagraphBlock(paragraphs)) return;

    try {
      story = first.parentStory;
      start = paragraphStartIndex(first);
      end = paragraphEndInsertionIndex(last) - 1;
      if (start >= 0 && end >= start) {
        app.select(story.characters.itemByRange(start, end));
        return;
      }
    } catch (e2) {}

    revealParagraph(first);
  }

  function revealParagraph(paragraph) {
    var page, frames;
    try {
      frames = paragraph.parentTextFrames;
      if (frames && frames.length > 0) {
        page = frames[0].parentPage;
        if (page && app.activeWindow) app.activeWindow.activePage = page;
      }
    } catch (e1) {}

    try {
      app.select(paragraph.texts[0]);
    } catch (e2) {
      try {
        app.select(paragraph);
      } catch (e3) {}
    }
  }

  function compareChangeItemsByIndex(a, b) {
    var ai = 0;
    var bi = 0;
    try { ai = a.range.insertionPoints[0].index; } catch (e1) {}
    try { bi = b.range.insertionPoints[0].index; } catch (e2) {}
    return ai - bi;
  }

  function conditionFindItems(story, condition, label) {
    var found = [];
    var items = [];
    var i;

    try {
      app.findTextPreferences = NothingEnum.NOTHING;
      app.changeTextPreferences = NothingEnum.NOTHING;
      app.findTextPreferences.appliedConditions = [condition];
      found = story.findText();
    } catch (e1) {
      try {
        app.findTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.appliedConditions = condition;
        found = story.findText();
      } catch (e2) {
        found = [];
      }
    }

    for (i = 0; i < found.length; i++) {
      items.push({
        range: found[i],
        label: label,
        paragraph: found[i].paragraphs.length ? found[i].paragraphs[0] : null
      });
    }

    try {
      app.findTextPreferences = NothingEnum.NOTHING;
      app.changeTextPreferences = NothingEnum.NOTHING;
    } catch (e3) {}

    return items;
  }

  function buildConditionNavigatorItems(story, conditions) {
    var items = [];
    items = items.concat(conditionFindItems(story, conditions.modificado, CONDITION_NAMES.modificado));
    items = items.concat(conditionFindItems(story, conditions.remocaoApos, CONDITION_NAMES.remocaoApos));
    items.sort(compareChangeItemsByIndex);
    return items;
  }

  function showChangeNavigator(changeItems) {
    var w, header, info, preview, controls, prevButton, nextButton, closeButton;
    var index = 0;
    if (!(changeItems && changeItems.length && changeItems[0].range)) {
      changeItems = groupChangeItems(changeItems);
    }
    var hasItems = changeItems && changeItems.length > 0;

    try {
      if ($.global.legislatorChangeNavigator && $.global.legislatorChangeNavigator.window) {
        $.global.legislatorChangeNavigator.window.close();
      }
    } catch (e1) {}

    w = new Window("palette", "Alteracoes da norma");
    w.orientation = "column";
    w.alignChildren = "fill";

    header = w.add("statictext", undefined, "Paragrafos alterados pelo diff");
    info = w.add("statictext", undefined, "");
    info.characters = 42;
    preview = w.add("statictext", undefined, "");
    preview.characters = 72;

    controls = w.add("group");
    controls.orientation = "row";
    prevButton = controls.add("button", undefined, "Anterior");
    nextButton = controls.add("button", undefined, "Proximo");
    closeButton = controls.add("button", undefined, "Fechar");

    prevButton.enabled = hasItems;
    nextButton.enabled = hasItems;

    function update() {
      var item;
      if (!hasItems) {
        info.text = "Nenhuma alteracao encontrada pelo diff.";
        preview.text = "";
        return;
      }
      item = changeItems[index];
      info.text = (index + 1) + " de " + changeItems.length + " - " + item.label;
      preview.text = getChangeItemPreview(item);
      revealChangeItem(item);
    }

    prevButton.onClick = function () {
      index = index <= 0 ? changeItems.length - 1 : index - 1;
      update();
    };

    nextButton.onClick = function () {
      index = index >= changeItems.length - 1 ? 0 : index + 1;
      update();
    };

    closeButton.onClick = function () {
      w.close();
    };

    $.global.legislatorChangeNavigator = {
      window: w,
      items: changeItems || []
    };

    w.onClose = function () {
      try {
        $.global.legislatorChangeNavigator = null;
      } catch (e2) {}
    };

    w.show();
    update();
  }

  function paragraphHasOverride(paragraph) {
    var leadingOriginal, leadingEstilo, hasRelevantOverride;

    try {
      if (!paragraph.styleOverridden) return false;
    } catch (e1) {
      return false;
    }

    try {
      leadingOriginal = paragraph.leading;
      leadingEstilo = paragraph.appliedParagraphStyle.leading;
      paragraph.leading = leadingEstilo;
      hasRelevantOverride = paragraph.styleOverridden ? true : false;
      paragraph.leading = leadingOriginal;
      return hasRelevantOverride;
    } catch (e2) {
      try {
        paragraph.leading = leadingOriginal;
      } catch (e3) {}
      return true;
    }
  }

  function isProtectedCharacterStyleName(name) {
    name = String(name || "").toLowerCase();
    return (
      name === "nao-hifenizar" ||
      name === "n\u00e3o-hifenizar" ||
      name === "nao-hifenizar italico" ||
      name === "n\u00e3o-hifenizar it\u00e1lico" ||
      name === "nao-hifenizar it\u00e1lico" ||
      name === "n\u00e3o-hifenizar italico" ||
      name === "sem-quebra" ||
      name === "sem quebra"
    );
  }

  function paragraphHasProtectedCharacterStyle(paragraph) {
    var ranges, i, name;
    try {
      ranges = paragraph.textStyleRanges;
      for (i = 0; i < ranges.length; i++) {
        try {
          name = ranges[i].appliedCharacterStyle.name;
          if (isProtectedCharacterStyleName(name)) return true;
        } catch (e1) {}
      }
    } catch (e2) {}
    return false;
  }

  function paragraphTables(paragraph) {
    var tables;
    try {
      tables = paragraph.tables.everyItem().getElements();
      if (tables && tables.length) return tables;
    } catch (e1) {}
    try {
      tables = paragraph.texts[0].tables.everyItem().getElements();
      if (tables && tables.length) return tables;
    } catch (e2) {}
    return [];
  }

  function tableComparableText(table) {
    var lines = [];
    var rows, cells, i, j, cellText;
    try {
      rows = table.rows.everyItem().getElements();
    } catch (e1) {
      rows = [];
    }
    for (i = 0; i < rows.length; i++) {
      try {
        cells = rows[i].cells.everyItem().getElements();
      } catch (e2) {
        cells = [];
      }
      cellText = [];
      for (j = 0; j < cells.length; j++) {
        try {
          cellText.push(normalizeText(cells[j].contents));
        } catch (e3) {
          cellText.push("");
        }
      }
      lines.push(cellText.join("\t"));
    }
    return normalizeText(lines.join(" "));
  }

  function paragraphIsInTableCell(paragraph) {
    var obj, name, guard = 0;
    try {
      obj = paragraph.parent;
      while (obj && guard < 8) {
        name = "";
        try {
          name = String(obj.constructor && obj.constructor.name ? obj.constructor.name : "");
        } catch (e1) {}
        if (name === "Cell" || name === "Cells") return true;
        if (name === "Table" || name === "Tables") return true;
        try {
          if (obj.hasOwnProperty && obj.hasOwnProperty("cells")) return true;
        } catch (e2) {}
        obj = obj.parent;
        guard++;
      }
    } catch (e3) {}
    return false;
  }

  function paragraphText(paragraph) {
    var tables, contents;
    try {
      if (!paragraph || paragraph.isValid === false) return "";
    } catch (e0) {
      return "";
    }
    try {
      tables = paragraphTables(paragraph);
      if (tables.length) return tableComparableText(tables[0]);
    } catch (e1) {}
    try {
      contents = paragraph.contents;
    } catch (e2) {
      return "";
    }
    return normalizeText(contents);
  }

  function collectPreservedParagraphs(frame) {
    var result = [];
    var paras = frame.parentStory.paragraphs;
    var i, text, hasOverride, hasProtectedStyle;
    for (i = 0; i < paras.length; i++) {
      text = paragraphText(paras[i]);
      if (!text) continue;
      hasOverride = paragraphHasOverride(paras[i]);
      hasProtectedStyle = paragraphHasProtectedCharacterStyle(paras[i]);
      if (hasOverride || hasProtectedStyle) {
        result.push({
          paragraph: paras[i],
          text: text,
          prev: i > 0 ? paragraphText(paras[i - 1]) : "",
          next: i < paras.length - 1 ? paragraphText(paras[i + 1]) : "",
          hasOverride: hasOverride,
          hasProtectedStyle: hasProtectedStyle
        });
      }
    }
    return result;
  }

  function findMatchingParagraph(info, paragraphs, used) {
    var candidates = [];
    var i, prev, next;
    for (i = 0; i < paragraphs.length; i++) {
      if (used[i]) continue;
      if (paragraphText(paragraphs[i]) === info.text) candidates.push(i);
    }
    if (candidates.length === 1) return candidates[0];
    for (i = 0; i < candidates.length; i++) {
      prev = candidates[i] > 0 ? paragraphText(paragraphs[candidates[i] - 1]) : "";
      next = candidates[i] < paragraphs.length - 1 ? paragraphText(paragraphs[candidates[i] + 1]) : "";
      if ((info.prev && info.prev === prev) || (info.next && info.next === next)) {
        return candidates[i];
      }
    }
    return -1;
  }

  function restorePreservedParagraphs(tempFrame, story, insertedBounds) {
    var preserved = collectPreservedParagraphs(tempFrame);
    var insertedText;
    var targetParas;
    var used = {};
    var restored = 0;
    var inspectedOverrides = 0;
    var inspectedProtectedStyles = 0;
    var i, idx;

    for (i = 0; i < preserved.length; i++) {
      if (preserved[i].hasOverride) inspectedOverrides++;
      if (preserved[i].hasProtectedStyle) inspectedProtectedStyles++;
    }

    if (!story || insertedBounds.end <= insertedBounds.start) {
      return {
        inspected: preserved.length,
        inspectedOverrides: inspectedOverrides,
        inspectedProtectedStyles: inspectedProtectedStyles,
        restored: 0
      };
    }

    insertedText = story.characters.itemByRange(insertedBounds.start, insertedBounds.end - 1);
    targetParas = insertedText.paragraphs;

    for (i = 0; i < preserved.length; i++) {
      idx = findMatchingParagraph(preserved[i], targetParas, used);
      if (idx < 0) continue;
      app.select(preserved[i].paragraph);
      app.copy();
      app.select(targetParas[idx]);
      app.paste();
      used[idx] = true;
      restored++;
    }
    return {
      inspected: preserved.length,
      inspectedOverrides: inspectedOverrides,
      inspectedProtectedStyles: inspectedProtectedStyles,
      restored: restored
    };
  }

  function createImportedTempFrame(selection, blocks, styles) {
    var doc = app.activeDocument;
    var layer = getLayer(doc, TEMP_LAYER_NAME);
    var frame, bounds;
    layer.visible = true;
    layer.locked = false;

    frame = doc.textFrames.add(layer);
    try {
      bounds = selection.parentTextFrames[0].geometricBounds;
      frame.geometricBounds = bounds;
    } catch (e1) {
      frame.geometricBounds = ["10mm", "10mm", "250mm", "190mm"];
    }
    frame.label = "XML Legislator para comparacao - " + (new Date()).toString();
    insertBlocks(frame.parentStory, 0, blocks, styles);
    return frame;
  }

  function collectComparableParagraphs(paragraphs, startIndex, progressLabel) {
    var result = [];
    var seen = {};
    var i, text, paragraph, pStart, firstBound = -1, lastBound = -1, item, total;
    var story, tables, table, tableStart, anchorParagraph;
    try {
      total = paragraphs.length;
    } catch (eLen) {
      total = 0;
    }
    try {
      if (total) {
        firstBound = paragraphs[startIndex || 0].insertionPoints[0].index;
        lastBound = paragraphs[total - 1].insertionPoints[-1].index;
      }
    } catch (e0) {}
    for (i = startIndex || 0; i < total; i++) {
      if (i === (startIndex || 0) || i % 50 === 0 || i === total - 1) {
        updateProgress(progressLabel || "Varrendo paragrafos", "Coletando texto comparavel", i + 1, total, false);
      }
      paragraph = paragraphs[i];
      if (paragraphIsInTableCell(paragraph)) continue;
      text = paragraphText(paragraph);
      if (!text) continue;
      try {
        pStart = paragraph.insertionPoints[0].index;
        seen[pStart] = true;
      } catch (e1) {}
      item = comparableItemFromParagraph(paragraph, i, text);
      if (item) result.push(item);
    }

    try {
      story = total ? paragraphs[0].parentStory : null;
      tables = story && story.tables ? story.tables.everyItem().getElements() : [];
    } catch (e2) {
      tables = [];
    }
    for (i = 0; i < tables.length; i++) {
      if (i === 0 || i % 10 === 0 || i === tables.length - 1) {
        updateProgress(progressLabel || "Varrendo tabelas", "Coletando tabelas ancoradas", i + 1, tables.length, false);
      }
      try {
        table = tables[i];
        tableStart = table.storyOffset.index;
        if (firstBound >= 0 && tableStart < firstBound) continue;
        if (lastBound >= 0 && tableStart > lastBound) continue;
        anchorParagraph = table.storyOffset.paragraphs[0];
        pStart = anchorParagraph.insertionPoints[0].index;
        if (seen[pStart]) continue;
        item = comparableItemFromParagraph(anchorParagraph, result.length);
        if (!item) continue;
        result.push(item);
        seen[pStart] = true;
      } catch (e3) {}
    }
    result.sort(function (a, b) { return a.start - b.start; });
    return result;
  }

  function attachImportedBlockFlags(items, blocks) {
    var filtered = [];
    var i, block, text;
    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      text = normalizeText(block && block.text ? block.text : "");
      if (!text) continue;
      filtered.push(block);
    }
    for (i = 0; i < items.length && i < filtered.length; i++) {
      items[i].alterado = filtered[i].alterado || "";
      items[i].sourceBlock = filtered[i];
    }
    return items;
  }

  function itemHasXmlChange(item) {
    return item && item.alterado === "modificado";
  }

  function comparableItemFromParagraph(paragraph, sourceIndex, precomputedText) {
    var tables, text, story, start, end;
    try {
      if (!paragraph || paragraph.isValid === false) return null;
    } catch (e0) {
      return null;
    }
    try {
      tables = paragraphTables(paragraph);
    } catch (e1) {
      tables = [];
    }
    text = precomputedText || (tables.length ? tableComparableText(tables[0]) : paragraphText(paragraph));
    if (!text) return null;
    try {
      story = paragraph.parentStory;
      start = paragraph.insertionPoints[0].index;
      end = paragraph.insertionPoints[-1].index - 1;
    } catch (e2) {
      return null;
    }
    return {
      paragraph: paragraph,
      text: text,
      isTable: tables.length > 0,
      sourceIndex: sourceIndex,
      story: story,
      start: start,
      end: end
    };
  }

  function buildLcsTable(oldItems, newItems) {
    var rows = oldItems.length + 1;
    var cols = newItems.length + 1;
    var table = [];
    var i, j, row, nextRow;

    for (i = 0; i < rows; i++) {
      row = [];
      for (j = 0; j < cols; j++) row[j] = 0;
      table[i] = row;
    }

    for (i = oldItems.length - 1; i >= 0; i--) {
      row = table[i];
      nextRow = table[i + 1];
      for (j = newItems.length - 1; j >= 0; j--) {
        if (oldItems[i].text === newItems[j].text) {
          row[j] = nextRow[j + 1] + 1;
        } else {
          row[j] = nextRow[j] >= row[j + 1] ? nextRow[j] : row[j + 1];
        }
      }
    }
    return table;
  }

  function diffParagraphs(oldItems, newItems) {
    var table = buildLcsTable(oldItems, newItems);
    var matches = [];
    var segments = [];
    var i = 0;
    var j = 0;
    var oldStart = 0;
    var newStart = 0;
    var match;

    while (i < oldItems.length && j < newItems.length) {
      if (oldItems[i].text === newItems[j].text) {
        matches.push({ oldIndex: i, newIndex: j });
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    for (i = 0; i <= matches.length; i++) {
      match = i < matches.length ? matches[i] : { oldIndex: oldItems.length, newIndex: newItems.length };
      if (match.oldIndex > oldStart || match.newIndex > newStart) {
        segments.push({
          oldStart: oldStart,
          oldEnd: match.oldIndex,
          newStart: newStart,
          newEnd: match.newIndex
        });
      }
      oldStart = match.oldIndex + 1;
      newStart = match.newIndex + 1;
    }

    segments.matches = matches;
    return segments;
  }

  function firstSelectedParagraph() {
    var sel;
    try {
      if (!app.selection.length) return null;
      sel = app.selection[0];
      if (sel.hasOwnProperty("paragraphs") && sel.paragraphs.length) return sel.paragraphs[0];
      if (sel.hasOwnProperty("parent") && sel.parent && sel.parent.hasOwnProperty("paragraphs")) return sel.parent.paragraphs[0];
    } catch (e) {}
    return null;
  }

  function copyParagraphOver(source, target) {
    var paragraph;
    app.select(source);
    app.copy();
    app.select(target);
    app.paste();
    paragraph = firstSelectedParagraph();
    return paragraph || target;
  }

  function itemTextRange(item) {
    if (item && item.isTable && item.paragraph) return item.paragraph;
    try {
      return item.story.characters.itemByRange(item.start, item.end);
    } catch (e) {
      return item.paragraph;
    }
  }

  function copyParagraphOverItem(source, targetItem) {
    var story, index, paragraph;
    story = targetItem.story;
    try {
      index = targetItem.paragraph.insertionPoints[0].index;
    } catch (e0) {
      index = targetItem.start;
    }
    try {
      app.select(source.texts[0]);
    } catch (e1) {
      app.select(source);
    }
    app.copy();
    if (!removeParagraphItem(targetItem)) return null;
    app.select(story.insertionPoints[index]);
    app.paste();
    paragraph = pastedParagraphAtIndex(story, index, source);
    return paragraph;
  }

  function pasteParagraphBefore(source, reference) {
    var paragraph;
    app.select(source);
    app.copy();
    app.select(reference.insertionPoints[0]);
    app.paste();
    paragraph = firstSelectedParagraph();
    return paragraph;
  }

  function pasteParagraphAtIndex(source, story, insertionIndex) {
    app.select(source);
    app.copy();
    app.select(story.insertionPoints[insertionIndex]);
    app.paste();
    return paragraphAtIndex(story, insertionIndex);
  }

  function pasteParagraphAtSelectionEnd(source, selection) {
    var paragraph;
    app.select(source);
    app.copy();
    app.select(selection.insertionPoints[-1]);
    app.paste();
    paragraph = firstSelectedParagraph();
    return paragraph;
  }

  function paragraphAtIndex(story, index) {
    try {
      return story.insertionPoints[index].paragraphs[0];
    } catch (e1) {
      try {
        return story.characters.itemByRange(index, index).paragraphs[0];
      } catch (e2) {}
    }
    return null;
  }

  function pastedParagraphAtIndex(story, index, source) {
    var expected, paragraph, i, candidate;
    expected = paragraphText(source);
    paragraph = paragraphAtIndex(story, index);
    if (paragraph && (!expected || paragraphText(paragraph) === expected)) return paragraph;

    try {
      for (i = 0; i < story.paragraphs.length; i++) {
        candidate = story.paragraphs[i];
        if (paragraphStartIndex(candidate) < index) continue;
        if (expected && paragraphText(candidate) === expected) return candidate;
        if (paragraphStartIndex(candidate) > index + 2) break;
      }
    } catch (e) {}

    return paragraph || firstSelectedParagraph();
  }

  function removeParagraph(paragraph) {
    try {
      paragraph.remove();
      return true;
    } catch (e1) {
      try {
        paragraph.texts[0].remove();
        return true;
      } catch (e2) {}
    }
    return false;
  }

  function removeParagraphItem(item) {
    try {
      itemTextRange(item).remove();
      return true;
    } catch (e1) {
      try {
        item.paragraph.remove();
        return true;
      } catch (e2) {}
    }
    return false;
  }

  function replaceItemWithBlocks(targetItem, blocks, styles) {
    var story, index, bounds, insertedText, paragraphs, paragraph;
    if (!targetItem || !blocks || !blocks.length) return null;
    story = targetItem.story;
    index = targetItem.start;
    if (!removeParagraphItem(targetItem)) return null;
    bounds = insertBlocks(story, index, blocks, styles);
    bounds.story = story;
    try {
      insertedText = story.characters.itemByRange(bounds.start, Math.max(bounds.start, bounds.end - 1));
      paragraphs = insertedText.paragraphs;
      if (paragraphs.length) {
        paragraph = paragraphs[0];
        return paragraph;
      }
    } catch (e1) {}
    paragraph = paragraphAtIndex(story, index);
    return paragraph;
  }

  function replaceItemWithSourceOrBlocks(targetItem, block, styles) {
    var paragraph = null;
    if (!targetItem || !block) return null;
    if (block.sourceParagraph) {
      try {
        paragraph = copyParagraphOverItem(block.sourceParagraph, targetItem);
      } catch (e1) {
        paragraph = null;
      }
      if (paragraph) {
        return paragraph;
      }
    }
    return replaceItemWithBlocks(targetItem, [block], styles);
  }

  function pushChangeItem(items, paragraph, label) {
    if (!paragraph) return;
    items.push({ paragraph: paragraph, label: label });
  }

  function markParagraph(paragraph, condition) {
    if (!paragraph || !condition) return false;
    try {
      return applyConditionToRange(paragraph.texts[0], condition);
    } catch (e) {
      return false;
    }
  }

  function markParagraphItem(item, condition) {
    if (!item || !condition) return false;
    try {
      return applyConditionToRange(itemTextRange(item), condition);
    } catch (e1) {
      return markParagraph(item.paragraph, condition);
    }
  }

  function markRemovalAfter(oldItems, oldIndex, conditions, changeItems, headMarker) {
    var marker = null;
    if (oldIndex > 0) marker = oldItems[oldIndex - 1];
    if (!marker) marker = headMarker;
    if (marker && markParagraphItem(marker, conditions.remocaoApos)) {
      pushChangeItem(changeItems, marker.paragraph, CONDITION_NAMES.remocaoApos);
      return 1;
    }
    return 0;
  }

  function applyIncrementalDiff(selection, skippedHead, tempFrame, blocks, conditions) {
    var originalItems = collectComparableParagraphs(selection.paragraphs, skippedHead, "Indexando texto original");
    var importedItems = attachImportedBlockFlags(collectComparableParagraphs(tempFrame.parentStory.paragraphs, 0, "Indexando XML importado"), blocks);
    var segments = diffParagraphs(originalItems, importedItems);
    var matches = segments.matches || [];
    var changeItems = [];
    var stats = {
      original: originalItems.length,
      imported: importedItems.length,
      segments: segments.length,
      modified: 0,
      added: 0,
      removed: 0,
      conditions: 0
    };
    var s, seg, oldLen, newLen, pairCount, i, j, paragraph, referenceIndex, story, selectedEnd, headMarker, match;
    story = originalItems.length ? originalItems[0].story : selection.parentStory;
    selectedEnd = originalItems.length ? originalItems[originalItems.length - 1].end + 1 : selection.insertionPoints[-1].index;
    headMarker = skippedHead > 0 && selection.paragraphs.length >= skippedHead ? comparableItemFromParagraph(selection.paragraphs[skippedHead - 1], skippedHead - 1) : null;

    for (i = matches.length - 1; i >= 0; i--) {
      match = matches[i];
      if (!itemHasXmlChange(importedItems[match.newIndex])) continue;
      paragraph = copyParagraphOverItem(importedItems[match.newIndex].paragraph, originalItems[match.oldIndex]);
      if (markParagraph(paragraph, conditions.modificado)) stats.conditions++;
      pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
      stats.modified++;
    }

    for (s = segments.length - 1; s >= 0; s--) {
      seg = segments[s];
      oldLen = seg.oldEnd - seg.oldStart;
      newLen = seg.newEnd - seg.newStart;
      pairCount = oldLen < newLen ? oldLen : newLen;

      if (newLen > pairCount) {
        referenceIndex = seg.oldEnd < originalItems.length ? originalItems[seg.oldEnd].start : -1;
        if (referenceIndex >= 0) {
          for (j = seg.newEnd - 1; j >= seg.newStart + pairCount; j--) {
            if (!itemHasXmlChange(importedItems[j])) continue;
            paragraph = pasteParagraphAtIndex(importedItems[j].paragraph, story, referenceIndex);
            if (markParagraph(paragraph, conditions.modificado)) stats.conditions++;
            pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
            stats.added++;
          }
        } else {
          for (j = seg.newEnd - 1; j >= seg.newStart + pairCount; j--) {
            if (!itemHasXmlChange(importedItems[j])) continue;
            paragraph = pasteParagraphAtIndex(importedItems[j].paragraph, story, selectedEnd);
            if (markParagraph(paragraph, conditions.modificado)) stats.conditions++;
            pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
            stats.added++;
          }
        }
      }

      if (oldLen > pairCount) {
        stats.conditions += markRemovalAfter(originalItems, seg.oldStart, conditions, changeItems, headMarker);
        for (i = oldLen - 1; i >= pairCount; i--) {
          if (removeParagraphItem(originalItems[seg.oldStart + i])) stats.removed++;
        }
      }

      for (i = pairCount - 1; i >= 0; i--) {
        if (!itemHasXmlChange(importedItems[seg.newStart + i])) continue;
        paragraph = copyParagraphOverItem(importedItems[seg.newStart + i].paragraph, originalItems[seg.oldStart + i]);
        if (markParagraph(paragraph, conditions.modificado)) stats.conditions++;
        pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
        stats.modified++;
      }
    }

    return {
      stats: stats,
      changeItems: changeItems
    };
  }

  function normalizeLocatorText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[–—]/g, "-")
      .replace(/[ÁÀÂÃÄ]/g, "A")
      .replace(/[áàâãä]/g, "a")
      .replace(/[ÉÈÊË]/g, "E")
      .replace(/[éèêë]/g, "e")
      .replace(/[ÍÌÎÏ]/g, "I")
      .replace(/[íìîï]/g, "i")
      .replace(/[ÓÒÔÕÖ]/g, "O")
      .replace(/[óòôõö]/g, "o")
      .replace(/[ÚÙÛÜ]/g, "U")
      .replace(/[úùûü]/g, "u")
      .replace(/[Ç]/g, "C")
      .replace(/[ç]/g, "c");
  }

  function articleKey(value) {
    var s = normalizeLocatorText(value).toUpperCase();
    var m = s.match(/(?:^|[^A-Z])ART\.?\s*([0-9]+(?:\s*-\s*[A-Z])?)/);
    if (!m) return "";
    return String(m[1]).replace(/\s+/g, "");
  }

  function locatorInfo(local) {
    var s = normalizeLocatorText(local).toLowerCase();
    var m;
    s = s.replace(/\s+/g, "");
    m = s.match(/^(apos|ap[oó]s)_?art(?:igo)?([0-9]+(?:-[a-z])?)$/);
    if (m) return { mode: "afterArticle", article: String(m[2]).toUpperCase() };
    m = s.match(/^art(?:igo)?([0-9]+(?:-[a-z])?)$/);
    if (m) return { mode: "inArticle", article: String(m[1]).toUpperCase() };
    return null;
  }

  function romanValue(roman) {
    var s = String(roman || "").toUpperCase();
    var values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    var total = 0;
    var prev = 0;
    var i, value;
    for (i = s.length - 1; i >= 0; i--) {
      value = values[s.charAt(i)] || 0;
      if (value < prev) total -= value;
      else {
        total += value;
        prev = value;
      }
    }
    return total;
  }

  function markerKeyFromText(tag, text) {
    var s = normalizeText(text);
    var m, base, suffix;
    tag = String(tag || "");

    if (tag === "Artigo") {
      base = articleKey(s);
      return base ? "artigo:" + base : "";
    }

    if (tag === "Paragrafo") {
      m = s.match(/^Par[aá]grafo\s+[uú]nico\.?/i);
      if (m) return "paragrafo:unico";
      m = s.match(/^§\s*([0-9]+)[ºo]?/i);
      if (m) return "paragrafo:" + String(m[1]);
      return "";
    }

    if (tag === "Inciso") {
      m = s.match(/^([IVXLCDM]+)(?:\s*[-–]\s*([A-Z]))?\s*[-–]/i);
      if (!m) return "";
      suffix = m[2] ? "-" + String(m[2]).toUpperCase() : "";
      return "inciso:" + romanValue(m[1]) + suffix;
    }

    if (tag === "Alinea") {
      m = s.match(/^([a-z])\)/i);
      return m ? "alinea:" + String(m[1]).toLowerCase() : "";
    }

    if (tag === "Item") {
      m = s.match(/^([0-9]+)\s*[-–.)]/);
      return m ? "item:" + String(m[1]) : "";
    }

    return "";
  }

  function markerKeyFromBlock(block) {
    return markerKeyFromText(block ? block.tag : "", block ? block.text : "");
  }

  function markerKeyFromItem(item, preferredTag) {
    var key;
    if (preferredTag) {
      key = markerKeyFromText(preferredTag, item ? item.text : "");
      if (key) return key;
    }
    key = markerKeyFromText("Artigo", item ? item.text : "");
    if (key) return key;
    key = markerKeyFromText("Paragrafo", item ? item.text : "");
    if (key) return key;
    key = markerKeyFromText("Inciso", item ? item.text : "");
    if (key) return key;
    key = markerKeyFromText("Alinea", item ? item.text : "");
    if (key) return key;
    key = markerKeyFromText("Item", item ? item.text : "");
    return key;
  }

  function markerOrder(marker) {
    var parts = String(marker || "").split(":");
    var value;
    if (parts.length < 2) return -1;
    if (parts[1] === "unico") return 1;
    value = parseInt(parts[1], 10);
    if (isNaN(value)) return -1;
    return value;
  }

  function markerType(marker) {
    var parts = String(marker || "").split(":");
    return parts.length ? parts[0] : "";
  }

  function buildLocalOperations(blocks) {
    var operations = [];
    var current = null;
    var warnings = [];
    var i, block, info;

    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      info = locatorInfo(block.local);
      if (info && info.mode === "afterArticle") {
        current = {
          type: "insertAfterArticle",
          local: block.local,
          article: info.article,
          alterado: block.alterado,
          blocks: [block]
        };
        operations.push(current);
        continue;
      }
      if (info && info.mode === "inArticle") {
        current = null;
        operations.push({
          type: "upsertInArticle",
          local: block.local,
          article: info.article,
          alterado: block.alterado,
          blocks: [block]
        });
        continue;
      }
      if (current && current.type === "insertAfterArticle") {
        current.blocks.push(block);
      } else {
        warnings.push("Bloco sem atributo local ignorado: " + block.tag + " - " + normalizeText(block.text).substr(0, 60));
      }
    }

    return { operations: operations, warnings: warnings };
  }

  function itemLooksLikeArticleStart(item) {
    if (!item) return false;
    if (articleKey(item.text)) return true;
    try {
      if (paragraphHasStyleInGroup(item.paragraph, "art", "corpo-legis")) return true;
      if (paragraphHasStyleInGroup(item.paragraph, "art-tit-centro", "corpo-legis")) return true;
    } catch (e) {}
    return false;
  }

  function articleCandidateRanges(items) {
    var starts = [];
    var ranges = [];
    var i, start, end;
    for (i = 0; i < items.length; i++) {
      if (itemLooksLikeArticleStart(items[i])) starts.push(i);
    }
    for (i = 0; i < starts.length; i++) {
      start = starts[i];
      end = i + 1 < starts.length ? starts[i + 1] : items.length;
      ranges.push({ items: items, start: start, end: end });
    }
    return ranges;
  }

  function normalizeReferencePiece(text) {
    return normalizeText(normalizeLocatorText(text)).toLowerCase();
  }

  function referenceBlocksForArticle(references, article) {
    var key = "art" + String(article || "").toLowerCase();
    if (!references) return null;
    return references[key] || references[String(article || "").toLowerCase()] || null;
  }

  function candidateText(range) {
    var parts = [];
    var i;
    for (i = range.start; i < range.end; i++) parts.push(range.items[i].text);
    return normalizeReferencePiece(parts.join(" "));
  }

  function referenceScore(range, referenceBlocks) {
    var haystack = candidateText(range);
    var score = 0;
    var checked = 0;
    var i, piece;
    if (!referenceBlocks || !referenceBlocks.length || !haystack) return 0;
    for (i = 0; i < referenceBlocks.length; i++) {
      piece = normalizeReferencePiece(referenceBlocks[i].text);
      if (!piece || piece.length < 8) continue;
      checked++;
      if (haystack.indexOf(piece) >= 0) score += piece.length >= 40 ? 3 : 1;
    }
    if (!checked) return 0;
    return score;
  }

  function findArticleRangeByReference(items, references, article) {
    var referenceBlocks = referenceBlocksForArticle(references, article);
    var ranges, best = null, bestScore = 0;
    var i, score;
    if (!referenceBlocks || !referenceBlocks.length) return null;
    ranges = articleCandidateRanges(items);
    for (i = 0; i < ranges.length; i++) {
      score = referenceScore(ranges[i], referenceBlocks);
      if (score > bestScore) {
        bestScore = score;
        best = ranges[i];
      }
    }
    return bestScore > 0 ? best : null;
  }

  function findArticleRange(selection, skippedHead, article, references, operationIndex, operationTotal) {
    var label = operationIndex && operationTotal
      ? "Buscando artigo " + article + " - alteracao " + operationIndex + "/" + operationTotal
      : "Buscando artigo " + article;
    var items = collectComparableParagraphs(selection.paragraphs, skippedHead, label);
    var i, key, start = -1, end, byReference;
    for (i = 0; i < items.length; i++) {
      key = articleKey(items[i].text);
      if (key === article) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      byReference = findArticleRangeByReference(items, references, article);
      if (byReference) return byReference;
      return null;
    }
    end = items.length;
    for (i = start + 1; i < items.length; i++) {
      if (itemLooksLikeArticleStart(items[i])) {
        end = i;
        break;
      }
    }
    return { items: items, start: start, end: end };
  }

  function itemInsertionAfter(item) {
    try {
      return item.paragraph.insertionPoints[-1].index;
    } catch (e1) {
      return item.end + 1;
    }
  }

  function itemParagraphIsValid(item) {
    try {
      return item && item.paragraph && item.paragraph.isValid !== false;
    } catch (e) {
      return false;
    }
  }

  function contextMatchIsLive(match, type) {
    if (!match || !itemParagraphIsValid(match.endItem)) return false;
    if (type !== "inserirApos" && !itemParagraphIsValid(match.nextItem)) return false;
    return true;
  }

  function liveItemStart(item) {
    try {
      return item.paragraph.insertionPoints[0].index;
    } catch (e1) {
      return item.start;
    }
  }

  function findTargetItemInArticle(range, block) {
    var wanted = markerKeyFromBlock(block);
    var i, item, key, text;
    if (!range) return null;
    if (block.tag === "Artigo") return range.items[range.start];
    if (wanted) {
      for (i = range.start + 1; i < range.end; i++) {
        item = range.items[i];
        key = markerKeyFromItem(item, block.tag);
        if (key === wanted) return item;
      }
    }
    text = normalizeText(block.text);
    if (text) {
      for (i = range.start + 1; i < range.end; i++) {
        if (normalizeText(range.items[i].text) === text) return range.items[i];
      }
    }
    return null;
  }

  function insertionIndexInArticle(range, block) {
    var wanted = markerKeyFromBlock(block);
    var wantedType = markerType(wanted);
    var wantedOrder = markerOrder(wanted);
    var i, item, key, order;
    if (!range) return -1;
    if (wanted && wantedOrder >= 0) {
      for (i = range.start + 1; i < range.end; i++) {
        item = range.items[i];
        key = markerKeyFromItem(item, block.tag);
        if (markerType(key) !== wantedType) continue;
        order = markerOrder(key);
        if (order > wantedOrder) return liveItemStart(item);
      }
    }
    return itemInsertionAfter(range.items[range.end - 1]);
  }

  function blockComparableText(block) {
    return normalizeText(block && block.text ? block.text : "");
  }

  function itemComparableText(item) {
    return normalizeText(item && item.text ? item.text : "");
  }

  function contextMatchAt(items, context, start) {
    var j;
    if (start < 0 || start + context.length > items.length) return false;
    for (j = 0; j < context.length; j++) {
      if (itemComparableText(items[start + j]) !== context[j]) return false;
    }
    return true;
  }

  function contextMatchResult(items, start, length, partial, omitted) {
    var end = start + length - 1;
    return {
      items: items,
      start: start,
      end: end,
      endItem: items[end],
      nextItem: end + 1 < items.length ? items[end + 1] : null,
      partial: partial || false,
      omitted: omitted || 0
    };
  }

  function findExactContextInItems(items, context) {
    var i;
    if (!context.length || context.length > items.length) return null;
    for (i = context.length - 1; i < items.length; i++) {
      if (contextMatchAt(items, context, i - context.length + 1)) {
        return contextMatchResult(items, i - context.length + 1, context.length, false, 0);
      }
    }
    return null;
  }

  function findUniqueContextSuffixInItems(items, context) {
    var omitted, suffix, matches, start, match;
    for (omitted = 1; omitted < context.length; omitted++) {
      suffix = context.slice(omitted);
      if (!suffix.length || suffix.length > items.length) continue;
      matches = [];
      for (start = 0; start <= items.length - suffix.length; start++) {
        if (contextMatchAt(items, suffix, start)) {
          matches.push(contextMatchResult(items, start, suffix.length, true, omitted));
          if (matches.length > 1) break;
        }
      }
      if (matches.length === 1) {
        match = matches[0];
        return match;
      }
    }
    return null;
  }

  function truncateDebugText(text, max) {
    text = String(text || "");
    if (text.length <= max) return text;
    return text.substr(0, max) + "...";
  }

  function charCodeHex(ch) {
    if (!ch) return "EOF";
    var code = ch.charCodeAt(0).toString(16).toUpperCase();
    while (code.length < 4) code = "0" + code;
    return "U+" + code;
  }

  function charDebugName(ch) {
    if (ch === "") return "fim do texto";
    if (ch === "\uFEFF") return "BOM/FEFF";
    if (ch === "\u00A0") return "espaco nao separavel";
    if (ch === "\t") return "tab";
    if (ch === "\r") return "quebra de paragrafo";
    if (ch === "\n") return "quebra de linha";
    if (/^\s$/.test(ch)) return "espaco";
    if (/[\x00-\x1F\uFFFC]/.test(ch)) return "controle/invisivel";
    return ch;
  }

  function firstDifferenceDebug(xmlText, idText) {
    var a = String(xmlText || "");
    var b = String(idText || "");
    var len = Math.max(a.length, b.length);
    var i, ca, cb, start, endA, endB;
    for (i = 0; i < len; i++) {
      ca = i < a.length ? a.charAt(i) : "";
      cb = i < b.length ? b.charAt(i) : "";
      if (ca !== cb) {
        start = Math.max(0, i - 18);
        endA = Math.min(a.length, i + 18);
        endB = Math.min(b.length, i + 18);
        return (
          "Primeira diferenca na posicao " + (i + 1) + ":\n" +
          "XML: " + charDebugName(ca) + " (" + charCodeHex(ca) + ")\n" +
          "ID : " + charDebugName(cb) + " (" + charCodeHex(cb) + ")\n" +
          "XML trecho: " + truncateDebugText(a.substring(start, endA), 80) + "\n" +
          "ID trecho : " + truncateDebugText(b.substring(start, endB), 80)
        );
      }
    }
    return "Sem diferenca de caracteres detectada.";
  }

  function scoreContextWindow(items, context, start) {
    var score = 0;
    var j, itemText, contextText;
    if (start < 0 || start >= items.length) return 0;
    for (j = 0; j < context.length && start + j < items.length; j++) {
      itemText = itemComparableText(items[start + j]);
      contextText = context[j];
      if (itemText === contextText) {
        score += 1000;
      } else {
        if (itemText && contextText && itemText.indexOf(contextText) >= 0) score += 100;
        if (itemText && contextText && contextText.indexOf(itemText) >= 0) score += 100;
        if (itemText && contextText && itemText.substr(0, 40) === contextText.substr(0, 40)) score += 40;
        if (itemText && contextText && itemText.substr(0, 20) === contextText.substr(0, 20)) score += 20;
      }
    }
    return score;
  }

  function bestContextDebugStart(items, context) {
    var bestStart = 0;
    var bestScore = -1;
    var limit, start, score;
    if (!items.length || !context.length) return 0;
    limit = Math.max(0, items.length - Math.max(1, context.length));
    for (start = 0; start <= limit; start++) {
      score = scoreContextWindow(items, context, start);
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }
    return bestStart;
  }

  function alertContextComparisonDebug(items, context) {
    var lines = [];
    var start = bestContextDebugStart(items, context);
    var j, xmlText, idText, item;
    lines.push("DEBUG - comparacao de contexto");
    lines.push("Blocos XML: " + context.length + " | Paragrafos InDesign: " + items.length);
    lines.push("Janela InDesign analisada a partir do item " + (start + 1));
    lines.push("");
    for (j = 0; j < context.length; j++) {
      item = start + j < items.length ? items[start + j] : null;
      xmlText = context[j] || "";
      idText = item ? itemComparableText(item) : "";
      lines.push("#" + (j + 1));
      lines.push("XML: " + truncateDebugText(xmlText, 420));
      lines.push("ID : " + truncateDebugText(idText, 420));
      lines.push(xmlText === idText ? "OK: iguais" : "DIFERENTES");
      if (xmlText !== idText) lines.push(firstDifferenceDebug(xmlText, idText));
      lines.push("");
      if (lines.join("\n").length > 3600) {
        lines.push("... debug truncado ...");
        break;
      }
    }
    alert(lines.join("\n"));
  }

  function findContextMatch(selection, skippedHead, contextBlocks, operationIndex, operationTotal, cachedItems) {
    var label = operationIndex && operationTotal
      ? "Comparando contexto - alteracao " + operationIndex + "/" + operationTotal
      : "Comparando contexto";
    var items = cachedItems || collectComparableParagraphs(selection.paragraphs, skippedHead, label);
    var context = [];
    var i, text, match;
    updateProgress(label, cachedItems ? "Usando indice ja coletado" : "Coletando texto comparavel", operationIndex || 0, operationTotal || 0, true);
    for (i = 0; i < contextBlocks.length; i++) {
      text = blockComparableText(contextBlocks[i]);
      if (text) context.push(text);
    }
    match = findExactContextInItems(items, context);
    if (match) return match;
    match = findUniqueContextSuffixInItems(items, context);
    if (match) return match;
    alertContextComparisonDebug(items, context);
    return null;
  }

  function applyContextOperations(selection, parsed, tempFrame, styles, conditions) {
    var operations = parsed.contextOperations || [];
    var changeItems = [];
    var warnings = [];
    var stats = {
      operations: operations.length,
      inserted: 0,
      replaced: 0,
      removed: 0,
      notFound: 0,
      warnings: 0,
      conditions: 0
    };
    var story = selection.parentStory;
    var op, match, target, paragraph, insertionIndex, i, remainingBlocks, contextItems;

    attachSourceParagraphsFromTempFrame(tempFrame, parsed.blocks);
    contextItems = collectComparableParagraphs(selection.paragraphs, parsed.skippedHead, "Indexando texto original para contexto");

    for (i = 0; i < operations.length; i++) {
      op = operations[i];
      updateProgress("Aplicando alteracoes por contexto", "Alteracao " + (i + 1) + " de " + operations.length, i + 1, operations.length, true);
      match = findContextMatch(selection, parsed.skippedHead, op.contextBlocks, i + 1, operations.length, contextItems);
      if (match && !contextMatchIsLive(match, op.type)) {
        updateProgress("Reindexando texto original", "Referencia invalidada antes da alteracao " + (i + 1), i + 1, operations.length, true);
        contextItems = collectComparableParagraphs(selection.paragraphs, parsed.skippedHead, "Reindexando texto original");
        match = findContextMatch(selection, parsed.skippedHead, op.contextBlocks, i + 1, operations.length, contextItems);
      }
      if (!match) {
        stats.notFound++;
        warnings.push("Nao localizei o contexto da alteracao " + (i + 1) + ".");
        continue;
      }
      if (match.partial) {
        warnings.push("Alteracao " + (i + 1) + " localizada por contexto parcial; " + match.omitted + " bloco(s) inicial(is) do contexto nao coincidiram.");
      }

      if (op.type === "removerProximo") {
        if (!match.nextItem) {
          stats.notFound++;
          warnings.push("Contexto localizado, mas nao ha paragrafo seguinte para remover na alteracao " + (i + 1) + ".");
          continue;
        }
        if (markParagraphItem(match.endItem, conditions.remocaoApos)) {
          stats.conditions++;
          pushChangeItem(changeItems, match.endItem.paragraph, CONDITION_NAMES.remocaoApos);
        }
        if (removeParagraphItem(match.nextItem)) stats.removed++;
        continue;
      }

      if (op.type === "inserirApos") {
        insertionIndex = itemInsertionAfter(match.endItem);
        stats.inserted += op.blocks.length;
        stats.conditions += insertOperationBlocks(story, insertionIndex, op.blocks, styles, conditions, changeItems);
        continue;
      }

      if (!match.nextItem) {
        stats.notFound++;
        warnings.push("Contexto localizado, mas nao ha paragrafo seguinte para substituir na alteracao " + (i + 1) + ".");
        continue;
      }

      if (!op.blocks.length) {
        stats.notFound++;
        warnings.push("Alteracao " + (i + 1) + " nao contem bloco novo.");
        continue;
      }

      target = match.nextItem;
      paragraph = replaceItemWithSourceOrBlocks(target, op.blocks[0], styles);
      if (!paragraph) {
        stats.notFound++;
        warnings.push("Nao consegui copiar o bloco novo da alteracao " + (i + 1) + ".");
        continue;
      }
      if (markParagraph(paragraph, conditions.modificado)) {
        stats.conditions++;
        pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
      }
      stats.replaced++;

      if (op.blocks.length > 1) {
        insertionIndex = itemInsertionAfter(comparableItemFromParagraph(paragraph, 0));
        remainingBlocks = op.blocks.slice(1);
        stats.inserted += remainingBlocks.length;
        stats.conditions += insertOperationBlocks(story, insertionIndex, remainingBlocks, styles, conditions, changeItems);
      }
    }

    stats.warnings = warnings.length;
    return {
      stats: stats,
      warnings: warnings,
      changeItems: changeItems
    };
  }

  function propagateOperationAlterado(operation) {
    var i;
    if (!operation || operation.alterado !== "modificado") return;
    for (i = 0; i < operation.blocks.length; i++) {
      if (!operation.blocks[i].alterado) operation.blocks[i].alterado = "modificado";
    }
  }

  function attachSourceParagraphsFromTempFrame(tempFrame, blocks) {
    var items = attachImportedBlockFlags(collectComparableParagraphs(tempFrame.parentStory.paragraphs, 0, "Indexando XML importado"), blocks);
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].sourceBlock) items[i].sourceBlock.sourceParagraph = items[i].paragraph;
    }
  }

  function prepareNeutralInsertionLine(story, insertionIndex) {
    var ip, noneStyle;
    if (!story || insertionIndex < 0) return false;
    noneStyle = noneCharacterStyle(app.activeDocument);
    try {
      ip = story.insertionPoints[insertionIndex];
      if (noneStyle) ip.appliedCharacterStyle = noneStyle;
      ip.contents = "\r";
      try {
        if (noneStyle) story.insertionPoints[insertionIndex].appliedCharacterStyle = noneStyle;
      } catch (e1) {}
      try {
        applyNoneCharacterStyle(story.characters.itemByRange(insertionIndex, insertionIndex));
      } catch (e2) {}
      return true;
    } catch (e3) {
      return false;
    }
  }

  function removeNeutralInsertionLine(story, insertionIndex) {
    var ch;
    if (!story || insertionIndex < 0) return;
    try {
      ch = story.characters[insertionIndex];
      if (String(ch.contents) === "\r") ch.remove();
    } catch (e) {}
  }

  function insertOperationBlocks(story, insertionIndex, blocks, styles, conditions, changeItems) {
    var bounds, items, i, applied, removeNeutralBreak;
    if (insertionIndex < 0) return 0;
    removeNeutralBreak = prepareNeutralInsertionLine(story, insertionIndex);
    bounds = insertBlocks(story, insertionIndex, blocks, styles);
    bounds.story = story;
    if (removeNeutralBreak) removeNeutralInsertionLine(story, bounds.end);
    applied = applyConditionsToInsertedBlocks(story, bounds, blocks, conditions);
    items = collectChangeItemsFromInsertedBlocks(story, bounds, blocks, conditions);
    for (i = 0; i < items.length; i++) changeItems.push(items[i]);
    return applied;
  }

  function applyLocalOperations(selection, parsed, tempFrame, styles, conditions) {
    var grouped = buildLocalOperations(parsed.blocks);
    var operations = grouped.operations;
    var warnings = grouped.warnings;
    var changeItems = [];
    var stats = {
      operations: operations.length,
      inserted: 0,
      replaced: 0,
      notFound: 0,
      warnings: warnings.length,
      conditions: 0
    };
    var op, range, target, paragraph, insertionIndex, story, i, block;

    attachSourceParagraphsFromTempFrame(tempFrame, parsed.blocks);
    story = selection.parentStory;

    for (i = 0; i < operations.length; i++) {
      op = operations[i];
      propagateOperationAlterado(op);
      updateProgress("Aplicando alteracoes por artigo", "Alteracao " + (i + 1) + " de " + operations.length, i + 1, operations.length, true);
      range = findArticleRange(selection, parsed.skippedHead, op.article, parsed.references, i + 1, operations.length);
      if (!range) {
        stats.notFound++;
        warnings.push("Nao localizei o artigo de referencia para local=\"" + op.local + "\".");
        continue;
      }

      if (op.type === "insertAfterArticle") {
        insertionIndex = itemInsertionAfter(range.items[range.end - 1]);
        stats.inserted += op.blocks.length;
        stats.conditions += insertOperationBlocks(story, insertionIndex, op.blocks, styles, conditions, changeItems);
        continue;
      }

      block = op.blocks[0];
      target = findTargetItemInArticle(range, block);
      if (target && block.sourceParagraph) {
        paragraph = copyParagraphOverItem(block.sourceParagraph, target);
        if (conditionForAlterado(block.alterado, conditions) && markParagraph(paragraph, conditions.modificado)) {
          stats.conditions++;
          pushChangeItem(changeItems, paragraph, CONDITION_NAMES.modificado);
        }
        stats.replaced++;
      } else {
        if (!markerKeyFromBlock(block)) {
          stats.notFound++;
          warnings.push("Nao encontrei marcador reconhecivel para inserir/substituir em local=\"" + op.local + "\": " + block.tag + ".");
          continue;
        }
        insertionIndex = insertionIndexInArticle(range, block);
        if (insertionIndex < 0) {
          stats.notFound++;
          warnings.push("Nao consegui definir ponto de insercao para local=\"" + op.local + "\".");
          continue;
        }
        stats.inserted += op.blocks.length;
        stats.conditions += insertOperationBlocks(story, insertionIndex, op.blocks, styles, conditions, changeItems);
      }
    }

    return {
      stats: stats,
      warnings: warnings,
      changeItems: changeItems
    };
  }

  function buildMapUi(container, title, map) {
    var panel = container.add("panel", undefined, title);
    panel.alignChildren = "fill";
    panel.margins = 10;
    var fields = {};
    var key, row, label, input;
    for (key in map) {
      if (!map.hasOwnProperty(key)) continue;
      row = panel.add("group");
      row.orientation = "row";
      row.alignChildren = ["fill", "center"];
      label = row.add("statictext", undefined, key);
      label.preferredSize.width = 104;
      input = row.add("edittext", undefined, map[key]);
      input.characters = 32;
      fields[key] = input;
    }
    return fields;
  }

  function showDialog() {
    var w = new Window("dialog", "Atualizar norma do Legislator - localizadores");
    w.orientation = "column";
    w.alignChildren = "fill";
    w.margins = 12;
    w.spacing = 8;

    var fileGroup = w.add("group");
    fileGroup.orientation = "row";
    fileGroup.alignChildren = ["fill", "center"];
    var choose = fileGroup.add("button", undefined, "Escolher XML...");
    var status = fileGroup.add("statictext", undefined, "Nenhum arquivo selecionado");
    status.characters = 48;

    var mapGroup = w.add("group");
    mapGroup.orientation = "row";
    mapGroup.alignChildren = ["fill", "top"];
    mapGroup.spacing = 10;

    var pFields = buildMapUi(mapGroup, "Tags XML > estilos de paragrafo (grupo/estilo)", DEFAULTS.paragraph);
    var cFields = buildMapUi(mapGroup, "Tags XML > estilos de caractere", DEFAULTS.character);

    var buttons = w.add("group");
    buttons.alignment = "right";
    var ok = buttons.add("button", undefined, "Confirmar", { name: "ok" });
    buttons.add("button", undefined, "Cancelar", { name: "cancel" });
    ok.enabled = false;

    var selectedFile = null;
    choose.onClick = function () {
      selectedFile = File.openDialog("Selecione o XML exportado pelo Legislator", "*.xml");
      if (selectedFile) {
        status.text = "Arquivo pronto para atualizacao localizada: " + selectedFile.name;
        if (isEmendaConstitucionalXml(readFile(selectedFile))) {
          applyEmendaConstitucionalFields(pFields);
        }
        ok.enabled = true;
      }
    };

    if (w.show() !== 1 || !selectedFile) return null;

    var map = { paragraph: {}, character: {} };
    var key;
    for (key in pFields) if (pFields.hasOwnProperty(key)) map.paragraph[key] = pFields[key].text;
    for (key in cFields) if (cFields.hasOwnProperty(key)) map.character[key] = cFields[key].text;
    return { file: selectedFile, map: map };
  }

  function main() {
    if (!app.documents.length) fail("Abra um documento do InDesign antes de executar o script.");

    var selection = resolveInitialSelection();
    var ui = showDialog();
    var xmlText, parsed, styles, conditions, originalStory, tempFrame, report, changeItems;
    if (!ui) return;

    openProgressWindow();
    try {
      updateProgress("Lendo XML", ui.file ? ui.file.fsName : "", 0, 0, true);
      xmlText = readFile(ui.file);

      updateProgress("Interpretando XML", "Convertendo blocos e alteracoes", 0, 0, true);
      parsed = parseXmlBlocks(xmlText);
      if (!parsed.blocks.length && !(parsed.contextOperations && parsed.contextOperations.length)) {
        fail("O XML nao contem blocos de texto importaveis.\nTags iniciais detectadas: " + previewXmlTags(xmlText));
      }
      updateProgress(
        "XML interpretado",
        "Blocos: " + parsed.blocks.length + " | alteracoes: " + ((parsed.contextOperations && parsed.contextOperations.length) || 0),
        0,
        0,
        true
      );

      updateProgress("Resolvendo estilos", "Localizando estilos de paragrafo e caractere", 0, 0, true);
      styles = resolveStyleMaps(app.activeDocument, ui.map);

      updateProgress("Preparando condicoes", "Criando/localizando textConditions", 0, 0, true);
      conditions = ensureLegislatorConditions(app.activeDocument);

      originalStory = selection.parentStory;

      updateProgress("Montando frame temporario", "Inserindo XML em camada temporaria", 0, 0, true);
      tempFrame = createImportedTempFrame(selection, parsed.blocks, styles);

      updateProgress("Aplicando atualizacoes", "Iniciando comparacao", 0, 0, true);
      report = parsed.contextOperations && parsed.contextOperations.length
        ? applyContextOperations(selection, parsed, tempFrame, styles, conditions)
        : applyLocalOperations(selection, parsed, tempFrame, styles, conditions);

      updateProgress("Montando navegador", "Coletando marcacoes de alteracao", 0, 0, true);
      changeItems = report.changeItems && report.changeItems.length ? report.changeItems : buildConditionNavigatorItems(originalStory, conditions);

      updateProgress("Finalizando", "Ocultando camada temporaria", 0, 0, true);
      hideTempLayer(tempFrame);

      updateProgress("Abrindo navegador", "Itens de alteracao: " + changeItems.length, 0, 0, true);
      showChangeNavigator(changeItems);

      closeProgressWindow();
      alert(
        "Atualizacao por localizadores concluida.\n\n" +
        "Operacoes localizadas no XML: " + report.stats.operations + "\n" +
        "Blocos inseridos: " + report.stats.inserted + "\n" +
        "Blocos substituidos: " + report.stats.replaced + "\n" +
        "Referencias nao localizadas: " + report.stats.notFound + "\n" +
        "Avisos: " + report.warnings.length + "\n" +
        "Marcacoes de condicao aplicadas: " + report.stats.conditions + "\n\n" +
        (report.warnings.length ? "Primeiro aviso: " + report.warnings[0] + "\n\n" : "") +
        "O texto importado foi mantido e ocultado na camada \"" + TEMP_LAYER_NAME + "\"."
      );
    } catch (err) {
      alert(
        "Erro durante a atualizacao localizada.\n\n" +
        "Ultimas etapas registradas:\n" +
        progressSummary() + "\n\n" +
        "Erro: " + (err && err.message ? err.message : err)
      );
      closeProgressWindow();
      throw err;
    }
  }

  main();
})();
