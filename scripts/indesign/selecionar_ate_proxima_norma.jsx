/*
  Expandir selecao ate antes da proxima norma.

  InDesign ExtendScript / ECMAScript 3.
  Uso:
    1. Selecione um trecho de texto ou coloque o cursor no inicio do recorte.
    2. Execute este script.
    3. A selecao sera expandida ate o paragrafo anterior ao inicio da proxima norma.

  Inicio de proxima norma:
    - tit-subtit/abertura-cap
    - tit-subtit/qualquer estilo iniciado por "epigrafe", exceto "epigrafe-apelido"
    - corpo-legis/texto-lei-faco-saber
*/

#target "InDesign"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.interactWithAll;

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

  function normalizeStyleName(name) {
    return String(name || "")
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
      return obj && obj.isValid;
    } catch (e) {
      return false;
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

  function paragraphStyleName(paragraph) {
    try {
      return String(paragraph.appliedParagraphStyle.name || "");
    } catch (e) {
      return "";
    }
  }

  function paragraphHasStyleInGroup(paragraph, styleName, groupName) {
    var style;
    try {
      style = paragraph.appliedParagraphStyle;
      return paragraphStyleName(paragraph) === styleName && styleHasGroup(style, groupName);
    } catch (e) {}
    return false;
  }

  function paragraphIsNormaStart(paragraph) {
    var style, name;
    try {
      style = paragraph.appliedParagraphStyle;
      name = normalizeStyleName(paragraphStyleName(paragraph));
    } catch (e) {
      return false;
    }

    if (styleHasGroup(style, "corpo-legis") && name === "texto-lei-faco-saber") return true;

    if (!styleHasGroup(style, "tit-subtit")) return false;
    if (name === "abertura-cap") return true;
    if (startsWithText(name, "epigrafe") && name !== "epigrafe-apelido") return true;

    return false;
  }

  function activeTextSelection() {
    var sel;
    if (!app.selection.length) fail("Selecione um trecho de texto ou coloque o cursor no inicio do recorte.");

    sel = app.selection[0];
    try {
      if (sel.hasOwnProperty("parentStory") && sel.hasOwnProperty("insertionPoints")) return sel;
      if (sel.hasOwnProperty("paragraphs") && sel.paragraphs.length) return sel.texts[0];
      if (sel.hasOwnProperty("baseline") && sel.parent && sel.parent.hasOwnProperty("parentStory")) return sel.parent;
    } catch (e) {}

    fail("A selecao ativa precisa estar dentro de uma story de texto.");
  }

  function storyLastIndex(story) {
    try {
      return story.characters[-1].index;
    } catch (e1) {
      try {
        return story.insertionPoints[-1].index - 1;
      } catch (e2) {}
    }
    return -1;
  }

  function paragraphStartIndex(paragraph) {
    try {
      return paragraph.insertionPoints[0].index;
    } catch (e) {
      return -1;
    }
  }

  function paragraphIndexByStart(paragraphs, startIndex) {
    var i;
    for (i = 0; i < paragraphs.length; i++) {
      if (paragraphStartIndex(paragraphs[i]) === startIndex) return i;
    }
    return -1;
  }

  function pageFromTextObject(textObject) {
    var frame;
    try {
      if (textObject.parentTextFrames && textObject.parentTextFrames.length) {
        frame = textObject.parentTextFrames[0];
        if (isValidObject(frame.parentPage)) return frame.parentPage;
      }
    } catch (e1) {}

    try {
      if (textObject.parent && textObject.parent.parentTextFrames && textObject.parent.parentTextFrames.length) {
        frame = textObject.parent.parentTextFrames[0];
        if (isValidObject(frame.parentPage)) return frame.parentPage;
      }
    } catch (e2) {}

    return null;
  }

  function forceWindowToPage(page) {
    var win, zoom;
    if (!page || !app.activeWindow) return;

    try {
      win = app.activeWindow;
      zoom = win.zoomPercentage;
      win.activePage = page;
      win.zoomPercentage = zoom === 100 ? 101 : zoom + 1;
      win.zoomPercentage = zoom;
    } catch (e) {}
  }

  function goToSelectionEndPage(story, endIndex, range) {
    var endChar, endIp, page;
    try {
      endChar = story.characters.itemByRange(endIndex, endIndex);
      page = pageFromTextObject(endChar);
    } catch (e1) {}

    try {
      endIp = story.insertionPoints[endIndex + 1];
      if (!page) page = pageFromTextObject(endIp);
      app.select(endIp);
    } catch (e2) {}

    forceWindowToPage(page);

    try {
      app.select(range);
    } catch (e3) {}

    forceWindowToPage(page);
  }

  function expandSelectionToNextNorma() {
    var selection = activeTextSelection();
    var story, paragraphs, selectedParagraphs, startIndex, paragraphIndex, i;
    var lastSelectedParagraph, lastSelectedStart;
    var nextStartParagraph = null;
    var endIndex, range;

    try {
      story = selection.parentStory;
      startIndex = selection.insertionPoints[0].index;
      paragraphs = story.paragraphs.everyItem().getElements();
      selectedParagraphs = selection.paragraphs.everyItem().getElements();
    } catch (e1) {
      fail("Nao foi possivel ler a selecao de texto ativa.");
    }

    if (!selectedParagraphs.length) fail("Nao foi possivel identificar o paragrafo selecionado.");
    lastSelectedParagraph = selectedParagraphs[selectedParagraphs.length - 1];
    lastSelectedStart = paragraphStartIndex(lastSelectedParagraph);
    paragraphIndex = paragraphIndexByStart(paragraphs, lastSelectedStart);
    if (paragraphIndex < 0) fail("Nao foi possivel localizar a selecao dentro da story.");

    for (i = paragraphIndex + 1; i < paragraphs.length; i++) {
      if (paragraphIsNormaStart(paragraphs[i])) {
        nextStartParagraph = paragraphs[i];
        break;
      }
    }

    if (nextStartParagraph) {
      endIndex = nextStartParagraph.insertionPoints[0].index - 1;
    } else {
      endIndex = storyLastIndex(story);
      alert("Nao encontrei o inicio da proxima norma. A selecao foi expandida ate o fim da story.");
    }

    if (endIndex < startIndex) {
      fail("O inicio da proxima norma esta antes do ponto final da selecao atual.");
    }

    try {
      range = story.characters.itemByRange(startIndex, endIndex);
      app.select(range);
      goToSelectionEndPage(story, endIndex, range);
    } catch (e2) {
      fail("Nao foi possivel expandir a selecao ate a proxima norma.");
    }
  }

  expandSelectionToNextNorma();
})();
