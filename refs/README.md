# Refs

Protótipo independente para conferência de referências bibliográficas em artigos.

Este app foi criado em uma pasta isolada (`refs/`) para não alterar rotas,
banco, build nem estrutura interna do Normando.

## Como abrir

Abra `refs/index.html` no navegador.

Para importar DOCX, o app usa o build de navegador do Mammoth já presente no
`node_modules` do projeto principal:

`../node_modules/mammoth/mammoth.browser.min.js`

## O que faz agora

- importa `.docx`;
- permite colar texto;
- localiza a seção final de referências;
- identifica citações autor-data no corpo do texto;
- tenta vincular cada citação ao item correspondente da lista de referências;
- marca citações encontradas, ausentes e com possível divergência de ano;
- exibe um painel navegável de resultados.

## Heurística inicial

O app trabalha com citações em padrão autor-data, como:

- `Gil (2002)`;
- `(Cellard, 2008, p. 300)`;
- `(BRASIL, 2016, p. 153-154)`;
- `(Santos; Ferreira, 2023)`;
- `(Araújo, Tolentino; Silva, 2018; Silvério, 2018)`;
- `(Lopes et al., 2024)`.

As referências finais são identificadas a partir de um título como
`Referências`, `REFERÊNCIAS`, `Referências bibliográficas` ou `Bibliografia`.

## Limitações esperadas

- Citações fora do padrão autor-data podem não ser detectadas.
- Entradas de referência quebradas em vários parágrafos podem exigir ajustes
  posteriores.
- Quando a citação usa o nome do veículo em vez do autor, como
  `(Carta Capital, 2015)`, o app tenta casar pelo texto completo da referência.
