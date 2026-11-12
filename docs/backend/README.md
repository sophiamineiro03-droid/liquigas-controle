# PostgreSQL/Supabase — proposta implementada para revisão

Esta etapa cria somente arquivos SQL, testes locais e documentação. Não conecta o frontend, não substitui o IndexedDB, não cria credenciais e não executa SQL remoto. **Não aplicar no Supabase de produção antes da revisão.** O projeto segue funcionando no modo local já existente.

## Decisões

- Uma PWA responsiva para computador e celular, uma unidade operacional e um caixa compartilhado por data. O schema admite unidades isoladas por RLS, sem criar uma segunda unidade automaticamente.
- Inicialização sem usuário autorizado: acesso aos dados fechado por padrão. Somente o bootstrap privilegiado da administradora concede a primeira associação. Contas Auth sem associação não recebem acesso.
- Papéis futuros `operator` e `viewer` preparados; nenhum usuário extra é criado pelas migrações.
- Valores em centavos `bigint`, limitados a 999999999999 por valor/saldo. Quantidades inteiras; UUIDs fornecidos pelos dispositivos são preservados.
- O comportamento monetário de `public/domain.js` e `public/commerce.js` é a referência. Transferências não são receitas/despesas, pagamentos digitais/benefício/fiado não entram na gaveta e recebimentos não duplicam vendas.
- **Caderno:** `sale_drafts` aceita documento vazio/incompleto, editável e versionado, até sem caixa aberto. Não é fiado, faturamento ou recebimento. Confirmar usa o mesmo UUID e exige informação financeira coerente. Cliente e entregador continuam opcionais mesmo na confirmação. Regra confirmada pela usuária nesta etapa. O formulário atual ainda não usa esse recurso.
- Valores financeiros confirmados não podem ficar incompletos silenciosamente: corrigir/estornar preserva histórico e respeita caixa fechado e recebimentos associados. Metadados podem ser completados depois, com auditoria e controle de versão.
- Histórico financeiro append-only; correção cria nova versão e movimento inverso. Projeções atuais de vendas/recebimentos são atualizadas apenas pelas RPCs autorizadas.
- Todas as operações de uma unidade usam a mesma ordem de lock (`unidade → dispositivo → entidade`). Isso favorece correção e simplicidade para o pequeno volume inicial, em vez de paralelismo financeiro excessivo.
- Comandos offline são idempotentes. Um ID repetido com conteúdo diferente é conflito, não atualização.
- Fechamento definitivo exige servidor, fila conhecida resolvida e confirmação de todos os dispositivos ativos. Não há fechamento definitivo offline.

## Arquivos e ordem

| Migração | Conteúdo |
| --- | --- |
| `20261112000100_schema.sql` | Tipos, tabelas, UUIDs, FKs, restrições e índices. |
| `20261112000200_rules.sql` | Validação financeira, saldos, recebíveis, relatórios e imutabilidade. |
| `20261112000300_transactions.sql` | Comandos transacionais de caixa, caderno, vendas, recebimentos e fechamento. |
| `20261112000400_api_and_rls.sql` | RPCs públicas, manifesto, idempotência, feed, bootstrap e políticas RLS/ACL. |
| `20261112000500_integrity_guards.sql` | Triggers de consistência, partidas, versões e proteção adicional do histórico. |

Migrações são aplicadas uma vez e em ordem; depois de aplicadas, alterações devem criar uma nova migração, sem editar o histórico; não são scripts de reset ou de sobrescrita de um banco existente. Não usar o fixture de testes no Supabase.

- [Tabelas e relações](schema.md)
- [Segurança e primeira administradora](security.md)
- [Contrato das RPCs e comandos](transactions.md)
- [Integração e sincronização futura](sync-plan.md)
- [Migração futura dos dados locais](local-data-migration.md)
- [Resultados dos testes locais](test-results.md)

## Executar os testes com segurança

Requisitos: Linux/WSL2, Node.js 24 e Docker com acesso ao socket local `/var/run/docker.sock`.

```sh
node scripts/test-database.mjs
```

O runner ignora seletores de Docker remoto, usa imagem oficial PostgreSQL 17 fixada por digest, cria container com nome aleatório, `--network none`, sem portas publicadas e dados temporários em memória. Aplica o fixture Auth mínimo, todas as migrações e os testes. Ao terminar, remove somente o container que criou. Não lê `DATABASE_URL` nem aceita URL de banco remoto. A autenticação `trust` existe apenas dentro desse container descartável sem acesso de rede; não é configuração de produção.

Para validar somente as migrações: `node scripts/test-database.mjs --migrations-only`.

Os testes incluem paridade com funções JS existentes, RLS/ACL, idempotência, rollback, recebimentos e fechamentos concorrentes, rascunhos e fechamento com barreira de dispositivos. Os testes de concorrência usam sessões PostgreSQL distintas.

**Limite da evidência:** PostgreSQL real, com substitutos locais mínimos para `auth.users`, `auth.uid()` e `auth.jwt()` e papéis API. Não testa GoTrue, emissão/validação criptográfica de JWT, PostgREST, emails, painel ou Realtime reais do Supabase. Esses testes ficam para um ambiente de homologação autorizado, sem dados reais. Não existe medição de cobertura percentual nem afirmação de segurança absoluta.

Os testes antigos continuam disponíveis com `npm test`. Nenhuma regra do frontend foi modificada nesta etapa.

## Revisão antes da execução remota

Revisar papéis, política conservadora de fechamento (todos os dispositivos ativos), rascunhos fora do financeiro, política de correção após fechar, preservação de autoria antiga, procedimento de importação e configurações Auth. Aprovar um ambiente de homologação antes de executar estas migrações. O desenvolvimento de outbox/login no frontend e qualquer migração real são etapas separadas.
