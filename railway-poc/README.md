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

Para navegar pela cópia real sem editar nada, abra:

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

Todas as rotas em `/api/homologacao` são exclusivamente `GET`.

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
`railway_poc_` dentro dessa cópia.

## Limites deliberados

- A homologação expõe normas e publicações somente para leitura e exige a chave.
- Nenhuma rota de homologação permite editar ou excluir dados reais.
- Não há integração com o aplicativo Electron.
- Não existe login de usuário; apenas uma chave de teste.
- Não substitui o servidor atual.
- Deve ser removida ou protegida antes de qualquer uso real.
