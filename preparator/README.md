# Preparator

Protótipo independente para preparação editorial de textos não legislativos.

Este app foi criado em uma pasta isolada (`preparator/`) para não alterar rotas,
banco, build nem estrutura interna do Legislator/Normando.

## Como abrir

Abra `preparator/index.html` no navegador.

Para importar DOCX, o app usa o build de navegador do Mammoth já presente no
`node_modules` do projeto principal:

`../node_modules/mammoth/mammoth.browser.min.js`

## O que faz agora

- importa `.docx`;
- permite colar texto;
- executa regras iniciais inspiradas no guia de revisão;
- aplica marcações visuais no texto;
- exibe um painel navegável de ocorrências;
- não substitui automaticamente o conteúdo.

## Próximos passos naturais

- transformar regras em arquivo configurável;
- adicionar aceitar/ignorar/concluir ocorrência;
- exportar DOCX com comentários ou realces;
- criar perfis de regra por tipo de obra;
- importar o guia de revisão para uma base versionada de regras.
