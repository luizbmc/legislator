/*
 * preparar_livro_normando.jsx — prepara o InDesign de uma edição para o Normando montar o livro completo.
 * Grava, numa pasta, o que o Normando não consegue tirar do IDML: livro.idml, livro.pdf (páginas que
 * entram no PDF de revisão) e livro.json (página de cada parte, onde termina cada parte e a posição
 * dos números que mudam: sumário e "1/1992 a N/AAAA" da apresentação). Não altera o documento.
 * Partes: os parágrafos de abertura (abertura-cap); num livro sem eles (Regimento), as epígrafes do
 * texto principal (divisao: 'epigrafe').
 *
 * Com o documento aberto: Scripts > preparar_livro_normando.jsx, e escolher a pasta.
 * Sem janela (testes): app.scriptArgs livroDoc (arquivo) e livroPasta.
 */
#target indesign

(function () {
    // o ExtendScript não tem JSON
    // caracteres de controle (ex.: marca de nota de rodapé no título) não podem ir para o JSON
    var CONTROLE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');
    var comoJson = function (v) {
        if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
        if (typeof v === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' ').replace(CONTROLE, '') + '"';
        var i, r = [];
        if (v instanceof Array) { for (i = 0; i < v.length; i++) r.push(comoJson(v[i])); return '[' + r.join(',') + ']'; }
        for (i in v) if (v.hasOwnProperty(i)) r.push('"' + i + '":' + comoJson(v[i]));
        return '{' + r.join(',') + '}';
    };
    var args = app.scriptArgs;
    var auto = args.isDefined('livroDoc');
    var doc, pasta;
    if (auto) {
        doc = app.open(new File(args.getValue('livroDoc')), false);
        pasta = new Folder(args.getValue('livroPasta'));
    } else {
        if (!app.documents.length) { alert('Abra o documento do livro.'); return; }
        doc = app.activeDocument;
        pasta = Folder.selectDialog('Pasta do livro para o Normando');
        if (!pasta) return;
    }
    var unidadeH = doc.viewPreferences.horizontalMeasurementUnits, unidadeV = doc.viewPreferences.verticalMeasurementUnits;
    var unidade = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        var numero = function (pg) { return pg ? Number(pg.name) : null; };
        // posição de um trecho de caracteres em relação à página
        var trecho = function (a, b) {
            var fr = a.parentTextFrames[0], pg = fr.parentPage, bd = pg.bounds;
            return {
                pagina: numero(pg), x0: a.horizontalOffset - bd[1], x1: b.endHorizontalOffset - bd[1], base: a.baseline - bd[0],
                corpo: a.pointSize, fonte: a.appliedFont.fontFamily, estilo: a.fontStyle
            };
        };

        // partes: parágrafos de abertura do texto principal
        var partes = [], estilos = doc.allParagraphStyles;
        app.findTextPreferences = NothingEnum.NOTHING;
        for (var e = 0; e < estilos.length; e++) {
            if (!/^abertura-cap(-nova-pg)?$/.test(estilos[e].name) && !/:abertura-cap(-nova-pg)?$/.test(estilos[e].name)) continue;
            app.findTextPreferences.appliedParagraphStyle = estilos[e];
            var achados = doc.findText();
            for (var k = 0; k < achados.length; k++) {
                var p = achados[k].paragraphs[0], st = p.parentStory;
                var parte = { titulo: String(p.contents).replace(/[\r\n﻿]+/g, ' ').replace(/^\s+|\s+$/g, ''), pagina: numero(p.characters[0].parentTextFrames[0].parentPage), anterior: null, fim: null };
                if (p.index > 1) {
                    var c = st.characters.item(p.index - 2);
                    parte.anterior = numero(c.parentTextFrames[0].parentPage);
                    parte.fim = c.baseline - c.parentTextFrames[0].parentPage.bounds[0];
                }
                partes.push(parte);
            }
        }
        app.findTextPreferences = NothingEnum.NOTHING;
        // livro sem aberturas de parte (Regimento): cada norma começa na epígrafe do texto principal
        var divisao = 'abertura';
        if (!partes.length) {
            divisao = 'epigrafe';
            var principal = null;
            for (var h = 0; h < doc.stories.length; h++) if (!principal || doc.stories[h].length > principal.length) principal = doc.stories[h];
            var pars = principal.paragraphs;
            for (var r = 0; r < pars.length; r++) {
                var nomeEst = pars[r].appliedParagraphStyle.name;
                if (!/(^|:)epigrafe(-quebra)?$/.test(nomeEst)) continue;
                var pr = pars[r];
                if (!pr.characters.length || !pr.characters[0].parentTextFrames.length) continue;
                var pe = { titulo: String(pr.contents).replace(/[\r\n﻿]+/g, ' ').replace(/^\s+|\s+$/g, ''), pagina: numero(pr.characters[0].parentTextFrames[0].parentPage), anterior: null, fim: null };
                if (pr.index > 1) {
                    var ce = principal.characters.item(pr.index - 2);
                    if (ce.parentTextFrames.length) {
                        pe.anterior = numero(ce.parentTextFrames[0].parentPage);
                        pe.fim = ce.baseline - ce.parentTextFrames[0].parentPage.bounds[0];
                    }
                }
                partes.push(pe);
            }
        }
        // as epígrafes já vêm na ordem do texto (duas podem cair na mesma página)
        if (divisao === 'abertura') partes.sort(function (a, b) { return a.pagina - b.pagina; });

        // sumário: posição do número de cada entrada; apresentação: número da última emenda
        var sumario = [], trocas = [];
        for (var s = 0; s < doc.stories.length; s++) {
            var story = doc.stories[s];
            if (story.storyType === StoryTypes.TOC_STORY) {
                var ps = story.paragraphs;
                for (var q = 0; q < ps.length; q++) {
                    var cs = ps[q].characters, n = cs.length, f = n - 1;
                    if (n && /[\r\n]/.test(String(cs[f].contents))) f--;
                    var i = f;
                    while (i >= 0 && /^\d$/.test(String(cs[i].contents))) i--;
                    if (i === f) continue;
                    var t = trecho(cs[i + 1], cs[f]);
                    var numeroTexto = '';
                    for (var d = i + 1; d <= f; d++) numeroTexto += String(cs[d].contents);
                    t.numero = Number(numeroTexto);
                    sumario.push(t);
                }
                continue;
            }
            if (story.length > 3000) continue;
            // entre o "a" e o número pode haver um caractere invisível (U+FEFF)
            var m = /1\/1992 a[^\d]{0,3}(\d+\/\d{4})/.exec(story.contents);
            if (m && story.textContainers.length && story.textContainers[0].parentPage) {
                var ini = m.index + m[0].length - m[1].length;
                var tt = trecho(story.characters[ini], story.characters[ini + m[1].length - 1]);
                tt.texto = m[1];
                trocas.push(tt);
            }
        }

        var dados = { documento: doc.name, paginas: doc.pages.length, divisao: divisao, partes: partes, sumario: sumario, trocas: trocas };
        var json = new File(pasta.fsName + '/livro.json');
        json.encoding = 'UTF-8';
        json.open('w');
        json.write(comoJson(dados));
        json.close();
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, new File(pasta.fsName + '/livro.idml'), false);
        // sem os realces de condição no PDF
        var indicadores = doc.conditionalTextPreferences.showConditionIndicators;
        doc.conditionalTextPreferences.showConditionIndicators = ConditionIndicatorMode.HIDE_INDICATORS;
        doc.exportFile(ExportFormat.PDF_TYPE, new File(pasta.fsName + '/livro.pdf'), false);
        app.waitForAllTasks();
        // livro-sangria.pdf: as mesmas páginas com 5 mm de sangria e sem marcas — o PDF para a gráfica
        // tira daqui o que passa da linha de corte (arte do rosto); as marcas o Normando põe
        var pe = app.pdfExportPreferences, guardar = {};
        var campos = ['useDocumentBleedWithPDF', 'bleedTop', 'bleedBottom', 'bleedInside', 'bleedOutside', 'cropMarks', 'bleedMarks', 'registrationMarks', 'colorBars', 'pageInformationMarks', 'includeSlugWithPDF', 'exportReaderSpreads', 'pageRange'];
        for (var c = 0; c < campos.length; c++) { try { guardar[campos[c]] = pe[campos[c]]; } catch (eC) { } }
        try {
            var sangria = 5 * 72 / 25.4;
            pe.useDocumentBleedWithPDF = false;
            pe.bleedTop = sangria; pe.bleedBottom = sangria; pe.bleedInside = sangria; pe.bleedOutside = sangria;
            pe.cropMarks = false; pe.bleedMarks = false; pe.registrationMarks = false; pe.colorBars = false; pe.pageInformationMarks = false;
            pe.includeSlugWithPDF = false; pe.exportReaderSpreads = false; pe.pageRange = PageRange.ALL_PAGES;
            doc.exportFile(ExportFormat.PDF_TYPE, new File(pasta.fsName + '/livro-sangria.pdf'), false);
            app.waitForAllTasks();
        } finally {
            for (var k in guardar) if (guardar.hasOwnProperty(k)) { try { pe[k] = guardar[k]; } catch (eR) { } }
        }
        doc.conditionalTextPreferences.showConditionIndicators = indicadores;
        if (!new File(pasta.fsName + '/livro.pdf').length) throw new Error('O PDF do livro saiu vazio.');
        if (!auto) alert('Livro preparado: ' + partes.length + ' partes, ' + sumario.length + ' entradas do sumário.');
    } finally {
        app.scriptPreferences.measurementUnit = unidade;
        if (auto) doc.close(SaveOptions.NO);
    }
})();
