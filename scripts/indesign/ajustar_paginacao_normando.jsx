/*
 * ajustar_paginacao_normando.jsx — leva o IDML ajustado do Normando, aberto no InDesign, à paginação
 * planejada: cada parágrafo com número de linhas diferente do plano é apertado ou solto em etapas
 * até chegar ao previsto, e as páginas criadas pelo transbordo são removidas.
 *
 * Lê o <nome>.paginacao.json gravado ao lado do .idml (botão "Gerar IDML ajustado"); se não achar,
 * pede o arquivo. Um só desfazer. Relatório em <nome>.ajuste.txt, ao lado do json, com os parágrafos
 * que não chegaram ao previsto e os que precisaram da hifenização flexibilizada.
 *
 * A última linha do parágrafo não pode ter menos de 8 caracteres (7 em caso complexo, sempre
 * relatado): conta para o parágrafo estar pronto, e um parágrafo com o nº de linhas certo e a
 * última linha curta é solto até ela crescer.
 *
 * Como no script do diagramador, o parágrafo para quando chega ao nº de linhas previsto ou quando o
 * espaçamento de alguma linha passa do limite sem o nº de linhas mudar. Se apertar não bastou, volta
 * ao início, flexibiliza a hifenização e tenta de novo (sem trocar espaços fixos do texto).
 *
 * Etapas (as do script de apertar/soltar parágrafo do diagramador):
 *   apertar — etapa par: tracking −1; etapa ímpar: tracking −2 e espaço mínimo entre palavras −1;
 *   soltar  — toda etapa: espaço entre palavras +2; etapa par: letras +1 e mínimo +1; a cada 4: mínimo
 *             das letras +1; depois da 21ª: desejado e mínimo das letras iguais ao máximo.
 * O espaço mínimo entre palavras nunca fica abaixo de 82% (regra do Normando).
 *
 * Sem janela (testes): app.scriptArgs normandoDoc, normandoJson e, opcionais, normandoSaida (.indd)
 * e normandoPdf.
 */
#target indesign

