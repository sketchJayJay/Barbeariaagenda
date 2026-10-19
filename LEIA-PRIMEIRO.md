# Suprema — agenda renovada, versão 6

O sistema continua em Node.js + PostgreSQL, pronto para o Coolify, na **porta 3000**.

## 1. Atualizar o sistema existente

1. Faça um backup do PostgreSQL pelo painel que você já utiliza.
2. Substitua os arquivos do projeto pelos arquivos deste ZIP. Mantenha `package-lock.json`, `Dockerfile`, `server.js`, a pasta `lib` e a pasta `public`.
3. **Mantenha a mesma `DATABASE_URL`, o mesmo banco e seu armazenamento persistente.** O banco guarda clientes, agendamentos, financeiro, configuração do número e histórico dos avisos. O código não apaga as tabelas ao iniciar.
4. Mantenha `ADMIN_PASSWORD` e `FINANCE_PASSWORD` existentes. Se a senha financeira não estiver definida, ela usa a senha do administrador.
5. Use o Dockerfile fornecido e porta interna `3000`. Faça o redeploy da aplicação, sem recriar ou apagar o banco.
6. Abra `/api/health` para conferir o servidor, depois confira seus registros no painel.

O aplicativo não precisa de um volume de arquivos próprio para gravar a agenda: os dados ficam no PostgreSQL. O **serviço PostgreSQL precisa continuar com seu volume persistente**. Este ZIP contém o código, não os dados de produção.

## 2. WhatsApp: o que está pronto e o que precisa conectar

No painel `/admin`, abra **WhatsApp** e confirme o número completo do barbeiro. O arquivo antigo trazia `32 9819-5165`; ele foi mantido sem inventar um nono dígito. A tela permite corrigir o número sem editar o código.

Há dois comportamentos distintos:

- **Sem API/automação configurada:** a reserva é salva normalmente e o cliente recebe um botão que abre a mensagem no WhatsApp. **O cliente precisa tocar em Enviar.** Abrir a conversa não envia mensagem automaticamente.
- **Com API/automação configurada:** o servidor grava o aviso junto com a reserva e processa uma fila persistente. O cliente não precisa abrir o WhatsApp. Falhas temporárias geram até quatro tentativas; o histórico aparece no painel.

A integração foi implementada, mas **não está conectada a uma conta real neste ZIP**. É necessário preencher uma das opções abaixo no Coolify. Nenhuma mensagem real foi disparada durante os testes.

### Opção A — usar seu webhook do n8n/Make/provedor

No Coolify, configure:

```env
WHATSAPP_PROVIDER=webhook
WHATSAPP_WEBHOOK_URL=https://SEU-ENDERECO/SEU-WEBHOOK
WHATSAPP_WEBHOOK_SECRET=SEU_SEGREDO
```

A automação precisa receber o POST e enviar `message` ao número `owner_whatsapp`, usando um provedor de WhatsApp que você tenha conectado. **Um webhook vazio ou que só retorna 200 não entrega mensagem no celular.**

Exemplo do corpo enviado:

```json
{
  "event": "booking.confirmed",
  "event_id": "suprema-123",
  "source": "barbearia_suprema",
  "owner_whatsapp": "55DDDNUMERO",
  "message": "Mensagem pronta com cliente, serviço, data, horário, valor e ticket",
  "booking": {
    "ticket": "BS-ABC123",
    "name": "Cliente",
    "phone": "",
    "service_label": "Corte",
    "date": "2026-10-20",
    "date_br": "20/10/2026",
    "start": "14:00",
    "end": "14:40",
    "duration_min": 40,
    "price_reais": 35
  }
}
```

O webhook recebe também `Idempotency-Key` e, quando existe segredo, `X-Webhook-Secret` e `X-Suprema-Signature` (HMAC SHA-256 do corpo bruto). Configure sua automação para deduplicar por `event_id`: uma falha de rede depois do envio pode provocar repetição. Aceite o evento somente depois de processá-lo ou gravá-lo de forma durável. Responda com HTTP 2xx sem campo `error`/`ok:false` para aceitar; 429/5xx permitem nova tentativa. Timeout por tentativa: 10 segundos. Intervalos de nova tentativa: 15, 60 e 300 segundos.

