# Atualização 8 — referências visuais dos serviços

Os seis cartões de agendamento agora têm fotos ilustrativas próprias: corte, corte com sobrancelha, corte com barba, corte com pigmentação, barba e o combo completo.

## Aplicar no sistema que já está instalado

1. Atualize os arquivos no mesmo repositório da agenda usado no Coolify. Inclua a pasta `public/assets/servicos`, o arquivo `public/servicos.css`, `public/app.js`, `public/index.html`, `package.json`, `package-lock.json` e `server.js` deste pacote.
2. Faça o **Redeploy da aplicação da agenda** no Coolify, mantendo as variáveis existentes. A porta continua `3000`.
3. Confira a versão `8.0.0` em `/api/health` e recarregue a página de reservas.

Mantenha a mesma `DATABASE_URL`, as senhas e o volume do banco de dados. Mantenha também o serviço Evolution e suas variáveis: não é necessário instalar a conexão do WhatsApp novamente para aplicar esta atualização visual.

## Imagens

- Os exemplos foram gerados com a ferramenta integrada imagegen e estão identificados na página como fotos ilustrativas.
- Os arquivos são carregados do próprio projeto, sem depender de sites externos.
- Há versões WebP de 320 e 640 pixels, com carregamento progressivo das fotos fora da área visível.
- O arquivo `public/assets/servicos/REFERENCIAS.md` registra os prompts usados e a relação entre imagens e serviços.

As imagens ajudam a escolher o serviço; o cliente pode combinar o estilo e os detalhes do acabamento com o barbeiro.
