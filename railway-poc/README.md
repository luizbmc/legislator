# Normando Railway SQLite PoC

Esta pasta é uma prova de conceito independente. Ela não importa módulos do
Normando, não usa o banco oficial e não altera as rotas do aplicativo atual.

## O que ela testa

- API Node/Express acessível por HTTPS no Railway;
- SQLite nativo com `better-sqlite3`;
- banco armazenado em volume persistente;
- modo WAL e transações;
- autenticação simples por chave;
- bloqueio de sobrescrita concorrente por número de revisão;
- leitura opcional das contagens de `normas` e `publicacoes` quando uma cópia
  do banco real for colocada no volume.
- edição controlada de cópias de normas, com histórico e restauração, sem
  alterar as tabelas reais do Normando.

## Teste local

```powershell
cd C:\dev\legislator\railway-poc
npm install
$env:POC_API_KEY="uma-chave-local"
npm test
npm start
```

O banco local de teste será criado em `railway-poc\data\normando-poc.db`.

## Implantação isolada no Railway

1. Envie esta pasta para o GitHub junto com o projeto.
2. No Railway, crie um serviço novo a partir do repositório.
3. Em **Settings > Source**, configure o diretório raiz como:

   ```text
   /railway-poc
   ```

4. Crie a variável:

   ```text
   POC_API_KEY=<uma-chave-longa-e-aleatoria>
   ```

5. Adicione um volume ao serviço com o caminho:

   ```text
   /data
   ```

6. Em **Networking**, gere um domínio público.
7. Configure o healthcheck como `/health`.

O Railway fornece automaticamente `PORT` e `RAILWAY_VOLUME_MOUNT_PATH`.

Abra o domínio gerado. A página de diagnóstico permite informar a chave,
consultar o banco e criar registros persistentes diretamente pelo navegador.

Para navegar pela cópia real e testar a edição isolada, abra:

```text
https://SEU-DOMINIO/homologacao.html
```

A homologação oferece:

- catálogo paginado de normas;
- busca por epígrafe, apelido ou conteúdo;
- abertura sob demanda do conteúdo da norma;
- catálogo e estrutura de publicações;
- tempos separados de rede e consulta SQLite;
- benchmark de consultas comuns.
- criação de uma cópia de edição a partir de uma norma real;
- salvamento com número de revisão e detecção de conflito;
- histórico integral das versões anteriores;
- restauração de uma versão como uma nova revisão.

As rotas de escrita em `/api/homologacao/edicoes` modificam somente:

```text
railway_homologacao_normas
railway_homologacao_versoes
```

As tabelas `normas`, `normas_versoes`, `publicacoes` e seus vínculos continuam
em modo somente leitura durante toda esta prova de conceito.

## Verificação

Sem chave:

```powershell
Invoke-RestMethod https://SEU-DOMINIO/health
```

Com chave:

```powershell
$headers = @{ "x-api-key" = "SUA-CHAVE" }

Invoke-RestMethod https://SEU-DOMINIO/api/info -Headers $headers

$body = @{
  titulo = "Registro persistente"
  conteudo = "Criado antes de um redeploy"
} | ConvertTo-Json

Invoke-RestMethod `
  https://SEU-DOMINIO/api/registros `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

Faça um redeploy e consulte novamente:

```powershell
Invoke-RestMethod https://SEU-DOMINIO/api/registros -Headers $headers
```

O registro deve continuar presente e `/api/info` deve indicar
`volumeMounted: true` no `/health`.

## Teste com uma cópia do banco atual

Não coloque `legislator.db` no Git.

Depois de criar o volume, use o gerenciamento de arquivos do Railway CLI para
enviar uma cópia do banco para:

```text
/data/legislator-copia.db
```

Configure no serviço:

```text
DATABASE_NAME=legislator-copia.db
```

Reinicie o serviço e consulte `/api/info`. O endpoint deve mostrar as contagens
de `normas` e `publicacoes`. A PoC criará somente tabelas prefixadas com
`railway_poc_` ou `railway_homologacao_` dentro dessa cópia.

## Teste de edição controlada

1. Abra `/homologacao.html` e informe a chave.
2. Informe o nome do testador.
3. Abra uma norma real e clique em **Criar ou abrir cópia de edição**.
4. Modifique a epígrafe ou o conteúdo textual e salve.
5. Confira o incremento da revisão e a nova entrada no histórico.
6. Restaure uma revisão anterior e confira que a versão atual foi preservada.
7. Volte à norma real e confirme que seu texto continua inalterado.

Para testar conflito, abra a mesma cópia em duas abas. Salve primeiro em uma
delas e depois tente salvar a aba antiga. A segunda operação deve receber
`HTTP 409`, manter o texto local na tela e solicitar recarregamento.

## Limites deliberados

- A homologação exige uma chave compartilhada; ainda não há autenticação por
  usuário.
- Nenhuma rota de homologação permite editar ou excluir dados reais.
- O editor da PoC altera apenas o texto simples. O `conteudo_doc` estruturado é
  preservado sem edição nesta etapa.
- Não há integração com o aplicativo Electron.
- Não existe login de usuário; apenas uma chave de teste.
- Não substitui o servidor atual.
- Deve ser removida ou protegida antes de qualquer uso real.
