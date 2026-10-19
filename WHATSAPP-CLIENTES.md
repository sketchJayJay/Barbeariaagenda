# Suprema v7 — confirmação da barbearia para o cliente

Fluxo desta versão: **cliente agenda no site → o servidor salva a reserva → a conta conectada da barbearia envia a confirmação para o WhatsApp informado pelo cliente**.

Não precisa de outro chip quando a conta conectada já é a da barbearia. O cliente não precisa abrir o WhatsApp nem tocar em Enviar. O envio só fica ativo após instalar/configurar um provedor e autorizar a conta. O ZIP sozinho não conecta o número.

## Conexão por QR Code

A opção QR usa Evolution API com Baileys. É uma integração não oficial: pode desconectar e existe risco de restrições ou bloqueio do número remetente. O barbeiro precisa estar ciente disso antes de autorizar. Se preferir a integração oficial da Meta, use a alternativa descrita abaixo. A autorização não precisa ser refeita a cada reserva, mas poderá ser necessária após uma desconexão.

### 1. Atualizar a agenda

Use os arquivos desta versão no projeto já existente. Mantenha a mesma `DATABASE_URL`, o mesmo PostgreSQL e as mesmas senhas. Porta interna da agenda: **3000**. O layout novo e os dados do banco existente são mantidos.

### 2. Instalar o serviço WhatsApp separado no Coolify

1. Crie um novo recurso **Docker Compose**, separado da agenda.
2. Cole o conteúdo de `instalacao/whatsapp.compose.yaml` nesse recurso.
3. Cadastre estas variáveis no novo recurso:

```env
EVOLUTION_PUBLIC_URL=https://SEU-ENDERECO-DO-WHATSAPP
EVOLUTION_API_KEY=UMA_CHAVE_SECRETA_LONGA
EVOLUTION_DB_PASSWORD=UMA_SENHA_HEXADECIMAL_LONGA
```

Gere valores diferentes para a chave e a senha. Em um terminal, `openssl rand -hex 32` gera um valor adequado; execute duas vezes. Cadastre os valores nas variáveis do Coolify, sem publicar as credenciais no GitHub.

4. Configure um domínio HTTPS no serviço `suprema-evolution`, apontando para a porta interna **8080**, e use esse endereço em `EVOLUTION_PUBLIC_URL`. O PostgreSQL e Redis desse recurso não precisam de domínio nem porta pública.
5. Faça o deploy desse recurso e confira seus três serviços. A composição traz volumes próprios para preservar a sessão, o banco e o Redis. Mantenha esses volumes nos próximos redeploys.

A composição foi preparada a partir da configuração do projeto Evolution API. Não foi executado um contêiner real da Evolution nesta entrega; a compatibilidade do serviço instalado e o pareamento precisam ser conferidos no seu servidor. Versão indicada na composição: `v2.3.7`; atualizações futuras devem ser testadas antes de trocar a imagem.

### 3. Ligar a agenda ao novo serviço

Nas variáveis do aplicativo da agenda, configure:

```env
OWNER_WHATSAPP=5532998195165
WHATSAPP_PROVIDER=evolution
EVOLUTION_API_URL=https://SEU-ENDERECO-DO-WHATSAPP
EVOLUTION_API_KEY=A_MESMA_CHAVE_SECRETA_DO_SERVICO
EVOLUTION_INSTANCE=suprema
```

Use o endereço da API, sem acrescentar `/manager`. Mantenha a `DATABASE_URL` da agenda como já estava. Faça o redeploy **da agenda**.

### 4. O barbeiro autoriza uma vez

1. O barbeiro acessa `/admin` com a senha do painel e abre **WhatsApp**.
2. Confere que o número da barbearia é **+55 32 99819-5165**.
3. Clica em **Gerar QR Code**.
4. No celular dessa conta, abre o WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** e lê o QR exibido em outra tela.
5. O painel deve mostrar **WhatsApp da barbearia conectado**, com o número correto.

