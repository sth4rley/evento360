# Segurança

Não publique senhas, tokens, dados de participantes, exportações do n8n/WAHA ou
arquivos `.env` em issues, commits ou logs. Para relatar uma vulnerabilidade,
use o canal privado do responsável pelo repositório, sem dados reais.

## Antes de enviar ao Git

Execute na raiz `node scripts/check-secrets.mjs` e revise `git diff --cached`
antes do commit. O scanner examina arquivos rastreados e novos não ignorados,
sem imprimir credenciais. Ele cobre padrões conhecidos e valores dos `.env`
locais; não substitui revisão manual, não inspeciona histórico nem extrai
conteúdo comprimido de PDFs. Ative também a proteção de segredos na hospedagem
Git. Se uma chave já foi publicada, revogue-a; adicionar ao `.gitignore` não
remove uma chave do histórico.

## Configuração e execução

- Gere `AUTH_TOKEN_SECRET` aleatoriamente, com pelo menos 32 caracteres.
  Valores de exemplo são recusados. Nunca use variáveis `VITE_*` para secrets.
- Use `NODE_ENV=production`, `FRONTEND_URL` e `PUBLIC_APP_URL` com HTTPS na
  hospedagem. Configure `VITE_API_URL` com a URL HTTPS da API antes do build.
- O Compose é destinado ao desenvolvimento: portas de banco, n8n e WAHA
  ficam em loopback. Não publique esses painéis diretamente na Internet.
- O seed local contém contas de demonstração conhecidas. Ele recusa produção
  e bancos remotos. Não migre essas contas para produção; provisione contas
  reais com senhas próprias. Rodar o seed novamente revoga suas sessões.
- Os testes exigem `TEST_DATABASE_URL`, diferente de `DATABASE_URL`, para um
  banco cujo nome termine em `_test`. Nunca aponte testes a dados reais.
- Não registre cabeçalhos Authorization, corpos de login, URLs completas de
  recuperação/cancelamento ou variáveis de ambiente no proxy ou observabilidade.

## Controles implementados e limites

A API valida papéis e pertencimento dos eventos no servidor, usa consultas
parametrizadas, hashes scrypt e tokens assinados com expiração e revogação.
Recuperação de senha usa token aleatório armazenado como hash, de uso único.
As respostas da API não podem ser armazenadas em cache. Helmet aplica
cabeçalhos de segurança; o frontend inclui `no-referrer` e CSP no build.

Login, cadastro e recuperação compartilham limite de 20 tentativas por IP a
cada 15 minutos. Consultas/cancelamentos de inscrições têm limite de 30, e
novas inscrições de 20, no mesmo intervalo. A API admite 300 requisições por
IP por minuto. Os contadores são locais ao processo e reiniciam com ele:
implantações com várias instâncias precisam de limitação compartilhada no
gateway ou de um store externo. Não habilite `trust proxy=true`; configure
apenas os proxies efetivamente controlados quando definir a infraestrutura.

O código público de oito dígitos continua permitindo consultar nome e evento,
como exige o fluxo atual. Rate limiting reduz enumeração, mas não protege de
ataques distribuídos. Eventos sensíveis precisam de autenticação adicional
ou comprovante com identificador de maior entropia antes de divulgação pública.

Os tokens de sessão permanecem em `localStorage`, acessíveis a JavaScript.
A CSP reduz o risco de XSS, mas não equivale a cookies HttpOnly. A migração
para cookies requer projetar CSRF e os domínios da implantação.
No servidor do frontend, configure também `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e uma CSP em
cabeçalho com `frame-ancestors 'none'`; a diretiva não funciona em meta tags.
Habilite HSTS somente depois de configurar HTTPS corretamente.

As integrações só enviam dados depois do commit, bloqueiam redirecionamentos
e têm timeout. O webhook de produção deve usar HTTPS e autenticação por
`X-Evento360-Webhook-Secret`. As imagens Docker ainda usam tags móveis:
fixe versões/digests e faça auditoria das imagens antes de produção.

## Dependências

Use `npm ci` nos dois projetos e execute `npm audit` regularmente. O override
de `deepmerge-ts@8.0.0` em `@prisma/config` corrige
[GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
Remova o override quando o Prisma adotar uma versão corrigida e revalide
geração, migrations, build e testes. Os controles HTTP seguem as
[orientações de segurança do Express](https://expressjs.com/en/advanced/best-practice-security/).
