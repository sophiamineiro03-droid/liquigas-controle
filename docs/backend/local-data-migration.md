# Procedimento futuro de migração dos registros locais

**Não executado nem automatizado nesta etapa.** Não há importador público de JSON ou RPC capaz de substituir o banco inteiro. Nenhum dado real foi lido, exportado ou enviado ao Supabase.

## 1. Inventário e preservação

Identificar cada computador, celular, perfil de navegador e origem/porta com registros. O IndexedDB é isolado por origem e não é backup. Exportar o JSON completo de cada origem e guardar cópias verificadas fora do navegador, com acesso restrito, data, hash e identificação da fonte. Não limpar site, cache de dados ou dispositivos para “atualizar”.

Não assumir que o GitHub contém as vendas: ele contém código, não os registros do navegador. Não assumir que dois arquivos com o mesmo cliente/valor representam necessariamente duplicação.

## 2. Validação e homologação

Criar um importador separado, privilegiado e revisado em outra etapa. Primeiro usar exportações sintéticas. Validar schema, centavos inteiros, UUIDs, referências de caixa/venda/movimento, estornos, fechamentos, saldos e auditoria. A extensão `business` pode não existir nos primeiros dados; não inventar produtos/categorias para esses movimentos.

Duas cópias com o mesmo UUID e mesmo conteúdo são uma duplicação de arquivo, não um novo fato. Mesmo UUID com conteúdo divergente requer reconciliação explícita. Datas com caixas de UUID diferente em aparelhos diferentes conflitam com o caixa único compartilhado; devem ser reconciliadas sem descartar registros ou mudar referências silenciosamente.

## 3. Mapeamento

| Origem IndexedDB | Destino / cuidado |
| --- | --- |
| `days[].id/date/initialCash/initialFund/referenceFund` | `cash_days`, preservando UUID/data/centavos e referência. |
| `days[].user`, `movement.user`, `sale.user`, `receipt.user` | Texto em `legacy_user_label` e documentos/auditoria originais; nunca “converter” por nome em UUID Auth. Registrar separadamente o ator autenticado da importação. |
| `movements[].id/entries/reverses` | Movimentos e partidas com inversões preservadas. `commerceId` é resolvido pelo tipo e referências reais. |
| Venda avulsa `type: sale` | Manter `legacy_sale_amount/legacy_received` e partidas; sem categoria de produto fictícia. |
| `business.sales[]` | Venda corrente, versões recuperáveis dos eventos, itens, alocações, taxa e entrega. UUID da venda preservado. |
| Itens/parcelas/taxa/entrega sem UUID | Gerar mapeamento estável por lote/fonte/venda/revisão/ordem e persistir esse mapeamento; nunca gerar novamente a cada retry. |
| `receipts[]` | Recebimentos e movimento, `saleId` opcional, alvo, meios e reversões. Sem vínculo continua com saldo anterior desconhecido. |
| `closing` | Fechamento e fotografias históricas originais; não reconstruir retroativamente com os recebimentos de hoje. |
| `events[]` | UUIDs, tipo original, motivo, antes/depois e horário originais. Campos de procedência/JSON preservam informação que não existir normalizada. |
| `createdAt` | Tempo original em `client_created_at` ou documento histórico; o recebimento/importação no servidor tem seu próprio tempo. |

`syncStatus: pending` do legado não prova que cada registro é uma operação pronta para replay. A importação deve materializar fatos históricos e conferir vínculos, **não** reenviar cegamente todos os registros como novas vendas/recebimentos.

## 4. Ordem e restrições

A importação necessita de uma transação/procedimento privilegiado específico para históricos já fechados e revisões antigas, com validações equivalentes às RPCs. O contrato normal bloqueia inserir dinheiro depois de fechar e não deve ser enfraquecido para facilitar importação. Não desativar RLS/triggers indiscriminadamente, não editar UUIDs para contornar conflitos e não abrir caixas históricos artificialmente sem trilha aprovada.

Planejar lote de importação, origem, hash, estado, relatório de divergências e rollback **antes** de implementar o importador. As tabelas atuais fornecem destinos, mas o procedimento executável de importação ainda depende dessa aprovação e implementação. Arquivos de origem verificados devem permanecer disponíveis para comprovar campos/histórico não reconstruíveis.

## 5. Conferência e corte

Comparar, por caixa e categoria: saldos iniciais, dinheiro/fundo, recebimentos por meio, vendas, benefício, taxas, dívidas conhecidas, saídas, quantidades, cancelamentos/estornos e diferenças de fechamento. Distinguir pendência de reposição do fundo de diferença física. Testar retry do mesmo lote sem duplicação.

Durante o corte aprovado, pausar lançamentos por tempo combinado, exportar a última revisão de todos os aparelhos, reconciliar, importar em transação e confirmar os totais. Só habilitar o modo compartilhado depois de autorização e conferir computador/celular. Manter cópias locais/exportadas até a aprovação da conferência; não apagar automaticamente ao receber um primeiro ACK.

## Aprovações pendentes

Fonte de verdade quando arquivos divergem, tratamento de caixas duplicados, autoria histórica, política de correções de dias encerrados, lote/rollback, janela de corte e retenção dos backups. Nenhum desses pontos exige informar senhas ou tokens no chat.
