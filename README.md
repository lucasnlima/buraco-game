# Buraco Online

Buraco **Aberto** (regras brasileiras) para jogar no navegador — mobile first, 2 a 4 jogadores,
entrada só com nome, ranking de vitórias e chat de voz. Deploy 100% gratuito (Cloudflare + Vercel/Pages).

> **Status:** Fase 1 concluída — engine de regras (`packages/engine`) com 71 testes.
> Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para estrutura, protocolo, modelo de dados e plano de fases.

## Rodar localmente

```bash
pnpm install
pnpm test         # testes do engine (Vitest)
pnpm typecheck
pnpm lint
```

Requer Node ≥ 20 e pnpm ≥ 10.

## Regras (resumo)

- 2 baralhos (104 cartas), 11 cartas por jogador, 1 morto de 11 por jogador (2–3 jogadores) ou por dupla (4).
- Só **sequências** (≥3 cartas do mesmo naipe). O **2** é curinga (máx. 1 por sequência); como natural, fica na posição 2.
  Ás baixo (A-2-3) ou alto (Q-K-A), sem dar a volta.
- Vez: **comprar** (monte ou lixo inteiro, livre) → **baixar** (opcional) → **descartar**.
- Canastra = 7+ cartas: suja +100, limpa +200, meia real (A–K) +500, real (A–A) +1000.
- Morto direto (zera baixando) ou indireto (zera descartando). Bater exige morto + canastra limpa (+100).
- Cartas: 3–7 = 5, 8–K = 10, Ás = 15, 2 = 10, joker = 20. Sem morto: −100. Sobras na mão: negativas.
- Partida até 3.000 pontos (configurável: 1.500 / 3.000 / 5.000).

Todas as variações são configuráveis (`packages/engine/src/config.ts`).

## Licença

MIT
