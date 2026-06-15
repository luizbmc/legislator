/*
  Atualizar norma a partir de XML do Legislator - approach por arvore estrutural.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto da norma no InDesign.
    2. Execute este script.
    3. Escolha o XML completo/legacy exportado pelo Legislator.
    4. Confira o relatorio estrutural e confirme a aplicacao.

  A estrategia:
    - monta uma arvore/index estrutural da selecao no InDesign;
    - monta a mesma arvore a partir do XML;
    - identifica somente blocos com alterado="modificado";
    - se o caminho estrutural existe no InDesign, substitui o paragrafo;
    - se nao existe, insere apos o item estrutural anterior encontrado.
*/

#target "InDesign"
#targetengine "legislatorAtualizarNormaArvore"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var TEMP_LAYER_NAME = "legislator-temporaria-arvore";
  var CONDITION_MODIFICADO = "Par\u00e1grafo adicionado/modificado";
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
      Inciso: "corpo-legis/texto-lei",
      Alinea: "corpo-legis/texto-lei",
      Item: "corpo-legis/texto-lei",
      Citacao: "corpo-legis/texto-lei-citacao",
      Data: "corpo-legis/ass-data",
      Assinatura: "corpo-legis/ass-nome"
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

  function trim(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  function normalizeSpaces(value) {
    return trim(String(value || "")
      .replace(/[\u0004\uFEFF\uFFFC]/g, "")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " "));
  }

  function normalizeForMatch(value) {
    return normalizeSpaces(value)
      .toUpperCase()
      .replace(/[\u00c1\u00c0\u00c2\u00c3\u00c4]/g, "A")
      .replace(/[\u00c9\u00c8\u00ca\u00cb]/g, "E")
      .replace(/[\u00cd\u00cc\u00ce\u00cf]/g, "I")
      .replace(/[\u00d3\u00d2\u00d4\u00d5\u00d6]/g, "O")
      .replace(/[\u00da\u00d9\u00db\u00dc]/g, "U")
      .replace(/\u00c7/g, "C");
  }

  function lowerStyleName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\u00e1\u00e0\u00e2\u00e3\u00e4]/g, "a")
      .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, "e")
      .replace(/[\u00ed\u00ec\u00ee\u00ef]/g, "i")
      .replace(/[\u00f3\u00f2\u00f4\u00f5\u00f6]/g, "o")
      .replace(/[\u00fa\u00f9\u00fb\u00fc]/g, "u")
      .replace(/\u00e7/g, "c");
  }

  function isValidObject(obj) {
    try {
      return obj && obj.isValid !== false;
    } catch (e) {
      return false;
    }
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

  function styleHasAnyGroup(style, groups) {
    var i;
    for (i = 0; i < groups.length; i++) {
      if (styleHasGroup(style, groups[i])) return true;
    }
    return false;
  }

  function paragraphText(paragraph) {
    var text;
    try {
      if (!paragraph || paragraph.isValid === false) return "";
      text = paragraph.contents;
    } catch (e) {
      return "";
    }
    return normalizeSpaces(text);
  }

  function activeTextSelection() {
    var sel;
    if (!app.selection.length) fail("Selecione o texto da norma antes de executar.");
    sel = app.selection[0];
    try {
      if (sel.hasOwnProperty("parentStory") && sel.hasOwnProperty("paragraphs")) return sel;
      if (sel.hasOwnProperty("paragraphs") && sel.paragraphs.length) return sel.texts[0];
      if (sel.hasOwnProperty("baseline") && sel.parent && sel.parent.hasOwnProperty("parentStory")) return sel.parent;
    } catch (e) {}
    fail("A selecao ativa precisa estar dentro de uma story de texto.");
  }

  function paragraphTag(paragraph, text) {
    var style, name, inTitSubtit, inCorpoLegis;
    try {
      style = paragraph.appliedParagraphStyle;
      name = lowerStyleName(style.name);
      inTitSubtit = styleHasAnyGroup(style, ["tit-subtit", "tit-substit"]);
      inCorpoLegis = styleHasGroup(style, "corpo-legis");
    } catch (e) {
      return "";
    }

    if (inTitSubtit && name === "parte-livro-tit-cap") return "Divisao";
    if (inTitSubtit && (
      name === "abertura-cap" ||
      name === "abertura-cap-quebra" ||
      name === "abertura-cap-nova-pq" ||
      name === "abertura-capitulo"
    )) return "AberturaCapitulo";
    if (inTitSubtit && name === "secao-subsecao") return "Secao";

    if (inCorpoLegis && name === "art") return "Artigo";
    if (inCorpoLegis && (name === "art-tit-centro" || name === "artigo-titulo")) return "ArtigoTitulo";
    if (inCorpoLegis && name === "corpo-tratado") return "CorpoTratado";

    if (inCorpoLegis && name === "texto-lei") {
      if (/^Par[a\u00e1]grafo\s+\u00fanico\b/i.test(text) || /^\u00a7/.test(text)) return "Paragrafo";
      if (/^[IVXLCDM]+(?:-[A-Z])?\s*[\u2013\u2014-]\s/.test(text)) return "Inciso";
      if (/^[a-z\u00e0-\u00ff]\)\s/i.test(text)) return "Alinea";
      if (/^\d+(?:\.\d+)?(?:[.)]|\s*[\u2013\u2014-])\s/i.test(text)) return "Item";
      return "Paragrafo";
    }
    return "";
  }

  function headingLevel(tag, text) {
    var norm = normalizeForMatch(text);
    if (tag === "Divisao") {
      if (/^PARTE\b/.test(norm)) return 1;
      if (/^LIVRO\b/.test(norm)) return 2;
      if (/^TITULO\b/.test(norm)) return 3;
      if (/^CAPITULO\b/.test(norm)) return 4;
      return 4;
    }
    if (tag === "AberturaCapitulo") return 4;
    if (tag === "Secao") {
      if (/^SUBSECAO\b/.test(norm)) return 6;
      if (/^SECAO\b/.test(norm)) return 5;
      return 5;
    }
    return 0;
  }

  function articleLabel(text) {
    var match = String(text || "").match(/\bArt(?:\.|igo)?\s*[\u00a0\s]*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:-[A-Z])?)\s*([\u00ba\u00aa\u00b0])?/i);
    if (!match) return "";
    return "Art. " + match[1] + (match[2] || "");
  }

  function deviceLabel(tag, text) {
    var norm = normalizeForMatch(text);
    var match;
    if (!(tag === "Paragrafo" || tag === "Inciso" || tag === "Alinea" || tag === "Item" || tag === "CorpoTratado")) return "";
    if (/^PARAGRAFO UNICO\b/.test(norm)) return "Par\u00e1grafo \u00fanico";
    match = String(text || "").match(/^\u00a7\s*\d+\s*[\u00ba\u00aa\u00b0]?(?:-[A-Z])?/i);
    if (match) return normalizeSpaces(match[0]);
    match = String(text || "").match(/^([IVXLCDM]+(?:-[A-Z])?)\s*[\u2013\u2014-]\s/i);
    if (match) return String(match[1]).toUpperCase();
    match = String(text || "").match(/^([a-z\u00e0-\u00ff])\)\s/i);
    if (match) return String(match[1]).toLowerCase() + ")";
    match = String(text || "").match(/^(\d+(?:\.\d+)?)(?:[.)]|\s*[\u2013\u2014-])\s/i);
    if (match) return String(match[1]);
    return "";
  }

  function currentPath(headings) {
    var parts = [];
    var i;
    for (i = 0; i < headings.length; i++) parts.push(headings[i].text);
    return parts.join(" > ");
  }

  function entryKey(kind, path, article, label) {
    return normalizeForMatch(kind + "|" + path + "|" + article + "|" + label);
  }

  function joinNonEmpty(parts) {
    var clean = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i]) clean.push(parts[i]);
    }
    return clean.join(" > ");
  }

  function lineWithIndent(text, depth) {
    var s = "";
    var i;
    for (i = 0; i < depth; i++) s += "  ";
    return s + text;
  }

  function addIndexEntry(index, entry) {
    index.entries.push(entry);
    if (!index.byKey[entry.key]) index.byKey[entry.key] = entry;
  }

  function finishIndexArticle(article, headings, index) {
    var suffix;
    if (!article) return null;
    suffix = article.devices.length ? " {" + article.devices.join("; ") + "};" : ".";
    index.lines.push(lineWithIndent(article.label + suffix, headings.length));
    return null;
  }

  function addIndexDevice(article, tag, text, paragraph, index) {
    var label = deviceLabel(tag, text);
    var fullLabel, key;
    if (!article || !label) return;

    if (tag === "Paragrafo") {
      article.currentParagraph = label;
      article.currentInciso = "";
      article.currentAlinea = "";
      fullLabel = label;
    } else if (tag === "Inciso" || tag === "CorpoTratado") {
      article.currentInciso = label;
      article.currentAlinea = "";
      fullLabel = article.currentParagraph ? article.currentParagraph + " > " + label : label;
    } else if (tag === "Alinea") {
      article.currentAlinea = label;
      fullLabel = joinNonEmpty([article.currentParagraph, article.currentInciso, label]);
    } else if (tag === "Item") {
      fullLabel = joinNonEmpty([article.currentParagraph, article.currentInciso, article.currentAlinea, label]);
    } else {
      return;
    }
    article.devices.push(fullLabel);
    key = entryKey("dispositivo", article.path, article.label, fullLabel);
    addIndexEntry(index, {
      kind: "dispositivo",
      tag: tag,
      path: article.path,
      article: article.label,
      label: fullLabel,
      key: key,
      paragraph: paragraph,
      text: text
    });
  }

  function buildInDesignIndex(selection) {
    var paragraphs, index = { entries: [], byKey: {}, lines: [], totalParagraphs: 0 };
    var headings = [], article = null;
    var i, paragraph, text, tag, level, label, path, key;
    try {
      paragraphs = selection.paragraphs.everyItem().getElements();
    } catch (e) {
      fail("Nao foi possivel ler os paragrafos da selecao.");
    }

    for (i = 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      if (!isValidObject(paragraph)) continue;
      text = paragraphText(paragraph);
      if (!text) continue;
      index.totalParagraphs++;
      tag = paragraphTag(paragraph, text);
      if (!tag) continue;

      level = headingLevel(tag, text);
      if (level) {
        article = finishIndexArticle(article, headings, index);
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level: level, text: text });
        path = currentPath(headings);
        key = entryKey("heading", path, "", text);
        index.lines.push(lineWithIndent(text, headings.length - 1));
        addIndexEntry(index, { kind: "heading", tag: tag, path: path, article: "", label: text, key: key, paragraph: paragraph, text: text });
        continue;
      }

      if (tag === "Artigo" || tag === "ArtigoTitulo") {
        article = finishIndexArticle(article, headings, index);
        label = articleLabel(text);
        if (!label) continue;
        path = currentPath(headings);
        key = entryKey("artigo", path, "", label);
        article = {
          label: label,
          path: path,
          devices: [],
          currentParagraph: "",
          currentInciso: "",
          currentAlinea: ""
        };
        addIndexEntry(index, { kind: "artigo", tag: tag, path: path, article: "", label: label, key: key, paragraph: paragraph, text: text });
        continue;
      }

      addIndexDevice(article, tag, text, paragraph, index);
    }

    article = finishIndexArticle(article, headings, index);
    return index;
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
    var i, item, group;
    try {
      for (i = 0; i < container[itemCollectionName].length; i++) {
        item = container[itemCollectionName][i];
        if (String(item.name || "") === name) results.push(item);
      }
    } catch (e1) {}
    try {
      for (i = 0; i < container[groupCollectionName].length; i++) {
        group = container[groupCollectionName][i];
        collectNamedItems(group, itemCollectionName, groupCollectionName, name, results);
      }
    } catch (e2) {}
  }

  function findNamedStyleAnywhere(doc, itemCollectionName, groupCollectionName, name) {
    var results = [];
    collectNamedItems(doc, itemCollectionName, groupCollectionName, name, results);
    return results.length ? results[0] : null;
  }

  function findParagraphStyle(doc, path, tagName) {
    var parts = String(path).split("/");
    var group, style, i;
    if (parts.length === 1) {
      style = findNamedStyleAnywhere(doc, "paragraphStyles", "paragraphStyleGroups", parts[0]);
      if (!style) fail("Estilo de paragrafo nao encontrado para <" + tagName + ">: " + path);
      return style;
    }
    group = getValidItem(doc.paragraphStyleGroups, parts[0]);
    if (!group) fail("Grupo de estilo de paragrafo nao encontrado: " + parts[0]);
    for (i = 1; i < parts.length - 1; i++) {
      group = getValidItem(group.paragraphStyleGroups, parts[i]);
      if (!group) fail("Subgrupo de estilo de paragrafo nao encontrado: " + parts[i]);
    }
    style = getValidItem(group.paragraphStyles, parts[parts.length - 1]);
    if (!style) fail("Estilo de paragrafo nao encontrado para <" + tagName + ">: " + path);
    return style;
  }

  function findCharacterStyle(doc, name, tagName) {
    var style = getValidItem(doc.characterStyles, name);
    if (!style) fail("Estilo de caractere nao encontrado para <" + tagName + ">: " + name);
    return style;
  }

  function resolveStyleMaps(doc, blocks) {
    var result = { paragraph: {}, character: {} };
    var neededParagraph = {};
    var neededCharacter = {};
    var key, i, j, block, run;

    if (!blocks || !blocks.length) {
      for (key in DEFAULTS.paragraph) if (DEFAULTS.paragraph.hasOwnProperty(key)) neededParagraph[key] = true;
      for (key in DEFAULTS.character) if (DEFAULTS.character.hasOwnProperty(key)) neededCharacter[key] = true;
    } else {
      for (i = 0; i < blocks.length; i++) {
        block = blocks[i].block || blocks[i];
        if (!block) continue;
        neededParagraph[block.tag] = true;
        if (block.footnotes && block.footnotes.length) neededParagraph.NotaRodape = true;
        for (j = 0; block.runs && j < block.runs.length; j++) {
          run = block.runs[j];
          if (run.charKey) neededCharacter[run.charKey] = true;
        }
      }
    }

    for (key in DEFAULTS.paragraph) {
      if (DEFAULTS.paragraph.hasOwnProperty(key) && neededParagraph[key]) {
        result.paragraph[key] = findParagraphStyle(doc, DEFAULTS.paragraph[key], key);
      }
    }
    for (key in DEFAULTS.character) {
      if (DEFAULTS.character.hasOwnProperty(key) && neededCharacter[key]) {
        result.character[key] = findCharacterStyle(doc, DEFAULTS.character[key], key);
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
    if (tagName === "b" || tagName === "i" || tagName === "Regular" || tagName === "Nota" || tagName === "Rotulo" || tagName === "sup") return tagName;
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

  function collectInline(xml, stack, runs, footnotes, ignoreNotes) {
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
        } else if (ignoreNotes && (tag === "Nota" || tag === "NotaRodape")) {
          continue;
        } else if (tag === "NotaRodape") {
          if (footnotes) footnotes.push({ index: runsTextLength(runs), chamada: xmlAttr(child, "chamada"), text: textFromInlineXml(child) });
        } else {
          nextStack = stack.slice(0);
          nextStack.push(tag);
          collectInline(child, nextStack, runs, footnotes, ignoreNotes);
        }
      }
    }
  }

  function textFromInlineXml(xml, ignoreNotes) {
    var runs = [], text = "", i;
    collectInline(xml, [], runs, null, ignoreNotes);
    for (i = 0; i < runs.length; i++) text += runs[i].text;
    return normalizeSpaces(text);
  }

  function blockFromXml(xml) {
    var runs = [], footnotes = [], text = "";
    var i, start, end;
    collectInline(xml, [], runs, footnotes, false);
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
      identifierText: textFromInlineXmlWithoutNotes(xml),
      runs: runs,
      footnotes: footnotes,
      alterado: xmlAttr(xml, "alterado"),
      sourceXml: xml
    };
  }

  function textFromInlineXmlWithoutNotes(xml) {
    return textFromInlineXml(xml, true);
  }

  function parseXmlEntries(xmlText) {
    XML.ignoreWhitespace = false;
    XML.prettyPrinting = false;

    var xml = new XML(prepareXmlText(xmlText));
    var children = xml.children();
    var entries = [], modified = [], headings = [], article = null, started = false;
    var i, child, tag, block, text, idText, level, label, path, key, previousEntry, entry;

    function pushEntry(entry) {
      entries.push(entry);
      if (entry.modified) modified.push(entry);
      previousEntry = entry;
    }

    function addXmlDevice(block, tag, text) {
      var label = deviceLabel(tag, text);
      var fullLabel, key;
      if (!article || !label) return;
      if (tag === "Paragrafo") {
        article.currentParagraph = label;
        article.currentInciso = "";
        article.currentAlinea = "";
        fullLabel = label;
      } else if (tag === "Inciso" || tag === "CorpoTratado") {
        article.currentInciso = label;
        article.currentAlinea = "";
        fullLabel = article.currentParagraph ? article.currentParagraph + " > " + label : label;
      } else if (tag === "Alinea") {
        article.currentAlinea = label;
        fullLabel = joinNonEmpty([article.currentParagraph, article.currentInciso, label]);
      } else if (tag === "Item") {
        fullLabel = joinNonEmpty([article.currentParagraph, article.currentInciso, article.currentAlinea, label]);
      } else {
        return;
      }
      key = entryKey("dispositivo", article.path, article.label, fullLabel);
      pushEntry({ kind: "dispositivo", tag: tag, path: article.path, article: article.label, label: fullLabel, key: key, block: block, modified: block.alterado === "modificado", previous: previousEntry });
    }

    for (i = 0; i < children.length(); i++) {
      child = children[i];
      if (!(child.nodeKind && child.nodeKind() === "element")) continue;
      tag = localName(child);
      block = blockFromXml(child);
      text = normalizeSpaces(block.text);
      idText = normalizeSpaces(block.identifierText || block.text);
      if (!text) continue;

      level = headingLevel(tag, idText);
      if (level) {
        started = true;
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level: level, text: text });
        path = currentPath(headings);
        key = entryKey("heading", path, "", text);
        article = null;
        pushEntry({ kind: "heading", tag: tag, path: path, article: "", label: text, key: key, block: block, modified: block.alterado === "modificado", previous: previousEntry });
        continue;
      }

      if (!started) continue;

      if (tag === "NotaTitulo") {
        key = entryKey("notaTitulo", currentPath(headings), "", "NotaTitulo");
        pushEntry({ kind: "notaTitulo", tag: tag, path: currentPath(headings), article: "", label: "NotaTitulo", key: key + "|" + entries.length, block: block, modified: block.alterado === "modificado", previous: previousEntry });
        continue;
      }

      if (tag === "Artigo" || tag === "ArtigoTitulo") {
        label = articleLabel(idText);
        if (!label) continue;
        path = currentPath(headings);
        key = entryKey("artigo", path, "", label);
        article = { label: label, path: path, currentParagraph: "", currentInciso: "", currentAlinea: "" };
        pushEntry({ kind: "artigo", tag: tag, path: path, article: "", label: label, key: key, block: block, modified: block.alterado === "modificado", previous: previousEntry });
        continue;
      }

      addXmlDevice(block, tag, idText);
    }
    return { entries: entries, modified: modified };
  }

  function noneCharacterStyle(doc) {
    var style;
    try { style = getValidItem(doc.characterStyles, "[Nenhum(a)]"); if (isValidObject(style)) return style; } catch (e1) {}
    try { style = getValidItem(doc.characterStyles, "[None]"); if (isValidObject(style)) return style; } catch (e2) {}
    try { style = doc.characterStyles[0]; if (isValidObject(style)) return style; } catch (e3) {}
    return null;
  }

  function applyNoneCharacterStyle(textRange) {
    var noneStyle = noneCharacterStyle(app.activeDocument);
    if (!noneStyle || !textRange) return;
    try { textRange.appliedCharacterStyle = noneStyle; } catch (e) {}
  }

  function insertBlocks(story, insertionIndex, blocks, styles) {
    var ip = story.insertionPoints[insertionIndex];
    var i, j, block, paraStyle, start, end, run, range, noteStyle;
    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      start = ip.index;
      block.renderStart = start;
      ip.contents = block.text + "\r";
      end = start + block.text.length;
      block.renderEnd = end;
      try { if (end > start) applyNoneCharacterStyle(story.characters.itemByRange(start, end - 1)); } catch (e0) {}
      paraStyle = styles.paragraph[block.tag];
      if (paraStyle) {
        try { story.characters.itemByRange(start, end).appliedParagraphStyle = paraStyle; } catch (e1) {}
      }
      for (j = 0; j < block.runs.length; j++) {
        run = block.runs[j];
        if (!run.charKey || !styles.character[run.charKey] || run.start > run.end) continue;
        try {
          range = story.characters.itemByRange(start + run.start, start + run.end);
          range.appliedCharacterStyle = styles.character[run.charKey];
        } catch (e2) {}
      }
      noteStyle = styles.paragraph.NotaRodape;
      for (j = block.footnotes.length - 1; j >= 0; j--) {
        try {
          var note = story.insertionPoints[start + block.footnotes[j].index].footnotes.add();
          note.insertionPoints[-1].contents = block.footnotes[j].text;
          if (noteStyle) note.texts[0].paragraphs.everyItem().appliedParagraphStyle = noteStyle;
        } catch (e3) {}
      }
      ip = story.insertionPoints[end + 1];
    }
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

  function createTempFrame(selection, entries, styles) {
    var doc = app.activeDocument;
    var layer = getLayer(doc, TEMP_LAYER_NAME);
    var frame, bounds, blocks = [], i, paragraph;
    layer.visible = true;
    layer.locked = false;
    frame = doc.textFrames.add(layer);
    try {
      bounds = selection.parentTextFrames[0].geometricBounds;
      frame.geometricBounds = bounds;
    } catch (e1) {
      frame.geometricBounds = ["10mm", "10mm", "250mm", "190mm"];
    }
    for (i = 0; i < entries.length; i++) blocks.push(entries[i].block);
    insertBlocks(frame.parentStory, 0, blocks, styles);
    for (i = 0; i < entries.length; i++) {
      try {
        paragraph = sourceParagraphForBlock(frame.parentStory, entries[i].block);
        entries[i].sourceParagraph = paragraph;
      } catch (e2) {}
    }
    return frame;
  }

  function ensureCondition(doc) {
    var condition;
    try {
      condition = doc.conditions.add({
        name: CONDITION_MODIFICADO,
        indicatorColor: [167, 200, 55],
        indicatorMethod: ConditionIndicatorMethod.useUnderline
      });
    } catch (e) {
      condition = doc.conditions.itemByName(CONDITION_MODIFICADO);
      try { condition.indicatorColor = [167, 200, 55]; } catch (e2) {}
    }
    return condition;
  }

  function markParagraph(paragraph, condition) {
    try {
      paragraph.texts[0].applyConditions(condition, false);
      return true;
    } catch (e) {
      return false;
    }
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

  function itemInsertionAfter(entry) {
    try {
      return entry.paragraph.insertionPoints[-1].index;
    } catch (e1) {}
    return -1;
  }

  function paragraphStartIndex(paragraph) {
    try {
      return paragraph.insertionPoints[0].index;
    } catch (e) {
      return -1;
    }
  }

  function findEmptyParagraphAtOrAfter(story, index) {
    var paragraphs, i, paragraph, start, text;
    try {
      paragraphs = story.paragraphs.everyItem().getElements();
    } catch (e0) {
      return null;
    }
    for (i = 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      start = paragraphStartIndex(paragraph);
      if (start < index) continue;
      text = paragraphText(paragraph).replace(/\s+/g, "");
      if (!text) return paragraph;
      if (start > index + 3) break;
    }
    return null;
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
    var expected, paragraph, paragraphs, i, candidate, start;
    expected = paragraphText(source);
    paragraph = paragraphAtIndex(story, index);
    if (paragraph && (!expected || paragraphText(paragraph) === expected)) return paragraph;

    try {
      paragraphs = story.paragraphs.everyItem().getElements();
      for (i = 0; i < paragraphs.length; i++) {
        candidate = paragraphs[i];
        start = paragraphStartIndex(candidate);
        if (start < index) continue;
        if (expected && paragraphText(candidate) === expected) return candidate;
        if (start > index + Math.max(20, expected.length + 5)) break;
      }
    } catch (e) {}

    return paragraph || firstSelectedParagraph();
  }

  function sourceParagraphForBlock(story, block) {
    var expected, paragraph, paragraphs, i, candidate, start;
    expected = normalizeSpaces(block.text);
    paragraph = paragraphAtIndex(story, block.renderStart);
    if (paragraph && (!expected || paragraphText(paragraph) === expected)) return paragraph;

    try {
      paragraphs = story.paragraphs.everyItem().getElements();
      for (i = 0; i < paragraphs.length; i++) {
        candidate = paragraphs[i];
        start = paragraphStartIndex(candidate);
        if (start < block.renderStart) continue;
        if (expected && paragraphText(candidate) === expected) return candidate;
        if (start > block.renderStart + Math.max(20, expected.length + 5)) break;
      }
    } catch (e) {}

    return paragraph;
  }

  function prepareNeutralParagraphAfter(entry) {
    var story, index, noneStyle, paragraph;
    try {
      story = entry.paragraph.parentStory;
      index = itemInsertionAfter(entry);
    } catch (e0) {
      return null;
    }
    if (!story || index < 0) return null;
    noneStyle = noneCharacterStyle(app.activeDocument);
    try {
      if (noneStyle) story.insertionPoints[index].appliedCharacterStyle = noneStyle;
      story.insertionPoints[index].contents = "\r";
      paragraph = findEmptyParagraphAtOrAfter(story, index);
      if (!paragraph) return null;
      if (noneStyle) {
        try { paragraph.texts[0].appliedCharacterStyle = noneStyle; } catch (e1) {}
        try { paragraph.insertionPoints.everyItem().appliedCharacterStyle = noneStyle; } catch (e2) {}
      }
      return paragraph;
    } catch (e3) {
      return null;
    }
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

  function copySourceOverEntry(source, targetEntry) {
    var story, index, paragraph;
    try {
      story = targetEntry.paragraph.parentStory;
      index = paragraphStartIndex(targetEntry.paragraph);
      app.select(source);
    } catch (e1) {
      try { app.select(source); } catch (e2) { return null; }
    }
    app.copy();
    try {
      app.select(targetEntry.paragraph);
      app.paste();
      paragraph = pastedParagraphAtIndex(story, index, source);
      return paragraph;
    } catch (e3) {
      return null;
    }
  }

  function pasteSourceAfterEntry(source, targetEntry) {
    var neutralParagraph, story, index, paragraph;
    try {
      neutralParagraph = prepareNeutralParagraphAfter(targetEntry);
      if (!neutralParagraph) return null;
      story = neutralParagraph.parentStory;
      index = paragraphStartIndex(neutralParagraph);
      app.select(source);
    } catch (e1) {
      try { app.select(source); } catch (e2) { return null; }
    }
    app.copy();
    try {
      app.select(neutralParagraph);
      app.paste();
      paragraph = pastedParagraphAtIndex(story, index, source);
      return paragraph;
    } catch (e3) {
      return null;
    }
  }

  function findPreviousMappedEntry(xmlEntries, startIndex, indesignMap) {
    var i, prev;
    for (i = startIndex - 1; i >= 0; i--) {
      prev = indesignMap[xmlEntries[i].key];
      if (prev && isValidObject(prev.paragraph)) return prev;
    }
    return null;
  }

  function planOperations(indesignIndex, xmlEntries, modifiedEntries) {
    var report = { replace: 0, insert: 0, missing: 0, lines: [], ops: [] };
    var i, entry, target, previous, xmlIndex;
    for (i = 0; i < modifiedEntries.length; i++) {
      entry = modifiedEntries[i];
      target = indesignIndex.byKey[entry.key];
      if (target && isValidObject(target.paragraph)) {
        report.replace++;
        report.ops.push({ mode: "replace", entry: entry, target: target });
        report.lines.push("SUBSTITUIR: " + entry.label + " | " + entry.path);
        continue;
      }
      xmlIndex = entry.xmlIndex;
      previous = findPreviousMappedEntry(xmlEntries, xmlIndex, indesignIndex.byKey);
      if (previous) {
        report.insert++;
        report.ops.push({ mode: "insert", entry: entry });
        report.lines.push("INSERIR apos: " + previous.label + " -> " + entry.label);
      } else {
        report.missing++;
        report.lines.push("NAO LOCALIZADO: " + entry.label + " | " + entry.path);
      }
    }
    return report;
  }

  function applyOperations(plan, xmlEntries, indesignMap, condition) {
    var i, op, paragraph, target, applied = 0, failed = 0;
    for (i = plan.ops.length - 1; i >= 0; i--) {
      op = plan.ops[i];
      if (!op.entry.sourceParagraph) {
        failed++;
        continue;
      }
      if (op.mode === "replace") {
        target = indesignMap[op.entry.key] || op.target;
        paragraph = target ? copySourceOverEntry(op.entry.sourceParagraph, target) : null;
      } else {
        target = findPreviousMappedEntry(xmlEntries, op.entry.xmlIndex, indesignMap);
        paragraph = target ? pasteSourceAfterEntry(op.entry.sourceParagraph, target) : null;
      }
      if (paragraph) {
        markParagraph(paragraph, condition);
        op.entry.paragraph = paragraph;
        indesignMap[op.entry.key] = {
          kind: op.entry.kind,
          tag: op.entry.tag,
          path: op.entry.path,
          article: op.entry.article,
          label: op.entry.label,
          key: op.entry.key,
          paragraph: paragraph,
          text: paragraphText(paragraph)
        };
        applied++;
      } else {
        failed++;
      }
    }
    return { applied: applied, failed: failed };
  }

  function hideTempLayer(frame) {
    try {
      if (frame && frame.itemLayer) frame.itemLayer.visible = false;
    } catch (e) {}
  }

  function showPlanDialog(indesignIndex, xmlTree, plan) {
    var w = new Window("dialog", "Atualizar por arvore estrutural");
    var summary, box, buttons, ok;
    w.orientation = "column";
    w.alignChildren = "fill";
    w.margins = 12;
    w.spacing = 8;
    summary = w.add("statictext", undefined,
      "InDesign: " + indesignIndex.entries.length + " entradas | XML: " + xmlTree.entries.length +
      " entradas | modificados: " + xmlTree.modified.length +
      " | substituir: " + plan.replace + " | inserir: " + plan.insert + " | nao localizados: " + plan.missing
    );
    summary.characters = 110;
    box = w.add("edittext", undefined, plan.lines.join("\r") || "Nenhuma alteracao marcada no XML.", { multiline: true, scrolling: true });
    box.preferredSize = [880, 480];
    buttons = w.add("group");
    buttons.alignment = "right";
    ok = buttons.add("button", undefined, "Aplicar", { name: "ok" });
    buttons.add("button", undefined, "Cancelar", { name: "cancel" });
    ok.enabled = plan.ops.length > 0;
    return w.show() === 1;
  }

  function chooseXmlFile() {
    return File.openDialog("Selecione o XML legacy/completo exportado pelo Legislator", "*.xml");
  }

  function main() {
    if (!app.documents.length) fail("Abra um documento do InDesign antes de executar o script.");

    var selection = activeTextSelection();
    var file = chooseXmlFile();
    var xmlText, indesignIndex, xmlTree, i, plan, styles, tempFrame, condition, result;
    if (!file) return;

    xmlText = readFile(file);
    indesignIndex = buildInDesignIndex(selection);
    xmlTree = parseXmlEntries(xmlText);
    for (i = 0; i < xmlTree.entries.length; i++) xmlTree.entries[i].xmlIndex = i;

    plan = planOperations(indesignIndex, xmlTree.entries, xmlTree.modified);
    if (!showPlanDialog(indesignIndex, xmlTree, plan)) return;

    styles = resolveStyleMaps(app.activeDocument, xmlTree.modified);
    tempFrame = createTempFrame(selection, xmlTree.modified, styles);
    condition = ensureCondition(app.activeDocument);
    result = applyOperations(plan, xmlTree.entries, indesignIndex.byKey, condition);
    hideTempLayer(tempFrame);

    alert(
      "Atualizacao por arvore concluida.\n\n" +
      "Itens aplicados: " + result.applied + "\n" +
      "Falhas: " + result.failed + "\n" +
      "Substituicoes planejadas: " + plan.replace + "\n" +
      "Insercoes planejadas: " + plan.insert + "\n" +
      "Nao localizados no planejamento: " + plan.missing + "\n\n" +
      "O XML formatado foi mantido e ocultado na camada \"" + TEMP_LAYER_NAME + "\"."
    );
  }

  main();
})();
