/*
  Atualizar norma a partir de XML do Legislator.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto da norma no InDesign.
    2. Execute este script.
    3. Escolha o XML exportado pelo Legislator.
    4. Revise os mapeamentos de tags para estilos e confirme.
*/

#target "InDesign"
#targetengine "legislatorAtualizarNorma"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var TEMP_LAYER_NAME = "legislator-temporaria";
  var CONDITION_NAMES = {
    modificado: "Par\u00e1grafo modificado",
    remocaoApos: "Par\u00e1grafo exclu\u00eddo abaixo"
  };
  var DEFAULTS = {
    paragraph: {
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

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function normalizeText(s) {
    return trim(String(s || "")
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
      alterado: xmlAttr(xml, "alterado")
    };
  }

  function textFromInlineXml(xml) {
    var runs = [];
    var text = "";
    var i;
    collectInline(xml, [], runs, null);
    for (i = 0; i < runs.length; i++) text += runs[i].text;
    return String(text || "");
  }

  function parseXmlBlocks(xmlText) {
    XML.ignoreWhitespace = false;
    XML.prettyPrinting = false;

    var xml = new XML(prepareXmlText(xmlText));
    var blocks = [];
    var skippedHeadBlocks = [];
    var skippedHead = 0;
    var children = xml.children();
    var i, tag;
    for (i = 0; i < children.length(); i++) {
      tag = localName(children[i]);
      if (tag === "Epigrafe" || tag === "EpigrafeApelido") {
        if (blocks.length === 0) skippedHeadBlocks.push(blockFromXml(children[i]));
        if (blocks.length === 0) skippedHead++;
        continue;
      }
      if (children[i].nodeKind && children[i].nodeKind() === "element") {
        blocks.push(blockFromXml(children[i]));
      }
    }
    return { blocks: blocks, skippedHead: skippedHead, skippedHeadBlocks: skippedHeadBlocks };
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

  function insertBlocks(story, insertionIndex, blocks, styles) {
    var ip = story.insertionPoints[insertionIndex];
    var insertStart = insertionIndex;
    var i, j, block, paraStyle, start, end, run, range;

    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      start = ip.index;
      ip.contents = block.text + "\r";
      end = start + block.text.length;

      paraStyle = styles.paragraph[block.tag];
      if (paraStyle) {
        story.characters.itemByRange(start, end).appliedParagraphStyle = paraStyle;
      }

      for (j = 0; j < block.runs.length; j++) {
        run = block.runs[j];
        if (!run.charKey || !styles.character[run.charKey] || run.start > run.end) continue;
        range = story.characters.itemByRange(start + run.start, start + run.end);
        range.appliedCharacterStyle = styles.character[run.charKey];
      }

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

  function showChangeNavigator(changeItems) {
    var w, header, info, preview, controls, prevButton, nextButton, closeButton;
    var index = 0;
    var hasItems = changeItems && changeItems.length > 0;

    try {
      if ($.global.legislatorChangeNavigator && $.global.legislatorChangeNavigator.window) {
        $.global.legislatorChangeNavigator.window.close();
      }
    } catch (e1) {}

    w = new Window("palette", "Alteracoes da norma");
    w.orientation = "column";
    w.alignChildren = "fill";

    header = w.add("statictext", undefined, "Paragrafos marcados no XML");
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
        info.text = "Nenhuma alteracao marcada no XML.";
        preview.text = "";
        return;
      }
      item = changeItems[index];
      info.text = (index + 1) + " de " + changeItems.length + " - " + item.label;
      preview.text = getParagraphPreview(item.paragraph);
      revealParagraph(item.paragraph);
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

  function paragraphText(paragraph) {
    return normalizeText(paragraph.contents);
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
    var w = new Window("dialog", "Atualizar norma do Legislator");
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
        status.text = "Arquivo pronto para substituicao: " + selectedFile.name;
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
    if (!ui) return;

    var xmlText = readFile(ui.file);
    var parsed = parseXmlBlocks(xmlText);
    if (!parsed.blocks.length) {
      fail("O XML nao contem blocos de texto importaveis.\nTags iniciais detectadas: " + previewXmlTags(xmlText));
    }

    var styles = resolveStyleMaps(app.activeDocument, ui.map);
    var conditions = ensureLegislatorConditions(app.activeDocument);
    var tempFrame = duplicateSelectionToTemp(selection);
    if (app.selection.length && app.selection[0].hasOwnProperty("parentStory")) {
      selection = app.selection[0];
    }
    var preservedConditions = applyConditionsToPreservedHead(selection, parsed.skippedHeadBlocks, conditions);
    var preservedChangeItems = collectChangeItemsFromPreservedHead(selection, parsed.skippedHeadBlocks, conditions);
    var insertedBounds = replaceSelectedBody(selection, parsed.skippedHead, parsed.blocks, styles);
    var report = restorePreservedParagraphs(tempFrame, insertedBounds.story, insertedBounds);
    var insertedConditions = applyConditionsToInsertedBlocks(insertedBounds.story, insertedBounds, parsed.blocks, conditions);
    var insertedChangeItems = collectChangeItemsFromInsertedBlocks(insertedBounds.story, insertedBounds, parsed.blocks, conditions);
    var changeItems = preservedChangeItems.concat(insertedChangeItems);
    var totalConditions = preservedConditions + insertedConditions;
    hideTempLayer(tempFrame);
    showChangeNavigator(changeItems);

    alert(
      "Atualizacao concluida.\n\n" +
      "Paragrafos preservaveis encontrados no texto antigo: " + report.inspected + "\n" +
      "Com override: " + report.inspectedOverrides + "\n" +
      "Com estilo de caractere protegido: " + report.inspectedProtectedStyles + "\n" +
      "Paragrafos retornados ao frame original: " + report.restored + "\n\n" +
      "Paragrafos marcados com condicao de alteracao: " + totalConditions + "\n\n" +
      "Uma copia do texto anterior foi mantida e ocultada na camada \"" + TEMP_LAYER_NAME + "\"."
    );
  }

  main();
})();
