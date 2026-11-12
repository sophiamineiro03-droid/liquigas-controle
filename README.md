# Liquigás Controle

Controle auxiliar ao RevGás para a **Liquigás Castelense**, em Castelo do Piauí. A versão atual amplia o caixa e fundo de troco existentes com vendas de gás/água, entregas, recebimentos e relatórios locais. Não substitui o RevGás, não emite documentos fiscais e não controla estoque.

## Executar e testar

Requer Node.js 24 (validado com 24.22.1). Na raiz do checkout:

```sh
npm ci --cache /tmp/liquigas-npm-cache
npm run dev
```

Abra `http://127.0.0.1:3000` no navegador **da mesma máquina que executa o servidor**. Se o servidor está no ambiente da nuvem, esse endereço não abre no Windows do usuário. Para executar no Windows, baixe/clone os arquivos e execute `npm start` na pasta do projeto, com Node.js 24 instalado. Nenhuma dependência é necessária para a execução normal; Playwright é dependência apenas de testes.

`npm start` executa sem recarga automática; `PORT=3001 npm start` muda a porta em Bash. O servidor escuta somente em loopback. O layout móvel é testado em Chromium com viewport de 390 × 844; um celular real precisa de acesso HTTPS apropriado, não do loopback de outra máquina.

```sh
npm run check
npm test
npm run test:browser
```

O teste de navegador inicia seu próprio servidor na porta 3100. Usa Chromium em `/usr/bin/chromium`, ou outro executável definido em `CHROMIUM_PATH`. A hospedagem estática pode ser validada em Bash com `STATIC_PREVIEW=1 npm run test:browser` (usa Python 3 para servir temporariamente `public`). Não há compilação ou backend remoto.

## Rotina diária

1. **Abrir caixa**: informe data, caixa das vendas **fora do fundo**, fundo disponível, responsável e observações. A referência do fundo é R$ 100,00. Uma data só admite um caixa e não pode haver dois expedientes simultâneos.
2. **Nova venda**: selecione produtos (P13, P08, P45, galão 20 L ou fardo 510 ml), quantidades inteiras e o valor total de cada linha, não preço unitário. O total da venda e o pagamento são calculados automaticamente a partir dos produtos. Na venda comum, basta escolher a forma de pagamento; em uma venda mista com um único meio, cada categoria recebe exatamente o total dos seus produtos. Marque Dividir pagamento para informar parcelas e categorias manualmente. Os pagamentos, incluindo fiado, devem fechar exatamente cada categoria.
3. **Pagamento dividido**: marque Dividir pagamento e adicione parcelas com meio e valor; a categoria aparece quando houver gás e água. Valores já digitados não são sobrescritos ao alterar o total; a tela mostra o que falta ou excede. Não há rateio automático entre gás e água. O campo de dinheiro só aparece quando houver pagamento em espécie (vazio = valor exato). A origem do troco aparece somente quando há troco; ao trocar tudo para Pix/cartão, o campo de dinheiro é desconsiderado e limpo. Recebimento e troco são salvos juntos.
4. **Gás do Povo**: marque a opção dentro de Nova venda. Marque Gás do Povo; havendo um único P13 ele é marcado automaticamente. Com várias linhas de P13, indique quais usam o benefício; valor padrão de R$ 107,98 por unidade. O benefício é pagamento, não outro produto ou cadastro. Água e outros produtos podem ficar na mesma venda, com pagamentos normais discriminados. Para parte dos P13 pelo benefício e parte em dinheiro, use linhas separadas do produto. A taxa de entrega pode ficar paga ou pendente; selecione sua forma de pagamento e o entregador. No RevGás, o benefício é lançado como débito, destinado à conta de Seu Chicó, fora da gaveta.
5. **Entregas e retiradas**: filtre por responsável/situação e atualize entrega, observações e lançamento manual no RevGás. Pagamento e entrega são independentes. Quantidades vendidas, entregues/retiradas e pendentes são mostradas sem movimentar estoque. “Outro” exige nome e só então mostra esse campo. Escolher entregador ou depósito ajusta as opções de situação, sempre mantendo pendente até confirmação explícita da conclusão. Cancelar é uma ação explícita de cancelamento e estorno, não simples troca do status.
6. **Novo recebimento**: associe a venda quando disponível, selecione a categoria/taxa pendente e registre o valor pago. Pagamentos parciais reduzem a dívida sem criar venda nova; excesso de pagamento é bloqueado. Para recebimento antigo sem vínculo, informe cliente, categoria, valor e meio. Nesse caso **saldo anterior e restante são desconhecidos**, conforme decisão operacional, e nenhum saldo de dívida é inventado. Não cadastre a venda antiga só para registrar seu pagamento.
7. **Saídas do Caixa**: registre valor, motivo, observação opcional e responsável opcional. O sistema mantém as saídas em lista própria. Para corrigir, estorne com justificativa e registre corretamente. A seção financeira mostra saídas operacionais líquidas dos estornos; troco e transferências não são despesas.
8. **Fundo de troco**: Repor fundo transfere do caixa ao fundo; Transferir permite o caminho inverso. A conferência de notas/moedas tem alerta próprio, sem mudar valores. Trocar uma nota por notas menores do mesmo valor não muda saldo.
9. **Fechamento**: conte caixa e fundo separadamente. Diferenças por conta exigem observações. O fechamento conserva os valores esperados e o resumo financeiro naquele momento. Histórico permite consultar por data e imprimir/salvar PDF com resumo e movimentações.
10. **Exportar cópia dos dados**: gera JSON com caixa, vendas, recebimentos, eventos e fechamentos. Guarde fora do navegador em local seguro. Importação assistida ainda não implementada.