(function () {
    var ESPACO_MINIMO = 82;       // % — piso do espaço entre palavras
    var ETAPAS = 60;              // limite do script do diagramador no modo "viúva" (parar quando o nº de linhas muda)
    var ESPACO_FONTE = 0.2;       // em — espaço normal da Source Sans 3, medido no InDesign
    var LIMITE_APERTO = 0.76;     // espaço visível (com o tracking): 82% com tracking −12
    var LIMITE_ABERTO = 1.7;      // o de "espaçamento aberto" do Normando (ABERTA em linhas.js)
    var MM_PT = 72 / 25.4;
    var LINHA_CURTA = 8;          // caracteres — a última linha do parágrafo não pode ter menos
    var LINHA_COMPLEXA = 7;       // só em caso complexo, e sempre relatado

    var args = app.scriptArgs;
    var auto = args.isDefined('normandoDoc');
    var arg = function (n) { return args.isDefined(n) ? args.getValue(n) : ''; };
    var lista = function (x) { return (x instanceof Array) ? x : [x]; };
    var aviso = function (t) { if (!auto) alert(t); };
    var ui = app.scriptPreferences.userInteractionLevel;
    if (auto) app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

    var doc = null, arq = null, rel = [];
    try {
        if (auto) {
            doc = app.open(new File(arg('normandoDoc')), false);
            arq = new File(arg('normandoJson'));
        } else {
            if (!app.documents.length) { alert('Abra o IDML ajustado do Normando.'); return; }
            doc = app.activeDocument;
            try {
                var f = new File(String(doc.fullName.fsName).replace(/\.(indd|idml)$/i, '') + '.paginacao.json');
                if (f.exists) arq = f;
            } catch (e) { arq = null; }
            if (!arq) arq = File.openDialog('Arquivo .paginacao.json do Normando (ao lado do IDML)', '*.json');
            if (!arq) return;
        }
        arq.encoding = 'UTF-8';
        arq.open('r');
        var dados = eval('(' + arq.read() + ')');
        arq.close();
        var esperado = dados.paragrafos, offset0 = dados.primeiraPagina - 1;
        if (dados.ultimaLinha) { LINHA_CURTA = dados.ultimaLinha; LINHA_COMPLEXA = dados.ultimaComplexa; ESPACO_MINIMO = dados.espacoMinimo; LIMITE_APERTO = dados.limiteAperto; }
        // bolso (usuário, 2026-11-10): ocupação mínima da última linha e +1 caractere quando ela é só nota
        var OCUPACAO = !!dados.ultimaOcupacao, NOTA_MAIS_UM = !!dados.notaMaisUm;

        doc.recompose();
        var story = null;
        for (var s = 0; s < doc.stories.length; s++) if (doc.stories[s].paragraphs.length === esperado.length) { story = doc.stories[s]; break; }
        if (!story) { aviso('Nenhuma história com ' + esperado.length + ' parágrafos (o miolo do Normando).'); return; }

        var feitos = [], maisLinhas = [], curtas = [], complexos = [], flexibilizados = [], foraDoLimite = [], falhos = [], paginasRemovidas = 0, desvios = [], paginasBrancas = [];

        var guardar = function (p) {
            var rs = p.textStyleRanges.everyItem().getElements(), tr = [];
            for (var r = 0; r < rs.length; r++) tr.push(rs[r].tracking);
            return { rs: rs, tr: tr, minW: p.minimumWordSpacing, desW: p.desiredWordSpacing, maxW: p.maximumWordSpacing,
                minL: p.minimumLetterSpacing, desL: p.desiredLetterSpacing, maxL: p.maximumLetterSpacing };
        };
        var porTracking = function (g, d) { for (var r = 0; r < g.rs.length; r++) g.rs[r].tracking = g.tr[r] + d; };
        // ordem: máximo antes de subir, mínimo antes de descer — o InDesign exige mínimo ≤ desejado ≤ máximo
        var espacos = function (p, minW, desW, maxW) {
            p.maximumWordSpacing = maxW; p.desiredWordSpacing = desW; p.minimumWordSpacing = Math.min(minW, desW);
        };
        var letras = function (p, minL, desL, maxL) {
            p.maximumLetterSpacing = maxL; p.desiredLetterSpacing = desL; p.minimumLetterSpacing = Math.min(minL, desL);
        };
        var restaurar = function (p, g) {
            porTracking(g, 0);
            p.minimumWordSpacing = Math.min(g.minW, p.minimumWordSpacing);
            p.minimumLetterSpacing = Math.min(g.minL, p.minimumLetterSpacing);
            p.desiredWordSpacing = g.desW; p.desiredLetterSpacing = g.desL;
            p.maximumWordSpacing = g.maxW; p.maximumLetterSpacing = g.maxL;
            p.minimumWordSpacing = g.minW; p.minimumLetterSpacing = g.minL;
        };

        // menor e maior espaço visível entre palavras das linhas, em frações do espaço normal; a última
        // linha só conta no aperto (no fim do parágrafo o espaço curto importa, o longo não)
        var espacamento = function (p) {
            var ls = p.lines, n = ls.length, menor = 9, maior = 0;
            for (var k = 0; k < n; k++) {
                var c = ls[k].characters, ct = lista(c.everyItem().contents), x = lista(c.everyItem().horizontalOffset), sz = lista(c.everyItem().pointSize);
                var soma = 0, nat = 0;
                for (var m = 0; m + 1 < ct.length; m++) if (ct[m] === ' ' && x[m + 1] > x[m]) { soma += (x[m + 1] - x[m]) * MM_PT; nat += ESPACO_FONTE * sz[m]; }
                if (!nat) continue;
                menor = Math.min(menor, soma / nat);
                if (k < n - 1) maior = Math.max(maior, soma / nat);
            }
            return { menor: menor, maior: maior };
        };
        var minimoUltima = LINHA_CURTA, passouLimite = false, exigirOcupacao = false;
        var ultimaLinha = function (p) { return String(p.lines[-1].contents).replace(/\s+$/, '').length; };
        // última linha só com texto de nota ("nota novo formato", corpo menor)
        var soNota = function (p) {
            var cs = p.lines[-1].characters, ct = lista(cs.everyItem().contents), st = lista(cs.everyItem().appliedCharacterStyle), algum = false;
            for (var k = 0; k < ct.length; k++) {
                if (typeof ct[k] !== 'string' || /^\s*$/.test(ct[k])) continue;
                algum = true;
                if (!/nota novo formato/i.test(st[k].name)) return false;
            }
            return algum;
        };
        var minimoDe = function (p, min) { return min + (NOTA_MAIS_UM && soNota(p) ? 1 : 0); };
        // ocupação da última linha: largura do texto sobre a largura da coluna (menos os recuos);
        // mínimo 10% com 2 linhas, 11% com 3, 12% com 4, 13% com 5 ou mais (bolso)
        var limiar = function (n) { return n <= 2 ? 0.10 : n === 3 ? 0.11 : n === 4 ? 0.12 : 0.13; };
        var ocupacao = function (p) {
            var l = p.lines[-1], fr = l.parentTextFrames[0];
            if (!fr) return 1;
            var gb = fr.geometricBounds, tp = fr.textFramePreferences, ins = lista(tp.insetSpacing);
            var cols = tp.textColumnCount || 1;
            var col = ((gb[3] - gb[1]) - (ins[1] || 0) - (ins[3] || 0) - tp.textColumnGutter * (cols - 1)) / cols;
            var largura = col - p.leftIndent - p.rightIndent;
            return largura > 0 ? (l.endHorizontalOffset - l.horizontalOffset) / largura : 1;
        };
        var vazia = function (p) { return OCUPACAO && p.lines.length > 1 && ocupacao(p) < limiar(p.lines.length); };
        var pronto = function (q, alvo) {
            var p = story.paragraphs[q];
            return p.lines.length === alvo && (alvo < 2 || (ultimaLinha(p) >= minimoDe(p, minimoUltima) && (!exigirOcupacao || !vazia(p))));
        };
        var pct = function (v) { return Math.round(v * 100) + '%'; };

        var apertarEtapas = function (q, alvo, g) {
            var p = story.paragraphs[q], d = 0, minW = g.minW;
            for (var i = 0; i < ETAPAS; i++) {
                if (espacamento(story.paragraphs[q]).menor < LIMITE_APERTO) return null;
                d -= i % 2 === 0 ? 1 : 2;
                porTracking(g, d);
                if (i % 2 === 1) { minW = Math.max(ESPACO_MINIMO, minW - 1); if (minW < g.minW) p.minimumWordSpacing = minW; }
                if (pronto(q, alvo)) return { etapas: i + 1, tracking: Math.min.apply(null, g.tr) + d };
                if (story.paragraphs[q].lines.length < alvo) return null;
            }
            return null;
        };
        // etapas de flexibilização de hifenização do script do diagramador
        var HIFEN = ['hyphenWeight', 'hyphenateAcrossColumns', 'hyphenateLastWord', 'hyphenateCapitalizedWords', 'hyphenateAfterFirst', 'hyphenateBeforeLast', 'hyphenateWordsLongerThan'];
        var flexibilizar = function (q, alvo) {
            var p = story.paragraphs[q];
            p.hyphenWeight = 0; p.hyphenateAcrossColumns = true; p.hyphenateLastWord = true; p.hyphenateCapitalizedWords = true;
            if (pronto(q, alvo)) return true;
            p.hyphenateAfterFirst = 2; p.hyphenateBeforeLast = 2;
            if (pronto(q, alvo)) return true;
            p.hyphenateWordsLongerThan = 5;
            return pronto(q, alvo);
        };
        // só com as etapas; se o resultado ficar abaixo do limite, tenta com a hifenização flexibilizada e
        // fica com o que deixar o espaço mais folgado
        var apertar = function (q, alvo) {
            var p = story.paragraphs[q], g = guardar(p), h = {}, a;
            for (a = 0; a < HIFEN.length; a++) h[HIFEN[a]] = p[HIFEN[a]];
            var r = apertarEtapas(q, alvo, g);
            var menor = r ? espacamento(story.paragraphs[q]).menor : 0;
            if (r && menor >= LIMITE_APERTO) return r;
            restaurar(p, g);
            var r2 = flexibilizar(q, alvo) ? { etapas: 0, tracking: Math.min.apply(null, g.tr), flex: true } : apertarEtapas(q, alvo, g);
            if (r2 && espacamento(story.paragraphs[q]).menor > menor) { r2.flex = true; return r2; }
            restaurar(p, g);
            for (a = 0; a < HIFEN.length; a++) p[HIFEN[a]] = h[HIFEN[a]];
            // só passando do limite de aperto: fica com a linha a mais (usuário, 2026-11-07: o limite vale
            // mais que o nº de linhas previsto)
            passouLimite = !!r;
            return null;
        };
        var soltar = function (q, alvo) {
            var p = story.paragraphs[q], g = guardar(p);
            var minW = g.minW, desW = g.desW, maxW = g.maxW, minL = g.minL, desL = g.desL, maxL = g.maxL;
            var soLinhaCurta = p.lines.length === alvo;
            for (var i = 0; i < ETAPAS; i++) {
                if (espacamento(story.paragraphs[q]).maior > LIMITE_ABERTO) break;
                maxW += 2; desW += 2; minW += 2;
                if (i > 21) { desL = maxL; minL = maxL; }
                if (i % 2 === 0) { maxL += 1; desL += 1; minW += 1; }
                if (i % 4 === 0) minL += 1;
                espacos(p, minW, desW, maxW);
                letras(p, minL, desL, maxL);
                if (pronto(q, alvo)) {
                    // só para alongar a última linha, não vale abrir além do limite: fica no relatório
                    if (soLinhaCurta && espacamento(story.paragraphs[q]).maior > LIMITE_ABERTO) break;
                    return { etapas: i + 1, desW: desW, maxW: maxW, maxL: maxL };
                }
                if (story.paragraphs[q].lines.length > alvo) break;
            }
            restaurar(p, g);
            return null;
        };

        var medirPaginas = function () {
            var idx = lista(story.paragraphs.everyItem().index), pag = [], q = 0, tc = story.textContainers;
            for (var c = 0; c < tc.length; c++) {
                var fr = tc[c];
                if (!fr.lines.length || !fr.parentPage) continue;
                var li = lista(fr.lines.everyItem().index), o = fr.parentPage.documentOffset - offset0;
                for (var k = 0; k < li.length; k++) {
                    while (q + 1 < idx.length && idx[q + 1] <= li[k]) q++;
                    if (pag[q] === undefined) pag[q] = o;
                }
            }
            return pag;
        };

        app.doScript(function () {
            for (var q = 0; q < esperado.length; q++) {
                var e = esperado[q];
                if (e.linhas === null) continue;
                var p = story.paragraphs[q], n = p.lines.length;
                var curta = n === e.linhas && n > 1 && ultimaLinha(p) < minimoDe(p, LINHA_CURTA);
                var quaseVazia = n === e.linhas && vazia(p);
                if (n === e.linhas && !curta && !quaseVazia) continue;
                var trecho = String(p.contents).substr(0, 60).replace(/[\r\n]/g, ' ');
                var ajustar = n > e.linhas ? apertar : soltar;
                passouLimite = false;
                // última linha quase vazia (bolso): soltar dentro do limite até ela ocupar o mínimo da
                // largura; se não der, vale o mínimo de caracteres, como antes
                var r = null;
                if (quaseVazia) {
                    exigirOcupacao = true;
                    r = soltar(q, e.linhas);
                    exigirOcupacao = false;
                    if (r) r.ocupacao = true;
                    else if (!curta) continue;
                }
                if (!r) r = ajustar(q, e.linhas);
                if (!r && passouLimite) {
                    // a linha a mais fica; se a última sair curta, solta o parágrafo dentro do limite de abertura
                    var curtaMais = ultimaLinha(story.paragraphs[q]) < minimoDe(story.paragraphs[q], LINHA_CURTA);
                    if (curtaMais) soltar(q, n);
                    maisLinhas.push(q + ': ' + n + ' linhas, previsto ' + e.linhas + ' — apertar passaria do limite (' + pct(LIMITE_APERTO) + '); última linha com ' + ultimaLinha(story.paragraphs[q]) + ' caracteres — ' + trecho);
                    continue;
                }
                // caso complexo: 7 caracteres, relatado
                if (!r && curta && ultimaLinha(story.paragraphs[q]) >= minimoDe(story.paragraphs[q], LINHA_COMPLEXA)) { complexos.push(q + ': última linha com ' + ultimaLinha(story.paragraphs[q]) + ' caracteres, sem ajuste — ' + trecho); continue; }
                if (!r) {
                    minimoUltima = LINHA_COMPLEXA;
                    r = ajustar(q, e.linhas);
                    minimoUltima = LINHA_CURTA;
                    if (r) complexos.push(q + ': última linha com ' + ultimaLinha(story.paragraphs[q]) + ' caracteres — ' + trecho);
                }
                // assinaturas da CF (ass-cf): ajusta se der, mas não entra no relatório (usuário, 2026-11-07)
                if (!r && /^ass-cf$/.test(p.appliedParagraphStyle.name)) continue;
                if (!r) { (curta ? curtas : falhos).push(q + ': ' + n + ' linhas, previsto ' + e.linhas + (curta ? ', última linha com ' + ultimaLinha(story.paragraphs[q]) + ' caracteres' : '') + ' — ' + trecho); continue; }
                var ee = espacamento(story.paragraphs[q]);
                var linha = q + ': ' + n + ' → ' + e.linhas + ' em ' + r.etapas + ' etapa(s)' +
                    (r.tracking !== undefined ? ', tracking ' + r.tracking : ', palavras ' + r.desW + '/' + r.maxW + '%, letras até ' + r.maxL + '%') +
                    ', espaço ' + pct(ee.menor) + ' a ' + pct(ee.maior) + (r.ocupacao ? ', última linha agora com ' + pct(ocupacao(story.paragraphs[q])) + ' da largura' : '') + ' — ' + trecho;
                feitos.push(linha);
                if (r.flex) flexibilizados.push(linha);
                if (ee.menor < LIMITE_APERTO || ee.maior > LIMITE_ABERTO) foraDoLimite.push(linha);
            }
            // páginas criadas pelo transbordo: vazias, no fim do miolo
            while (true) {
                var tc = story.textContainers, ult = tc[tc.length - 1];
                if (tc.length <= dados.paginas || ult.lines.length || !ult.parentPage) break;
                ult.parentPage.remove();
                paginasRemovidas++;
            }
            // página que ficou em branco (quebra para o lado certo): sem cabeço, como as brancas do livro
            for (var bp = 0; bp < doc.pages.length; bp++) {
                var pgb = doc.pages[bp], fs = pgb.textFrames, branca = fs.length > 0 && pgb.appliedMaster !== null;
                for (var bf = 0; bf < fs.length && branca; bf++) if (!fs[bf].isValid || fs[bf].contents !== '' && !/^[\s﻿]*$/.test(fs[bf].contents)) branca = false;
                if (!branca || pgb.allGraphics.length) continue;
                // último quadro da história, vazio: página que o reflow criou ao abrir o documento
                if (fs.length === 1 && fs[0].previousTextFrame && !fs[0].nextTextFrame) { pgb.remove(); paginasRemovidas++; bp--; continue; }
                pgb.appliedMaster = NothingEnum.NOTHING;
                paginasBrancas.push(pgb.name);
            }
        }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, 'Ajustar paginação do Normando');

        var pag = medirPaginas();
        for (var w = 0; w < esperado.length; w++) if (esperado[w].pagina !== null && pag[w] !== esperado[w].pagina) desvios.push(w);

        rel.push('Ajuste da paginação do Normando — ' + doc.name);
        rel.push('Parágrafos ajustados: ' + feitos.length);
        rel.push('Sem solução nos limites: ' + falhos.length);
        rel.push('Com uma linha a mais que o previsto (apertar passaria do limite): ' + maisLinhas.length);
        rel.push('Última linha curta, mantida (resolver passaria do limite de espaçamento): ' + curtas.length);
        rel.push('Última linha no mínimo do caso complexo: ' + complexos.length);
        rel.push('Com hifenização flexibilizada (conferir): ' + flexibilizados.length);
        rel.push('Com espaço além do limite (conferir): ' + foraDoLimite.length);
        rel.push('Páginas removidas: ' + paginasRemovidas);
        rel.push('Páginas em branco, sem cabeço: ' + (paginasBrancas.length ? paginasBrancas.join(', ') : 'nenhuma'));
        rel.push('Parágrafos fora da página prevista: ' + desvios.length);
        if (desvios.length) {
            var d0 = desvios[0];
            rel.push('PRIMEIRO: parágrafo ' + d0 + ', p. ' + (pag[d0] + offset0 + 1) + ' (previsto p. ' + (esperado[d0].pagina + offset0 + 1) + ') — ' + String(story.paragraphs[d0].contents).substr(0, 60).replace(/[\r\n]/g, ' '));
        }
        rel.push('', '── Sem solução ──'); rel = rel.concat(falhos);
        rel.push('', '── Linha a mais que o previsto ──'); rel = rel.concat(maisLinhas);
        rel.push('', '── Última linha curta, mantida ──'); rel = rel.concat(curtas);
        rel.push('', '── Última linha no caso complexo ──'); rel = rel.concat(complexos);
        rel.push('', '── Hifenização flexibilizada ──'); rel = rel.concat(flexibilizados);
        rel.push('', '── Espaço além do limite ──'); rel = rel.concat(foraDoLimite);
        rel.push('', '── Ajustados ──'); rel = rel.concat(feitos);

        var saida = new File(String(arq.fsName).replace(/\.paginacao\.json$/i, '') + '.ajuste.txt');
        saida.encoding = 'UTF-8';
        saida.lineFeed = 'Windows';
        if (saida.open('w')) { saida.write(rel.join('\n')); saida.close(); }

        if (auto) {
            if (arg('normandoSaida')) doc.save(new File(arg('normandoSaida')));
            if (arg('normandoPdf')) doc.exportFile(ExportFormat.PDF_TYPE, new File(arg('normandoPdf')), false);
        }
        aviso(rel.slice(0, 10).join('\n') + '\n\nRelatório: ' + saida.name);
    } finally {
        if (auto) {
            try { if (doc && doc.isValid) doc.close(SaveOptions.NO); } catch (e2) {}
            app.scriptPreferences.userInteractionLevel = ui;
        }
    }
})();
