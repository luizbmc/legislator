# Scripts InDesign

## `atualizar_norma_legislator.jsx`

Atualiza no InDesign uma norma ja diagramada usando um XML exportado pelo Legislator.

Fluxo esperado:

1. Coloque o cursor no paragrafo da epigrafe da norma ou selecione manualmente todo o texto da norma.
2. Execute `atualizar_norma_legislator.jsx`.
3. Clique em `Escolher XML...` e selecione o XML do Legislator.
4. Revise os mapeamentos de tags XML para estilos do InDesign.
5. Clique em `Confirmar`.

O script:

- quando ha apenas cursor/um paragrafo selecionado, seleciona automaticamente da epigrafe ate o primeiro `corpo-legis/ass-nome-espaco-ant`;
- se encontrar outra epigrafe depois que o corpo da norma ja comecou e antes de `ass-nome-espaco-ant`, pede selecao manual;
- copia a selecao antiga para uma camada temporaria chamada `legislator-temporaria`;
- remove do XML as tags `Epigrafe` e `EpigrafeApelido`;
- preserva os paragrafos iniciais correspondentes na selecao antiga, quando essas tags existirem no inicio do XML;
- insere o corpo novo da norma aplicando estilos de paragrafo e caractere;
- cria/atualiza as condicoes de modificacao e exclusao abaixo;
- aplica condicoes aos paragrafos marcados no XML com `alterado="modificado"` ou `alterado="remocaoApos"`;
- procura, no texto antigo copiado, paragrafos com override de composicao;
- tambem preserva paragrafos sem override quando houver trecho com estilo de caractere `nao-hifenizar`, `nao-hifenizar italico`, `sem-quebra` ou `sem quebra`;
- quando encontra o mesmo paragrafo no texto novo, substitui o paragrafo novo pelo antigo para preservar ajustes manuais;
- oculta a camada temporaria ao concluir;
- abre uma paleta de navegacao pelas alteracoes, com botoes `Anterior` e `Proximo`;
- exibe um relatorio com a quantidade de paragrafos com override encontrados e restaurados.

Observacao: a deteccao de override segue a logica do Anexo II: primeiro testa `paragraph.styleOverridden`; se houver override, salva o `leading`, aplica o `leading` do estilo, testa novamente `styleOverridden` e restaura o valor original.

## `exportar_norma_legislator.jsx`

Exporta a norma selecionada no InDesign para XML do Legislator.

Mapeamentos principais:

- estilos no grupo `tit-subtit` que comecam com `epigrafe`, exceto `epigrafe-apelido`, viram `Epigrafe`;
- `epigrafe-apelido` vira `EpigrafeApelido`;
- `corpo-legis/nome-juridico` vira `NomeJuridico`;
- `corpo-legis/art` vira `Artigo`;
- `corpo-legis/texto-lei-citacao` vira `Citacao`;
- `corpo-legis/texto-lei` e estilos equivalentes viram `Paragrafo`, `Inciso`, `Alinea` ou `Item` por inferencia do texto.

Estilos de caractere:

- `bold-artigo` vira `Rotulo`;
- `bold` vira `b`;
- `italico` vira `i`;
- `nota novo formato` vira `Nota`;
- `italico light` vira `i`.

Antes de salvar, o script alerta se encontrar estilos de paragrafo ou caractere sem tag XML mapeada.

## `exportar_publicacao_html_legislator.jsx`

Exporta varias normas de uma publicacao usando a exportacao HTML nativa do InDesign.

Fluxo esperado:

1. Selecione o texto do sumario da publicacao.
2. Execute `exportar_publicacao_html_legislator.jsx`.
3. O script detecta os paragrafos `sumario/sum-epigrafe` e `sumario/sum-separador`.
4. Escolha a pasta raiz de destino.
5. Clique em `Exportar HTML`.

O script:

- usa a numeracao de pagina no sumario para localizar cada epigrafe no miolo;
- consulta apenas os frames das paginas indicadas pelo sumario para localizar os limites, sem varrer todas as stories do documento;
- depois de localizar os limites, coleta os paragrafos diretamente do range de cada norma;
- procura no miolo paragrafos de epigrafe no grupo `tit-subtit`, exceto `epigrafe-apelido`;
- valida apenas os estilos de paragrafo e caractere encontrados dentro dos limites das normas localizadas, ignorando texto fora das normas;
- quando a tag configurada esta como `Auto`, considera `p` para estilos de paragrafo e `span` para estilos de caractere;
- quando a classe do estilo esta vazia, considera a classe que o InDesign gera na exportacao HTML, no formato `grupo_estilo`;
- lista os estilos cuja tag ou classe nao corresponde a nenhuma tag XML ou classe HTML reconhecida pelo importador do Legislator;
- exibe um relatorio com a pagina inicial, pagina final, dois primeiros paragrafos e dois ultimos paragrafos de cada norma localizada;
- quando uma epigrafe do sumario e seguida por `sumario/sum-separador` antes da proxima epigrafe, usa esse separador como limite da selecao;
- cria pastas a partir dos paragrafos `sumario/sum-separador`, usando separador sem numero como pasta-mae e separador numerado como subpasta;
- exporta cada norma em um HTML separado;
- mantem a opcao `Gerar CSS` desativada nas preferencias de exportacao HTML;
- salva `_relatorio-exportacao-html.txt` na pasta raiz.

## `inserir_norma_legislator.jsx`

Insere no InDesign uma nova norma a partir de um XML exportado pelo Legislator,
sem depender de uma norma anterior ja diagramada.

Fluxo esperado:

1. Coloque o cursor no ponto em que a nova norma deve ser inserida.
   Alternativamente, selecione um frame de texto para inserir no fim da story.
2. Execute `inserir_norma_legislator.jsx`.
3. Clique em `Escolher XML...` e selecione o XML do Legislator.
4. Revise os mapeamentos de tags XML para estilos do InDesign.
5. Clique em `Inserir`.

O script:

- importa todos os blocos do XML, incluindo epigrafe e apelido;
- aplica estilos de paragrafo conforme o mapeamento exibido na UI;
- aplica estilos de caractere para `Rotulo`, `b`, `i`, `Nota` e `sup`;
- cria/atualiza as condicoes de modificacao e exclusao abaixo;
- aplica condicoes aos paragrafos marcados no XML com `alterado="modificado"` ou `alterado="remocaoApos"`;
- exibe um resumo com a quantidade de paragrafos inseridos e condicoes aplicadas.
