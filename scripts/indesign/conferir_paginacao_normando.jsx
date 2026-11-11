/*
 * conferir_paginacao_normando.jsx — confere, no IDML ajustado do Normando aberto no InDesign, se cada
 * parágrafo do miolo ficou na página e com o número de linhas que o Normando planejou.
 *
 * Lê o <nome>.paginacao.json gravado ao lado do .idml (botão "Gerar IDML ajustado" da tela de
 * paginação); se não achar, pede o arquivo. Os parágrafos diferentes recebem a condição
 * "Normando: linhas" (nº de linhas diferente) ou "Normando: página" (mesmo nº de linhas, outra
 * página) — condição com destaque, não sai na impressão nem no PDF. Relatório em
 * <nome>.conferencia.txt, ao lado do json.
 *
 * O que importa é a PRIMEIRA divergência: dali em diante as páginas se deslocam em cadeia. Ajuste o
 * parágrafo apontado (tracking, espaço) até ele ter o nº de linhas previsto e rode de novo.
 */
#target indesign

(function () {
    if (!app.documents.length) { alert('Abra o IDML ajustado do Normando.'); return; }
    var doc = app.activeDocument;

    // ── esperado ──────────────────────────────────────────────
    var arq = null;
    try {
        if (doc.saved || doc.fullName) {
            var base = String(doc.fullName.fsName).replace(/\.(indd|idml)$/i, '');
            var f = new File(base + '.paginacao.json');
            if (f.exists) arq = f;
        }
    } catch (e) { arq = null; }
    if (!arq) arq = File.openDialog('Arquivo .paginacao.json do Normando (ao lado do IDML)', '*.json');
    if (!arq) return;
    arq.encoding = 'UTF-8';
    arq.open('r');
    var texto = arq.read();
    arq.close();
    var dados;
    try { dados = eval('(' + texto + ')'); } catch (e) { alert('Não consegui ler ' + arq.name + ': ' + e); return; }
    var esperado = dados.paragrafos;
    var offset0 = dados.primeiraPagina - 1;   // documentOffset da 1ª página do miolo

    // ── story do miolo: a que tem o mesmo nº de parágrafos (senão a mais longa) ──
    var story = null, maior = null;
    for (var s = 0; s < doc.stories.length; s++) {
        var st = doc.stories[s];
        var n = st.paragraphs.length;
        if (n === esperado.length) { story = st; break; }
        if (!maior || n > maior.paragraphs.length) maior = st;
    }
    if (!story) {
        if (!confirm('Nenhuma história com ' + esperado.length + ' parágrafos (o miolo do Normando). Conferir a mais longa (' + maior.paragraphs.length + ' parágrafos)? O resultado pode sair deslocado.')) return;
        story = maior;
    }

    var condicao = function (nome, cor) {
        var c = doc.conditions.itemByName(nome);
        if (!c.isValid) c = doc.conditions.add({ name: nome, indicatorColor: cor, indicatorMethod: ConditionIndicatorMethod.USE_HIGHLIGHT });
        return c;
    };

    var linhasDif = [], paginasDif = [], fora = [];
    app.doScript(function () {
        var cLinhas = condicao('Normando: linhas', UIColors.RED);
        var cPagina = condicao('Normando: página', UIColors.YELLOW);
        // tira as marcas de uma conferência anterior (o IDML do Normando não usa condições)
        story.texts[0].appliedConditions = [];
        var pars = story.paragraphs.everyItem().getElements();
        var total = Math.min(pars.length, esperado.length);
        for (var q = 0; q < total; q++) {
            var e = esperado[q];
            if (e.linhas === null && e.pagina === null) continue;
            var p = pars[q];
            var ls = p.lines;
            var nl = ls.length;
            var pagina = null;
            try {
                var tf = ls[0].parentTextFrames;
                if (tf.length && tf[0].parentPage) pagina = tf[0].parentPage.documentOffset - offset0;
            } catch (err) { pagina = null; }
            var trecho = String(p.contents).substr(0, 60).replace(/[\r\n]/g, ' ');
            if (pagina === null) { fora.push({ q: q, t: trecho }); continue; }
            if (e.linhas !== null && nl !== e.linhas) {
                linhasDif.push({ q: q, pg: pagina, pgEsp: e.pagina, n: nl, nEsp: e.linhas, t: trecho });
                p.appliedConditions = [cLinhas];
            } else if (e.pagina !== null && pagina !== e.pagina) {
                paginasDif.push({ q: q, pg: pagina, pgEsp: e.pagina, t: trecho });
                p.appliedConditions = [cPagina];
            }
        }
    }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, 'Conferir paginação do Normando');

    // ── relatório ─────────────────────────────────────────────
    var folio = function (rel) { return rel === null ? '?' : String(rel + offset0 + 1); };
    var primeira = null;
    for (var a = 0; a < linhasDif.length; a++) if (!primeira || linhasDif[a].q < primeira.q) primeira = linhasDif[a];
    for (var b = 0; b < paginasDif.length; b++) if (!primeira || paginasDif[b].q < primeira.q) primeira = paginasDif[b];
    var linhas = [];
    linhas.push('Conferência da paginação do Normando — ' + doc.name);
    linhas.push('Parágrafos conferidos: ' + esperado.length);
    linhas.push('Nº de linhas diferente: ' + linhasDif.length + ' (condição "Normando: linhas")');
    linhas.push('Mesma linhas, outra página: ' + paginasDif.length + ' (condição "Normando: página")');
    if (fora.length) linhas.push('Fora das páginas (texto excedente): ' + fora.length);
    if (primeira) linhas.push('', 'PRIMEIRA DIVERGÊNCIA: p. ' + folio(primeira.pg) + ' (previsto p. ' + folio(primeira.pgEsp) + ')' +
        (primeira.nEsp !== undefined ? ', ' + primeira.n + ' linhas (previsto ' + primeira.nEsp + ')' : '') + ' — ' + primeira.t);
    linhas.push('', '── Nº de linhas diferente ──');
    for (var i = 0; i < linhasDif.length; i++) {
        var x = linhasDif[i];
        linhas.push('p. ' + folio(x.pg) + ' (prev. ' + folio(x.pgEsp) + '): ' + x.n + ' linhas, previsto ' + x.nEsp + ' — ' + x.t);
    }
    linhas.push('', '── Outra página ──');
    for (var j = 0; j < paginasDif.length; j++) {
        var y = paginasDif[j];
        linhas.push('p. ' + folio(y.pg) + ' (prev. ' + folio(y.pgEsp) + ') — ' + y.t);
    }
    var rel = new File(String(arq.fsName).replace(/\.paginacao\.json$/i, '') + '.conferencia.txt');
    rel.encoding = 'UTF-8';
    rel.lineFeed = 'Windows';
    if (rel.open('w')) { rel.write('\uFEFF' + linhas.join('\n')); rel.close(); }

    alert(linhasDif.length + paginasDif.length + fora.length === 0
        ? 'Tudo bateu: os ' + esperado.length + ' parágrafos estão na página e com o nº de linhas previstos.'
        : linhas.slice(0, 7).join('\n') + '\n\nRelatório: ' + rel.name);
})();
