# Barbearia Suprema — v8

Agenda online e painel responsivo em preto e dourado.

**[ATUALIZACAO-V8.md](ATUALIZACAO-V8.md)** explica como adicionar as seis fotos ilustrativas aos serviços na instalação existente.

**[LEIA-PRIMEIRO.md](LEIA-PRIMEIRO.md)** explica a atualização no Coolify e a conservação do banco existente. Porta da agenda: **3000**.

**[WHATSAPP-CLIENTES.md](WHATSAPP-CLIENTES.md)** explica o fluxo **WhatsApp da barbearia → confirmação ao cliente**, a autorização por QR Code e a alternativa com API oficial.

- Reservas, comprovante e agenda do celular.
- Fotos de referência dos serviços em cartões adaptados para celular.
- Agenda, financeiro, clientes e histórico de confirmações no painel.
- Fila persistente e verificação do número conectado na opção Evolution.
- As credenciais e a autorização real da conta ainda precisam ser configuradas.

`npm ci` · `npm test` · `npm start`

Mantenha a mesma `DATABASE_URL` e os volumes do PostgreSQL ao atualizar.
