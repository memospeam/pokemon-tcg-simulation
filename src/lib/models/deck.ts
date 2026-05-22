import type { Card } from "./card";

export class Deck {
  constructor(
    public name: string,
    public cards: Card[] = [],
  ) {}

  get size(): number {
    return this.cards.length;
  }

  add(card: Card): void {
    this.cards.push(card);
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(count = 1): Card[] {
    if (count > this.cards.length) {
      throw new Error(`Cannot draw ${count} cards from deck of ${this.cards.length}`);
    }
    const drawn = this.cards.slice(0, count);
    this.cards = this.cards.slice(count);
    return drawn;
  }

  isValidStandard(): boolean {
    return this.size === 60;
  }
}