## Cálculos e decisões financeiras

- Todos os valores são **centavos inteiros**. Aceita `1200,50` ou `1200`, sem separadores de milhar, notação científica ou arredondamento de casas extras. Limite por valor/saldo: R$ 9.999.999.999,99. Quantidades são inteiros entre 1 e 99999.
- **Caixa e fundo são separados**. Total físico = caixa fora do fundo + fundo. Referência do fundo R$ 100,00; falta e excedente são comparações com essa referência, não prejuízos. Saldos iniciais são informados em cada abertura; não há transporte automático do dia anterior.
- Caixa esperado = inicial + entradas físicas − saídas físicas + transferências recebidas − transferências enviadas. Pix, débito, crédito, fiado e benefício não aumentam a gaveta. Venda de R$ 120 em espécie com recebimento de R$ 200 aumenta caixa em R$ 200 e reduz em R$ 80 a conta escolhida para o troco, sem duplicar a venda.
- Os totais de gás e água usam os valores por produto e a distribuição explícita dos pagamentos. Não há divisão proporcional implícita. Taxa de entrega do benefício pertence a gás e aparece discriminada; o total vendido a inclui uma única vez. Taxa pendente não entra no recebido até o recebimento correspondente.
- “Total recebido” dos relatórios inclui os meios financeiros, inclusive benefício na conta do proprietário; **não significa dinheiro físico**. Mostra vendas do dia e dívidas pagas no dia. A tabela de dívidas/taxas é discriminação dos valores já incluídos, não valor adicional a somar. Benefício aparece separado de débito; a interface também mostra o total equivalente para o lançamento no RevGás.
- “Fiado / pendente na venda” é o valor originalmente vendido a prazo, incluindo taxa pendente. “Recebíveis conhecidos em aberto” é o restante das vendas vinculadas de todos os dias, após pagamentos. Dívidas antigas sem venda original não entram nesse saldo conhecido. Recebimentos posteriores não alteram o faturamento original.
- O caixa físico inclui também entradas avulsas e ajustes; eles não recebem categoria gás/água automaticamente. Vendas avulsas da versão anterior permanecem no caixa, com aviso de que não têm produto/categoria. **Não são migradas ficticiamente nem recadastradas como venda nova.**
- Correções financeiras preservam o ID da venda, o lançamento anterior, seu estorno e o novo lançamento. O evento guarda antes/depois, motivo e responsável. Vendas com recebimentos ativos vinculados exigem estorno desses recebimentos antes de correção financeira/cancelamento. Saldo negativo em qualquer etapa é bloqueado.
- Caixa fechado bloqueia mudanças financeiras nos seus registros. Entrega, observações e situação RevGás podem ser atualizadas com trilha de auditoria sem alterar os valores do fechamento. Dívida de venda de caixa fechado pode ser recebida em outro caixa aberto; não reabre o anterior. O resumo financeiro gravado no fechamento permanece como retrato daquela conferência, mesmo se uma entrega for concluída depois.
- Estorno/cancelamento inverte os efeitos registrados; confirmar somente quando a operação financeira deve ser anulada/devolvida. Não é integração com operadoras e não executa reembolso real.

## Dados existentes, offline e segurança

O IndexedDB existente (`liquigas-controle`, versão 1) e os expedientes/movimentações são preservados. O campo `business` é uma extensão aditiva com vendas, recebimentos, preço padrão e eventos; dados antigos recebem valores iniciais em memória e a extensão é persistida na próxima gravação normal. Nenhum histórico anterior é apagado ou reinterpretado.

IndexedDB guarda os registros financeiros e o service worker guarda **só os arquivos da interface**. Após a primeira carga e a indicação de prontidão, é possível recarregar e lançar sem rede. PWA/service worker requerem contexto seguro (HTTPS ou localhost). A instalação como aplicativo depende do navegador; não foi validada em todos os celulares.

**Sem Supabase, banco remoto, autenticação externa ou sincronização.** Todos os registros seguem locais/pendentes; reconectar não finge envio. “Lançada no RevGás” é confirmação manual, não integração. Nome do responsável é autodeclarado, não login autenticado. O formulário reaproveita o último nome informado ou o nome de quem abriu o expediente, exibindo Registro por; ele pode ser corrigido em Atendente e RevGás. Observações/endereço também ficam em seção expansível, sem serem exigidos na venda comum. Use dispositivo/perfil restrito à equipe.

