# Barbearia Suprema - Agendamentos (Coolify + PostgreSQL)

## Variáveis de ambiente (Coolify > Environment Variables)
- `DATABASE_URL` (obrigatório)  
  Ex: `postgres://usuario:senha@host:5432/postgres`

- `ADMIN_PASSWORD` (obrigatório)  
  Senha do dono para entrar em `/admin`

- `WHATSAPP_BARBERSHOP` (opcional)  
  Número da barbearia no formato com DDI+DDD+numero, só dígitos.  
  Ex: `55998195165`

- `BARBERSHOP_NAME` (opcional)  
  Ex: `Barbearia Suprema`

- `TIME_OPEN` (opcional) padrão `08:00`
- `TIME_CLOSE` (opcional) padrão `20:00`

## Rotas
- Site do cliente: `/`
- Admin: `/admin`

## Observação importante sobre WhatsApp
Enviar mensagem automática para o WhatsApp do cliente **sem clique** não é possível direto do navegador/servidor sem usar um provedor (Twilio, Z-API, etc).
Aqui foi feito o modo **1 clique**: no painel Admin você clica e abre o WhatsApp já com a mensagem pronta para o cliente.


## Ticket do cliente
Após confirmar o agendamento, o site mostra um **ticket** (com código) e já abre um link do WhatsApp com a mensagem pronta. O cliente só precisa tocar em **Enviar**.
