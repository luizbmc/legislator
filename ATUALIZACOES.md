# Atualizações do Normando

O Normando instalado verifica as versões publicadas em:

```text
https://github.com/luizbmc/legislator/releases
```

Quando uma versão nova é encontrada, o aplicativo mostra um aviso. O usuário
pode baixar a atualização e clicar em **Instalar e reiniciar**. Também existe
um controle em **Configurações > Atualizações**.

O banco no Railway não faz parte do instalador e não é substituído durante a
atualização.

## Primeira instalação

1. Publique a primeira versão usando o procedimento abaixo.
2. Abra a Release criada no GitHub.
3. Baixe `Normando-Setup-X.Y.Z.exe`.
4. Instale esse arquivo em cada computador.

Depois da primeira instalação, as próximas versões podem ser recebidas pelo
próprio aplicativo.

Como o instalador ainda não possui assinatura digital, o Windows pode mostrar
um aviso do SmartScreen. A assinatura pode ser adicionada futuramente sem
alterar o mecanismo de atualização.

## Publicar uma atualização

Antes de publicar, confirme que todas as alterações desejadas estão salvas no
Git:

```powershell
cd C:\dev\legislator
git status
git add .
git commit -m "Descrição da atualização"
git push origin main
```

Crie uma versão. Para uma correção ou melhoria comum:

```powershell
npm run version:patch
git push origin main --follow-tags
```

Exemplo: `1.0.0` passa para `1.0.1`.

Para uma atualização maior de funcionalidades:

```powershell
npm run version:minor
git push origin main --follow-tags
```

O comando `npm version` atualiza `package.json`, cria um commit e cria a tag
Git correspondente. O envio da tag inicia automaticamente o workflow
**Publicar Normando para Windows**.

## Acompanhar a publicação

1. Abra a aba **Actions** do repositório no GitHub.
2. Acompanhe o workflow **Publicar Normando para Windows**.
3. Quando ele terminar, confira a nova entrada na aba **Releases**.

A Release deve conter:

- `Normando-Setup-X.Y.Z.exe`;
- `Normando-Setup-X.Y.Z.exe.blockmap`;
- `latest.yml`.

Os três arquivos são necessários para o mecanismo de atualização.

## Testar antes de distribuir

O build da aplicação pode ser validado com:

```powershell
npm run build
```

O instalador pode ser gerado localmente com:

```powershell
npm run package:win
```

Em computadores Windows sem permissão para criar links simbólicos, o
`electron-builder` pode falhar ao extrair sua ferramenta de assinatura. Nesse
caso, use o GitHub Actions para gerar o instalador ou habilite o **Modo de
Desenvolvedor** do Windows.
