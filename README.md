# Barbearia Suprema - Agendamentos (Coolify + PostgreSQL)

Este projeto roda **100% no Coolify**, usando um **PostgreSQL criado no próprio Coolify**.
Não usa Supabase.

## 1) Criar banco no Coolify
- New Resource -> Database -> PostgreSQL
- Copie a **Connection String** do banco (DATABASE_URL).

## 2) Criar app no Coolify (GitHub)
- Build Pack: **Dockerfile**
- Base Directory: vazio (ou `.`) se o Dockerfile estiver na raiz do repo
- Container Port: **3000**
- IMPORTANTE: não monte Persistent Storage em `/app` (isso quebra o node_modules).

## 3) Environment Variables (Runtime only)
Crie no app:
- `DATABASE_URL` = connection string do Postgres
- `ADMIN_PASSWORD` = senha do admin (ex: Barbearia@2026!)
- `PORT` = 3000 (opcional, mas recomendado)

Opcional (horários):
- `OPEN_TIME` (padrão 09:00)
- `CLOSE_TIME` (padrão 19:00)
- `BREAK_START` (padrão 12:00)
- `BREAK_END` (padrão 13:00)
- `SLOT_STEP_MIN` (padrão 10)
- `TZ_OFFSET` (padrão -03:00)

> Todas **Runtime only**. Não marque Buildtime.

## 4) Rotas
- `/` site de agendamento
- `/admin.html` painel admin
- `/api/health` teste de saúde (e conexão DB)