### Opção B — WhatsApp Cloud API oficial da Meta

Você precisa de um remetente habilitado, token válido e modelo aprovado. O WhatsApp do barbeiro é o **destinatário**; não é o ID do número remetente.

```env
WHATSAPP_PROVIDER=cloud
WA_TOKEN=SEU_TOKEN
WA_PHONE_NUMBER_ID=ID_DO_REMETENTE
WA_TEMPLATE_NAME=booking_alert
WA_TEMPLATE_LANG=pt_BR
WA_API_VERSION=v23.0
```

O corpo do modelo deve ter **cinco variáveis posicionais, nesta ordem**:

1. Nome do cliente.
2. Serviço.
3. Data no formato dia/mês/ano.
4. Hora inicial.
5. Ticket da reserva.

Exemplo de conteúdo para cadastrar e submeter à aprovação na Meta:

```text
Novo agendamento na Barbearia Suprema.
Cliente: {{1}}
Serviço: {{2}}
Data: {{3}}
Horário: {{4}}
Reserva: {{5}}
```

A versão da API é configurável para manutenção futura. Referência oficial: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

### Conferir se funcionou

1. Salve o número em Painel > WhatsApp.
2. Configure um dos canais acima e faça o redeploy.
3. Faça uma reserva de teste em um horário livre, usando um nome identificável.
4. Abra Painel > WhatsApp. O aviso deve passar de “Na fila” para “Aceito pela integração”.
5. **Confira a mensagem no celular do barbeiro.** “Aceito” indica aceitação pelo provedor; o sistema não recebe confirmação de entrega/leitura do WhatsApp.
6. Cancele a reserva de teste para liberar o horário.

Uma reserva não é perdida quando o WhatsApp fica indisponível. O histórico mantém o erro e permite reenviar avisos com falha ou que foram gerados no modo manual. O modo automático envia **novas reservas confirmadas**; ele não é um robô de conversa e não envia lembretes, promoções ou avisos de cancelamento automaticamente.

## 3. Telas e regras mantidas

- `/`: reserva em três etapas, resumo, comprovante copiável, botão de WhatsApp e arquivo `.ics` para a agenda do celular.
- `/admin`: agenda por dia, busca, filtros de status, conclusão/cancelamento, financeiro, contatos com autorização e histórico do WhatsApp.
- `/finance`: acesso independente ao caixa, consulta diária/semanal/mensal, lançamentos com data própria e exclusão.
- `/admin/login` e `/finance/login`: mantêm as senhas de ambiente.
- Reservas online continuam liberadas **a partir de amanhã**, com referência no fuso de São Paulo.
- Os serviços e preços do arquivo original foram mantidos. O término do serviço deve caber no expediente, até `CLOSE_TIME`.
- Horários simultâneos são protegidos por transações e travas no banco. Repetir uma confirmação com a mesma chave não cria outra reserva.
- Concluir um atendimento lança a receita uma vez. Clicar de novo não recria uma receita que foi excluída do financeiro. Atendimentos concluídos ficam encerrados; correções de valor são feitas no caixa.
- A consulta “Meus horários” usa o WhatsApp informado. Reservas só com nome devem ser consultadas com a barbearia.

## 4. Instalar no celular

Use o endereço HTTPS do sistema. No Android, abra no Chrome e escolha “Adicionar à tela inicial” ou “Instalar aplicativo”. No iPhone, abra no Safari, toque em Compartilhar e em “Adicionar à Tela de Início”. A agenda usa dados atuais do servidor; para consultar e reservar, precisa de internet.

## 5. Desenvolvimento

Use Node.js 22 ou superior (Dockerfile: Node.js 24). Execute `npm ci`, configure as variáveis e execute `npm start`. A validação desta versão usou uma base de testes isolada, sem acessar o banco do cliente. `npm test` executa as verificações locais dos formatos e da seleção de canal do WhatsApp.

A revisão da entrega verificou migração de dados antigos, persistência após reinício, reservas e conflitos, autenticação, exclusão financeira, fila/reenvio de avisos e telas em 360, 390 e 768 pixels. O webhook foi testado localmente e a resposta da Cloud API foi simulada; o envio real precisa ser conferido após conectar a conta.
