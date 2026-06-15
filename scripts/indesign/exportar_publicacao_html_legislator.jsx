/*
  Exportar normas de uma publicacao para HTML usando a exportacao nativa do InDesign.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione o texto do sumario da publicacao.
    2. Execute este script.
    3. Escolha a pasta raiz de exportacao.
    4. Clique em Exportar HTML.

  O script usa os paragrafos do sumario com estilo sumario/sum-epigrafe
  para localizar cada norma no miolo. Quando uma epigrafe do sumario e seguida
  por sumario/sum-separador antes da proxima epigrafe, esse separador vira o
  limite da norma.

  O script tambem gera um relatorio final na pasta raiz.
*/

#target "InDesign"
#targetengine "legislatorExportarPublicacaoHtml"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

  var SUMMARY_GROUP = "sumario";
  var SUMMARY_EPIGRAPH_STYLE = "sum-epigrafe";
  var SUMMARY_SEPARATOR_STYLE = "sum-separador";
  var BODY_TITLE_GROUP = "tit-subtit";
  var REPORT_FILE = "_relatorio-exportacao-html.txt";
  var pageParagraphCache = {};
  var LEGISLATOR_TAGS = {
    epigrafe: true,
    epigrafeapelido: true,
    ementa: true,
    paragrafoabertura: true,
    paragrafofacosaber: true,
    aberturacapitulo: true,
    divisao: true,
    secao: true,
    artigo: true,
    corpotratado: true,
    rotulo: true,
    paragrafounico: true,
    paragrafo: true,
    inciso: true,
    alinea: true,
    item: true,
    citacao: true,
    nometitulo: true,
    nomejuridico: true,
    notatitulo: true,
    nota: true,
    notarodape: true,
    tabela: true,
    linha: true,
    celula: true,
    data: true,
    assinatura: true,
    assinaturadata: true,
    assinaturanome: true,
    b: true,
    i: true,
    regular: true,
    sup: true,
    sub: true,
    u: true,
    s: true
  };
  var INDESIGN_PARAGRAPH_CLASS_TO_LEGISLATOR = {
    "tit-subtit_epigrafe": "Epigrafe",
    "tit-subtit_epigrafe-emenda": "Epigrafe",
    "tit-substit_epigrafe-emenda": "Epigrafe",
    "tit-subtit_epigrafe-apelido": "EpigrafeApelido",
    "corpo-legis_nota-titulos": "NotaTitulo",
    "corpo-legis_nota-titulos-transp": "NotaTitulo",
    "corpo-legis_ementa": "Ementa",
    "corpo-legis_emenda-ementa": "Ementa",
    "corpo-legis_texto-lei-sem-indent": "ParagrafoAbertura",
    "corpo-legis_texto-lei-faco-saber": "ParagrafoFacoSaber",
    "tit-subtit_abertura-cap": "AberturaCapitulo",
    "tit-subtit_abertura-cap-quebra": "AberturaCapitulo",
    "tit-subtit_abertura-cap-nova-pq": "AberturaCapitulo",
    "tit-subtit_parte-livro-tit-cap": "Divisao",
    "tit-subtit_secao-subsecao": "Secao",
    "corpo-legis_art": "Artigo",
    "corpo-legis_art-tit-centro": "ArtigoTitulo",
    "corpo-legis_artigo-titulo": "ArtigoTitulo",
    "corpo-legis_corpo-tratado": "CorpoTratado",
    "corpo-legis_texto-lei": "Paragrafo/Inciso/Alinea/Item",
    "corpo-legis_texto-lei-citacao": "Citacao",
    "corpo-legis_nome-juridico": "NomeJuridico",
    "corpo-legis_ass-data": "Data",
    "corpo-legis_ass-nome": "Assinatura",
    "corpo-legis_ass-nome-espaco-ant": "Assinatura",
    "corpo-legis_nota-rodape": "NotaRodape"
  };
  var INDESIGN_CHARACTER_CLASS_TO_LEGISLATOR = {
    "bold-artigo": "Rotulo",
    "bold": "b",
    "italico": "i",
    "italico-light": "Nota+i",
    "nota-novo-formato": "Nota",
    "nota-titulos": "Nota",
    "regular": "Regular",
    "sobrescrito": "sup",
    "sup": "sup",
    "subscrito": "sub",
    "sub": "sub"
  };

  function fail(message) {
    alert(message);
    throw new Error(message);
  }

  function trim(s) {
    return String(s || "").replace(/^\s+|\s+$/g, "");
  }

  function startsWithText(text, prefix) {
    text = String(text || "");
    prefix = String(prefix || "");
    return text.substr(0, prefix.length) === prefix;
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

  function paragraphStyleName(paragraph) {
    try {
      return String(paragraph.appliedParagraphStyle.name || "");
    } catch (e) {
      return "";
    }
  }

  function paragraphHasStyleInGroup(paragraph, styleName, groupName) {
    try {
      return paragraphStyleName(paragraph) === styleName &&
        styleHasGroup(paragraph.appliedParagraphStyle, groupName);
    } catch (e) {
      return false;
    }
  }

  function paragraphStyleStartsWithEpigrafe(paragraph) {
    var name = paragraphStyleName(paragraph).toLowerCase();
    if (startsWithText(name, "epigrafe-apelido") || startsWithText(name, "ep\u00edgrafe-apelido")) return false;
    if (!styleHasGroup(paragraph.appliedParagraphStyle, BODY_TITLE_GROUP)) return false;
    return startsWithText(name, "epigrafe") || startsWithText(name, "ep\u00edgrafe");
  }

  function storyKey(story) {
    try {
      return story.toSpecifier();
    } catch (e) {
      return String(story);
    }
  }

  function stripHiddenChars(s) {
    return String(s || "")
      .replace(/\uFEFF/g, "")
      .replace(/\uFFFC/g, "")
      .replace(/\u0007/g, "")
      .replace(/~I/g, "");
  }

  function normalizeText(s) {
    return trim(stripHiddenChars(s)
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\t/g, " ")
      .replace(/\s+/g, " "));
  }

  function normalizeKey(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\u00e1\u00e0\u00e2\u00e3\u00e4]/g, "a")
      .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, "e")
      .replace(/[\u00ed\u00ec\u00ee\u00ef]/g, "i")
      .replace(/[\u00f3\u00f2\u00f4\u00f5\u00f6]/g, "o")
      .replace(/[\u00fa\u00f9\u00fb\u00fc]/g, "u")
      .replace(/\u00e7/g, "c")
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeClassPart(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/^\s+|\s+$/g, "")
      .replace(/\s+/g, "-")
      .replace(/[\/\\]+/g, "-")
      .replace(/[^a-z0-9_\-\u00c0-\u017f]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function extractTrailingPageNumber(text) {
    var clean = normalizeText(text);
    var m = clean.match(/(.+?)\s+(\d+)\s*$/);
    if (!m) return { title: clean, page: "" };
    return { title: trim(m[1]), page: m[2] };
  }

  function safeFileName(name) {
    var clean = asciiFileName(normalizeText(name))
      .replace(/[\\\/:\*\?"<>\|]/g, "-")
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_\.\-]+/g, "-")
      .replace(/_+/g, "_")
      .replace(/-+/g, "-")
      .replace(/^[\._-]+|[\._-]+$/g, "");
    if (!clean) clean = "norma";
    if (clean.length > 90) clean = clean.substr(0, 90);
    return clean;
  }

  function asciiFileName(s) {
    return String(s || "")
      .replace(/[\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u0100\u0102\u0104]/g, "A")
      .replace(/[\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105]/g, "a")
      .replace(/[\u00c7\u0106\u0108\u010a\u010c]/g, "C")
      .replace(/[\u00e7\u0107\u0109\u010b\u010d]/g, "c")
      .replace(/[\u00d0\u010e\u0110]/g, "D")
      .replace(/[\u00f0\u010f\u0111]/g, "d")
      .replace(/[\u00c8\u00c9\u00ca\u00cb\u0112\u0114\u0116\u0118\u011a]/g, "E")
      .replace(/[\u00e8\u00e9\u00ea\u00eb\u0113\u0115\u0117\u0119\u011b]/g, "e")
      .replace(/[\u00cc\u00cd\u00ce\u00cf\u0128\u012a\u012c\u012e\u0130]/g, "I")
      .replace(/[\u00ec\u00ed\u00ee\u00ef\u0129\u012b\u012d\u012f\u0131]/g, "i")
      .replace(/[\u00d1\u0143\u0145\u0147]/g, "N")
      .replace(/[\u00f1\u0144\u0146\u0148]/g, "n")
      .replace(/[\u00d2\u00d3\u00d4\u00d5\u00d6\u00d8\u014c\u014e\u0150]/g, "O")
      .replace(/[\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u014d\u014f\u0151]/g, "o")
      .replace(/[\u00d9\u00da\u00db\u00dc\u0168\u016a\u016c\u016e\u0170\u0172]/g, "U")
      .replace(/[\u00f9\u00fa\u00fb\u00fc\u0169\u016b\u016d\u016f\u0171\u0173]/g, "u")
      .replace(/[\u00dd\u0176\u0178]/g, "Y")
      .replace(/[\u00fd\u00ff\u0177]/g, "y")
      .replace(/[\u0154\u0156\u0158]/g, "R")
      .replace(/[\u0155\u0157\u0159]/g, "r")
      .replace(/[\u015a\u015c\u015e\u0160]/g, "S")
      .replace(/[\u015b\u015d\u015f\u0161]/g, "s")
      .replace(/[\u0162\u0164\u0166]/g, "T")
      .replace(/[\u0163\u0165\u0167]/g, "t")
      .replace(/[\u0179\u017b\u017d]/g, "Z")
      .replace(/[\u017a\u017c\u017e]/g, "z")
      .replace(/\u00c6/g, "AE")
      .replace(/\u00e6/g, "ae")
      .replace(/\u0152/g, "OE")
      .replace(/\u0153/g, "oe")
      .replace(/\u00df/g, "ss")
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[ºª]/g, "");
  }

  function ensureFolder(folder) {
    if (!folder) return false;
    if (folder.exists) return true;
    try {
      return folder.create();
    } catch (e) {
      return false;
    }
  }

  function joinPath(folder, name) {
    return folder.fsName + "/" + safeFileName(name);
  }

  function writeReport(folder, lines) {
    var file = new File(folder.fsName + "/" + REPORT_FILE);
    file.encoding = "UTF-8";
    if (!file.open("w")) return null;
    file.write(lines.join("\r"));
    file.close();
    return file;
  }

  function isNumberedSeparator(text) {
    return /^\s*\d+[\.\)]\s+/.test(normalizeText(text));
  }

  function padNumber(n, width) {
    var s = String(n);
    while (s.length < width) s = "0" + s;
    return s;
  }

  function pageByName(doc, pageName) {
    var pages, i, page;
    if (!pageName) return null;
    try {
      page = doc.pages.itemByName(String(pageName));
      page.name;
      return page;
    } catch (e1) {}

    try {
      pages = doc.pages.everyItem().getElements();
      for (i = 0; i < pages.length; i++) {
        if (String(pages[i].name) === String(pageName)) return pages[i];
      }
    } catch (e2) {}
    return null;
  }

  function pageIndex(doc, pageName) {
    var page = pageByName(doc, pageName);
    if (!page) return -1;
    try {
      return page.documentOffset;
    } catch (e) {
      return -1;
    }
  }

  function paragraphPage(paragraph) {
    var frames, i, frame, page;
    try {
      frames = paragraph.parentTextFrames;
      for (i = 0; i < frames.length; i++) {
        frame = frames[i];
        try {
          page = frame.parentPage;
          if (page && page.isValid) return page;
        } catch (e1) {}
      }
    } catch (e2) {}
    return null;
  }

  function paragraphText(paragraph) {
    try {
      return normalizeText(paragraph.contents);
    } catch (e) {
      return "";
    }
  }

  function textMatches(a, b) {
    a = normalizeText(a).toLowerCase();
    b = normalizeText(b).toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 12 && b.indexOf(a) >= 0) return true;
    if (b.length >= 12 && a.indexOf(b) >= 0) return true;
    return false;
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

  function defaultExportClass(style) {
    var path = stylePath(style);
    var parts, result = [], i, part;
    if (!path) return "";
    parts = path.split("/");
    for (i = 0; i < parts.length; i++) {
      part = normalizeClassPart(parts[i]);
      if (!part) continue;
      if (part.charAt(0) === "[") continue;
      result.push(part);
    }
    return result.join("_");
  }

  function isNoneCharacterStyle(style) {
    var name;
    try {
      name = String(style.name || "");
    } catch (e) {
      return true;
    }
    if (!name) return true;
    if (name === "[None]" || name === "[Nenhum]" || name === "[No character style]") return true;
    if (name.charAt(0) === "[") return true;
    return false;
  }

  function isAutoTag(tag) {
    var key = normalizeKey(tag);
    if (!key) return true;
    return key === "auto" ||
      key === "automatic" ||
      key === "automatico" ||
      key.indexOf("auto") >= 0 ||
      key.indexOf("automatic") >= 0;
  }

  function exportTagInfo(style, kind) {
    var maps, i, map, chosen = null, exportType;
    var tag = "Auto";
    var cssClass = "";

    try {
      maps = style.styleExportTagMaps.everyItem().getElements();
    } catch (e1) {
      maps = [];
    }

    for (i = 0; i < maps.length; i++) {
      map = maps[i];
      try {
        exportType = String(map.exportType || "").toLowerCase();
      } catch (e2) {
        exportType = "";
      }
      if (exportType.indexOf("html") >= 0 || exportType.indexOf("epub") >= 0) {
        chosen = map;
        break;
      }
      if (!chosen) chosen = map;
    }

    if (chosen) {
      try { tag = String(chosen.exportTag || "Auto"); } catch (e3) {}
      try { cssClass = String(chosen.exportClass || ""); } catch (e4) {}
    }

    if (isAutoTag(tag)) tag = kind === "character" ? "span" : "p";
    if (!trim(cssClass)) cssClass = defaultExportClass(style);

    return {
      kind: kind,
      tag: tag,
      cssClass: cssClass
    };
  }

  function valueMatchesLegislatorTag(value) {
    var parts, i, key;
    value = trim(value);
    if (!value) return false;
    if (LEGISLATOR_TAGS[normalizeKey(value)]) return true;

    parts = value.split(/\s+/);
    for (i = 0; i < parts.length; i++) {
      key = normalizeKey(parts[i]);
      if (LEGISLATOR_TAGS[key]) return true;
    }
    return false;
  }

  function classMatchesIndesignImportMap(value, kind) {
    var classes, i, cls, map;
    value = trim(value);
    if (!value) return "";
    classes = value.split(/\s+/);
    map = kind === "paragraph" ? INDESIGN_PARAGRAPH_CLASS_TO_LEGISLATOR : INDESIGN_CHARACTER_CLASS_TO_LEGISLATOR;

    for (i = 0; i < classes.length; i++) {
      cls = normalizeClassPart(classes[i]);
      if (map[cls]) return map[cls];
    }
    return "";
  }

  function exportInfoHasLegislatorTag(info) {
    return valueMatchesLegislatorTag(info.tag) ||
      valueMatchesLegislatorTag(info.cssClass) ||
      !!classMatchesIndesignImportMap(info.cssClass, info.kind);
  }

  function styleRecordKey(kind, style) {
    return kind + "|" + stylePath(style);
  }

  function addStyleRecord(records, style, kind, pageName) {
    var key, path, info, record;
    if (!style) return;
    if (kind === "character" && isNoneCharacterStyle(style)) return;

    path = stylePath(style);
    if (!path) return;
    key = styleRecordKey(kind, style);
    record = records[key];
    if (!record) {
      info = exportTagInfo(style, kind);
      record = {
        kind: kind,
        path: path,
        tag: info.tag,
        cssClass: info.cssClass,
        mappedAs: classMatchesIndesignImportMap(info.cssClass, kind),
        count: 0,
        pages: {},
        hasCorrespondence: exportInfoHasLegislatorTag(info)
      };
      records[key] = record;
    }
    record.count++;
    if (pageName) record.pages[String(pageName)] = true;
  }

  function collectCharacterStylesFromParagraph(records, paragraph, pageName) {
    var ranges, i, style;
    try {
      ranges = paragraph.textStyleRanges.everyItem().getElements();
    } catch (e1) {
      ranges = [];
    }

    for (i = 0; i < ranges.length; i++) {
      try {
        style = ranges[i].appliedCharacterStyle;
        addStyleRecord(records, style, "character", pageName);
      } catch (e2) {}
    }
  }

  function mapKeys(map) {
    var result = [];
    var key;
    for (key in map) {
      if (map.hasOwnProperty(key)) result.push(key);
    }
    return result.sort();
  }

  function collectNormaItems(startItem, limitItem, includeEmpty) {
    var items = [];
    var story, end, range, paragraphs, i, item;
    if (!startItem) return items;

    story = startItem.story;
    if (limitItem && limitItem.storyKey === startItem.storyKey && limitItem.start > startItem.start) {
      end = limitItem.start - 1;
    } else {
      end = storyLastCharacterIndex(story);
    }
    if (end < startItem.start) return items;

    try {
      range = story.characters.itemByRange(startItem.start, end);
      paragraphs = range.paragraphs.everyItem().getElements();
    } catch (e1) {
      return items;
    }

    for (i = 0; i < paragraphs.length; i++) {
      item = paragraphItem(paragraphs[i]);
      if (!includeEmpty && !item.text) continue;
      items.push(item);
    }
    return items;
  }

  function collectStyleRecords(normaItems, records, progress) {
    var i, item;
    if (!records) return;

    for (i = 0; i < normaItems.length; i++) {
      item = normaItems[i];
      if (progress && (i === 0 || i % 100 === 0 || i === normaItems.length - 1)) {
        progress.update(i + 1, "validando estilos das normas", "Preparando");
      }
      try {
        addStyleRecord(records, item.paragraph.appliedParagraphStyle, "paragraph", item.pageName);
        collectCharacterStylesFromParagraph(records, item.paragraph, item.pageName);
      } catch (e) {}
    }
  }

  function styleValidationFromRecords(records) {
    var invalid = [];
    var keys, i, record;

    keys = mapKeys(records);
    for (i = 0; i < keys.length; i++) {
      record = records[keys[i]];
      if (!record.hasCorrespondence) invalid.push(record);
    }

    invalid.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind < b.kind ? 1 : -1;
      return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
    });

    return {
      total: keys.length,
      invalid: invalid
    };
  }

  function collectStyleValidation(normaItems, progress) {
    var records = {};
    collectStyleRecords(normaItems, records, progress);
    return styleValidationFromRecords(records);
  }

  function pagesText(pages) {
    var keys = mapKeys(pages);
    if (!keys.length) return "?";
    if (keys.length <= 8) return keys.join(", ");
    return keys.slice(0, 8).join(", ") + " ...";
  }

  function pushStyleValidationLines(report, validation) {
    var invalid = validation.invalid;
    var i, record, label;
    report.push("VALIDACAO DE ESTILOS");
    report.push("Estilos encontrados no miolo: " + validation.total);
    report.push("Estilos sem correspondencia com tags/classes reconhecidas pelo Legislator: " + invalid.length);
    if (!invalid.length) {
      report.push("Nenhum estilo sem correspondencia foi encontrado.");
      report.push("");
      return;
    }

    for (i = 0; i < invalid.length; i++) {
      record = invalid[i];
      label = record.kind === "paragraph" ? "Paragrafo" : "Caractere";
      report.push("- " + label + ": " + record.path);
      report.push("  Tag configurada: " + (record.tag || "[vazia]"));
      report.push("  Classe configurada: " + (record.cssClass || "[vazia]"));
      report.push("  Ocorrencias: " + record.count + " | Paginas: " + pagesText(record.pages));
    }
    report.push("");
  }

  function collectSummaryEntries(selection) {
    var paragraphs, i, paragraph, info, entries = [];
    var type;
    try {
      paragraphs = selection.paragraphs.everyItem().getElements();
    } catch (e) {
      fail("Selecione o texto do sumario antes de executar.");
    }

    for (i = 0; i < paragraphs.length; i++) {
      paragraph = paragraphs[i];
      type = "";
      if (paragraphHasStyleInGroup(paragraph, SUMMARY_EPIGRAPH_STYLE, SUMMARY_GROUP)) type = "epigrafe";
      if (paragraphHasStyleInGroup(paragraph, SUMMARY_SEPARATOR_STYLE, SUMMARY_GROUP)) type = "separador";
      if (!type) continue;

      info = extractTrailingPageNumber(paragraph.contents);
      entries.push({
        type: type,
        title: info.title,
        page: info.page,
        index: i,
        text: normalizeText(paragraph.contents)
      });
    }

    return entries;
  }

  function nextLimitEntry(entries, startIndex) {
    var i;
    for (i = startIndex + 1; i < entries.length; i++) {
      if (entries[i].type === "epigrafe" || entries[i].type === "separador") return entries[i];
    }
    return null;
  }

  function assignExportFolders(entries) {
    var map = {};
    var currentParent = "";
    var currentChild = "";
    var i, entry;

    for (i = 0; i < entries.length; i++) {
      entry = entries[i];
      if (entry.type === "separador") {
        if (isNumberedSeparator(entry.title)) {
          currentChild = entry.title;
        } else {
          currentParent = entry.title;
          currentChild = "";
        }
      } else if (entry.type === "epigrafe") {
        map[entry.index] = {
          parent: currentParent,
          child: currentChild
        };
      }
    }
    return map;
  }

  function folderForEntry(rootFolder, folderInfo) {
    var folder = rootFolder;
    if (folderInfo && folderInfo.parent) {
      folder = new Folder(joinPath(folder, folderInfo.parent));
      if (!ensureFolder(folder)) fail("Nao foi possivel criar a pasta: " + folder.fsName);
    }
    if (folderInfo && folderInfo.child) {
      folder = new Folder(joinPath(folder, folderInfo.child));
      if (!ensureFolder(folder)) fail("Nao foi possivel criar a pasta: " + folder.fsName);
    }
    return folder;
  }

  function paragraphItem(paragraph) {
    var story, page;
    story = paragraph.parentStory;
    page = paragraphPage(paragraph);
    return {
      paragraph: paragraph,
      story: story,
      storyKey: storyKey(story),
      start: paragraph.insertionPoints[0].index,
      end: paragraph.insertionPoints[-1].index,
      pageName: page ? String(page.name) : "",
      pageIndex: page ? page.documentOffset : -1,
      text: paragraphText(paragraph),
      isEpigrafe: paragraphStyleStartsWithEpigrafe(paragraph),
      isFacoSaber: paragraphHasStyleInGroup(paragraph, "texto-lei-faco-saber", "corpo-legis")
    };
  }

  function previousParagraphItem(item) {
    var paragraphs, i, paragraph, candidate;
    if (!item || !item.story) return null;

    try {
      paragraphs = item.story.paragraphs.everyItem().getElements();
    } catch (e1) {
      return null;
    }

    for (i = 0; i < paragraphs.length; i++) {
      try {
        paragraph = paragraphs[i];
        candidate = paragraphItem(paragraph);
        if (candidate.start >= item.start) {
          if (i <= 0) return null;
          return paragraphItem(paragraphs[i - 1]);
        }
      } catch (e2) {}
    }
    return null;
  }

  function adjustedStartForIntro(startItem) {
    var current = startItem;
    var previous;
    while (current) {
      previous = previousParagraphItem(current);
      if (!previous || previous.storyKey !== startItem.storyKey) break;
      if (!previous.isFacoSaber) break;
      current = previous;
    }
    return current || startItem;
  }

  function collectPageParagraphs(page, tocStory) {
    var result = [];
    var seen = {};
    var frames, f, frame, paragraphs, p, paragraph, item, key, groupSumario;
    var cacheKey;
    if (!page) return result;

    try {
      cacheKey = String(page.documentOffset) + "|" + storyKey(tocStory);
      if (pageParagraphCache[cacheKey]) return pageParagraphCache[cacheKey];
    } catch (e0) {
      cacheKey = "";
    }

    try {
      frames = page.textFrames.everyItem().getElements();
    } catch (e1) {
      frames = [];
    }

    for (f = 0; f < frames.length; f++) {
      frame = frames[f];
      try {
        if (storyKey(frame.parentStory) === storyKey(tocStory)) continue;
        paragraphs = frame.paragraphs.everyItem().getElements();
      } catch (e2) {
        continue;
      }

      for (p = 0; p < paragraphs.length; p++) {
        paragraph = paragraphs[p];
        try {
          groupSumario = styleHasGroup(paragraph.appliedParagraphStyle, SUMMARY_GROUP);
        } catch (e3) {
          groupSumario = false;
        }
        if (groupSumario) continue;

        try {
          item = paragraphItem(paragraph);
          key = item.storyKey + "|" + item.start;
          if (seen[key]) continue;
          seen[key] = true;
          result.push(item);
        } catch (e4) {}
      }
    }

    result.sort(function (a, b) {
      if (a.storyKey !== b.storyKey) return a.storyKey < b.storyKey ? -1 : 1;
      return a.start - b.start;
    });
    if (cacheKey) pageParagraphCache[cacheKey] = result;
    return result;
  }

  function findEntryOnPage(entry, doc, tocStory, startAfter, requireEpigrafe) {
    var baseIndex = pageIndex(doc, entry.page);
    var offsets = [0, 1, -1];
    var o, idx, page, items, i, item, candidates = [];
    if (baseIndex < 0) return null;

    for (o = 0; o < offsets.length; o++) {
      idx = baseIndex + offsets[o];
      if (idx < 0 || idx >= doc.pages.length) continue;
      try {
        page = doc.pages[idx];
      } catch (e1) {
        continue;
      }
      items = collectPageParagraphs(page, tocStory);
      candidates = [];

      for (i = 0; i < items.length; i++) {
        item = items[i];
        if (startAfter && item.storyKey === startAfter.storyKey && item.start <= startAfter.start) continue;
        if (requireEpigrafe && !item.isEpigrafe) continue;
        if (textMatches(item.text, entry.title)) return item;
        if (requireEpigrafe && item.isEpigrafe) candidates.push(item);
      }

      if (offsets[o] === 0 && requireEpigrafe && candidates.length === 1) return candidates[0];
    }
    return null;
  }

  function findBodyEpigrafe(entry, doc, tocStory, startAfter) {
    return findEntryOnPage(entry, doc, tocStory, startAfter, true);
  }

  function findSeparatorLimit(entry, doc, tocStory, currentStart) {
    var item = findEntryOnPage(entry, doc, tocStory, currentStart, false);
    if (item && item.storyKey === currentStart.storyKey && item.start > currentStart.start) return item;
    return null;
  }

  function findNextEpigrafeInStory(doc, tocStory, currentStart) {
    var startPage = currentStart.pageIndex;
    var page, items, i, item, best;
    if (startPage < 0) startPage = 0;

    for (; startPage < doc.pages.length; startPage++) {
      try {
        page = doc.pages[startPage];
      } catch (e1) {
        continue;
      }
      items = collectPageParagraphs(page, tocStory);
      best = null;
      for (i = 0; i < items.length; i++) {
        item = items[i];
        if (item.storyKey !== currentStart.storyKey) continue;
        if (!item.isEpigrafe || item.start <= currentStart.start) continue;
        if (!best || item.start < best.start) best = item;
      }
      if (best) return best;
    }
    return null;
  }

  function storyLastCharacterIndex(story) {
    try {
      return story.insertionPoints[-1].index - 1;
    } catch (e) {
      return -1;
    }
  }

  function makeTextRange(startItem, limitItem) {
    var story = startItem.story;
    var start = startItem.start;
    var end;

    if (limitItem && limitItem.storyKey === startItem.storyKey && limitItem.start > start) {
      end = limitItem.start - 1;
    } else {
      end = storyLastCharacterIndex(story);
    }

    if (end < start) return null;
    try {
      return story.characters.itemByRange(start, end);
    } catch (e) {
      return null;
    }
  }

  function makeTextRangeFromItems(startItem, endItem) {
    var story, start, end;
    if (!startItem || !endItem) return null;
    if (startItem.storyKey !== endItem.storyKey) return null;

    story = startItem.story;
    start = startItem.start;
    try {
      end = endItem.paragraph.characters[-1].index;
      if (String(endItem.paragraph.characters[-1].contents) === "\r") end--;
    } catch (e1) {
      end = endItem.end - 1;
    }

    if (end < start) return null;
    try {
      return story.characters.itemByRange(start, end);
    } catch (e) {
      return null;
    }
  }

  function trySet(object, prop, value) {
    try {
      object[prop] = value;
    } catch (e) {}
  }

  function snapshotHtmlPrefs(prefs) {
    var keys = [
      "includeClassesInHTML",
      "exportSelection",
      "viewDocumentAfterExport",
      "preserveLocalOverride",
      "generateCascadeStyleSheet",
      "preserveLayoutAppearence"
    ];
    var snap = {}, i;
    for (i = 0; i < keys.length; i++) {
      try {
        snap[keys[i]] = prefs[keys[i]];
      } catch (e) {}
    }
    return snap;
  }

  function restoreHtmlPrefs(prefs, snap) {
    var key;
    for (key in snap) {
      if (snap.hasOwnProperty(key)) trySet(prefs, key, snap[key]);
    }
  }

  function configureHtmlPrefs(doc) {
    var prefs = doc.htmlExportPreferences;
    trySet(prefs, "includeClassesInHTML", true);
    trySet(prefs, "exportSelection", true);
    trySet(prefs, "viewDocumentAfterExport", false);
    trySet(prefs, "preserveLocalOverride", true);
    trySet(prefs, "generateCascadeStyleSheet", false);
    trySet(prefs, "preserveLayoutAppearence", false);
  }

  function openProgress(title, total) {
    var palette, text;
    try {
      palette = new Window("palette", title || "Conferir publicacao HTML");
      palette.orientation = "column";
      palette.alignChildren = ["fill", "top"];
      palette.margins = 14;
      text = palette.add("statictext", undefined, "Preparando...");
      text.characters = 48;
      palette.show();
      return {
        palette: palette,
        text: text,
        update: function (current, label, prefix) {
          try {
            text.text = (prefix || "Conferindo") + ": " + current + " de " + total + (label ? " - " + label : "");
            palette.update();
            app.refresh();
          } catch (e) {}
        },
        close: function () {
          try { palette.close(); } catch (e) {}
        }
      };
    } catch (e) {
      return {
        update: function () {},
        close: function () {}
      };
    }
  }

  function maxDialogContentHeight(fallback) {
    var height = fallback || 360;
    try {
      if ($.screens && $.screens.length) {
        var screen = $.screens[0];
        var screenHeight = screen.bottom - screen.top;
        if (screenHeight > 0) height = Math.min(height, Math.max(260, screenHeight - 240));
      }
    } catch (e) {}
    return height;
  }

  function splitLinesForColumns(lines) {
    var columns = [[], []];
    var half = Math.ceil(lines.length / 2);
    var i;
    for (i = 0; i < lines.length; i++) {
      columns[i < half ? 0 : 1].push(lines[i]);
    }
    return columns;
  }

  function showSetupDialog(entries) {
    var dlg = new Window("dialog", "Exportar normas para HTML");
    var info, body, leftColumn, rightColumn, list, folderPanel, folderText, chooseBtn, buttons;
    var destination = null;
    var epigrafes = [];
    var i;

    for (i = 0; i < entries.length; i++) {
      if (entries[i].type === "epigrafe") epigrafes.push(entries[i]);
    }

    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.margins = 14;

    info = dlg.add("statictext", undefined, epigrafes.length + " epigrafes detectadas no sumario selecionado.");
    info.characters = 58;

    body = dlg.add("group");
    body.orientation = "row";
    body.alignChildren = ["fill", "top"];
    body.spacing = 12;

    leftColumn = body.add("group");
    leftColumn.orientation = "column";
    leftColumn.alignChildren = ["fill", "top"];

    rightColumn = body.add("group");
    rightColumn.orientation = "column";
    rightColumn.alignChildren = ["fill", "top"];

    list = leftColumn.add("listbox", undefined, [], { multiselect: false });
    list.preferredSize = [450, maxDialogContentHeight(280)];
    for (i = 0; i < epigrafes.length; i++) {
      list.add("item", padNumber(i + 1, 3) + " | pag. " + (epigrafes[i].page || "?") + " | " + epigrafes[i].title);
    }

    folderPanel = rightColumn.add("panel", undefined, "Destino");
    folderPanel.orientation = "column";
    folderPanel.alignChildren = ["fill", "top"];
    folderPanel.margins = 12;
    folderText = folderPanel.add("edittext", undefined, "");
    folderText.characters = 34;
    chooseBtn = folderPanel.add("button", undefined, "Escolher pasta...");
    chooseBtn.onClick = function () {
      var folder = Folder.selectDialog("Escolha a pasta raiz para salvar os HTMLs");
      if (!folder) return;
      destination = folder;
      folderText.text = folder.fsName;
    };

    buttons = dlg.add("group");
    buttons.alignment = "right";
    buttons.add("button", undefined, "Cancelar", { name: "cancel" });
    buttons.add("button", undefined, "Exportar HTML", { name: "ok" });

    if (dlg.show() !== 1) return null;
    if (!destination && folderText.text) destination = new Folder(folderText.text);
    if (!destination) fail("Escolha uma pasta de destino.");
    if (!ensureFolder(destination)) fail("Nao foi possivel acessar ou criar a pasta de destino.");

    return { folder: destination };
  }

  function showManualSelectionDialog(selection) {
    var dlg = new Window("dialog", "Exportar recorte manual para HTML");
    var info, folderPanel, folderText, chooseBtn, namePanel, fileNameText, buttons;
    var destination = null;
    var defaultName = "recorte_manual";

    try {
      if (selection && selection.paragraphs && selection.paragraphs.length) {
        defaultName = safeFileName(shorten(selection.paragraphs[0].contents, 48));
      }
    } catch (e1) {}

    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.margins = 14;

    info = dlg.add("statictext", undefined, "Nenhum paragrafo sumario/sum-epigrafe foi encontrado. A selecao sera exportada como um unico HTML.");
    info.characters = 76;

    folderPanel = dlg.add("panel", undefined, "Destino");
    folderPanel.orientation = "row";
    folderPanel.alignChildren = ["fill", "center"];
    folderPanel.margins = 12;
    folderText = folderPanel.add("edittext", undefined, "");
    folderText.characters = 50;
    chooseBtn = folderPanel.add("button", undefined, "Escolher pasta...");
    chooseBtn.onClick = function () {
      var folder = Folder.selectDialog("Escolha a pasta para salvar o HTML");
      if (!folder) return;
      destination = folder;
      folderText.text = folder.fsName;
    };

    namePanel = dlg.add("panel", undefined, "Arquivo");
    namePanel.orientation = "row";
    namePanel.alignChildren = ["fill", "center"];
    namePanel.margins = 12;
    fileNameText = namePanel.add("edittext", undefined, defaultName + ".html");
    fileNameText.characters = 58;

    buttons = dlg.add("group");
    buttons.alignment = "right";
    buttons.add("button", undefined, "Cancelar", { name: "cancel" });
    buttons.add("button", undefined, "Exportar HTML", { name: "ok" });

    if (dlg.show() !== 1) return null;
    if (!destination && folderText.text) destination = new Folder(folderText.text);
    if (!destination) fail("Escolha uma pasta de destino.");
    if (!ensureFolder(destination)) fail("Nao foi possivel acessar ou criar a pasta de destino.");

    defaultName = safeFileName(fileNameText.text.replace(/\.html?$/i, ""));
    return {
      folder: destination,
      file: new File(destination.fsName + "/" + defaultName + ".html")
    };
  }

  function selectionParagraphItems(selection) {
    var items = [];
    var paragraphs, i, item;
    try {
      paragraphs = selection.paragraphs.everyItem().getElements();
    } catch (e1) {
      paragraphs = [];
    }
    for (i = 0; i < paragraphs.length; i++) {
      item = paragraphItem(paragraphs[i]);
      if (item.text) items.push(item);
    }
    return items;
  }

  function hasSummaryEpigrafe(entries) {
    var i;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].type === "epigrafe") return true;
    }
    return false;
  }

  function exportManualSelection(doc, selection) {
    var setup = showManualSelectionDialog(selection);
    var report = [], reportFile, prefs, snap, styleRecords = {}, styleValidation;
    var items, samples, progress;
    if (!setup) return;

    items = selectionParagraphItems(selection);
    samples = paragraphSamples(items, 2);
    collectStyleRecords(items, styleRecords, null);

    progress = openProgress("Exportar recorte manual para HTML", 1);
    progress.update(1, "exportando selecao", "Exportando");

    prefs = doc.htmlExportPreferences;
    snap = snapshotHtmlPrefs(prefs);
    configureHtmlPrefs(doc);
    try {
      exportOneHtml(doc, selection, setup.file);
    } finally {
      try { if (prefs && snap) restoreHtmlPrefs(prefs, snap); } catch (restoreError) {}
      progress.close();
      try { app.select(selection); } catch (e) {}
    }

    report.push("Relatorio de exportacao HTML Legislator");
    report.push("Documento: " + doc.name);
    report.push("Data: " + (new Date()).toString());
    report.push("Modo de exportacao: recorte manual da selecao.");
    report.push("Arquivo HTML: " + setup.file.fsName);
    report.push("Opcao Gerar CSS: desativada.");
    report.push("Paragrafos considerados: " + samples.total);
    report.push("");
    styleValidation = styleValidationFromRecords(styleRecords);
    pushStyleValidationLines(report, styleValidation);
    pushSampleLines(report, "Dois primeiros paragrafos", samples.first);
    pushSampleLines(report, "Dois ultimos paragrafos", samples.last);

    reportFile = writeReport(setup.folder, report);
    if (reportFile) report.splice(6, 0, "Relatorio salvo em: " + reportFile.fsName);
    showReport(report);
  }

  function pageLabel(item) {
    if (!item) return "?";
    return item.pageName || "?";
  }

  function shorten(text, max) {
    text = normalizeText(text);
    max = max || 220;
    if (text.length <= max) return text;
    return text.substr(0, max - 3) + "...";
  }

  function paragraphSamples(items, count) {
    var textItems = [], first = [], last = [];
    var i;
    count = count || 2;

    for (i = 0; i < items.length; i++) {
      if (items[i].text) textItems.push(items[i]);
    }

    for (i = 0; i < textItems.length && first.length < count; i++) {
      first.push(textItems[i]);
    }

    for (i = Math.max(0, textItems.length - count); i < textItems.length; i++) {
      if (i >= 0 && textItems[i]) last.push(textItems[i]);
    }

    return {
      total: textItems.length,
      first: first,
      last: last
    };
  }

  function pushSampleLines(report, label, items) {
    var i;
    report.push("  " + label + ":");
    if (!items.length) {
      report.push("    - [nenhum paragrafo com texto]");
      return;
    }
    for (i = 0; i < items.length; i++) {
      report.push("    - p. " + pageLabel(items[i]) + ": " + shorten(items[i].text, 260));
    }
  }

  function showReport(lines) {
    var dlg = new Window("dialog", "Relatorio de exportacao HTML");
    var columns, body, leftText, rightText, buttons, contentHeight;
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.margins = 14;

    columns = splitLinesForColumns(lines);
    contentHeight = maxDialogContentHeight(420);
    body = dlg.add("group");
    body.orientation = "row";
    body.alignChildren = ["fill", "fill"];
    body.spacing = 10;

    leftText = body.add("edittext", undefined, columns[0].join("\r\n"), { multiline: true, scrolling: true });
    leftText.preferredSize = [430, contentHeight];
    rightText = body.add("edittext", undefined, columns[1].join("\r\n"), { multiline: true, scrolling: true });
    rightText.preferredSize = [430, contentHeight];
    leftText.active = true;

    buttons = dlg.add("group");
    buttons.alignment = "right";
    buttons.add("button", undefined, "Fechar", { name: "ok" });
    dlg.show();
  }

  function exportOneHtml(doc, range, file) {
    app.select(range);
    trySet(doc.htmlExportPreferences, "generateCascadeStyleSheet", false);
    doc.exportFile(ExportFormat.HTML, file, false);
  }

  function comparablePosition(item) {
    if (!item) return null;
    return {
      storyKey: item.storyKey,
      start: item.start
    };
  }

  function cleanupAfterNorma() {
    try { app.select(NothingEnum.NOTHING); } catch (e1) {
      try { app.select(null); } catch (e2) {}
    }
    pageParagraphCache = {};
    try { $.gc(); } catch (e3) {}
    try { app.refresh(); } catch (e4) {}
  }

  function main() {
    var doc, selection, tocStory, entries, setup;
    var exportEntries = [], i, entry, nextEntry, startItem, exportStartItem, limitItem, endItem;
    var samples, itemsForNorma;
    var styleRecords = {}, styleValidation;
    var progress, found = 0, skipped = 0, exported = 0, report = [];
    var warnings = [];
    var nextStartAfter;
    var folderMap, folderInfo, targetFolder, file, range, prefs, snap, reportFile;
    var detailReport = [], filePath, detailPrefix;

    if (!app.documents.length) fail("Abra um documento do InDesign antes de executar.");
    if (!app.selection.length || !app.selection[0].hasOwnProperty("paragraphs")) {
      fail("Selecione o texto do sumario antes de executar.");
    }

    doc = app.activeDocument;
    pageParagraphCache = {};
    selection = app.selection[0];
    tocStory = selection.parentStory;
    entries = collectSummaryEntries(selection);
    if (!hasSummaryEpigrafe(entries)) {
      exportManualSelection(doc, selection);
      return;
    }

    setup = showSetupDialog(entries);
    if (!setup) return;

    folderMap = assignExportFolders(entries);
    for (i = 0; i < entries.length; i++) {
      if (entries[i].type === "epigrafe") {
        exportEntries.push({
          entry: entries[i],
          limit: nextLimitEntry(entries, i),
          folderInfo: folderMap[entries[i].index] || { parent: "", child: "" }
        });
      }
    }
    if (!exportEntries.length) fail("Nao ha epigrafes para exportar.");

    progress = openProgress("Exportar normas para HTML", exportEntries.length);
    progress.update(0, "localizando normas pelas paginas do sumario", "Preparando");

    report.push("Relatorio de exportacao HTML Legislator");
    report.push("Documento: " + doc.name);
    report.push("Data: " + (new Date()).toString());
    report.push("Pasta raiz: " + setup.folder.fsName);
    report.push("Opcao Gerar CSS: desativada.");
    report.push("");
    report.push("Total de epigrafes no sumario: " + exportEntries.length);
    report.push("Modo de exportacao: uma norma por vez, com limpeza entre exportacoes.");
    report.push("");

    prefs = doc.htmlExportPreferences;
    snap = snapshotHtmlPrefs(prefs);
    configureHtmlPrefs(doc);

    try {
      nextStartAfter = null;
      for (i = 0; i < exportEntries.length; i++) {
        entry = exportEntries[i].entry;
        nextEntry = exportEntries[i].limit;
        folderInfo = exportEntries[i].folderInfo;
        startItem = null;
        exportStartItem = null;
        limitItem = null;
        endItem = null;
        itemsForNorma = null;
        samples = null;
        range = null;
        file = null;
        filePath = "[nao exportado]";

        progress.update(i + 1, entry.title, "Conferindo");

        startItem = findBodyEpigrafe(entry, doc, tocStory, nextStartAfter);
        if (!startItem) {
          skipped++;
          warnings.push("[PULADO] Nao localizei a epigrafe no miolo: pag. " + entry.page + " | " + entry.title);
          cleanupAfterNorma();
          continue;
        }
        exportStartItem = adjustedStartForIntro(startItem);

        limitItem = null;
        if (nextEntry) {
          if (nextEntry.type === "epigrafe") {
            limitItem = findBodyEpigrafe(nextEntry, doc, tocStory, startItem);
          } else if (nextEntry.type === "separador") {
            limitItem = findSeparatorLimit(nextEntry, doc, tocStory, startItem);
            if (!limitItem) {
              warnings.push("[AVISO] Nao localizei o separador no miolo; usei a proxima epigrafe como limite: " + nextEntry.title);
              limitItem = findNextEpigrafeInStory(doc, tocStory, startItem);
            }
          }
        } else {
          limitItem = findNextEpigrafeInStory(doc, tocStory, startItem);
        }

        itemsForNorma = collectNormaItems(exportStartItem, limitItem, true);
        if (!itemsForNorma.length) {
          skipped++;
          warnings.push("[PULADO] Nao consegui coletar os paragrafos da norma: " + entry.title);
          nextStartAfter = comparablePosition(startItem);
          cleanupAfterNorma();
          continue;
        }

        endItem = itemsForNorma[itemsForNorma.length - 1];
        samples = paragraphSamples(itemsForNorma, 2);
        collectStyleRecords(itemsForNorma, styleRecords, null);
        found++;

        targetFolder = folderForEntry(setup.folder, folderInfo);
        file = new File(targetFolder.fsName + "/" + padNumber(i + 1, 3) + "_" + safeFileName(entry.title) + ".html");
        range = makeTextRangeFromItems(exportStartItem, endItem);
        if (!range) {
          skipped++;
          warnings.push("[PULADO] Nao consegui criar a selecao de exportacao para: " + entry.title);
          nextStartAfter = comparablePosition(startItem);
          cleanupAfterNorma();
          continue;
        }

        progress.update(i + 1, entry.title, "Exportando");
        try {
          exportOneHtml(doc, range, file);
          filePath = file.fsName;
          exported++;
        } catch (exportError) {
          skipped++;
          warnings.push("[ERRO] Falha ao exportar " + entry.title + ": " + exportError);
        }

        detailPrefix = filePath === "[nao exportado]" ? "[NAO EXPORTADO]" : "[OK]";
        detailReport.push(detailPrefix + " " + padNumber(i + 1, 3) + " | " + entry.title);
        detailReport.push("  Pagina inicial: " + pageLabel(exportStartItem));
        detailReport.push("  Pagina final: " + pageLabel(endItem));
        detailReport.push("  Paragrafos considerados: " + samples.total);
        detailReport.push("  Arquivo HTML: " + filePath);
        detailReport.push("  Limite: " + (nextEntry ? nextEntry.type + " - " + nextEntry.title : "fim da story/proxima epigrafe"));
        if (startItem && startItem.start !== exportStartItem.start) {
          detailReport.push("  Inicio ajustado por texto introdutorio: " + exportStartItem.text);
        }
        detailReport.push("  Epigrafe localizada: " + (startItem ? startItem.text : exportStartItem.text));
        if (limitItem) detailReport.push("  Primeiro paragrafo fora da norma: " + limitItem.text);
        pushSampleLines(detailReport, "Dois primeiros paragrafos", samples.first);
        pushSampleLines(detailReport, "Dois ultimos paragrafos", samples.last);
        detailReport.push("");

        nextStartAfter = comparablePosition(startItem);
        startItem = null;
        exportStartItem = null;
        limitItem = null;
        endItem = null;
        itemsForNorma = null;
        samples = null;
        range = null;
        file = null;
        targetFolder = null;
        cleanupAfterNorma();
      }

      if (warnings.length) {
        report.push("AVISOS");
        for (i = 0; i < warnings.length; i++) report.push("- " + warnings[i]);
        report.push("");
      }
      progress.update(exportEntries.length, "validando estilos", "Concluindo");
      styleValidation = styleValidationFromRecords(styleRecords);
      pushStyleValidationLines(report, styleValidation);

      for (i = 0; i < detailReport.length; i++) report.push(detailReport[i]);
      progress.update(exportEntries.length, "relatorio pronto", "Concluido");
    } finally {
      try { if (prefs && snap) restoreHtmlPrefs(prefs, snap); } catch (restoreError) {}
      progress.close();
      try { app.select(selection); } catch (e) {}
    }

    report.splice(5, 0, "Normas encontradas: " + found);
    report.splice(6, 0, "Normas exportadas: " + exported);
    report.splice(7, 0, "Normas puladas: " + skipped);
    report.splice(8, 0, "Relatorio salvo em: " + setup.folder.fsName + "/" + REPORT_FILE);
    reportFile = writeReport(setup.folder, report);
    if (reportFile) {
      report[8] = "Relatorio salvo em: " + reportFile.fsName;
    }
    showReport(report);
  }

  main();
})();
