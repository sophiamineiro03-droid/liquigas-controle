# Escopo e evolução

## Entregue nesta primeira versão

Caixa diário local, fundo de referência de R$ 100,00 separado do caixa, vendas e troco atômicos, entradas/saídas, transferências internas, reposição, ajustes justificados, estornos rastreáveis, conferência, fechamento imutável na interface, histórico por data, impressão, exportação JSON e persistência offline em IndexedDB.

## Próxima evolução, sujeita à definição e autorização

- Autenticação e permissões reais. O responsável atual é um nome autodeclarado.
- Importação de cópias com validação integral e política explícita de mesclagem; exportação já disponível.
- Integração Supabase somente após autorização: autenticação, migrações, políticas de acesso, validação das regras no backend e proteção de credenciais.
- Sincronização real: cada comando terá UUID como chave idempotente, outbox persistida e confirmação do backend. Conflitos de abertura/fechamento não poderão ser mesclados silenciosamente; expedientes fechados devem rejeitar novos comandos. Estado pendente somente muda após confirmação do servidor.
- Reabertura e correções posteriores ao fechamento exigem política auditável; nesta versão são bloqueadas.
- Testes em dispositivos móveis reais e de instalação PWA, além dos testes responsivos de Chromium.
- Estratégia de backup permanente, restauração e recuperação de dispositivo antes do uso como único registro financeiro.

Não implementar estoque, clientes, pedidos ou emissão fiscal nesta fase. Não publicar a aplicação ou configurar serviços externos sem autorização.
