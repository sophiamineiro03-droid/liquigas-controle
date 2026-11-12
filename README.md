# Liquigás Controle

Primeira versão local do controle diário de caixa e fundo de troco da **Liquigás Castelense**, em Castelo do Piauí. Interface em português, responsiva para notebook e celular. Estoque, clientes, pedidos e emissão fiscal estão fora desta fase.

## Executar

Requer Node.js 24 (validado com 24.22.1). Na raiz do checkout:

```sh
npm ci --cache /tmp/liquigas-npm-cache
npm run dev
```

Abra o navegador no endereço local `http://127.0.0.1:3000`. `npm start` executa sem recarga automática; `PORT=3001 npm start` escolhe outra porta. O servidor escuta somente na interface local. Não foi configurado acesso remoto, hospedagem nem publicação. Para testar a interface em celular real será necessário um acesso HTTPS autorizado; o layout móvel foi validado em Chromium com viewport de 390 × 844.

A aplicação usa módulos nativos de Node e do navegador. A única dependência de desenvolvimento é Playwright, para testes; não há dependências de execução nem etapa de compilação.

## Fluxo da atendente

1. **Abrir caixa**: informe data, dinheiro do caixa **fora do fundo**, dinheiro efetivamente disponível no fundo, responsável e observações opcionais. A referência do fundo é **R$ 100,00**. Não abra mais de um expediente simultaneamente.
2. **Venda em espécie**: informe o valor da venda e o recebido do cliente. O recebido entra no caixa e o troco sai do fundo, juntos em uma única gravação. Não lance esse troco outra vez como saída.
3. **Repor fundo**: transfira dinheiro do caixa para o fundo quando conseguir notas menores. Para devolver dinheiro do fundo ao caixa use **Transferir**. Essas operações não geram receitas, vendas ou despesas.
4. **Entrada / Saída**: selecione a conta e informe o valor e o motivo. Um aporte externo no fundo é uma entrada com destino Fundo, não uma reposição interna.
5. **Estornar**: mantém o original e acrescenta a inversão com justificativa. Não é permitido repetir estorno, estornar um estorno ou deixar contas negativas. Para corrigir valor, estorne e registre o lançamento correto. **Ajustar** registra uma correção justificada; não existe exclusão financeira na interface.
6. **Conferir e fechar**: conte caixa e fundo separadamente. A comparação aparece antes de confirmar. Diferenças por conta exigem observações. O fechamento congela os lançamentos; não há reabertura nesta versão.
7. **Histórico**: filtre por data, selecione o expediente e consulte abertura, movimentos e conferência. **Imprimir resumo e histórico** usa a impressão do navegador, inclusive salvar como PDF.
8. **Exportar cópia dos dados**: gera um JSON com todos os expedientes, lançamentos e fechamentos. Guarde-o em local seguro fora do navegador. Importação assistida ainda não foi implementada; não descarte os originais.

Todos os formulários exigem um responsável, inclusive após recarregar a página. O nome é autodeclarado, **não equivale a login autenticado**.

## Regras financeiras confirmadas

- Todos os valores de negócio são centavos inteiros. Entrada aceita `1200,50` ou `1200`; não aceita pontos, negativos, notação científica ou mais de duas casas decimais. Valores unitários e saldos têm limite de R$ 9.999.999.999,99.
- Caixa e fundo são contas separadas. **Total físico = caixa fora do fundo + fundo**. Os saldos iniciais são informados em cada abertura; não há transporte automático do dia anterior.
- Referência do fundo: R$ 100,00. Falta = máximo entre zero e referência menos disponível. Excedente = máximo entre zero e disponível menos referência.
- Venda de R$ 120,00 com recebimento de R$ 200,00: caixa aumenta R$ 200,00, fundo diminui R$ 80,00 e total físico aumenta somente R$ 120,00. É necessário saldo no fundo para entregar o troco. Se o dinheiro apenas mudar de lugar, registre transferência, não venda.
- Entradas e saídas do painel são **fluxos físicos brutos**, incluindo recebimentos e troco das vendas, aportes, retiradas e ajustes. Vendas são mostradas também pelo valor líquido; esse indicador não deve ser somado novamente às entradas. Transferências internas são excluídas das entradas/saídas. O resumo mostra o volume físico de transferências, incluindo movimentos inversos e estornos, não receita.
- Estornos preservam os fluxos inversos no histórico; a venda líquida é reduzida pelo estorno. Ajustes líquidos são identificados no fechamento.
- Diferença de conferência = contado menos esperado, por conta e no total. Falta de reposição do fundo não é diferença de caixa. Fechar não cria um ajuste automático.
- Uma data admite um único caixa, mesmo depois de fechado. Reabertura/correção de expedientes fechados exige um fluxo futuro explícito.
- Saídas, transferências e estornos que deixariam alguma conta negativa são rejeitados.

