# Resultado da validação local — 12/11/2026

- PostgreSQL real: **17.11 (Debian 17.11-1.pgdg12+2)**, container descartável sem rede e sem portas publicadas.
- Cinco migrações aplicadas, na ordem, em banco novo.
- **41 casos de integridade, segurança e concorrência aprovados; zero falhas.**
- Verificação adicional: permissões fechadas desde a primeira migração, simulando defaults amplos de hosted Supabase.
- `npm test`: **26 testes existentes aprovados**, zero falhas ou skips.
- `npm run check`, sintaxe dos scripts e `git diff --check`: aprovados.
- Frontend e IndexedDB não alterados; testes de navegador não foram repetidos nesta etapa de banco.

Comando reproduzível: `npm run test:db`. Código dos testes: `supabase/tests/integrity.mjs`; isolamento/limpeza: `scripts/test-database.mjs`.

## Verificações executadas

- acesso fechado desde a primeira migração
- bootstrap exige usuário confirmado e email esperado; API não pode chamar bootstrap
- RLS nega anônimo, conta sem autorização, outra unidade e associação inativa
- nem administradora pode gravar tabelas diretamente ou executar auxiliares privados
- papéis futuros: viewer só lê; operator não altera preço nem fecha caixa
- UUID de dispositivo não pode ser apropriado por outro usuário
- abertura separa caixa/fundo e impede duplicidade ou segundo caixa aberto
- idempotência: mesma operação retorna resposta idêntica sem repetir venda ou auditoria
- UUID da venda impede duplicação mesmo com outro ID de operação
- operação financeira sem manifesto é rejeitada; manifesto não pode sumir com pendências
- valores fracionários, negativos, excessivos e conta externa em transferência são rejeitados
- venda/troco: resultado SQL é igual às regras JS existentes
- transferência e reposição não são receitas/despesas; saldo negativo reverte a transação inteira
- Pix, cartões e fiado não criam dinheiro físico
- gás/água divididos e benefício/taxa correspondem ao relatório JS
- categoria, valor do benefício, quantidade e soma de parcelas inválidos não deixam venda parcial
- taxa pendente e recebimento parcial não repetem vendas
- recebimento acima da dívida é rejeitado e recebimento sem vínculo não inventa saldo
- duas sessões não podem receber mais que o saldo devido
- estorno único preserva movimento; movimento comercial só pode ser estornado pela operação correta
- correção mantém UUID, cria versão e inversão; versão antiga não pode ser adulterada
- correção/cancelamento exige resolver recebimentos ativos primeiro
- preço novo não altera a fotografia financeira antiga
- fechamento exige rodada, manifesto e confirmação de todos os dispositivos
- pendências conhecidas bloqueiam fechamento; não são apagadas silenciosamente
- novo manifesto invalida ack da rodada e fechamento exige justificativa de diferença
- duas sessões não finalizam o mesmo caixa duas vezes
- fechamento não pode ser adulterado; entrega/RevGás podem atualizar sem mudar valores
- recebimento no próximo caixa não modifica venda/fechamento anteriores
- anotação vazia e incompleta é editável sem abrir caixa nem presumir fiado
- confirmar rascunho preserva seu UUID e não exige cliente ou entregador
- feed incremental usa cursor de mudanças retornadas e respeita unidade
- JWT de sessão anônima não acessa dados mesmo com UUID de membro
- RLS cobre todas as tabelas públicas e auxiliares não têm execute acidental
- FK composta rejeita ligar venda de uma unidade ao caixa de outra
- duas retiradas concorrentes não gastam o mesmo saldo do fundo
- repetição simultânea do mesmo comando produz uma única venda
- restrições diferidas rejeitam parcela extra e movimento sem partida
- venda avulsa antiga preserva valores e não ganha categoria inventada
- completar só um dado depois não apaga observações, endereço ou RevGás
- pendência anunciada durante rodada bloqueia fechamento até reconciliar
- operador confirma seu manifesto na rodada sem ganhar permissão de fechar

## Limites

O Auth foi representado por fixture SQL mínimo, não por GoTrue/JWT criptográfico/PostgREST reais. RLS e ACL foram exercitadas no PostgreSQL com papéis e contextos de usuário distintos; concorrência usou sessões de banco distintas. Não houve execução no Supabase hospedado, credenciais reais, importação de registros reais ou configuração de Realtime. A homologação real precisa de aprovação posterior. Não há medição percentual de cobertura.
