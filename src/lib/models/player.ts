import type { Card } from "./card";
import type { Deck } from "./deck";

export class Player {
  hand: Card[] = [];
  activePokemon: Card | null = null;
  bench: Card[] = [];
  prizeCards: Card[] = [];
  discardPile: Card[] = [];

  constructor(
    public name: string,
    public deck: Deck,
  ) {}

  drawToHand(count = 1): Card[] {
    const drawn = this.deck.draw(count);
    this.hand.push(...drawn);
    return drawn;
  }

  setupPrizes(count = 6): void {
    this.prizeCards = this.deck.draw(count);
  }

  get prizesRemaining(): number {
    return this.prizeCards.length;
  }
}
