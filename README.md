# Evento360 — versão 0.1

Aplicação web para criação de eventos, inscrições e controle de vagas.
Projeto da disciplina de Engenharia de Software 3.

Frontend em React, Vite e Tailwind CSS; backend em Node.js, Express e
TypeScript; persistência em PostgreSQL com Prisma. A API controla as regras
de negócio e a autorização de organizadores e participantes.

## Funcionalidades

- Catálogo público, publicação e arquivamento de eventos.
- Login independente de organizador e participante; cadastro de participantes.
- Recuperação de senha com token de uso único e expiração.
- Inscrição com ou sem conta, controle transacional de vagas e prevenção de duplicidade.
- Lista de espera para eventos lotados, com promoção automática por ordem de chegada quando uma vaga é liberada.
- Comprovante por código, cancelamento por token e painel de inscrições do participante.
- Painel do organizador com inscritos, métricas e check-in.
- Confirmação por e-mail via Resend e webhook opcional para n8n.

## Requisitos

- Node.js 22.12 ou posterior compatível, com npm.
- Docker com Docker Compose e suporte a containers Linux.
- Git.

Os comandos abaixo usam PowerShell e partem da raiz do repositório.

## Preparação local

```powershell
git clone https://github.com/sth4rley/evento360.git
cd evento360
Copy-Item .env.example .env
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Se os arquivos `.env` já existirem, preserve a configuração existente.
O Compose lê `.env` da raiz, a API/Prisma leem `backend/.env` e o Vite lê
`frontend/.env`. Esses arquivos são ignorados pelo Git.

Antes de iniciar:

1. Substitua `POSTGRES_PASSWORD` e a senha das URLs `DATABASE_URL` e
   `TEST_DATABASE_URL` por uma senha local própria, mantendo os valores
   consistentes. Senhas com caracteres especiais precisam de codificação URL
   nas URLs de conexão. O banco de testes deve ser separado e terminar em `_test`.
2. Gere `AUTH_TOKEN_SECRET` com o comando abaixo e coloque o resultado em
   `backend/.env`. O placeholder do exemplo é recusado pela API.
3. Deixe as variáveis Resend/n8n vazias para testar sem envio de mensagens.

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Alterar a senha no `.env` não altera a senha de um banco já inicializado no
volume Docker. Para instalações existentes, mantenha a credencial válida ou
altere-a no PostgreSQL antes de atualizar a configuração.

### Banco e backend

```powershell
docker compose up -d postgres
cd backend
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

O seed é opcional e cria somente contas locais de demonstração. Para criar
novas migrations durante o desenvolvimento, use `npm run prisma:migrate`.

### Frontend

Em outro terminal, a partir da raiz:

```powershell
cd frontend
npm ci
npm run dev
```

| Serviço | Endereço local |
| --- | --- |
| Aplicação | http://localhost:5173 |
| Health da API | http://localhost:3000/api/public/health |
| PostgreSQL | `127.0.0.1:5434` |

`VITE_API_URL` configura o backend usado pelo frontend. Toda variável `VITE_*`
fica acessível no navegador: nunca coloque senhas ou chaves nesse arquivo.

### Contas de demonstração

| Perfil | Login | Senha |
| --- | --- | --- |
| Organizador | `admin` | `admin` |
| Participante | `teste` | `teste` |

Essas credenciais são públicas e servem apenas para desenvolvimento local.
O seed recusa produção e bancos remotos; ao executá-lo novamente, redefine
as senhas e revoga sessões dessas contas. Não leve contas de demonstração
nem dados locais para produção.

## Testes e build

Na pasta `backend`, configure `TEST_DATABASE_URL` em `.env` com um banco
local separado, como `evento360_test`, e execute:

```powershell
npm run test:prepare
npm test
npm run build
npm audit
```

`test:prepare` cria o banco de testes se necessário e aplica as migrations.
Os testes alteram dados nesse banco e nunca devem apontar para dados reais.

