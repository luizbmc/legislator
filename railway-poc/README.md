# Normando no Railway com SQLite

Este serviço hospeda uma cópia completa do banco SQLite do Normando em um
volume persistente do Railway. O aplicativo local continua executando a
interface, as rotinas e as exportações; normas, publicações, tags, exceções e
usuários podem ser lidos e gravados no banco online.

## Recursos

- SQLite em volume persistente, com WAL, transações e `busy_timeout`;
- API protegida por uma chave compartilhada;
- catálogo e edição completa de normas e publicações;
- cadastro compartilhado de usuários para comentários e autoria da última
  atualização;
- histórico de versões das normas;
- proteção contra sobrescrita concorrente por número de revisão;
- backup do banco remoto pelo aplicativo;
- modo de cópias controladas mantido para homologação e testes.

## Teste local

```powershell
cd C:\dev\legislator\railway-poc
npm install
$env:POC_API_KEY="uma-chave-local"
npm test
npm start
```

O banco local de teste será criado em `railway-poc\data\normando-poc.db`.

## Implantação no Railway

1. Crie um serviço a partir do repositório do Normando.
2. Em **Settings > Source**, defina o diretório raiz como `/railway-poc`.
3. Crie `POC_API_KEY` com uma chave longa e aleatória.
4. Adicione um volume montado em `/data`.
5. Em **Networking**, gere um domínio público.
6. Configure o healthcheck como `/health`.

O Railway fornece automaticamente `PORT` e
`RAILWAY_VOLUME_MOUNT_PATH`.

## Colocar o banco no volume

Não envie o banco para o Git. Faça primeiro uma cópia de segurança do banco
oficial e envie essa cópia:

```powershell
railway volume files --volume NOME_DO_VOLUME upload `
  "C:\temp\legislator-copia.db" `
  "/legislator-copia.db"
```

Configure no serviço:

```text
DATABASE_NAME=legislator-copia.db
```

Reinicie o serviço. As migrações necessárias, como revisão concorrente e
cadastro de usuários, são aplicadas automaticamente sem apagar dados
existentes.

## Ativar no Normando

1. Atualize o código local e execute `npm install` quando as dependências
   tiverem mudado.
2. Execute `npm run build` ou inicie com `npm run dev`.
3. Abra **Configurações > Railway**.
4. Informe o domínio público, sem acrescentar `/api`.
5. Informe a mesma `POC_API_KEY`.
6. Marque **Usar banco Railway no aplicativo**.
7. Clique em **Salvar configuração e testar**.

Com o modo ativo, as telas normais do aplicativo passam a usar o banco
Railway. Desmarcar a opção volta a usar o banco local, sem copiar ou mesclar
dados entre as duas fontes.

No Electron, a configuração fica no diretório de dados do usuário. No acesso
por `localhost`, ela fica junto ao banco do servidor, em
`railway-remoto.json`. Esse arquivo contém a chave e não deve ser enviado ao
Git.

## Usuários

Os usuários continuam sendo apenas identificadores de autoria; não são contas
de login. Eles ficam na tabela `usuarios` do mesmo SQLite selecionado.

Em **Configurações > Usuários**, é possível adicionar, selecionar e excluir
usuários. A escolha do usuário atual continua armazenada em cada computador,
enquanto a lista de nomes e cores é compartilhada pelo banco.

## Concorrência

Normas e publicações possuem uma revisão numérica. Ao salvar, a API confirma
que o registro ainda está na revisão carregada pelo usuário. Se outra pessoa
salvou antes, a operação recebe `HTTP 409` e não sobrescreve silenciosamente o
trabalho mais recente.

O SQLite no Railway deve ser acessado por uma única instância do serviço.
Não configure múltiplas réplicas apontando para o mesmo arquivo.

## Backup

Em modo Railway, **Configurações > Backup > Exportar banco** baixa uma cópia
consistente do SQLite remoto. A restauração direta pelo aplicativo fica
bloqueada por segurança; para restaurar, use uma janela de manutenção, pare o
serviço e substitua o arquivo no volume.

## Verificação

```powershell
$headers = @{ "x-api-key" = "SUA-CHAVE" }

Invoke-RestMethod https://SEU-DOMINIO/health
Invoke-RestMethod https://SEU-DOMINIO/api/info -Headers $headers
```

`/health` deve indicar `volumeMounted: true`. `/api/info` deve mostrar o
caminho em `/data` e as contagens de normas e publicações.

## Segurança

- A API usa uma única chave compartilhada, não autenticação individual.
- Use HTTPS do domínio Railway e uma chave longa.
- Não registre a chave no repositório.
- Faça backups periódicos.
- As ações ficam atribuídas aos nomes cadastrados, mas isso não substitui uma
  trilha de auditoria autenticada.
