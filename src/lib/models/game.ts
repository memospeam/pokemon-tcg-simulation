import { GamePhase } from "./enums";
import type { Player } from "./player";

export class GameState {
  phase: GamePhase = GamePhase.Setup;
  turnNumber = 0;
  currentPlayerIndex = 0;
  winner: Player | null = null;
  log: string[] = [];

  constructor(
    public player1: Player,
    public player2: Player,
  ) {}

  get players(): [Player, Player] {
    return [this.player1, this.player2];
  }

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  get opponent(): Player {
    return this.players[1 - this.currentPlayerIndex];
  }

  logEvent(message: string): void {
    this.log.push(message);
  }

  checkWinCondition(): Player | null {
    for (const player of this.players) {
      if (player.prizesRemaining === 0) {
        return player;
      }
    }
    return null;
  }

  endTurn(): void {
    this.currentPlayerIndex = 1 - this.currentPlayerIndex;
    this.turnNumber += 1;
  }
}
