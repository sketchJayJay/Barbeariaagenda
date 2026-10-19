# Barbearia Suprema — v6

Agenda online e painel do barbeiro, com novo visual responsivo em preto, tons quentes e dourado.

**Comece por [LEIA-PRIMEIRO.md](LEIA-PRIMEIRO.md)**: atualização no Coolify, porta 3000, conservação do banco existente e ativação do WhatsApp.

- Node.js + Express + PostgreSQL.
- Reservas em três etapas, disponibilidade atualizada e comprovante.
- Painel com agenda, caixa, clientes e avisos.
- WhatsApp por Cloud API oficial ou webhook, com fila persistente e tentativas.
- Sem credenciais, o WhatsApp abre uma mensagem que o cliente precisa enviar.

`npm ci` · `npm test` · `npm start`

Não publique `.env`, credenciais ou backups do banco no repositório.
