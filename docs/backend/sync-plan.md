# Plano de integração: mesma aplicação e mesmo caixa

Este documento é um plano, não uma sincronização já implementada. `public/storage.js`, `domain.js`, `commerce.js`, formulários e service worker permanecem inalterados nesta etapa. A mudança solicitada para o uso “como caderno” está preparada no banco; ainda precisa de uma etapa de interface.

## Sequência de desenvolvimento sugerida

1. Aprovar/testar banco e Auth em homologação sem dados reais.
2. Acrescentar login administrativo sem signup público, identificação da unidade e dispositivo estável. Nenhuma chave administrativa no frontend.
3. Acrescentar uma camada de repositório/adaptação; manter regras e casos financeiros de JS como testes de conformidade. Não substituir toda a interface.
4. Evoluir IndexedDB por migração **aditiva**, sem apagar `state/ledger`. Guardar o legado e a exportação de segurança até a conferência.
5. Implementar outbox e cache por unidade. Alteração local, rascunho e comando da outbox devem persistir na mesma transação. Não reutilizar a atual revisão global como versão de servidor.
6. Integrar manifesto, aplicação idempotente, feed e reconciliação. Só então ligar o modo compartilhado e o fechamento confirmado pelo servidor.
7. Migrar dados locais sob procedimento revisado; testar computador e celular reais, expiração de sessão, perda de conexão, atualização do app e conflitos.

## Outbox local planejada

Campos mínimos: `operationId`, `unitId`, `deviceId`, `command`, `requestHash`, `clientCreatedAt`, `dependencies`, `state` (`pending/sending/confirmed/conflict/discarded`), `attempts`, `lastError`, `serverVersion`, `acknowledgedAt`.

- UUIDs de venda/caixa/recebimento devem nascer antes da gravação local e ser preservados. Não gerar outro ID só porque houve timeout.
- O JSON de um comando anunciado é imutável. Para corrigir intenção pendente, cancelar/reconciliar explicitamente e criar novo comando; não editar o payload mantendo o ID antigo.
- Rascunhos usam o mesmo UUID ao converter para venda; enquanto incompletos não geram fiado, entradas, faturamento ou quantidades de venda confirmada. Exibir uma fila própria de anotações por completar.
- Cliente, entregador, endereço e situação podem ser desconhecidos; não exigir preenchimento fictício. Na confirmação financeira são necessários apenas os fatos que sustentam os cálculos: produtos/quantidades/valores e distribuição coerente de pagamentos.
- `sale_update` é parcial para metadados: campos omitidos são preservados. `draft_save` substitui o documento inteiro sob `expectedVersion`: o cliente precisa carregar/mesclar sua cópia antes de enviar, sem sobrescrever revisão remota.
- Documento convertido exige fluxo de venda confirmada para correção financeira; não permitir apagar valores confirmados e transformar isso silenciosamente em rascunho.

## Envio

Uma rotina por dispositivo controla o envio e tentativas com espera progressiva. Publicar manifesto completo e monotônico antes dos comandos. Enviar dependências primeiro: abrir caixa antes de confirmar venda; confirmar venda antes de receber dívida. Receber confirmação do servidor antes de remover da outbox; queda de conexão após commit deve repetir o mesmo comando e receber a resposta salva.

`navigator.onLine` é apenas pista. Erro de rede não significa falta de permissão e não significa sucesso. Sessão expirada pausa envio, preserva dados e solicita nova autenticação. Não trocar automaticamente o ator de uma operação antiga por outro usuário sem uma política explícita de confirmação.

Pendências conhecidas não podem desaparecer dos manifestos. Operação com erro de negócio fica em conflito; não fazer retry infinito de versão obsoleta ou excesso de recebimento. Descarte só com confirmação, justificativa e conservação da anotação original; `lc_discard_pending` não apaga o corpo e não desfaz operação aplicada.

## Recebimento de mudanças

`lc_changes` retorna referências ordenadas por `unit_changes.version`. Avançar o cursor somente após aplicar a página localmente com sucesso, junto com o cursor, em transação IndexedDB. Buscar as entidades autorizadas pelas tabelas/RLS, incluindo revisões e estornos, e atualizar projeções sem perder comandos locais pendentes.

Não atualizar o cursor diretamente para o “maior timestamp visto” nem para a versão atual do servidor que não foi efetivamente baixada. Não enviar o JSON inteiro de `ledger` para sobrescrever o estado central. Realtime pode notificar que há novidades, mas não substitui pull com cursor/outbox e não foi configurado.

A revisão local existente protege abas da mesma origem. Ela não serve para decidir conflitos entre aparelhos. Uma venda terá `entity_version` do servidor; uma correção requer a versão esperada. Movimentos financeiros são fatos novos, não valores para somar duas vezes ao atualizar a tela.

## Conflitos

- Mesmo comando e hash: confirmação idempotente; não recontabilizar.
- Mesmo ID com outro conteúdo: parar e reconciliar, sem sobrescrever.
- Mesmo caixa/data com UUIDs locais diferentes: escolher o caixa central, revisar/apontar o mapeamento de pendências antes de recriar comandos; conservar os IDs/documentos de origem no histórico de migração/conflito. Não resetar nem apagar os dois expedientes locais.
- Recebimento excessivo ou saldo insuficiente: conservar a intenção, mostrar o estado atual e permitir correção confirmada. O servidor é autoridade para aceitação financeira.
- Alteração financeira de caixa fechado: conflito, não reabertura automática. Definir correção em novo expediente em etapa posterior.
- Metadados concorrentes: carregar versão atual, comparar campos e pedir escolha quando necessário; não usar “última escrita vence” para tudo.
- Dois aparelhos digitando a mesma venda de forma independente terão UUIDs diferentes. Idempotência de rede não deduplica semanticamente essas vendas; prever conferência humana, sem deduplicar por nome/valor iguais automaticamente.

## Fechamento e dispositivos

O modo compartilhado deve usar os estados `open/closing/closed` do servidor. Preparação/ack/commit só funcionam online. Mostrar fechamento solicitado/aguardando aparelho/confirmado como estados distintos; não usar a confirmação local antiga como definitiva.

A política inicial exige confirmação de **todos os dispositivos ativos** da rodada e nenhuma pendência conhecida do dia. Um manifesto novo invalida a confirmação anterior daquela geração. Se surgirem operações durante a preparação, abortar/reconciliar/preparar de novo. O servidor não conhece uma fila ainda não anunciada por aparelho desconectado; não prometa garantia impossível. Operação tardia após fechar deve ficar preservada em conflito, nunca desaparecer.

Aparelho perdido/inacessível bloqueia essa política conservadora. Um procedimento excepcional de desativação, tratamento de suas pendências e auditoria precisa ser definido e aprovado separadamente. Não excluir aparelho/ack ou ignorar pendências automaticamente por timeout.

## Segurança de integração

CSP atual (`connect-src 'self'`) precisará autorizar os destinos HTTPS/WSS estritamente necessários do projeto aprovado. Isso não foi feito. Escopar cache local por unidade/permissão e definir comportamento de logout/aparelho compartilhado sem perder outbox. Não migrar identidades por coincidência de texto. O nome autodeclarado antigo permanece histórico; o servidor determina o ator por Auth.