Você pode preparar o servidor e deixar que o próprio barbeiro faça essa etapa. Você não precisa pedir a senha da conta dele nem receber códigos de acesso pelo chat. A conexão deve ser autorizada pelo titular da conta.

O sistema confere o número da conta conectada antes de enviar. Se for outro número, as confirmações ficam na fila e o painel informa a divergência. Não desconecta a outra conta automaticamente.

### 5. Conferir o envio real

Faça uma reserva de teste informando um WhatsApp ao qual você tenha acesso, diferente do número remetente. Confira:

- A reserva apareceu no painel.
- O destinatário do histórico é o número do **cliente**.
- O cliente recebeu a mensagem **da conta da barbearia**.

A mensagem inclui nome, serviço, data, hora, valor e ticket. O histórico mostra a aceitação pela integração; isso não comprova entrega ou leitura. Esta entrega não implementa recibos de entrega/leitura.

Se o cliente agendar só com o nome, não há número para enviar: a reserva é salva e fica com status **Sem telefone** no histórico. Se o WhatsApp desconectar, as novas confirmações aguardam na fila. Falhas no envio têm até quatro tentativas e podem ser reenviadas pelo painel. Se o provedor transmitir uma mensagem e a resposta se perder na rede, uma nova tentativa pode repetir a confirmação. Cancelar a reserva interrompe confirmações ainda pendentes.

## Alternativa: API oficial da Meta

Use a conta/remetente da própria barbearia, devidamente habilitada pela Meta. Se esse número já é usado no aplicativo WhatsApp Business, avalie com a Meta/provedor o fluxo de coexistência compatível. O cadastro e a autorização são feitos pelo titular; o projeto não migra nem remove a conta do aplicativo.

Variáveis da agenda:

```env
WHATSAPP_PROVIDER=cloud
WA_TOKEN=TOKEN_DA_CONTA
WA_PHONE_NUMBER_ID=ID_DO_REMETENTE_DA_BARBEARIA
WA_CUSTOMER_TEMPLATE_NAME=booking_confirmation
WA_TEMPLATE_LANG=pt_BR
WA_API_VERSION=v23.0
```

Crie e aprove um modelo com cinco variáveis posicionais, nesta ordem: nome, serviço, data, hora inicial, ticket. Exemplo de texto para cadastrar:

```text
Olá, {{1}}! Seu horário na Barbearia Suprema está confirmado.
Serviço: {{2}}
Data: {{3}}
Horário: {{4}}
Reserva: {{5}}
Se precisar alterar, responda a esta mensagem.
```

O nome `WA_TEMPLATE_NAME=booking_alert` usado no antigo aviso ao barbeiro não é reutilizado para confirmar ao cliente.

## Automação própria por webhook

Use `WHATSAPP_PROVIDER=webhook` e `WHATSAPP_CUSTOMER_WEBHOOK_URL`. A automação deve usar:

- `event`: `booking.customer_confirmation`.
- `recipient_whatsapp`: número do cliente que receberá a confirmação.
- `owner_whatsapp`: número da barbearia/remetente esperado.
- `message`: confirmação pronta para o cliente.
- `event_id`: identificador estável, para deduplicar tentativas.

A configuração antiga `WHATSAPP_WEBHOOK_URL` não é reutilizada nesta versão, evitando que a automação antiga envie a mensagem ao barbeiro por engano. O segredo opcional continua em `WHATSAPP_WEBHOOK_SECRET`; cabeçalhos de autenticação/assinatura e limite de quatro tentativas são mantidos. Uma resposta 2xx confirma aceitação pelo webhook, não entrega ao cliente.

## Limites da entrega

A integração foi testada com respostas simuladas e uma base isolada. Nenhum WhatsApp real foi conectado e nenhuma mensagem real foi enviada durante a preparação. Para funcionamento em produção, falta instalar o provedor, autorizar a conta e validar uma reserva real. Os registros antigos do WhatsApp são mantidos no histórico, mas não são reenviados como confirmações aos clientes.

Referências do provedor:
- https://github.com/evolution-foundation/evolution-api
- https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/instance.router.ts
- https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- https://faq.whatsapp.com/1217634902127718/
