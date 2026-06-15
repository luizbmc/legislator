/*
  Inserir nova norma a partir de XML do Legislator.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Coloque o cursor no ponto onde a norma deve entrar.
       Alternativamente, selecione um frame de texto para inserir no fim da story.
    2. Execute este script.
    3. Escolha o XML exportado pelo Legislator.
    4. Revise os mapeamentos de tags XML para estilos do InDesign.
    5. Clique em Inserir.
*/

#target "InDesign"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var TABLE_STYLE_NAME = "tabela1";
  var CELL_STYLE_NAME = "cel-corpo";

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
      NotaEmItalico: "italico light",
      sup: "sobrescrito"
    }
  };

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function trim(s) {
    return String(s || "").replace(/^\s+|\s+$/g, "");
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

  function getValidItem(collection, name) {
    var item;
    try {
      item = collection.itemByName(name);
      item.name;
      return item;
    } catch (e) {
      return null;
    }
  }

  function collectNamedItems(container, itemCollectionName, groupCollectionName, name, results) {
    var i, item, group, items, groups;
    try {
      items = container[itemCollectionName];
      for (i = 0; i < items.length; i++) {
        item = items[i];
        if (String(item.name || "") === name) results.push(item);
      }
    } catch (e1) {}
    try {
      groups = container[groupCollectionName];
      for (i = 0; i < groups.length; i++) {
        group = groups[i];
        collectNamedItems(group, itemCollectionName, groupCollectionName, name, results);
      }
    } catch (e2) {}
  }

  function findNamedStyleAnywhere(doc, itemCollectionName, groupCollectionName, name) {
    var results = [];
    collectNamedItems(doc, itemCollectionName, groupCollectionName, name, results);
    return results.length ? results[0] : null;
  }

  function collectParagraphStylesByName(container, name, results) {
    var i, style, group;
    try {
      for (i = 0; i < container.paragraphStyles.length; i++) {
        style = container.paragraphStyles[i];
        if (String(style.name || "") === name) results.push(style);
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
    if (
      tagName === "b" ||
      tagName === "i" ||
      tagName === "Regular" ||
      tagName === "Nota" ||
      tagName === "Rotulo" ||
      tagName === "sup"
    ) {
      return tagName;
    }
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
    var i, start, end, tableXml;
    if (localName(xml) === "Tabela") return tableBlockFromXml(xml);
    if (localName(xml) === "Paragrafo") {
      tableXml = childTableXml(xml);
      if (tableXml && !textFromInlineXml(xml).replace(textFromInlineXml(tableXml), "").replace(/\s+/g, "")) {
        return tableBlockFromXml(tableXml);
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
      footnotes: footnotes
    };
  }

  function textFromInlineXml(xml) {
    var runs = [];
    var text = "";
    var i;
    collectInline(xml, [], runs);
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
      rows: rows
    };
  }

  function parseXmlBlocks(xmlText) {
    XML.ignoreWhitespace = false;
    XML.prettyPrinting = false;

    var xml = new XML(prepareXmlText(xmlText));
    var blocks = [];
    var children = xml.children();
    var i;
    for (i = 0; i < children.length(); i++) {
      if (children[i].nodeKind && children[i].nodeKind() === "element") {
        blocks.push(blockFromXml(children[i]));
      }
    }
    return blocks;
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

  function insertionTargetFromSelection(doc) {
    var sel;
    if (!app.selection.length) {
      fail("Coloque o cursor no ponto de insercao ou selecione um frame de texto antes de executar.");
    }
    sel = app.selection[0];

    try {
      if (sel.constructor && String(sel.constructor.name) === "TextFrame") {
        return { story: sel.parentStory, index: sel.parentStory.insertionPoints[-1].index };
      }
    } catch (e0) {}

    try {
      if (sel.hasOwnProperty("insertionPoints")) {
        return { story: sel.parentStory, index: sel.insertionPoints[0].index };
      }
    } catch (e1) {}

    try {
      if (sel.constructor && String(sel.constructor.name) === "InsertionPoint") {
        return { story: sel.parentStory, index: sel.index };
      }
    } catch (e2) {}

    try {
      if (sel.hasOwnProperty("parentStory") && sel.parentStory && sel.insertionPoints) {
        return { story: sel.parentStory, index: sel.insertionPoints[0].index };
      }
    } catch (e3) {}

    try {
      if (sel.hasOwnProperty("texts") && sel.texts.length) {
        return { story: sel.texts[0].parentStory, index: sel.texts[0].insertionPoints[0].index };
      }
    } catch (e4) {}

    try {
      if (sel.hasOwnProperty("parentStory")) {
        return { story: sel.parentStory, index: sel.parentStory.insertionPoints[-1].index };
      }
    } catch (e5) {}

    try {
      if (sel.hasOwnProperty("texts") && sel.texts.length) {
        return { story: sel.texts[0].parentStory, index: sel.texts[0].parentStory.insertionPoints[-1].index };
      }
    } catch (e6) {}

    fail("Selecao invalida. Coloque o cursor em um texto ou selecione um frame de texto.");
  }

  function noneCharacterStyle(doc) {
    var style;
    try {
      style = getValidItem(doc.characterStyles, "[Nenhum(a)]");
      if (isValidObject(style)) return style;
    } catch (e1) {}
    try {
      style = getValidItem(doc.characterStyles, "[None]");
      if (isValidObject(style)) return style;
    } catch (e2) {}
    try {
      style = getValidItem(doc.characterStyles, "$ID/[None]");
      if (isValidObject(style)) return style;
    } catch (e3) {}
    try {
      style = doc.characterStyles[0];
      if (isValidObject(style)) return style;
    } catch (e4) {}
    return null;
  }

  function isEmptyParagraph(paragraph) {
    var text;
    try {
      text = String(paragraph.contents || "");
      text = text.replace(/[\r\n\t \u00a0]/g, "");
      return text.length === 0;
    } catch (e) {
      return false;
    }
  }

  function prepareEmptyInsertionParagraph(doc, target, styles) {
    var ip, paragraph, noneStyle, baseParagraphStyle;
    try {
      ip = target.story.insertionPoints[target.index];
      paragraph = ip.paragraphs[0];
    } catch (e0) {
      return;
    }

    if (!isValidObject(paragraph) || !isEmptyParagraph(paragraph)) return;

    baseParagraphStyle = styles.paragraph.Paragrafo;
    noneStyle = noneCharacterStyle(doc);

    if (baseParagraphStyle) {
      try {
        paragraph.appliedParagraphStyle = baseParagraphStyle;
      } catch (e1) {}
    }

    if (noneStyle) {
      try {
        paragraph.texts[0].appliedCharacterStyle = noneStyle;
      } catch (e2) {}
      try {
        paragraph.insertionPoints.everyItem().appliedCharacterStyle = noneStyle;
      } catch (e3) {}
      try {
        ip.appliedCharacterStyle = noneStyle;
      } catch (e4) {}
    }
  }

  function clearInsertionPointCharacterStyle(doc, target) {
    var ip, noneStyle;
    noneStyle = noneCharacterStyle(doc);
    if (!noneStyle) return;

    try {
      ip = target.story.insertionPoints[target.index];
    } catch (e0) {
      return;
    }

    try {
      ip.appliedCharacterStyle = noneStyle;
    } catch (e1) {}

    try {
      app.select(ip);
      if (app.selection.length) {
        app.selection[0].appliedCharacterStyle = noneStyle;
      }
    } catch (e2) {}
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
      end: ip.index,
      story: story
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

  function tableText(block) {
    var lines = [];
    var i;
    for (i = 0; i < block.rows.length; i++) {
      lines.push(block.rows[i].join("\t"));
    }
    return lines.join("\r");
  }

  function isValidObject(obj) {
    try {
      return obj && obj.isValid;
    } catch (e) {
      return false;
    }
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

  function buildMapUi(container, title, map) {
    var panel = container.add("panel", undefined, title);
    var fields = {};
    var key, row, label, input;
    panel.orientation = "column";
    panel.alignChildren = ["fill", "top"];
    panel.margins = 8;
    panel.spacing = 3;

    for (key in map) {
      if (!map.hasOwnProperty(key)) continue;
      row = panel.add("group");
      row.orientation = "row";
      row.alignChildren = ["left", "center"];
      label = row.add("statictext", undefined, "<" + key + ">");
      label.preferredSize.width = 118;
      input = row.add("edittext", undefined, map[key]);
      input.characters = 34;
      fields[key] = input;
    }
    return fields;
  }

  function showDialog() {
    var w = new Window("dialog", "Inserir norma XML do Legislator");
    var selectedFile = null;
    var info, fileRow, chooseBtn, preview, pFields, cFields, buttons, okBtn, cancelBtn;
    var key;

    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.margins = 10;
    w.spacing = 6;
    w.preferredSize.width = 560;

    info = w.add("statictext", undefined, "Insira uma nova norma XML no ponto do cursor. Revise os mapeamentos antes de confirmar.");
    info.characters = 62;

    fileRow = w.add("group");
    fileRow.orientation = "row";
    chooseBtn = fileRow.add("button", undefined, "Escolher XML...");
    preview = fileRow.add("statictext", undefined, "Nenhum arquivo selecionado.");
    preview.characters = 52;

    var tabs = w.add("tabbedpanel");
    tabs.alignChildren = ["fill", "fill"];
    tabs.preferredSize = [540, 390];

    var pTab = tabs.add("tab", undefined, "Paragrafo");
    pTab.orientation = "column";
    pTab.alignChildren = ["fill", "top"];
    pFields = buildMapUi(pTab, "Tags XML > estilos de paragrafo (grupo/estilo)", DEFAULTS.paragraph);

    var cTab = tabs.add("tab", undefined, "Caractere");
    cTab.orientation = "column";
    cTab.alignChildren = ["fill", "top"];
    cFields = buildMapUi(cTab, "Tags XML > estilos de caractere", DEFAULTS.character);
    tabs.selection = pTab;

    buttons = w.add("group");
    buttons.alignment = "right";
    okBtn = buttons.add("button", undefined, "Inserir", { name: "ok" });
    cancelBtn = buttons.add("button", undefined, "Cancelar", { name: "cancel" });
    okBtn.enabled = false;

    chooseBtn.onClick = function () {
      selectedFile = File.openDialog("Selecione o XML exportado pelo Legislator", "*.xml");
      if (!selectedFile) return;
      preview.text = selectedFile.fsName;
      if (isEmendaConstitucionalXml(readFile(selectedFile))) {
        applyEmendaConstitucionalFields(pFields);
      }
      okBtn.enabled = true;
    };

    cancelBtn.onClick = function () { w.close(0); };

    if (w.show() !== 1 || !selectedFile) return null;

    var map = { paragraph: {}, character: {} };
    for (key in pFields) if (pFields.hasOwnProperty(key)) map.paragraph[key] = pFields[key].text;
    for (key in cFields) if (cFields.hasOwnProperty(key)) map.character[key] = cFields[key].text;

    return { file: selectedFile, map: map };
  }

  function main() {
    if (!app.documents.length) fail("Abra um documento do InDesign antes de executar.");

    var doc = app.activeDocument;
    var target = insertionTargetFromSelection(doc);
    var ui = showDialog();
    if (!ui) return;

    var xmlText = readFile(ui.file);
    var blocks = parseXmlBlocks(xmlText);
    if (!blocks.length) {
      fail("O XML nao contem blocos de texto importaveis.\nTags iniciais detectadas: " + previewXmlTags(xmlText));
    }

    var styles = resolveStyleMaps(doc, ui.map);
    clearInsertionPointCharacterStyle(doc, target);
    prepareEmptyInsertionParagraph(doc, target, styles);
    var insertedBounds = insertBlocks(target.story, target.index, blocks, styles);

    alert(
      "Norma inserida com sucesso.\n\n" +
      "Paragrafos inseridos: " + blocks.length
    );
  }

  main();
})();
