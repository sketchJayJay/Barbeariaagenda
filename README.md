# Barbearia Suprema - Agenda + Admin + Financeiro

Versão corrigida para Coolify + PostgreSQL.

## Variáveis de ambiente no Coolify

Obrigatórias:

```env
DATABASE_URL=sua_url_do_postgres
ADMIN_PASSWORD=senha_do_admin
FINANCE_PASSWORD=senha_do_financeiro
PORT=3000
```

Recomendadas:

```env
OWNER_WHATSAPP=32998195165
TZ=America/Sao_Paulo
OPEN_TIME=08:00
CLOSE_TIME=20:20
SLOT_STEP_MIN=20
```

Opcional, somente se você tiver WhatsApp Cloud API oficial:

```env
WA_TOKEN=
WA_PHONE_NUMBER_ID=
WA_TEMPLATE_NAME=booking_alert
WA_TEMPLATE_LANG=pt_BR
OWNER_WHATSAPP_E164=5532998195165
```

Sem WhatsApp Cloud API, o sistema mostra o ticket e botão de WhatsApp com mensagem pronta.

## Rotas

- `/` - agenda do cliente
- `/admin/login` - painel do dono
- `/finance/login` - painel financeiro separado
- `/api/health` - teste de servidor/banco

## O que foi corrigido

- Corrigido erro de SQL na inicialização/migração do banco.
- Corrigido agendamento com `marketing_opt_in` e `birth_date`.
- Corrigido `ticket_code`, `price`, `price_cents`, `start_min` e `end_min` para evitar erro de coluna nula.
- Corrigido login e API do financeiro separado.
- Corrigido JavaScript quebrado do painel admin.
- Ao marcar agendamento como `Feito`, o sistema cria uma entrada no financeiro, sem duplicar.
- Mantém dados do Postgres no redeploy.
