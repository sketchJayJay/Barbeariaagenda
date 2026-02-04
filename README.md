# Barbearia Suprema - Agendamentos (Coolify + PostgreSQL) - V5

## Variáveis de ambiente (Coolify > Environment Variables)
- DATABASE_URL = (connection string do Postgres do Coolify)
- ADMIN_PASSWORD = (senha da área do dono)  ex: 123456
- OWNER_WHATSAPP = 32998195165  (número do dono, sem +55; opcional)
- TZ = America/Sao_Paulo (opcional)

## Portas
- Porta do app: 3000

## Rotas
- Site: /
- Área do dono: /admin

## WhatsApp (importante)
Este sistema NÃO envia mensagem automaticamente pelo WhatsApp (isso exige API paga/oficial).
Ele gera o *ticket na tela* e oferece um botão "Abrir WhatsApp" com a mensagem pronta.
O cliente só precisa clicar e enviar.

## Banco (PostgreSQL)
As tabelas são criadas automaticamente ao iniciar o servidor:
- bookings
- finance

