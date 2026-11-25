# Arquitetura — Buraco Aberto Online

## Estrutura de pastas

```
buraco-online/
├─ packages/
│  ├─ engine/            # Fase 1 ✅  regras em TypeScript puro + Vitest
│  └─ protocol/          # Fase 2     schemas zod compartilhados (cliente ⇄ servidor)
├─ apps/
│  ├─ server/            # Fase 2/5   Cloudflare Worker + Durable Object (sala) + D1 (ranking)
│  └─ web/               # Fase 3+    React + Vite + TS + Tailwind + Zustand + PWA
├─ docs/
├─ .github/workflows/    # ci.yml (lint+test), deploy-server.yml (wrangler deploy)
└─ pnpm-workspace.yaml
```

## Engine (`@buraco/engine`)

Módulo puro, sem rede/UI. Estado imutável: `applyAction(state, player, action)` clona o
estado e devolve `{ ok: true, state }` ou `{ ok: false, code, message }` (mensagens pt-BR em
`messages.ts`). O servidor é a autoridade; o cliente usa as mesmas funções só para pré-validar
(ex.: habilitar o botão "Baixar").

- `cards.ts` baralho, pontos por carta, RNG seguro (`crypto.getRandomValues`, sem viés), Fisher–Yates.
- `sequence.ts` `arrangements()` enumera todas as formas válidas de uma sequência (Ás baixo/alto,
  1 curinga, 2 natural, A…A de 14 cartas); canastras (suja/limpa/meia real/real).
- `game.ts` distribuição, turno (comprar → baixar → descartar), morto direto/indireto, batida,
  monte esgotado/reciclagem do morto, recusa da 1ª compra, timeout, partida (várias mãos).
- `scoring.ts` placar detalhado por time/mão.
- `view.ts` `viewFor(state, player)`: a única coisa que sai do servidor — nunca mãos alheias,
  ordem do monte ou conteúdo do morto.

### Decisões de regra (pontos ambíguos do enunciado)

| Tema                     | Decisão                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quem começa              | O jogador seguinte ao carteador na ordem dos assentos; carteador roda a cada mão.                                                                             |
| Real (A–A, 14)           | Dois Ases naturais, um em cada ponta (pos. 1 e 14). Meia real = A…K (13, Ás baixo).                                                                           |
| Curinga ambíguo          | `arrangements()` devolve todas as posições; ação aceita `wildPos` opcional para escolher; padrão: extensão para cima.                                         |
| 2 natural                | Na posição 2 do próprio naipe não é curinga; a sequência ainda aceita 1 curinga.                                                                              |
| Morto direto             | Mão zera ao baixar → pega morto na hora, segue jogando, termina com descarte.                                                                                 |
| Morto indireto           | Mão zera no descarte → mão vira o morto; joga com ele na próxima vez.                                                                                         |
| Bloqueio de batida       | Servidor e UI recusam jogada que zere a mão sem morto + canastra limpa. Também recusa deixar **1 carta** que só poderia sair batendo (evita jogador travado). |
| Morto reciclado          | Se o monte acaba e ainda há morto, ele vira monte. O time que não pegou o morto ainda toma −100.                                                              |
| Monte esgotado sem morto | Mão acaba ao fim da vez; ninguém recebe bônus de batida.                                                                                                      |
| Empate no placar final   | Se as duas duplas passam da meta com o mesmo total, joga-se mais uma mão.                                                                                     |
| Timeout                  | `applyTimeout`: compra do monte (se ainda não comprou) e descarta a carta comprada.                                                                           |

## Modelo de dados (D1 / SQLite) — Fase 5

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,            -- uuid
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL,       -- SHA-256 do token anônimo guardado no localStorage
  created_at INTEGER NOT NULL
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  num_players INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  hands_played INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  team INTEGER NOT NULL,
  score INTEGER NOT NULL,
  won INTEGER NOT NULL,           -- 1 para os dois parceiros da dupla vencedora
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_mp_player ON match_players(player_id);
CREATE INDEX idx_matches_finished ON matches(finished_at);
```

Ranking (geral/semana/mês) = agregação de `match_players ⨝ matches` filtrada por `finished_at`.
Gravado **só** pelo Durable Object ao fim da partida.

## Protocolo (zod, `packages/protocol`) — Fase 2

WebSocket por sala (`/rooms/:code/ws`). Todo envelope: `{ v: number, ... }`.

Cliente → servidor

- `hello {name, token}` · `lobby/config {config}` · `lobby/seat {seat}` · `lobby/start`
- `game {action}` onde `action` é exatamente o `Action` do engine
  (`DRAW_STOCK`, `TAKE_DISCARD`, `REJECT_DRAW`, `MELD`, `ADD_TO_MELD`, `DISCARD`)
- `chat {text}` · `react {emoji}` · `rtc/offer|answer|ice {to, payload}` · `ping`

Servidor → cliente

- `state {view: PlayerView}` (sempre só a visão do destinatário; `view.version` p/ resync)
- `lobby {players, seats, config, host}` · `error {code, message}`
- `chat`, `react`, `rtc/*`, `presence {playerId, connected}`, `turn_deadline {at}`

Anti-trapaça: rate limit por conexão, ações fora da vez rejeitadas pelo engine, mãos alheias
nunca serializadas. Estado persistido no storage do Durable Object a cada jogada.

## Plano de entrega

1. ✅ Engine de regras + testes
2. ✅ Servidor de salas (Durable Object) + protocolo + lobby
3. ✅ UI da mesa mobile + jogo completo
4. ✅ 3 e 4 jogadores (duplas), placar, fim de partida
5. ✅ Ranking (D1) + perfil
6. ✅ Voz WebRTC (mesh) + chat de texto + reações
7. ✅ PWA, wake lock, háptico, tema de assets (SVG por código; imagens do Gemini plugáveis)
8. ✅ CI/CD, deploy, README
