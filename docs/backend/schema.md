# Tabelas e relacionamentos

Todas as tabelas de aplicação ficam em `public` com RLS. Tipos e funções auxiliares ficam em `private`, com execução revogada para a API (exceto o predicado necessário às políticas). Não são criadas tabelas em `auth`: a produção usa Supabase Auth existente.

## Identidade e escopo

| Tabela | Campos principais / relação |
| --- | --- |
| `operating_units` | `id`, `name`, `timezone`, `change_version`. Unidade e sequência ordenada de mudanças. |
| `profiles` | `id → auth.users.id`, `display_name`. Identidade autenticada; nome não autentica. |
| `unit_memberships` | PK `(unit_id,user_id)`, `role`, `active`. Autorização explícita; nenhuma associação automática por signup. |
| `private.role_permissions` | Combinações autorizadas de papel/permissão. Somente migração/administrador SQL podem alterar. |
| `unit_settings` | PK `unit_id`, `benefit_price` inicialmente 10798, `entity_version`. |
| `devices` | UUID estável, unidade, usuário proprietário, nome, ativo, geração/hash do manifesto e horário visto pelo servidor. |

## Operação e financeiro

| Tabela | Campos principais / relação |
| --- | --- |
| `cash_days` | UUID original, unidade, `business_date`, saldos iniciais separados, referência 10000, autor, observações, `status`, `financial_version`, alerta de notas e rodada de fechamento. |
| `sale_drafts` | UUID da anotação, unidade, `origin_day_id` opcional, `document` JSONB até 64 KiB, `entity_version`, estado `draft/converted/canceled`, usuário e horários. Documento pode ser `{}`. |
| `sales` | UUID original, caixa de confirmação, cliente/endereço/observações opcionais, `posted`, cancelamento, `current_revision`, `entity_version`, autoria inicial e horários. |
| `sale_versions` | PK `(unit_id,sale_id,revision)`, movimento daquela versão, preço histórico do benefício, dinheiro líquido, entregue e troco, conta de origem, documento completo da versão, motivo/autor. Imutável. |
| `sale_items` | UUID novo quando inexistente no legado, versão da venda, ordem, produto, categoria, quantidade, total da linha, flag benefício. Imutável. |
| `payment_allocations` | UUID, versão, ordem, categoria, método e centavos. Inclui `creditSale` como condição a receber, não recebimento realizado. Imutável. |
| `delivery_fees` | UUID, versão, valor, meio e situação **inicial**. Quitação atual é calculada pelos recebimentos. Só para vendas com benefício. Imutável. |
| `deliveries` | UUID, venda, assignee opcional, textos de responsável, situação opcional e versão. Cliente/entregador desconhecidos não impedem confirmação financeira válida. |
| `delivery_assignees` | Cadastro opcional futuro; não é necessário inserir Wagner/Vinicius/Depósito para migrar ou registrar vendas. |
| `financial_movements` | UUID original, caixa, tipo, descrição/observações, ator, venda ou recebimento opcional, `reverses` e campos de venda avulsa antiga. Imutável. |
| `movement_entries` | UUID, movimento, ordem, `from_account`, `to_account`, centavos e natureza. Imutável; movimento digital pode ter zero partidas. |
| `debt_receipts` | UUID original, caixa do recebimento, venda/revisão opcionais, alvo gás/água/taxa, categoria, cliente fotografado, valor/meio, movimento original e inversão posterior. |
| `cash_closings` | UUID original, caixa único, rodada, saldos esperados/contados, diferenças geradas, fotografias física/comercial, versão financeira, observação e ator. Imutável. |

`sale_drafts.converted_sale_id` referencia a venda confirmada e deve ser igual ao UUID do próprio rascunho. A anotação original e os eventos ficam preservados. Corrigir rascunho convertido deve usar o fluxo de venda confirmada; não reescrever o rascunho para apagar uma operação financeira.

Os dados `legacy_user_label` e `client_created_at`, onde aplicáveis, preservam atribuição/tempo antigos sem fingir que o texto antigo corresponde a um login Auth. Documentos financeiros e eventos também aceitam a fotografia original para importação privilegiada futura.

## Sincronização e auditoria

| Tabela | Finalidade |
| --- | --- |
| `sync_operations` | PK `(unit_id,id)` do comando, dispositivo/ator, hash SHA-256 do JSONB canônico, pedido, resposta e versão do servidor. Repetição idêntica devolve a resposta salva. Imutável. |
| `device_pending_operations` | Operações anunciadas pelo dispositivo: corpo/hash, caixa opcional e estado `pending/applied/discarded`. Descarte exige justificativa e auditoria; omitir pendente no próximo manifesto é erro. |
| `unit_changes` | PK `(unit_id,version)`, tipo, operação e referências afetadas. Cursor incremental, sem depender do relógio do celular. Imutável. |
| `close_acknowledgments` | Participantes da rodada e a geração do manifesto confirmada por cada dispositivo. |
| `audit_events` | UUID, unidade, operação/dispositivo, ator autenticado, tipo/ID de entidade, motivo, antes/depois e horário do servidor. Imutável. |

## Relações e invariantes

- Uma unidade tem no máximo um caixa em estado `open/closing`; uma data tem um caixa, mesmo após fechar.
- Relações entre entidades da aplicação usam FKs compostas com `unit_id`, impedindo ligar dados de unidades diferentes.
- `sales.current_revision` tem FK diferida: a venda, a versão, suas linhas e o movimento nascem na mesma transação.
- Eventos/feed podem referenciar o comando inserido no fim da transação graças a FKs diferidas.
- Cada movimento admite uma única inversão; não se estorna um estorno.
- Itens e alocações fecham exatamente gás/água. Benefício corresponde aos P13 marcados e ao preço histórico, não ao preço atual.
- Taxas são faturamento de gás, não benefício adicional. Pendentes não são recebidas.
- `cash` e `fund` são contas físicas; `external` é contraparte. `cash+fund` não conta o fundo duas vezes.
- Saldo negativo é rejeitado. A contagem pode divergir, mas diferenças exigem observação; fechamento não lança ajuste sozinho.
- Recebimentos sem venda não inventam saldo original. Vinculados reduzem somente o alvo selecionado, nunca mais que o devido.
- Rascunho não entra nas tabelas financeiras, relatórios de faturamento ou recebíveis.
- Situação de entrega desconhecida em venda confirmada é considerada pendência, não conclusão presumida.

`private.commercial_report()` mantém os campos centrais de `report()` do JS e `private.cash_summary()` mantém `summary()`. A listagem de despesas deve ser obtida em `financial_movements/entries` via RLS; o relatório agregado não duplica essa lista em JSON. Não interpretar `creditSold` como saldo atual: `pending` é calculado pelos recebimentos ativos. Totais de filas e recebíveis recalculados são atuais; o fechamento armazena sua fotografia histórica.

Não há cadastro obrigatório de cliente, preço comum inventado, estoque, taxa de maquininha ou conciliação bancária nesta proposta.
