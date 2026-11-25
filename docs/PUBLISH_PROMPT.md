# Prompt — publicar o Buraco Online (sessão local, fora da nuvem)

Cole o bloco abaixo numa nova sessão do Claude Code aberta na pasta do repositório.

---

Você é um engenheiro DevOps. Publique o jogo **Buraco Online** deste repositório de forma **gratuita** na Cloudflare e valide que funciona de ponta a ponta. Trabalhe você mesmo, rodando os comandos; só me peça algo quando precisar de login/autorização no navegador ou de uma decisão minha. Antes de qualquer ação irreversível ou que publique algo, diga o que vai fazer.

## Contexto
- Monorepo pnpm. Branch de trabalho: `claude/buraco-aberto-online-ikn64i` (faça checkout dela; NÃO abra PR a menos que eu peça).
- `packages/engine` (regras), `packages/protocol` (zod), `apps/server` (Cloudflare Worker + Durable Object `RoomDO` + D1; `wrangler.toml` já configurado com Durable Objects SQLite e migração em `apps/server/migrations/0001_init.sql`), `apps/web` (React + Vite + PWA).
- Leia `README.md` (seção "Deploy gratuito") e `docs/ARCHITECTURE.md` antes de começar.
- Em `apps/server/wrangler.toml`: `database_id = "COLE_AQUI_O_ID_DO_D1"` é placeholder e `ALLOWED_ORIGIN = "*"` deve virar o domínio do front em produção.
- Existe um modo "Treinar contra o computador" (roda só no navegador). O deploy real habilita lobby online, voz (WebRTC), chat e ranking.

## Passos
1. **Pré-checagem local**: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Tudo deve passar. (Opcional: `pnpm --filter @buraco/web exec playwright install chromium` e `pnpm --filter @buraco/web e2e`.)
2. **Login na Cloudflare**: use `npx wrangler login` (abre o navegador) e confirme com `npx wrangler whoami`. Se o projeto/CLI preferido for o `cf`, ok, mas o repositório usa Wrangler.
3. **D1**: `cd apps/server && npx wrangler d1 create buraco`. Copie o `database_id` retornado para `wrangler.toml`. Aplique a migração: `npx wrangler d1 migrations apply buraco --remote`. Verifique as tabelas (`players`, `matches`, `match_players`).
4. **Deploy do servidor**: `npx wrangler deploy`. Anote a URL `https://buraco-server.<subdominio>.workers.dev`. Teste: `curl <URL>/api/health` deve responder `{"ok":true}`; e `POST <URL>/api/rooms` com `{"name":"Teste","token":"<32+ caracteres>"}` deve devolver um código de 5 letras.
5. **TURN (voz atrás de NAT)** — opcional, recomendado: no painel Cloudflare → Realtime → TURN, crie uma chave. Guarde com `npx wrangler secret put TURN_KEY_ID` e `npx wrangler secret put TURN_KEY_API_TOKEN` (valores que EU colo no terminal; nunca os escreva em arquivos ou commits). Depois teste `POST <URL>/api/turn` com `{name, token}` → deve incluir servidores TURN na resposta.
6. **Front-end no Cloudflare Pages** (mesma conta, um provedor só):
   - Build: `pnpm --filter @buraco/web build`, saída `apps/web/dist`, raiz do projeto = raiz do repo.
   - Variável de build: `VITE_SERVER_URL=<URL do Worker>` (sem barra final).
   - O Pages precisa de fallback de SPA: crie `apps/web/public/_redirects` com `/* /index.html 200` (e confirme que não quebra `/api` — o front chama o Worker por URL absoluta, então não há conflito).
   - Pode usar `npx wrangler pages deploy apps/web/dist --project-name buraco` (após o build com a variável definida) ou conectar o repositório GitHub no painel.
   - Alternativa aceita: Vercel (`apps/web/vercel.json` já existe).
7. **CORS/origem**: troque `ALLOWED_ORIGIN` em `wrangler.toml` para a URL do front (`https://buraco.pages.dev` ou domínio próprio) e rode `npx wrangler deploy` de novo. Confirme que o WebSocket (`wss://<Worker>/ws/<CODIGO>`) conecta a partir do front publicado.
8. **Validação ponta a ponta no front publicado** (use o navegador/Playwright apontando para a URL de produção):
   - Home carrega, o logo e as cartas aparecem; PWA instalável (manifest + service worker).
   - Criar sala → copiar código → segundo navegador entra → iniciar → comprar/descartar uma vez → recarregar a página e confirmar reconexão na mesma partida.
   - Nome repetido com outro dispositivo é recusado.
   - Voz entre dois dispositivos (se o TURN foi configurado, teste também em redes diferentes, ex.: Wi-Fi e 4G).
   - Ranking e perfil carregam (vazios no início); depois de uma partida terminada (dá para usar meta 1.500 e jogar até o fim, ou simular) aparece uma linha no ranking.
9. **CI/CD (opcional)**: no GitHub, adicione os secrets `CLOUDFLARE_API_TOKEN` (permissões: Workers Scripts:Edit, D1:Edit, Account Settings:Read) e `CLOUDFLARE_ACCOUNT_ID` para o workflow `.github/workflows/deploy-server.yml` (dispara em push na `main`). Se eu pedir, faça o merge para `main`.
10. **Entrega**: commite as mudanças de configuração (`wrangler.toml` com o `database_id`, `_redirects`, etc.) em mensagens Conventional Commits, faça push na branch de trabalho e me entregue um resumo com: URL do front, URL do Worker, o que foi validado e o que ficou pendente.

## Regras
- Nunca escreva tokens/segredos em arquivos, logs ou commits. Segredos só via `wrangler secret put` / variáveis do painel.
- Não force-push, não apague recursos existentes da minha conta sem perguntar.
- Se algo falhar, diagnostique a causa (logs: `npx wrangler tail`) antes de tentar de novo.
- Limites do plano gratuito: Durable Objects precisam ser SQLite (já configurado); avise se algum limite for relevante.
