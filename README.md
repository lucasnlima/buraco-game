# Buraco Online

Buraco **Aberto** (regras brasileiras) no navegador — mobile first, 2 a 4 jogadores, entrada só com nome,
chat de voz (WebRTC), chat de texto, reações e ranking de vitórias. Deploy gratuito (Cloudflare + Vercel/Pages).

```
packages/engine    regras do jogo em TypeScript puro (71 testes)
packages/protocol  schemas zod / tipos do protocolo WebSocket
apps/server        Cloudflare Worker + Durable Object (sala) + D1 (ranking)   |  dev: servidor Node
apps/web           React + Vite + Tailwind + Zustand + PWA
docs/ARCHITECTURE.md  decisões de regra, modelo de dados, protocolo
```

## Rodar localmente

Requer Node ≥ 20 e pnpm ≥ 10.

```bash
pnpm install
pnpm --filter @buraco/server dev:node   # servidor de jogo em http://localhost:8787 (ranking em memória)
pnpm --filter @buraco/web dev           # app em http://localhost:5173 (proxy /api e /ws → 8787)
```

Abra em dois navegadores (ou no celular via IP da máquina; a voz exige HTTPS fora de `localhost`),
crie uma sala e entre com o código. Para testar o servidor "de verdade" (workerd + Durable Objects):
`pnpm --filter @buraco/server dev` (wrangler).

Testes:

```bash
pnpm test        # engine (71) + servidor (16)
pnpm lint && pnpm typecheck
pnpm --filter @buraco/web e2e   # Playwright em viewport 360×740: sala, jogo, baixar/arrastar, voz P2P, reconexão
```

## Deploy gratuito

### 1) Servidor (Cloudflare Workers + Durable Objects + D1)

```bash
cd apps/server
npx wrangler login
npx wrangler d1 create buraco                 # copie o database_id para wrangler.toml
npx wrangler d1 migrations apply buraco --remote
npx wrangler secret put TURN_KEY_ID           # opcional, ver abaixo
npx wrangler secret put TURN_KEY_API_TOKEN
npx wrangler deploy                           # anote a URL https://buraco-server.<conta>.workers.dev
```

- No plano gratuito os Durable Objects precisam ser SQLite (já configurado em `wrangler.toml`).
- Em produção troque `ALLOWED_ORIGIN` em `wrangler.toml` pelo domínio do front.
- **TURN (opcional, recomendado):** em _Cloudflare → Realtime → TURN_ crie uma chave e guarde o
  _Key ID_ e o _API Token_ como secrets acima. O servidor gera credenciais temporárias
  (`POST /api/turn`); a chave nunca vai para o cliente. Sem TURN a voz usa só STUN
  (`stun:stun.cloudflare.com:3478`) e pode falhar atrás de NAT simétrico.

### 2) Front-end (Vercel Hobby ou Cloudflare Pages)

- Root: raiz do repositório · build: `pnpm --filter @buraco/web build` · saída: `apps/web/dist`
  (o `apps/web/vercel.json` já traz isso).
- Variável de ambiente: `VITE_SERVER_URL=https://buraco-server.<conta>.workers.dev` (veja `apps/web/.env.example`).
- Por que o servidor não fica na Vercel: funções serverless derrubam WebSockets em poucos minutos. O Durable Object
  mantém a sala viva e coordena todos os jogadores num lugar só.

### 3) CI/CD (GitHub Actions)

- `ci.yml`: lint + typecheck + testes + build + E2E em todo PR.
- `deploy-server.yml`: na `main`, migra o D1 e roda `wrangler deploy`. Configure os secrets do repositório
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
- O front usa a integração Git da Vercel (preview por PR). Commits seguem Conventional Commits.

## Assets (cartas, mesa, logo)

Os assets do Gemini já estão integrados (`apps/web/public/assets`, otimizados para WebP, ~1,2 MB no total):
figuras e coringas, verso, avatares, selos, ícones, naipes (2 e 4 cores), mesa (retrato/paisagem) e logo.
O pacote **não trazia A e 2–10**: essas cartas são desenhadas em SVG no mesmo estilo e as figuras ganham um
índice sobreposto no canto (necessário com a mão sobreposta). Veja `apps/web/public/assets/README.md` e `apps/web/src/theme.ts`.

## Regras (resumo)

- 2 baralhos (104 cartas), 11 cartas por jogador, 1 morto de 11 por jogador (2–3) ou por dupla (4).
- Só **sequências** (≥3 cartas do mesmo naipe). O **2** é curinga (máx. 1 por sequência) ou carta natural na posição 2.
  Ás baixo (A-2-3) ou alto (Q-K-A), sem dar a volta.
- Vez: **comprar** (monte ou lixo inteiro, livre) → **baixar** (opcional) → **descartar**.
- Canastra = 7+ cartas: suja +100, limpa +200, meia real (A–K) +500, real (A–A) +1000.
- Morto direto (zera baixando) ou indireto (zera descartando). Bater exige morto + canastra limpa (+100).
- Cartas: 3–7 = 5, 8–K = 10, Ás = 15, 2 = 10, joker = 20. Sem morto: −100. Sobras na mão: negativas.
- Partida até 3.000 pontos (1.500 / 3.000 / 5.000). Todas as variações são configuráveis no lobby.

Detalhes e decisões de interpretação: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licença

MIT
