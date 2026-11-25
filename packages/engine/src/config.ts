/** Variações de regra configuráveis na criação da sala. */
export interface Config {
  /** Incluir 4 coringas (jokers). Padrão: não (o 2 é o curinga). */
  jokers: boolean;
  /** Permitir trinca de Ases (3+ Ases, sem curinga). */
  acesTrinca: boolean;
  /** Curinga se reposiciona quando a carta natural é colocada. */
  wildReposition: boolean;
  /** Primeiro jogador da mão pode recusar a 1ª carta do monte. */
  firstDrawRefusal: boolean;
  /** Pontuação para vencer a partida. */
  targetScore: 1500 | 3000 | 5000;
  /** Aceitar canastra suja para bater. */
  dirtyCanastaToGoOut: boolean;
  /** Como é permitido bater. */
  goOut: 'both' | 'meld' | 'discard';
  /** Morto restante vira monte quando o monte acaba. */
  recycleDead: boolean;
  /** Timer de turno em segundos (0 = desligado). Aplicado pelo servidor. */
  turnTimer: 0 | 60 | 90;
}

export const DEFAULT_CONFIG: Config = {
  jokers: false,
  acesTrinca: false,
  wildReposition: true,
  firstDrawRefusal: true,
  targetScore: 3000,
  dirtyCanastaToGoOut: false,
  goOut: 'both',
  recycleDead: true,
  turnTimer: 0,
};

export const normalizeConfig = (partial: Partial<Config> = {}): Config => ({
  ...DEFAULT_CONFIG,
  ...partial,
});

/** 2 e 3 jogadores: cada um é um "time". 4 jogadores: duplas (0&2 × 1&3). */
export const teamCount = (numPlayers: number): number => (numPlayers === 4 ? 2 : numPlayers);
export const teamOf = (numPlayers: number, player: number): number =>
  numPlayers === 4 ? player % 2 : player;
export const playersOfTeam = (numPlayers: number, team: number): number[] =>
  numPlayers === 4 ? [team, team + 2] : [team];