Cada operação persiste dados comerciais e movimentos financeiros em uma única transação IndexedDB. Revisão monotônica e BroadcastChannel protegem contra sobrescrita entre abas; formulários anteriores a outra alteração precisam ser reabertos. Erros de gravação não fecham o formulário nem indicam sucesso.

Armazenamento local não é backup permanente. Limpeza de dados do site, perda de dispositivo, navegação anônima ou troca de origem/porta/perfil podem tornar os registros indisponíveis. A solicitação de armazenamento persistente pode ser recusada. Exporte cópias após o fechamento. JSONs incluem dados financeiros e endereços, sem criptografia; proteja os arquivos. Não faça uso como única fonte de registro antes de definir recuperação/backup permanente.

## Organização técnica

- `src/server.js`: servidor local, lista explícita de assets públicos e `/api/health`.
- `public/domain.js`: caixa, transferências, ajustes, estornos e fechamento; ponte atômica para movimentos comerciais.
- `public/commerce.js`: vendas, pagamentos, Gás do Povo, recebimentos, entrega, RevGás, auditoria e relatórios por categoria.
- `public/app.js`: fluxo de caixa preservado, navegação, modais e fechamento integrado.
- `public/commerce-ui.js`: painel operacional, recebimentos e filtros.
- `public/sale-form.js`: formulário rápido de venda, pagamento automático, divisão opcional e campos condicionais.
- `public/storage.js`: IndexedDB, extensão aditiva e controle de revisão.
- `public/sync.js`: indicador de pendências locais, sem transporte remoto simulado.
- `public/index.html`, `styles.css`, `sw.js`, manifesto e ícone: interface responsiva e shell offline.
- `test/`: testes Node de regras financeiras/comerciais e servidor.
- `tests-browser/`: testes Playwright de fluxos, migração aditiva, offline, segurança de texto, falhas e concorrência.

Valores são exibidos em reais; horários no fuso `America/Sao_Paulo`. Para atualizar a interface, incremente a versão do cache em `public/sw.js`; a versão atual é `liquigas-shell-v5`. Feche abas antigas para ativar o novo shell. **Nunca limpe IndexedDB para atualizar a aplicação.**

## Vercel

`vercel.json` serve `public` como site estático, sem instalação/build e sem funções necessárias. O endpoint local `/api/health` não existe nessa hospedagem. CSP e cabeçalhos de segurança também estão configurados. O projeto já tem deploy automático conectado à branch `main`; um push nessa branch pode publicar imediatamente. Não envie mudanças para `main` sem considerar essa publicação.

Preset Other, raiz do repositório e saída `public`; configurações antigas que sobrescrevam o arquivo precisam ser revistas. A hospedagem não adiciona autenticação, backup ou sincronização. Endereços publicados e locais têm armazenamentos separados. Esta evolução não exige configurar nenhum serviço externo.

## Backend PostgreSQL preparado para revisão

A proposta de Supabase está em [docs/backend/README.md](docs/backend/README.md), com cinco migrações versionadas, RLS, funções transacionais, idempotência, fechamento coordenado e testes locais de banco. Inclui rascunhos editáveis como caderno: informações incompletas não são presumidas como fiado ou recebimento; a confirmação financeira é separada.

**O frontend continua local e sem Supabase.** Nenhum SQL remoto, login, credencial, importação real ou sincronização foi configurado nesta etapa. As anotações do formulário são persistidas apenas no IndexedDB; ainda não utilizam os rascunhos do banco nem sincronizam entre dispositivos.

Para testar somente um PostgreSQL descartável local, com Node 24 e Docker:

```sh
npm run test:db
```

O runner cria um container sem rede/portas, aplica fixtures Auth mínimos e migrações, executa testes de integridade/RLS/concorrência e remove o container. Não aceita endereço de banco remoto. Leia os limites do teste e o procedimento de primeira administradora antes de qualquer execução futura no Supabase.

### Anotações locais como caderno

Em **Nova venda**, use **Salvar anotação** mesmo sem preço, pagamento, cliente ou entregador. As anotações aparecem em **Vendas e anotações** para completar e editar, inclusive após reabrir o navegador e sem caixa aberto. Somente **Confirmar venda**, com produtos e pagamentos financeiramente válidos e caixa aberto, gera venda e movimentos. Pagamento a definir nunca vira fiado automaticamente. A confirmação preserva o UUID; alterações e arquivamentos preservam eventos locais. Vendas já confirmadas continuam usando correção financeira com histórico.

**Excluir:** anotações saem da lista de pendentes e ficam em um histórico recolhido. Excluir uma venda confirmada usa cancelamento com estorno, exige justificativa e mantém sua auditoria. Vendas excluídas ficam no histórico recolhido e saem da fila de entregas. Caixa fechado e recebimentos vinculados mantêm as restrições existentes.
