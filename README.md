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
OWNER_WHATSAPP=3298195165
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
OWNER_WHATSAPP_E164=553298195165
```

Sem WhatsApp Cloud API, o sistema abre automaticamente o WhatsApp/WhatsApp Web com a mensagem pronta para a barbearia. O envio 100% silencioso depende da API oficial do WhatsApp.

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

## Atualização desta versão

- Adicionada opção **Sem cadastro, só nome** no agendamento.
- Telefone deixou de ser obrigatório quando o cliente escolher agendar somente com o nome.
- Ao confirmar o agendamento, o sistema abre automaticamente o WhatsApp da barbearia com a mensagem do corte confirmada.
- WhatsApp padrão da barbearia configurado como `32 9819-5165` (`OWNER_WHATSAPP=3298195165`).


## Envio automático por Make/n8n/Zapier

Para facilitar sem mexer direto na API oficial do WhatsApp dentro do sistema, configure uma automação por webhook.

No Coolify, adicione:

```env
WHATSAPP_WEBHOOK_URL=https://seu-webhook-do-make-ou-n8n
WHATSAPP_WEBHOOK_SECRET=uma_senha_opcional
OWNER_WHATSAPP=3298195165
```

Quando o cliente confirmar o agendamento, o sistema envia um POST JSON para o webhook com este formato:

```json
{
  "event": "booking.confirmed",
  "source": "barbearia_suprema",
  "owner_whatsapp": "553298195165",
  "message": "✅ Novo agendamento confirmado...",
  "booking": {
    "ticket": "BS-123ABC",
    "name": "Cliente",
    "phone": "",
    "date_br": "20/05/2026",
    "start": "14:00",
    "end": "14:40",
    "service_label": "Corte",
    "price_reais": 35
  }
}
```

No Make/n8n, use o campo `message` como corpo da mensagem e envie para o número em `owner_whatsapp`. Se a automação ainda não estiver configurada, deixe `WHATSAPP_WEBHOOK_URL` vazio; o site continua abrindo o WhatsApp com a mensagem pronta.
