# Contrato transacional e compatibilidade financeira

As funções abaixo já existem nos arquivos SQL, mas não foram instaladas remotamente nem ligadas ao frontend.

## RPCs públicas (somente authenticated autorizado)

| Função | Contrato |
| --- | --- |
| `lc_register_device(p_unit,p_device,p_name)` | Registra UUID estável para o usuário atual; não permite apropriar dispositivo alheio nem criar participante durante rodada de fechamento. |
| `lc_publish_queue(p_unit,p_device,p_generation,p_operations)` | Publica manifesto completo das pendências. Geração monotônica; repetição idêntica da mesma geração é aceita. Não pode omitir pendente conhecido. |
| `lc_apply_operation(p_unit,p_device,p_operation,p_command)` | Gateway atômico, idempotente e autorizado para aplicar um comando. |
| `lc_discard_pending(p_unit,p_device,p_operation,p_reason)` | Admin cancela explicitamente uma pendência conhecida, preserva corpo e justificativa, invalida o manifesto anterior. Não descarta operação aplicada. |
| `lc_changes(p_unit,p_after,p_limit)` | Feed ordenado por unidade; retorna mudanças, cursor da última mudança efetivamente retornada e `hasMore`. |
| `lc_day_report(p_unit,p_day)` | Relatório físico/comercial calculado pelo servidor para caixa autorizado. |

Manifesto contém array de `{id: operationUUID, command: objeto}`. O comando tem o envelope:

```json
{
  "type": "sale_create",
  "dayId": "UUID-do-caixa",
  "data": {
    "id": "UUID-da-venda",
    "movementId": "UUID-do-movimento",
    "sale": {
      "customer": "",
      "items": [{"product":"p13","quantity":1,"total":12000,"benefit":false}],
      "payments": [{"category":"gas","method":"cash","amount":12000}],
      "delivery": {},
      "posted": false
    }
  }
}
```

Os textos UUID acima são marcadores documentais, não UUIDs executáveis. Todos os valores financeiros são números inteiros de centavos. Nomes/contas não informados não são inventados. Campos de identidade são fornecidos antes da gravação local; IDs filhos ausentes no legado podem receber UUID servidor, devolvido no documento persistido. Novos clientes deverão gerar também IDs estáveis para os filhos.

Resposta aplicada: `{operationId,unitId,serverVersion,result}`. Repetição de UUID/conteúdo/dispositivo/ator iguais devolve a resposta original, sem repetir movimento ou auditoria. Mesmo UUID com outro conteúdo/dispositivo/ator é conflito. Operação com erro reverte tudo; sua pendência conhecida permanece até aplicação válida ou descarte explícito. Não modificar o conteúdo sob um ID que já foi anunciado: descartar justificadamente e gerar outro ID.

## Tipos de comando e data

| `type` | `data` |
| --- | --- |
| `draft_save` | `id`, `document` objeto livre/incompleto; `expectedVersion` se já existe. `dayId` pode ser null, mesmo sem caixa aberto. Substitui o documento completo sob versão otimista, não faz merge financeiro. |
| `draft_cancel` | `id`, `expectedVersion`, `reason`; preserva documento/histórico. |
| `open_day` | `id` igual a `dayId`, `date`, `initialCash`, `initialFund`, `notes?`, `createdAt?`. |
| `movement` | `id`, tipo atual (`income/expense/sale/transfer/replenish/adjustment`), `amount`, `description`, `notes?`; conta, origem/destino, recebido ou direção conforme o tipo. |
| `movement_reverse` | `id` novo do estorno, `movementId` original, `reason`. Não aceita estornar movimento de venda/recebimento fora do fluxo correspondente. |
| `sale_create` | `id`, `sale` com campos compatíveis com `commerce.js`, `movementId?`, `deliveryId?`, `createdAt?`; `draftVersion` obrigatório se aquele UUID já é anotação. |
| `sale_correct` | `id` da venda, `expectedVersion`, `reason`, documento `sale` completo; `movementId?`, `reversalId?` novos. Usa preço histórico original e cria nova revisão. |
| `sale_cancel` | `id`, `expectedVersion`, `reason`, `reversalId?`. |
| `sale_update` | `id`, `expectedVersion`, `reason`; cliente, endereço parcial, observação, entrega parcial e RevGás opcionais. Campos omitidos são preservados. Não altera valores. |
| `receipt_create` | `id`, `amount`, `method`, `notes?`, `movementId?`, `createdAt?`; com venda: `saleId/target`; sem venda: `customer/category`. |
| `receipt_reverse` | `id` do recebimento, `expectedVersion`, `reason`, `reversalId?`. |
| `benefit_price` | `amount`, `expectedVersion` da configuração; `dayId` pode ser null. |
| `small_notes` | `needed` booleano e `reason`. Não muda saldos. |
| `close_prepare` | Objeto vazio; servidor cria rodada e lista de participantes. |
| `close_ack` | `roundId`, `manifestGeneration` atual do dispositivo. |
| `close_commit` | `id` estável do fechamento, `roundId`, `financialVersion`, `countedCash`, `countedFund`, `notes?`. |
| `close_abort` | `roundId`, `reason`; reabre somente preparação, nunca reabre caixa já fechado. |

