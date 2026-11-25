/** Textos em pt-BR centralizados (facilita tradução). */
export const ERROR_MESSAGES = {
  HAND_OVER: 'A mão já terminou.',
  NOT_YOUR_TURN: 'Não é a sua vez.',
  MUST_DRAW: 'Compre uma carta do monte ou pegue o lixo primeiro.',
  ALREADY_DREW: 'Você já comprou nesta vez.',
  STOCK_EMPTY: 'O monte acabou.',
  DISCARD_EMPTY: 'O lixo está vazio.',
  DISCARD_TAKEN_CARD: 'O lixo tinha só essa carta: ela não pode ser descartada nesta vez.',
  CARDS_NOT_IN_HAND: 'Essas cartas não estão na sua mão.',
  INVALID_MELD:
    'Isso não forma uma sequência válida (mínimo 3 cartas do mesmo naipe, em ordem, com no máximo 1 curinga).',
  INVALID_ADDITION: 'Essas cartas não podem ser adicionadas a esse jogo.',
  MELD_NOT_FOUND: 'Jogo não encontrado.',
  NOT_YOUR_MELD: 'Você só pode adicionar cartas aos jogos da sua dupla.',
  CANNOT_REFUSE: 'Você não pode recusar a carta agora.',
  NEED_DEAD: 'Você precisa pegar o morto antes de bater.',
  NEED_CLEAN_CANASTA: 'Você precisa de uma canastra limpa para bater.',
  NEED_CANASTA: 'Você precisa de uma canastra para bater.',
  GO_OUT_MODE_MELD: 'Nesta sala só é permitido bater baixando as cartas.',
  GO_OUT_MODE_DISCARD: 'Nesta sala só é permitido bater com o descarte.',
  BAD_ACTION: 'Ação inválida.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