Na pasta `frontend`:

```powershell
npm test
npm run build
npm audit
```

O frontend compilado fica em `frontend/dist` e o backend em `backend/dist`.
Para executar o backend compilado, use `npm start` dentro de `backend`.

## Integrações opcionais

As integrações recebem dados somente depois que a inscrição é gravada.
Falhas de entrega não desfazem a inscrição. Cada envio tem timeout de cinco
segundos e bloqueia redirecionamentos; não há fila persistente de retentativas.

### E-mail com Resend

Configure somente no `backend/.env`:

```dotenv
RESEND_API_KEY=replace-with-your-resend-api-key
RESEND_FROM_EMAIL="Evento360 <no-reply@example.com>"
PUBLIC_APP_URL=http://localhost:5173
```

Use um domínio remetente verificado no Resend. O e-mail de inscrição inclui
código do comprovante e link seguro de cancelamento. A recuperação de senha
também depende dessa integração. Deixe ambas as variáveis `RESEND_*` vazias
para desativá-la; configurar apenas uma delas gera erro técnico de entrega.

### n8n e WAHA

Antes de iniciar o WAHA, configure na raiz `.env` uma senha própria para
`WAHA_DASHBOARD_PASSWORD`, o usuário `WAHA_DASHBOARD_USERNAME` e
`WAHA_API_KEY_SHA512` com o hash SHA-512 de uma chave de API aleatória.
Guarde a chave original fora do repositório; o cliente usa essa chave
original no header `X-Api-Key`, enquanto o Compose configura o hash no WAHA.

```powershell
docker compose up -d n8n waha
```

O editor n8n fica em http://localhost:5678 e o painel WAHA em
http://localhost:3001/dashboard/. Configure o proprietário do n8n no primeiro
acesso. Todos os serviços Docker são publicados apenas em loopback.
Sessões, workflows e banco ficam em volumes locais, fora do Git.

No `backend/.env`, configure:

```dotenv
N8N_REGISTRATION_WEBHOOK_URL=http://localhost:5678/webhook/evento360-registration
N8N_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
```

Crie e ative um workflow com Webhook POST e autenticação do header
`X-Evento360-Webhook-Secret`. Em produção, use HTTPS. Deixe as duas variáveis
vazias para desativar o webhook.

O payload possui `type`, `occurredAt`, `event` e `registration`. O `type` é
`registration.created` para inscrições confirmadas, `registration.waitlisted`
quando a pessoa entra na lista de espera (com `registration.waitlistPosition`)
e `registration.promoted` quando uma vaga liberada é repassada à fila. Filtre
pelo `type` no n8n para não enviar confirmação de vaga a quem só está na fila. Envia dados do evento, nome, e-mail, WhatsApp normalizado,
status, data e código da inscrição. `registration.id` e
`registration.confirmationCode` são o mesmo código público de oito dígitos;
o UUID interno, tokens de cancelamento, senhas e chaves não são enviados.

Do n8n para o WAHA, use POST `http://waha:3000/api/sendText` na rede Docker,
header `X-Api-Key` e JSON com `session`, `chatId` e `text`. O telefone em
`chatId` contém somente dígitos e termina em `@c.us` para conversa individual.

## Segurança e versionamento

Consulte [SECURITY.md](SECURITY.md) para controles e requisitos de implantação.
Esta versão usa tokens em `localStorage`, comprovantes por código público e
rate limiting em memória; esses limites precisam ser considerados antes de
uma implantação pública. O Compose é destinado ao desenvolvimento local.

Antes de cada commit, execute na raiz:

```powershell
node scripts/check-secrets.mjs
git diff --cached --check
git diff --cached --stat
```

O repositório inclui código, assets usados pela interface, testes, migrations,
lockfiles, exemplos de configuração e documentação essencial. `.env`, chaves,
logs, backups, dependências, builds e apresentações locais ficam fora do Git.
