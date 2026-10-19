# Suprema — fotos dos serviços, versão 8

O sistema continua em Node.js + PostgreSQL, pronto para o Coolify, na **porta 3000**.

Esta atualização acrescenta seis fotos ilustrativas aos cartões de serviço, com arquivos WebP locais em duas resoluções para computador e celular. As imagens são referências geradas, não um portfólio de atendimentos feitos pela barbearia. Os serviços, preços, durações, reservas e integração do WhatsApp permanecem os mesmos.

Se o serviço Evolution já está instalado, atualize somente a aplicação da agenda. Preserve as variáveis `WHATSAPP_PROVIDER`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE` já configuradas no Coolify. A autorização do número pelo QR Code continua sendo feita no painel da agenda.

## 1. Atualizar o sistema existente

1. Faça um backup do PostgreSQL pelo painel que você já utiliza.
2. Substitua os arquivos do projeto pelos arquivos deste ZIP. Mantenha `package-lock.json`, `Dockerfile`, `server.js`, a pasta `lib` e a pasta `public`.
3. **Mantenha a mesma `DATABASE_URL`, o mesmo banco e seu armazenamento persistente.** O banco guarda clientes, agendamentos, financeiro, configuração do número e histórico dos avisos. O código não apaga as tabelas ao iniciar.
4. Mantenha `ADMIN_PASSWORD` e `FINANCE_PASSWORD` existentes. Se a senha financeira não estiver definida, ela usa a senha do administrador.
5. Use o Dockerfile fornecido e porta interna `3000`. Faça o redeploy da aplicação, sem recriar ou apagar o banco.
6. Abra `/api/health` para conferir o servidor, depois confira seus registros no painel.

O aplicativo não precisa de um volume de arquivos próprio para gravar a agenda: os dados ficam no PostgreSQL. O **serviço PostgreSQL precisa continuar com seu volume persistente**. Este ZIP contém o código, não os dados de produção.

## 2. WhatsApp: confirmação da barbearia para o cliente

O fluxo foi ajustado: o cliente agenda e a conta conectada da **barbearia** envia a confirmação para o número informado pelo **cliente**. Ele não precisa abrir o WhatsApp nem tocar em Enviar.

Leia **[WHATSAPP-CLIENTES.md](WHATSAPP-CLIENTES.md)** para instalar/configurar a integração e deixar o próprio barbeiro autorizar a conta uma vez. O número da barbearia permanece **+55 32 99819-5165**.

Este ZIP prepara a integração; a conta real ainda precisa ser conectada e o envio precisa ser validado no celular. Sem conexão, a reserva continua sendo salva, mas não há envio automático. Sem telefone do cliente, não há destinatário para a confirmação.

## 3. Telas e regras mantidas

- `/`: reserva em três etapas, resumo, comprovante copiável, botão de WhatsApp e arquivo `.ics` para a agenda do celular.
- `/admin`: agenda por dia, busca, filtros de status, conclusão/cancelamento, financeiro, contatos com autorização e histórico de confirmações do WhatsApp.
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