`close_*` são comandos **online**, fora da outbox financeira, mas usam ID de operação e idempotência do mesmo gateway. Os demais devem ser anunciados no manifesto antes da aplicação. Novos registros financeiros exigem caixa aberto; atualização não financeira é permitida depois do fechamento com auditoria.

## Integridade

A unidade é travada antes do dispositivo e das entidades; as verificações de saldo/devido ocorrem dentro dessa transação. Mesmo duas chamadas simultâneas não podem consumir duas vezes o mesmo saldo ou dívida. Chaves únicas também protegem UUID da venda, operação, data de caixa, fechamento e estorno.

Restrições diferidas permitem inserir o agregado completo e validam no commit: versão, itens, alocações, benefício, partidas físicas e recebimentos. Triggers imutáveis bloqueiam reescrita de histórico. Toda falha reverte venda, partidas, versão, auditoria e confirmação de sincronização daquela operação.

Sem preço comum automático. As linhas usam total da quantidade, não preço unitário presumido. O benefício usa preço histórico por unidade. Transferências/reposição são movimentos internos; recebido digital/fiado/benefício não aumenta caixa; dinheiro entregue/troco são movimentos atômicos. Fiado e taxa pendente são obrigações calculadas, nunca dinheiro recebido.

Mantidas as restrições conservadoras atuais: corrigir/cancelar venda com recebimento ativo exige estornar recebimentos primeiro; estorno/correção financeira em caixa fechado não é permitido; estorno intermediário não pode deixar saldo negativo. Definir uma política posterior de correções em outro dia antes de ampliar esses fluxos.

Não confundir estorno contábil com reembolso bancário real. Não há integração com Pix, maquininha ou RevGás.

## Fechamento em duas fases

1. Publicar e aplicar as operações locais conhecidas, preservando eventuais conflitos.
2. Admin envia `close_prepare`. Qualquer pendência conhecida daquele dia bloqueia. O caixa passa a `closing` e novas gravações financeiras são recusadas.
3. Cada dispositivo ativo publica/reconcilia sua fila e envia `close_ack` para a rodada com sua geração atual. Um operador pode confirmar seu próprio dispositivo, mas não ganha poder de fechar.
4. Manifesto novo exige nova confirmação. Pendência anunciada durante a rodada bloqueia o fechamento; abortar a preparação, reconciliar e iniciar nova rodada quando necessário.
5. Admin envia `close_commit` com versão financeira e contagens. O servidor valida todos os participantes, diferenças/observações e versões e só então grava a fotografia e marca `closed`.

A preparação pode ser abortada com justificativa. Dispositivo offline/inacessível sem confirmação impede o fechamento definitivo nesta política inicial. O servidor não consegue provar que não existe informação ainda escondida em um aparelho desconectado; uma operação tardia não será apagada ou aplicada silenciosamente em caixa fechado. Deve permanecer conflito local até revisão.

## Erros de integração

Códigos SQLSTATE comuns: `28000` autenticação, `42501` permissão, `22023` entrada inválida, `23505` unicidade, `23514` restrição e `P0001` conflito de negócio. Mensagens `LC_*` distinguem caixa fechado, excesso de recebimento, saldo insuficiente, versão obsoleta, operação alterada e pendências. O frontend deve traduzir mensagens e manter a outbox, nunca considerar erro como sucesso.
