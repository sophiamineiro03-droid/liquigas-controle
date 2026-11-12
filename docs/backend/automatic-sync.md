# Sincronização automática da aplicação

## Implementação

A aplicação usa Supabase Auth com senha e sessão persistente. Não há formulário de cadastro público. A única configuração publicada é URL do projeto e chave publicável; nenhuma chave administrativa é necessária no navegador. O SDK é fixado no lockfile e empacotado localmente por `npm run build:client`, inclusive para o cache offline, sem CDN. Vercel executa `npm ci` e esse build; `npm start` também prepara o bundle.

`storage.save()` grava projeção local e comandos na mesma transação IndexedDB. Uma falha em gerar a fila aborta o lançamento. `sync-commands.js` preserva UUIDs, versões esperadas, alvo de recebimento, troco, parcelas e vínculos de estorno. Comandos anunciados não são editados. A fila contém IDs próprios de operação e ator autenticado; não usa o nome autodeclarado como identidade Auth.

`sync-engine.js` publica manifesto monotônico, aplica RPCs `lc_*`, remove da fila só após resposta aceita, repete o mesmo ID após timeout, preserva conflitos e pausa operações dependentes. Usa Web Locks entre abas quando disponível e a revisão IndexedDB para rejeitar gravações desatualizadas. Sem Web Locks, uma disputa de manifesto é recusada pelo servidor; use uma aba para sincronizar nesse navegador.

O pull lê `lc_changes` e reconstrói a projeção pelas tabelas sob RLS, com paginação. Só avança o cursor junto com a fotografia local; verifica a versão da unidade antes de aceitar a leitura e não sobrescreve fila local. O intervalo é de 5 segundos, com backoff até 60 segundos em erros. Estar online não equivale a confirmação de envio.

Fechamento compartilhado é online: prepara rodada, confirma manifesto de cada aparelho e só grava fechamento definitivo após `close_commit`. IDs dos comandos de controle são persistidos para repetição após desconexão. Todos os aparelhos ativos devem abrir a aplicação com internet; aparelho inacessível continua bloqueando a política conservadora. É possível abortar a preparação com motivo, sem reabrir caixa fechado.

## Ativação e dados locais

1. Criar a única conta pelo Supabase Auth, confirmar o email e vincular à unidade pelo bootstrap privado revisado. Signup público e login anônimo devem estar desativados no painel hospedado; o TOML local não muda essas opções.
2. Entrar em **Minha conta e sincronização**. A conta precisa de associação ativa à única unidade.
3. Exportar os registros atuais antes da primeira importação.
4. No primeiro aparelho, conferir **Conferir e importar registros locais**. Esta versão aceita fatos simples de caixa aberto, vendas/recebimentos ativos e rascunhos pendentes, mantendo os UUIDs. Exige unidade sem caixas existentes. Caixas fechados, correções, estornos e preços históricos divergentes bloqueiam a importação automática para evitar reescrever histórico. Esses casos precisam de importação assistida separada.
5. No segundo aparelho, usar **Conectar sem importar registros antigos**. Os dados centrais são baixados. Uma cópia integral do ledger anterior fica em `localArchive`, incluída na exportação; não é apagada.

Durante a primeira importação, novos lançamentos são bloqueados até reconstruir a fotografia aceita pelo servidor. A importação usa novos comandos auditados no momento do envio; a cópia original conserva horários/autoria anteriores e registros não importados. Não se afirma que este fluxo substitui uma importação histórica completa.

Operações em conflito permanecem com seu corpo e erro. A reconciliação exige confirmação e motivo, descarta pendências conhecidas pelas RPCs e arquiva intenções e projeção no navegador antes de recarregar o servidor. Exportar antes de reconciliar. O descarte não é reembolso nem estorno. A cópia local permanece acessível no perfil de navegador após logout; o botão avisa isso. Outra conta não pode enviar a fila existente. Não há limpeza automática de dados locais.

## Limites

Esta implementação não muda as cinco migrações, não cria contas Auth por SQL, não desativa RLS nem libera escrita direta. A restrição de taxa versus Depósito continua validada no frontend e em cadastro/correção SQL; o reforço no `sale_update` SQL é pendência anterior à integração e precisa de nova migração revisada.

A homologação local usa as funções PostgreSQL reais e papéis simulados de Auth; não valida emissão criptográfica de JWT, entrega de emails ou sessão real da administradora. Só ativar para os registros reais depois de criar/vincular a conta e conferir o acesso hospedado nos dois aparelhos. Nenhuma senha é incluída no código ou na exportação do ledger.
