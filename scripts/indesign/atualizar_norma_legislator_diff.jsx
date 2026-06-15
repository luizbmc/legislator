/*
  Atualizar norma a partir de XML do Legislator - approach incremental por diff.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto da norma no InDesign.
    2. Execute este script.
    3. Escolha o XML exportado pelo Legislator.
    4. Revise os mapeamentos de tags para estilos e confirme.
    5. O XML sera montado na camada temporaria e comparado com o texto original.
*/

#target "InDesign"
#targetengine "legislatorAtualizarNormaDiff"

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

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function normalizeText(s) {
    return trim(String(s || "")
      .replace(/~I/g, "")
      .replace(/[\u0007\uFEFF\uFFFC]/g, "")
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
      alterado: xmlAttr(xml, "alterado")
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
    var i, j, block, paraStyle, start, end, run, range;

    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      if (block.isTable) {
        ip = insertTableBlock(story, ip, block, styles);
        continue;
      }
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
    var tables = paragraphTables(paragraph);
    if (tables.length) return tableComparableText(tables[0]);
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

  function collectComparableParagraphs(paragraphs, startIndex) {
    var result = [];
    var seen = {};
    var i, text, paragraph, pStart, firstBound = -1, lastBound = -1;
    var story, tables, table, tableStart, anchorParagraph;
    try {
      if (paragraphs.length) {
        firstBound = paragraphs[startIndex || 0].insertionPoints[0].index;
        lastBound = paragraphs[paragraphs.length - 1].insertionPoints[-1].index;
      }
    } catch (e0) {}
    for (i = startIndex || 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      if (i > (startIndex || 0) && paragraphStyleStartsWithEpigrafe(paragraph)) {
        try {
          lastBound = paragraph.insertionPoints[0].index - 1;
        } catch (e1a) {}
        break;
      }
      if (paragraphIsInTableCell(paragraph)) continue;
      text = paragraphText(paragraph);
      if (!text) continue;
      try {
        pStart = paragraph.insertionPoints[0].index;
        seen[pStart] = true;
      } catch (e1) {}
      result.push(comparableItemFromParagraph(paragraph, i));
    }

    try {
      story = paragraphs.length ? paragraphs[0].parentStory : null;
      tables = story && story.tables ? story.tables.everyItem().getElements() : [];
    } catch (e2) {
      tables = [];
    }
    for (i = 0; i < tables.length; i++) {
      try {
        table = tables[i];
        tableStart = table.storyOffset.index;
        if (firstBound >= 0 && tableStart < firstBound) continue;
        if (lastBound >= 0 && tableStart > lastBound) continue;
        anchorParagraph = table.storyOffset.paragraphs[0];
        pStart = anchorParagraph.insertionPoints[0].index;
        if (seen[pStart]) continue;
        result.push(comparableItemFromParagraph(anchorParagraph, result.length));
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

  function comparableItemFromParagraph(paragraph, sourceIndex) {
    var tables = paragraphTables(paragraph);
    return {
      paragraph: paragraph,
      text: tables.length ? tableComparableText(tables[0]) : paragraphText(paragraph),
      isTable: tables.length > 0,
      sourceIndex: sourceIndex,
      story: paragraph.parentStory,
      start: paragraph.insertionPoints[0].index,
      end: paragraph.insertionPoints[-1].index - 1
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
    var target;
    target = itemTextRange(targetItem);
    app.select(source);
    app.copy();
    app.select(target);
    app.paste();
    return paragraphAtIndex(targetItem.story, targetItem.start) || targetItem.paragraph;
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
    var originalItems = collectComparableParagraphs(selection.paragraphs, skippedHead);
    var importedItems = attachImportedBlockFlags(collectComparableParagraphs(tempFrame.parentStory.paragraphs, 0), blocks);
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
    var w = new Window("dialog", "Atualizar norma do Legislator - diff incremental");
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
        status.text = "Arquivo pronto para comparacao: " + selectedFile.name;
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
    if (!ui) return;

    var xmlText = readFile(ui.file);
    var parsed = parseXmlBlocks(xmlText);
    if (!parsed.blocks.length) {
      fail("O XML nao contem blocos de texto importaveis.\nTags iniciais detectadas: " + previewXmlTags(xmlText));
    }

    var styles = resolveStyleMaps(app.activeDocument, ui.map);
    var conditions = ensureLegislatorConditions(app.activeDocument);
    var originalStory = selection.parentStory;
    var tempFrame = createImportedTempFrame(selection, parsed.blocks, styles);
    var report = applyIncrementalDiff(selection, parsed.skippedHead, tempFrame, parsed.blocks, conditions);
    var changeItems = buildConditionNavigatorItems(originalStory, conditions);
    if (!changeItems.length) changeItems = report.changeItems.reverse();
    hideTempLayer(tempFrame);
    showChangeNavigator(changeItems);

    alert(
      "Atualizacao incremental concluida.\n\n" +
      "Paragrafos no texto original comparado: " + report.stats.original + "\n" +
      "Paragrafos no XML importado: " + report.stats.imported + "\n" +
      "Trechos com diferenca: " + report.stats.segments + "\n\n" +
      "Paragrafos substituidos: " + report.stats.modified + "\n" +
      "Paragrafos adicionados: " + report.stats.added + "\n" +
      "Paragrafos removidos: " + report.stats.removed + "\n" +
      "Marcacoes de condicao aplicadas: " + report.stats.conditions + "\n\n" +
      "O texto importado foi mantido e ocultado na camada \"" + TEMP_LAYER_NAME + "\"."
    );
  }

  main();
})();
