/*
  Exportar norma selecionada no InDesign para XML do Legislator.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto da norma no InDesign.
    2. Execute este script.
    3. Escolha onde salvar o XML.
*/

#target "InDesign"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var unmappedParagraphStyles = {};
  var unmappedCharacterStyles = {};
  var progressPalette = null;
  var progressText = null;
  var paragraphStyleTagMap = {};
  var ignoredParagraphStyles = {};
  var characterStyleTagMap = {};
  var ignoredCharacterStyles = {};
  var PARAGRAPH_TAGS = [
    "Epigrafe", "EpigrafeApelido", "NotaTitulo", "Ementa", "ParagrafoAbertura", "ParagrafoFacoSaber", "AberturaCapitulo",
    "Divisao", "Secao", "Artigo", "ArtigoTitulo", "CorpoTratado", "NomeJuridico", "Paragrafo",
    "Inciso", "Alinea", "Item", "Citacao", "Tabela", "Data", "Assinatura"
  ];
  var CHARACTER_TAGS = ["Rotulo", "b", "i", "Regular", "Nota", "NotaRodape", "sup", "sub", "u", "s"];

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function openProgress(total) {
    try {
      progressPalette = new Window("palette", "Exportar XML Legislator");
      progressPalette.orientation = "column";
      progressPalette.alignChildren = ["fill", "top"];
      progressPalette.margins = 14;
      progressText = progressPalette.add("statictext", undefined, "Preparando exportacao...");
      progressText.characters = 42;
      progressPalette.add("statictext", undefined, "Aguarde. Normas grandes podem levar alguns minutos.");
      progressPalette.show();
      updateProgress(0, total);
    } catch (e) {
      progressPalette = null;
      progressText = null;
    }
  }

  function updateProgress(current, total) {
    try {
      if (!progressText) return;
      progressText.text = current + " de " + total + " paragrafos exportados...";
      if (progressPalette) progressPalette.update();
      if (current === 0 || current % 25 === 0 || current === total) app.refresh();
    } catch (e) {}
  }

  function closeProgress() {
    try {
      if (progressPalette) progressPalette.close();
    } catch (e) {}
    progressPalette = null;
    progressText = null;
  }

  function trim(s) {
    return String(s || "").replace(/^\s+|\s+$/g, "");
  }

  function startsWithText(text, prefix) {
    text = String(text || "");
    prefix = String(prefix || "");
    return text.substr(0, prefix.length) === prefix;
  }

  function xmlEscape(s) {
    return stripInvalidXmlChars(String(s || ""))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stripInvalidXmlChars(s) {
    return String(s || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  function addUnmapped(map, name) {
    name = String(name || "");
    if (!name) return;
    if (name === "[None]" || name === "[Nenhum]" || name === "[No character style]") return;
    if (name.charAt(0) === "[") return;
    map[name] = true;
  }

  function mapKeys(map) {
    var result = [];
    var key;
    for (key in map) {
      if (map.hasOwnProperty(key)) result.push(key);
    }
    return result.sort();
  }

  function showUnmappedAlert() {
    var paragraphStyles = mapKeys(unmappedParagraphStyles);
    var characterStyles = mapKeys(unmappedCharacterStyles);
    var message = "";

    if (!paragraphStyles.length && !characterStyles.length) return;

    message += "Alguns estilos encontrados na selecao nao possuem tag XML mapeada.\n\n";
    if (paragraphStyles.length) {
      message += "Estilos de paragrafo:\n- " + paragraphStyles.join("\n- ") + "\n\n";
    }
    if (characterStyles.length) {
      message += "Estilos de caractere:\n- " + characterStyles.join("\n- ") + "\n\n";
    }
    message += "Esses trechos foram exportados com fallback quando possivel. Revise o XML gerado.";
    alert(message);
  }

  function paragraphStyleName(item) {
    try {
      return String(item.appliedParagraphStyle.name || "");
    } catch (e) {
      return "";
    }
  }

  function characterStyleName(item) {
    try {
      return String(item.appliedCharacterStyle.name || "");
    } catch (e) {
      return "";
    }
  }

  function lowerParagraphStyleName(item) {
    return paragraphStyleName(item).toLowerCase();
  }

  function lowerCharacterStyleName(item) {
    return characterStyleName(item).toLowerCase();
  }

  function shouldIgnoreCharacterStyleName(name) {
    name = String(name || "").toLowerCase();
    return name.indexOf("hifenizar") >= 0 ||
      name.indexOf("quebra") >= 0 ||
      name.indexOf("parte") >= 0;
  }

  function stylePath(style) {
    var names = [];
    var current = style;
    var guard = 0;
    try {
      while (current && guard < 20) {
        if (current.name) names.unshift(String(current.name));
        current = current.parent;
        guard++;
        if (current && String(current.constructor && current.constructor.name) === "Document") break;
      }
    } catch (e) {}
    return names.join("/");
  }

  function styleMapKey(path) {
    return String(path || "").toLowerCase();
  }

  function paragraphStylePath(paragraph) {
    try {
      return stylePath(paragraph.appliedParagraphStyle);
    } catch (e) {
      return paragraphStyleName(paragraph);
    }
  }

  function characterStylePath(textRange) {
    try {
      return stylePath(textRange.appliedCharacterStyle);
    } catch (e) {
      return characterStyleName(textRange);
    }
  }

  function paragraphStyleKey(paragraph) {
    return styleMapKey(paragraphStylePath(paragraph) || paragraphStyleName(paragraph));
  }

  function characterStyleKey(textRange) {
    return styleMapKey(characterStylePath(textRange) || characterStyleName(textRange));
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

  function paragraphStyleHasGroup(paragraph, groupName) {
    try {
      return styleHasGroup(paragraph.appliedParagraphStyle, groupName);
    } catch (e) {
      return false;
    }
  }

  function paragraphStyleHasAnyGroup(paragraph, groupNames) {
    var i;
    for (i = 0; i < groupNames.length; i++) {
      if (paragraphStyleHasGroup(paragraph, groupNames[i])) return true;
    }
    return false;
  }

  function normalizeText(s) {
    return stripInvalidXmlChars(String(s || ""))
      .replace(/\r/g, "")
      .replace(/\uFEFF/g, "");
  }

  function normalizeSpecialCharacters(s) {
    return stripInvalidXmlChars(String(s || ""))
      .replace(/EN_DASH/g, "\u2013")
      .replace(/EM_DASH/g, "\u2014")
      .replace(/DISCRETIONARY_HYPHEN/g, "\u00ad")
      .replace(/NONBREAKING_SPACE/g, "\u00a0")
      .replace(/NONBREAKING_HYPHEN/g, "\u2011")
      .replace(/SECTION_SYMBOL/g, "\u00a7")
      .replace(/PARAGRAPH_SYMBOL/g, "\u00b6")
      .replace(/COPYRIGHT_SYMBOL/g, "\u00a9")
      .replace(/REGISTERED_TRADEMARK/g, "\u00ae")
      .replace(/TRADEMARK_SYMBOL/g, "\u2122")
      .replace(/DEGREE_SYMBOL/g, "\u00b0")
      .replace(/BULLET_CHARACTER/g, "\u2022")
      .replace(/ELLIPSIS_CHARACTER/g, "\u2026")
      .replace(/FORCED_LINE_BREAK/g, "\n");
  }

  function paragraphTextByBounds(paragraph, nextParagraph) {
    var text;

    try {
      text = paragraph.contents;
    } catch (e) {
      text = "";
    }

    text = normalizeSpecialCharacters(text);
    text = String(text || "").replace(/\r[\s\S]*$/, "");
    return normalizeText(text);
  }

  function paragraphPlainText(paragraph, nextParagraph) {
    var text = paragraphTextByBounds(paragraph, nextParagraph);
    return text.replace(/\r$/, "");
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

  function paragraphFootnotes(paragraph) {
    var notes, storyNotes, start, end, i, noteIndex;
    try {
      notes = paragraph.footnotes.everyItem().getElements();
      if (notes && notes.length) return notes;
    } catch (e1) {}

    notes = [];
    try {
      start = paragraph.insertionPoints[0].index;
      end = paragraph.insertionPoints[-1].index;
      storyNotes = paragraph.parentStory.footnotes.everyItem().getElements();
      for (i = 0; i < storyNotes.length; i++) {
        try {
          noteIndex = storyNotes[i].storyOffset.index;
          if (noteIndex >= start && noteIndex <= end) notes.push(storyNotes[i]);
        } catch (e2) {}
      }
    } catch (e3) {}
    return notes;
  }

  function footnoteText(note) {
    var text;
    try {
      text = note.texts[0].contents;
    } catch (e1) {
      try {
        text = note.contents;
      } catch (e2) {
        text = "";
      }
    }
    text = normalizeSpecialCharacters(text);
    return trim(String(text || "")
      .replace(/\uFEFF/g, "")
      .replace(/^\s+/, "")
      .replace(/\r+$/g, ""));
  }

  function footnoteLabel(note, index) {
    var label = "";
    try {
      label = String(note.marker || "");
    } catch (e1) {}
    if (!label) {
      try {
        label = String(note.index + 1);
      } catch (e2) {
        label = String(index + 1);
      }
    }
    return label;
  }

  function footnotesXml(paragraph) {
    var notes = paragraphFootnotes(paragraph);
    var parts = [];
    var i, text, label;
    for (i = 0; i < notes.length; i++) {
      text = footnoteText(notes[i]);
      if (!trim(text)) continue;
      label = footnoteLabel(notes[i], i);
      parts.push('<NotaRodape chamada="' + xmlEscape(label) + '">' + xmlEscape(text) + '</NotaRodape>');
    }
    return parts.join("");
  }

  function isEmptyParagraph(paragraph, nextParagraph) {
    if (paragraphTables(paragraph).length) return false;
    if (paragraphFootnotes(paragraph).length) return false;
    return !trim(paragraphPlainText(paragraph, nextParagraph));
  }

  function conditionNameList(textRange) {
    var names = [];
    var conds, i;
    try {
      conds = textRange.appliedConditions;
      for (i = 0; i < conds.length; i++) names.push(String(conds[i].name || ""));
    } catch (e) {}
    return names;
  }

  function alteradoFromConditions(paragraph) {
    var names = conditionNameList(paragraph.texts[0]).join("|").toLowerCase();
    if (names.indexOf("modificado") >= 0) return "modificado";
    if (names.indexOf("exclu") >= 0 || names.indexOf("remocao") >= 0 || names.indexOf("remo\u00e7\u00e3o") >= 0) {
      return "remocaoApos";
    }
    return "";
  }

  function inferredParagraphTag(paragraph, nextParagraph, allowFallback) {
    var name = lowerParagraphStyleName(paragraph);
    var text = paragraphPlainText(paragraph, nextParagraph);
    var inTitSubtit = paragraphStyleHasAnyGroup(paragraph, ["tit-subtit", "tit-substit"]);
    var inCorpoLegis = paragraphStyleHasGroup(paragraph, "corpo-legis");

    if (inTitSubtit && startsWithText(name, "epigrafe-apelido")) return "EpigrafeApelido";
    if (inTitSubtit && startsWithText(name, "ep\u00edgrafe-apelido")) return "EpigrafeApelido";
    if (inTitSubtit && startsWithText(name, "epigrafe")) return "Epigrafe";
    if (inTitSubtit && startsWithText(name, "ep\u00edgrafe")) return "Epigrafe";

    if (name === "ementa" || name === "emenda-ementa") return "Ementa";
    if (name === "texto-lei-sem-indent") return "ParagrafoAbertura";
    if (name === "texto-lei-faco-saber") return "ParagrafoFacoSaber";
    if (inTitSubtit && (
      name === "abertura-cap" ||
      name === "abertura-cap-quebra" ||
      name === "abertura-cap-nova-pq" ||
      name === "abertura-capitulo"
    )) return "AberturaCapitulo";
    if (name === "parte-livro-tit-cap") return "Divisao";
    if (name === "secao-subsecao") return "Secao";
    if (name === "art") return "Artigo";
    if (name === "art-tit-centro") return "ArtigoTitulo";
    if (name === "artigo-titulo") return "ArtigoTitulo";
    if (name === "corpo-tratado") return "CorpoTratado";
    if (name === "texto-lei-citacao") return "Citacao";
    if (inCorpoLegis && (name === "nota-titulos" || name === "nota-titulos-transp")) return "NotaTitulo";
    if (name === "nome-juridico") return "NomeJuridico";
    if (name === "ass-data" || name === "data" || name === "assinatura-data") return "Data";
    if (name === "ass-nome" || name === "ass-nome-espaco-ant" || name === "assinatura" || name === "assinatura-nome") return "Assinatura";

    if (name === "texto-lei") {
      if (/^Par[a\u00e1]grafo\s+\u00fanico\b/i.test(text) || /^\u00a7/.test(text)) return "Paragrafo";
      if (/^[IVXLCDM]+(?:-[A-Z])?\s*[\u2013\u2014-]\s/.test(text)) return "Inciso";
      if (/^[a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00e2\u00ea\u00f4\u00ee\u00fb\u00e0\u00e8\u00ec\u00f2\u00f9\u00e3\u00f5\u00e7]\)\s/i.test(text)) return "Alinea";
      if (/^\d+[.)]\s/.test(text)) return "Item";
      return "Paragrafo";
    }

    if (inCorpoLegis || inTitSubtit) {
      addUnmapped(unmappedParagraphStyles, paragraphStyleName(paragraph));
    }

    return allowFallback ? "Paragrafo" : "";
  }

  function tagFromParagraph(paragraph, nextParagraph) {
    var key = paragraphStyleKey(paragraph);
    if (ignoredParagraphStyles[key]) return "";
    if (paragraphStyleTagMap.hasOwnProperty(key)) return paragraphStyleTagMap[key];
    return inferredParagraphTag(paragraph, nextParagraph, true);
  }

  function inferredCharacterTag(textRange) {
    var name = lowerCharacterStyleName(textRange);
    if (shouldIgnoreCharacterStyleName(name)) return "";
    if (name === "bold-artigo") return "Rotulo";
    if (name === "bold") return "b";
    if (name === "italico" || name === "it\u00e1lico") return "i";
    if (name === "regular") return "Regular";
    if (name === "nota novo formato") return "Nota";
    if (name === "italico light" || name === "it\u00e1lico light") return "i";
    if (name === "sobrescrito") return "sup";
    addUnmapped(unmappedCharacterStyles, characterStyleName(textRange));
    return "";
  }

  function charStyleTag(textRange) {
    var key = characterStyleKey(textRange);
    if (ignoredCharacterStyles[key]) return "";
    if (characterStyleTagMap.hasOwnProperty(key)) return characterStyleTagMap[key];
    return inferredCharacterTag(textRange);
  }

  function wrapInlineText(text, tag) {
    if (!text) return "";
    if (tag) return "<" + tag + ">" + xmlEscape(text) + "</" + tag + ">";
    return xmlEscape(text);
  }

  function inlineXml(paragraph, nextParagraph) {
    var textStyleRanges;
    var remaining = paragraphPlainText(paragraph, nextParagraph).length;
    var xml = "";
    var i, raw, tag, parts, j, returnPos, endAfterThisRange;

    if (remaining <= 0) return "";

    try {
      textStyleRanges = paragraph.textStyleRanges.everyItem().getElements();
    } catch (e) {
      return xmlEscape(paragraphPlainText(paragraph, nextParagraph));
    }

    for (i = 0; i < textStyleRanges.length; i++) {
      raw = normalizeSpecialCharacters(textStyleRanges[i].contents);
      raw = String(raw || "").replace(/\uFEFF/g, "");
      endAfterThisRange = false;

      returnPos = raw.indexOf("\r");
      if (returnPos >= 0) {
        raw = raw.substring(0, returnPos);
        endAfterThisRange = true;
      }

      if (raw.length > remaining) {
        raw = raw.substr(0, remaining);
        endAfterThisRange = true;
      }

      raw = normalizeText(raw);
      if (!raw && endAfterThisRange) break;
      if (!raw) continue;

      tag = charStyleTag(textStyleRanges[i]);
      parts = raw.split(/\n|\u2028|\u0003/);
      for (j = 0; j < parts.length; j++) {
        if (j > 0) xml += "<br/>";
        xml += wrapInlineText(parts[j], tag);
      }

      remaining -= raw.length;
      if (remaining <= 0 || endAfterThisRange) break;
    }

    return xml;
  }

  function wrapLeadingMatch(xml, re, tag) {
    var match;
    if (!xml || startsWithText(xml, "<")) return xml;
    match = xml.match(re);
    if (!match || !match[0]) return xml;
    return "<" + tag + ">" + match[0] + "</" + tag + ">" + xml.substr(match[0].length);
  }

  function applyInferredCharacterMarks(xml, tag) {
    var upper = "A-Z\u00c0-\u00d6\u00d8-\u00de";
    var lower = "a-z\u00e0-\u00f6\u00f8-\u00ff";
    var reBoldArtigo = /^Arts?\.(?:\u00a0|\s)*\d[\d.]*(?:[\u00ba\u00aa])?(?:-[A-Z])?\.?(?:(?:\u00a0|\s)+a(?:\u00a0|\s)+\d[\d.]*\.?)?/;
    var reBoldNormal = new RegExp("^(?:(?:[" + upper + "]+(?:-[" + upper + "\\d]+)?(?:\\u00a0|\\s)*[\\u2013\\u2014-])|(?:Pena(?:\\u00a0|\\s)*[\\u2013\\u2014-])|(?:\\u00a7(?:\\u00a0|\\s)*\\d+\\.?[\\u00ba\\u00aa]?(?:-[" + upper + "]\\.?)?))");
    var reItalicAlinea = new RegExp("^[" + lower + "]\\)");
    var reItalicParUnico = /^Par[a\u00e1]grafo(?:\u00a0|\s)+\u00fanico\./i;

    if (!xml) return xml;
    if (tag === "Citacao" || tag === "Epigrafe" || tag === "EpigrafeApelido") return xml;

    if (tag === "Artigo") {
      xml = wrapLeadingMatch(xml, reBoldArtigo, "Rotulo");
    }

    if (tag === "Alinea") {
      xml = wrapLeadingMatch(xml, reItalicAlinea, "i");
    }

    if (tag === "Paragrafo") {
      xml = wrapLeadingMatch(xml, reItalicParUnico, "i");
    }

    return wrapLeadingMatch(xml, reBoldNormal, "b");
  }

  function cellTextXml(cell) {
    var text, parts, xml = "", i;
    try {
      text = cell.contents;
    } catch (e) {
      text = "";
    }
    text = normalizeSpecialCharacters(text);
    text = String(text || "")
      .replace(/\uFEFF/g, "")
      .replace(/\r$/, "");
    parts = text.split(/\r|\n|\u2028|\u0003/);
    for (i = 0; i < parts.length; i++) {
      if (i > 0) xml += "<br/>";
      xml += xmlEscape(parts[i]);
    }
    return xml;
  }

  function tableToXml(table) {
    var rows, cells, cell, lines = ["  <Tabela>"];
    var i, j, tag, attrs, colspan, rowspan;

    try {
      rows = table.rows.everyItem().getElements();
    } catch (e1) {
      rows = table.rows;
    }

    for (i = 0; i < rows.length; i++) {
      lines.push("    <Linha>");
      try {
        cells = rows[i].cells.everyItem().getElements();
      } catch (e2) {
        cells = rows[i].cells;
      }
      for (j = 0; j < cells.length; j++) {
        cell = cells[j];
        tag = i === 0 ? "Cabecalho" : "Celula";
        attrs = "";
        try {
          colspan = Number(cell.columnSpan || 1);
          if (colspan > 1) attrs += ' colspan="' + colspan + '"';
        } catch (e3) {}
        try {
          rowspan = Number(cell.rowSpan || 1);
          if (rowspan > 1) attrs += ' rowspan="' + rowspan + '"';
        } catch (e4) {}
        lines.push("      <" + tag + attrs + ">" + cellTextXml(cell) + "</" + tag + ">");
      }
      lines.push("    </Linha>");
    }

    lines.push("  </Tabela>");
    return lines.join("\n");
  }

  function tablesToXml(paragraph) {
    var tables = paragraphTables(paragraph);
    var lines = [];
    var i, tableXml;
    for (i = 0; i < tables.length; i++) {
      tableXml = tableToXml(tables[i]).replace(/^  /gm, "    ");
      lines.push("  <Paragrafo>");
      lines.push(tableXml);
      lines.push("  </Paragrafo>");
    }
    return lines.join("\n");
  }

  function tagInList(tag, list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] === tag) return true;
    }
    return false;
  }

  function sortedStyleRecords(map) {
    var result = [];
    var key;
    for (key in map) {
      if (map.hasOwnProperty(key)) result.push(map[key]);
    }
    result.sort(function (a, b) {
      var aa = String(a.path || a.name || "").toLowerCase();
      var bb = String(b.path || b.name || "").toLowerCase();
      if (aa < bb) return -1;
      if (aa > bb) return 1;
      return 0;
    });
    return result;
  }

  function collectStyleRecords(paragraphs) {
    var paragraphMap = {};
    var characterMap = {};
    var i, paragraph, pName, pKey, ranges, r, cName, cKey;

    for (i = 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      pName = paragraphStyleName(paragraph);
      pKey = paragraphStyleKey(paragraph);
      if (pName && !paragraphMap[pKey]) {
        paragraphMap[pKey] = {
          key: pKey,
          name: pName,
          path: paragraphStylePath(paragraph),
          tag: paragraphTables(paragraph).length ? "Tabela" : inferredParagraphTag(paragraph, paragraphs[i + 1], false)
        };
      }

      try {
        ranges = paragraph.textStyleRanges.everyItem().getElements();
      } catch (e1) {
        ranges = [];
      }
      for (r = 0; r < ranges.length; r++) {
        cName = characterStyleName(ranges[r]);
        cKey = characterStyleKey(ranges[r]);
        if (!cName || cName.charAt(0) === "[" || characterMap[cKey]) continue;
        if (shouldIgnoreCharacterStyleName(cName)) continue;
        characterMap[cKey] = {
          key: cKey,
          name: cName,
          path: characterStylePath(ranges[r]),
          tag: inferredCharacterTag(ranges[r])
        };
      }
    }

    return {
      paragraph: sortedStyleRecords(paragraphMap),
      character: sortedStyleRecords(characterMap)
    };
  }

  function addTagDropdown(parent, tags) {
    var items = ["Ignorar", "Personalizada..."].concat(tags);
    var dropdown = parent.add("dropdownlist", undefined, items);
    dropdown.preferredSize.width = 170;
    dropdown.selection = 0;
    return dropdown;
  }

  function setDropdownValue(dropdown, value, tags) {
    var i;
    if (!value) {
      dropdown.selection = 0;
      return;
    }
    for (i = 0; i < tags.length; i++) {
      if (tags[i] === value) {
        dropdown.selection = i + 2;
        return;
      }
    }
    dropdown.selection = 1;
  }

  function selectedDropdownText(dropdown) {
    try {
      return dropdown.selection ? String(dropdown.selection.text) : "";
    } catch (e) {
      return "";
    }
  }

  function rowTag(record, dropdown, custom) {
    var selected = selectedDropdownText(dropdown);
    var value = trim(custom.text);
    if (selected === "Ignorar") return null;
    if (selected === "Personalizada...") return value;
    return selected;
  }

  function listRecordText(record) {
    var tag = record.ignored ? "Ignorar" : (record.tag || "sem tag");
    return (record.path || record.name) + "  ->  " + tag;
  }

  function fillList(listbox, records) {
    var i, item;
    listbox.removeAll();
    for (i = 0; i < records.length; i++) {
      item = listbox.add("item", listRecordText(records[i]));
      item.indexRef = i;
    }
    if (records.length) listbox.selection = 0;
  }

  function configureMappingTab(tab, records, tags) {
    var list, editGroup, tagDrop, custom, applyBtn, ignoreBtn, hint;

    tab.orientation = "column";
    tab.alignChildren = ["fill", "top"];

    list = tab.add("listbox", undefined, [], { multiselect: false });
    list.preferredSize = [680, 280];

    hint = tab.add("statictext", undefined, "Selecione um estilo, escolha a tag que sera exportada e clique em Aplicar.");
    hint.characters = 86;

    editGroup = tab.add("group");
    editGroup.orientation = "row";
    editGroup.alignChildren = ["left", "center"];
    editGroup.add("statictext", undefined, "Tag:");
    tagDrop = addTagDropdown(editGroup, tags);
    editGroup.add("statictext", undefined, "Personalizada:");
    custom = editGroup.add("edittext", undefined, "");
    custom.characters = 22;
    applyBtn = editGroup.add("button", undefined, "Aplicar");
    ignoreBtn = editGroup.add("button", undefined, "Ignorar");

    function loadSelected() {
      var record;
      if (!list.selection) return;
      record = records[list.selection.indexRef];
      setDropdownValue(tagDrop, record.ignored ? "" : record.tag, tags);
      custom.text = record.tag && !tagInList(record.tag, tags) ? record.tag : "";
    }

    list.onChange = loadSelected;
    applyBtn.onClick = function () {
      var record, tag;
      if (!list.selection) return;
      record = records[list.selection.indexRef];
      tag = rowTag(record, tagDrop, custom);
      if (tag === null) {
        record.ignored = true;
        record.tag = "";
      } else if (tag) {
        record.ignored = false;
        record.tag = tag;
      } else {
        alert("Informe uma tag personalizada ou escolha Ignorar.");
        return;
      }
      fillList(list, records);
      list.selection = list.items[record.index];
    };
    ignoreBtn.onClick = function () {
      var record;
      if (!list.selection) return;
      record = records[list.selection.indexRef];
      record.ignored = true;
      record.tag = "";
      fillList(list, records);
      list.selection = list.items[record.index];
    };

    fillList(list, records);
    loadSelected();
  }

  function assignRecordIndexes(records) {
    var i;
    for (i = 0; i < records.length; i++) records[i].index = i;
  }

  function applyRecordMappings(records, targetMap, ignoredMap) {
    var i;
    for (i = 0; i < records.length; i++) {
      if (records[i].ignored) {
        ignoredMap[records[i].key] = true;
      } else if (records[i].tag) {
        targetMap[records[i].key] = records[i].tag;
      }
    }
  }

  function showStyleMappingDialog(paragraphs) {
    var records = collectStyleRecords(paragraphs);
    var dialog = new Window("dialog", "Mapeamento XML da norma");
    var intro, tabs, pTab, cTab, buttons, okBtn, cancelBtn, result = false;

    assignRecordIndexes(records.paragraph);
    assignRecordIndexes(records.character);

    dialog.orientation = "column";
    dialog.alignChildren = ["fill", "top"];
    dialog.margins = 14;

    intro = dialog.add("statictext", undefined, "Confira as tags XML dos estilos encontrados. Voce pode trocar a tag, informar uma personalizada ou ignorar o estilo.");
    intro.characters = 92;

    tabs = dialog.add("tabbedpanel");
    tabs.preferredSize = [720, 420];
    tabs.alignChildren = ["fill", "fill"];

    pTab = tabs.add("tab", undefined, "Paragrafo");
    configureMappingTab(pTab, records.paragraph, PARAGRAPH_TAGS);

    cTab = tabs.add("tab", undefined, "Caractere");
    configureMappingTab(cTab, records.character, CHARACTER_TAGS);

    tabs.selection = pTab;

    buttons = dialog.add("group");
    buttons.alignment = "right";
    okBtn = buttons.add("button", undefined, "Exportar", { name: "ok" });
    cancelBtn = buttons.add("button", undefined, "Cancelar", { name: "cancel" });

    okBtn.onClick = function () {
      paragraphStyleTagMap = {};
      ignoredParagraphStyles = {};
      characterStyleTagMap = {};
      ignoredCharacterStyles = {};
      applyRecordMappings(records.paragraph, paragraphStyleTagMap, ignoredParagraphStyles);
      applyRecordMappings(records.character, characterStyleTagMap, ignoredCharacterStyles);
      result = true;
      dialog.close(1);
    };
    cancelBtn.onClick = function () {
      result = false;
      dialog.close(0);
    };

    dialog.show();
    return result;
  }

  function paragraphToXml(paragraph, nextParagraph) {
    if (paragraphTables(paragraph).length) return tablesToXml(paragraph);
    var tag = tagFromParagraph(paragraph, nextParagraph);
    if (!tag) return "";
    var alterado = alteradoFromConditions(paragraph);
    var attrs = alterado ? ' alterado="' + xmlEscape(alterado) + '"' : "";
    var xml = inlineXml(paragraph, nextParagraph);
    xml += footnotesXml(paragraph);
    xml = applyInferredCharacterMarks(xml, tag);
    return "  <" + tag + attrs + ">" + xml + "</" + tag + ">";
  }

  function selectedParagraphs() {
    var sel, paragraphs;
    if (!app.documents.length) fail("Abra um documento do InDesign antes de executar o script.");
    if (!app.selection.length || !app.selection[0].hasOwnProperty("paragraphs")) {
      fail("Selecione o texto da norma antes de executar o script.");
    }
    sel = app.selection[0];
    try {
      paragraphs = sel.paragraphs.everyItem().getElements();
    } catch (e) {
      paragraphs = sel.paragraphs;
    }
    if (!paragraphs || !paragraphs.length) fail("A selecao nao contem paragrafos exportaveis.");
    return paragraphs;
  }

  function buildXml(paragraphs) {
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Norma xmlns="http://legislator.app/schema/1.0">'];
    var i, paragraphXml;
    openProgress(paragraphs.length);
    for (i = 0; i < paragraphs.length; i++) {
      if (isEmptyParagraph(paragraphs[i], paragraphs[i + 1])) continue;
      paragraphXml = paragraphToXml(paragraphs[i], paragraphs[i + 1]);
      if (paragraphXml) lines.push(paragraphXml);
      updateProgress(i + 1, paragraphs.length);
    }
    lines.push("</Norma>");
    updateProgress(paragraphs.length, paragraphs.length);
    return lines.join("\n");
  }

  function saveXml(xml) {
    var file = File.saveDialog("Salvar XML do Legislator", "*.xml");
    if (!file) return false;
    if (!/\.xml$/i.test(file.fsName)) file = new File(file.fsName + ".xml");
    file.encoding = "UTF-8";
    if (!file.open("w")) fail("Nao foi possivel salvar o arquivo XML.");
    file.write(xml);
    file.close();
    alert("XML exportado com sucesso:\n" + file.fsName);
    return true;
  }

  function main() {
    var paragraphs, xml;
    try {
      paragraphs = selectedParagraphs();
      if (!showStyleMappingDialog(paragraphs)) return;
      unmappedParagraphStyles = {};
      unmappedCharacterStyles = {};
      xml = buildXml(paragraphs);
      closeProgress();
      showUnmappedAlert();
      saveXml(xml);
    } catch (e) {
      closeProgress();
      throw e;
    }
  }

  main();
})();
