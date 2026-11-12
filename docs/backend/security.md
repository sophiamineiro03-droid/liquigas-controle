# Segurança e primeira administradora

## Não confundir cadastro Auth com autorização

As migrações não criam contas, senhas, emails reais, tokens nem associação automática a partir de signup. Um usuário Auth sem `unit_memberships` ativa não acessa dados. Não há RPC pública de bootstrap, criação de perfil, alteração de papel, autoassociação ou autoconcessão de permissões.

`supabase/config.toml` desativa signup (geral/email) e login anônimo **no ambiente local que utilizar essa configuração**. Esse arquivo e as migrações NÃO mudam automaticamente as configurações Auth de um projeto hospedado. Antes da execução remota autorizada é obrigatório desabilitar novos cadastros públicos e login anônimo no painel/configuração Auth do Supabase e revisar os provedores habilitados. Não criar um formulário público de cadastro no frontend.

A função de política também rejeita JWT com `is_anonymous: true`, mesmo se um UUID desse contexto fosse associado equivocadamente a uma unidade.

## RLS e privilégios

Todas as tabelas públicas criadas por estas migrações habilitam RLS. `anon` não tem SELECT, DML ou execução das RPCs. `authenticated` recebe SELECT sujeito a associação ativa e permissão `read`, mas **nenhuma escrita direta** nas tabelas, inclusive para a administradora. `profiles` permite ler somente o próprio perfil enquanto a associação estiver ativa e a sessão não for anônima nesta primeira versão; tela de gestão de equipe será outra etapa.

Gravações normais passam pelas RPCs `lc_*`, que verificam `auth.uid()`, associação/papel, propriedade do dispositivo, unidade, hash/idempotência, versões e regras financeiras. Não aceitam `user` do payload como identidade autenticada. Todos os identificadores relacionados têm escopo de unidade.

| Papel | Permissões iniciais |
| --- | --- |
| `admin` | Ler, movimentar caixa, registrar/corrigir vendas, recebimentos, entrega, configurações, preparar/confirmar/abortar fechamento e descartar pendência explicitamente. |
| `operator` | Ler, caixa, vendas, recebimentos, entregas e confirmar sua própria fila na rodada; não fecha definitivamente, não muda preço ou associações. |
| `viewer` | Leitura apenas; não registra dispositivo financeiro, não envia comandos. |

Não há usuários operator/viewer criados automaticamente. A primeira associação é exclusivamente da administradora.

As funções `SECURITY DEFINER` têm `search_path=''`, objetos qualificados e ACL explícita. Auxiliares em `private` não são executáveis pela API, exceto o predicado de RLS. Triggers diferidos também têm contexto de proprietário explicitamente definido, pois executam no commit depois de a RPC retornar. Não ampliar grants para contornar erros.

Movimentos, partidas, versões financeiras, itens, alocações, taxas, fechamentos, comandos aplicados, feed e auditoria não admitem UPDATE/DELETE normais de histórico. Correções criam novos fatos. O proprietário SQL continua sendo uma autoridade privilegiada capaz de alterar o schema/triggers; não se promete proteção contra comprometimento do próprio administrador do PostgreSQL.

Não colocar `service_role`, senha do banco ou credenciais administrativas no frontend. Uma futura chave publicável não substitui RLS. CSP do frontend ainda permite somente `connect-src 'self'`; não foi alterada nem conectada ao Supabase nesta etapa.

## Procedimento de bootstrap — somente após aprovação

1. Revisar migrações, testes e versão PostgreSQL do projeto de homologação. Não usar dados reais para o primeiro teste.
2. Desativar signup público e login anônimo nos ajustes Auth hospedados. Revisar configuração de email e recuperação de conta. O arquivo TOML sozinho não basta.
3. Aplicar migrações aprovadas na ordem com uma identidade SQL privilegiada, pelo processo de migração escolhido. Não executar os fixtures de teste.
4. Criar/convidar **apenas a administradora** pelo fluxo administrativo seguro do Supabase Auth. Confirmar a propriedade do email. Não inserir hashes/senhas manualmente em `auth.users` e não inferir identidade pelo nome/email de Git.
5. Conferir o UUID Auth e a confirmação do email por canal administrativo. Escolher e registrar um UUID estável para a unidade.
6. Em transação SQL privilegiada, chamar `private.bootstrap_admin(auth_user_uuid, unit_uuid, expected_email, display_name, unit_name)` com os valores revisados. Isso cria perfil, unidade, associação admin, configuração inicial e auditoria. O email precisa corresponder à conta confirmada e não anônima. Uma segunda inicialização é bloqueada.
7. Validar em homologação que admin lê os próprios dados, contas não associadas/anon não acessam nada e não há escrita direta. Testar também a autenticação HTTP real, pois o teste local simula somente o contexto JWT confiável entregue ao PostgreSQL.
8. Só depois planejar login/outbox do frontend. Nesta etapa a aplicação não usa Auth nem chama essas RPCs.

A função de bootstrap é `SECURITY INVOKER`, sem EXECUTE para API, sem segredo no código e sem mecanismo de “primeiro usuário que entrar vira admin”. Não executar agora; os parâmetros acima são descrição do contrato, não dados reais.

## Inclusão futura de usuários

A criação Auth deve continuar administrativa; adicionar perfil e associação por procedimento privilegiado revisado. Não permitir que o usuário edite seu próprio `role` ou `active`. Desativar a associação faz as políticas recusarem dados mesmo se ainda existir um JWT válido. A remoção física de identidades históricas não é o fluxo normal; preserve autoria e desative acesso.

## Revisões ainda necessárias

Homologação de GoTrue/JWT/PostgREST, fluxo de convite/recuperação, permissões de sessão offline e proteção do perfil de navegador em aparelho compartilhado. Não há tela de gestão de usuários nem política excepcional aprovada para ignorar aparelho inacessível no fechamento. Não aplicar UPDATE direto em dispositivos para contornar a barreira.
