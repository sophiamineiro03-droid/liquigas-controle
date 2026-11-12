# Escopo da evolução operacional

## Implementado sobre a base existente

- Vendas de gás (P13/P08/P45) e água (galão 20 L/fardo 510 ml), múltiplos produtos, quantidades e pagamentos divididos por categoria.
- Gás do Povo como pagamento, preço padrão configurável de R$ 107,98/P13, benefício fora da gaveta e taxa de entrega paga/pendente separada.
- Entregas/retiradas com filtros, observações e confirmação manual de lançamento no RevGás.
- Recebimentos parciais vinculados e recebimentos antigos sem vínculo, sem inventar saldo anterior.
- Painel e fechamento financeiro por categoria e meio, sem duplicar taxas, dívidas ou transferências.
- Caixa e fundo fixo de R$ 100 preservados; indicador de falta de notas/moedas independente do saldo.
- Correções, cancelamentos e estornos com registros anteriores e posteriores; proteção de caixas fechados.
- Histórico legado, persistência IndexedDB, offline e exportação JSON preservados.

## Decisões confirmadas pela usuária

Caixa inicial exclui o fundo. Vendas mistas têm valor por produto e pagamentos explicitamente atribuídos a gás/água. Recebimentos antigos sem venda cadastrada registram somente o valor recebido, com saldo anterior desconhecido.

## Limites desta etapa

Não configurar Supabase, banco remoto, autenticação externa, sincronização ou integração automática com RevGás. Não há estoque, emissão fiscal, reembolso por operadora nem cadastro independente de clientes. O anexo recebido termina no meio da seção 11; requisitos posteriores não foram recebidos nem presumidos.

## Próximas evoluções

- Complementos do requisito da seção 11 em diante, quando fornecidos.
- Importação validada e recuperação de cópias; backup permanente.
- Autenticação, permissões e validação no servidor, somente após autorização de integração.
- Sincronização idempotente e tratamento explícito de conflitos, sem substituir UUIDs ou sobrescrever fechamentos.
- Política de correções em caixas fechados e de estornos com recebimentos de expedientes já encerrados.
- Testes em celulares físicos e de instalação PWA.

As integrações ficam para etapa futura. Um push em main aciona a Vercel já conectada; publicação deve respeitar a autorização aplicável.
