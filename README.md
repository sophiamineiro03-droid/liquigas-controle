# liquigas-controle

Projeto iniciado do zero para desenvolver um sistema de controle de uma distribuidora de gás.

## Estado atual

Base de desenvolvimento local com servidor HTTP e testes automatizados. Os módulos de negócio ainda não foram implementados. Não há banco de dados, autenticação, serviços externos ou deploy configurados.

## Requisitos

Node.js 24 (versão usada na validação: 24.22.1). A base usa apenas módulos nativos; não é necessário instalar pacotes.

## Desenvolvimento

Execute na raiz do repositório:

```sh
npm run dev
```

O servidor escuta somente na interface local, na porta 3000. Para trocar a porta, use `PORT=3001 npm run dev`. Para executar sem recarga automática, use `npm start`.

Em outro terminal, confira o funcionamento:

```sh
curl --fail http://127.0.0.1:3000/api/health
```

Resposta esperada: `{"status":"ok","service":"liquigas-controle"}`.

## Validação

```sh
npm run check
npm test
```

## Estrutura

- `src/server.js`: servidor e endpoint de saúde.
- `test/server.test.js`: testes HTTP reais, em porta temporária.
- `docs/plano.md`: proposta inicial de evolução.

Não versionar credenciais ou dados reais de clientes. Serviços externos e publicação dependem de autorização explícita.