## Offline e proteção dos dados

IndexedDB guarda os dados financeiros no navegador e o service worker guarda somente os arquivos da interface. Após a primeira carga e a indicação **Aplicação disponível offline**, é possível recarregar e continuar lançando sem rede. PWA e service worker exigem contexto seguro (HTTPS ou localhost). A instalação como aplicativo depende do navegador; foi validado o uso offline em Chromium, não a instalação em todas as plataformas móveis.

**Não há backend remoto, Supabase ou sincronização configurados.** O indicador de rede não garante acesso à internet nem indica envio de dados. A aplicação mantém UUIDs e status `pending`; voltar a ficar online não altera esse status. A fila não é processada até existir uma integração autorizada com autenticação, idempotência e política de conflitos. Não há sincronização entre dispositivos.

Gravações são transações atômicas: uma venda e seu troco não são gravados pela metade. Uma revisão monotônica impede sobrescrever dados de outra aba; BroadcastChannel atualiza as telas. Formulários abertos antes de outra alteração precisam ser reabertos para conferir os saldos. Erros de persistência mantêm o formulário aberto e não indicam sucesso.

Armazenamento local **não é backup permanente**. Limpar os dados do site, perder o dispositivo, usar navegação anônima ou mudar de origem, porta ou perfil pode tornar os registros indisponíveis. A solicitação de armazenamento persistente pode ser recusada pelo navegador. Exporte cópias após os fechamentos. Arquivos exportados contêm dados financeiros e não são criptografados.

Não existe autenticação ou criptografia local nesta versão. Use um dispositivo/perfil com acesso restrito à equipe. O servidor não oferece APIs de leitura dos registros financeiros, que ficam no IndexedDB do perfil. Os dados não são enviados a serviços externos. O servidor serve apenas uma lista explícita de arquivos públicos, com CSP e sem acesso a `.git` ou `.env`. Não exponha este servidor à internet como solução de produção.

## Organização

- `src/server.js`: servidor local, assets permitidos e endpoint `/api/health`.
- `public/domain.js`: abertura, lançamentos, estornos, cálculos e fechamento; funções sem acesso à persistência ou interface.
- `public/storage.js`: IndexedDB e controle de revisão entre abas.
- `public/sync.js`: estado local e contrato para futura sincronização, sem transporte simulado.
- `public/app.js`, `index.html`, `styles.css`: interface, validações dos formulários e impressão.
- `public/sw.js`, `manifest.webmanifest`, `icon.svg`: cache offline e metadados PWA.
- `test/`: regras financeiras e servidor, usando o runner nativo do Node.
- `tests-browser/`, `playwright.config.js`: testes integrados com Chromium.
- `docs/plano.md`: próximos passos e limites da versão.

Os registros têm IDs de expediente/movimento, horário ISO, responsável, descrição, origem/destino, valores em centavos e status de envio. Horários são exibidos no fuso `America/Sao_Paulo`; datas são brasileiras. A identidade autodeclarada poderá ser substituída por usuário autenticado em uma integração futura, que também deverá validar as regras no servidor.

## Validar

```sh
npm run check
npm test
npm run test:browser
```

O teste de navegador inicia seu próprio servidor na porta 3100. Use Chromium instalado em `/usr/bin/chromium`, ou configure `CHROMIUM_PATH` para outro executável. Nenhum teste usa dados de produção ou serviços externos. Para o servidor local:

```sh
curl --fail http://127.0.0.1:3000/api/health
```

Ao alterar arquivos da interface, atualize a versão do cache em `public/sw.js`. Uma nova versão espera as abas antigas fecharem antes de assumir o controle; não apague o IndexedDB para atualizar a aplicação.

## Preparação para Vercel (sem publicação automática)

`vercel.json` prepara esta versão como site estático, com saída em `public`, sem comando de instalação ou build. A interface usa IndexedDB e não depende do servidor Node para executar. O endpoint local `/api/health` não faz parte da hospedagem estática. Cabeçalhos de segurança também estão declarados na configuração da Vercel.

Caso a publicação seja autorizada, confira o preset **Other**, diretório raiz do repositório e saída `public`; remova configurações antigas de funções ou comandos que substituam o arquivo. Publique somente depois de o código completo estar no repositório/artefato escolhido. Esta configuração não envia arquivos ao GitHub nem realiza deploy.

Para testar somente os arquivos estáticos, como na hospedagem, use `STATIC_PREVIEW=1 npm run test:browser` em Bash. O teste usa Python 3 para servir `public` temporariamente.

O endereço publicado e o endereço local têm armazenamentos separados. Publicar não migra dados do navegador, não adiciona autenticação, não configura sincronização e não cria backup remoto. Ainda é necessário definir controle de acesso antes de usar dados reais em produção.
