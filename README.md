# Barbearia Suprema - Agendamentos (Coolify + PostgreSQL)

## Deploy no Coolify
Build Pack: **Dockerfile**

### Variáveis (Runtime)
- DATABASE_URL = Postgres URL (internal) do Coolify
- ADMIN_PASSWORD = sua senha do admin
- PORT = 3000

Opcional:
- OPEN_TIME = 09:00
- CLOSE_TIME = 19:00
- SLOT_STEP_MIN = 10

## Páginas
- / -> agendamento
- /admin.html -> painel admin
- /api/health -> healthcheck
