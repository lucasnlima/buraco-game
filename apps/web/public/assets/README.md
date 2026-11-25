# Assets

Gerados no Gemini e otimizados para WebP (cartas 240×336, avatares 128, selos 96, logo 720).

- `cards/` — `{J,Q,K}{S,H,D,C}.webp`, `JK1/JK2.webp` (os 4 coringas reutilizam 2 artes), `back*.webp`.
  **Não há arte para A, 2–10**: essas cartas são desenhadas em SVG no mesmo estilo (`CardView`).
  As artes de figuras não trazem índice no canto; o app sobrepõe um índice (valor + naipe) para
  funcionar com cartas sobrepostas. Se gerar A–10 (`AS.webp`, `10H.webp`…), basta incluí-los em `IMAGE_CARDS` em `src/theme.ts`.
- `avatars/01..13.webp` — escolhido pelo nome do jogador.
- `badges/` — canastra limpa/suja/real, batida, vitória, pegou o morto.
- `icons/`, `suits/` (+ `4-color/`) — SVGs.
- `table/portrait.webp`, `landscape.webp` — fundo da mesa.
- `brand/logo.webp`. Ícones do PWA em `public/icons/`.

Troque o verso em `theme.back` (`back`, `back-blue`, `back-wine`).
