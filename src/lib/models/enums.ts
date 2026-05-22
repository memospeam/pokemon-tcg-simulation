export enum CardType {
  Pokemon = "pokemon",
  Trainer = "trainer",
  Energy = "energy",
}

export enum PokemonStage {
  Basic = "basic",
  Stage1 = "stage1",
  Stage2 = "stage2",
}

export enum TrainerSubtype {
  Item = "item",
  Supporter = "supporter",
  Stadium = "stadium",
  Tool = "tool",
}

export enum EnergyType {
  Colorless = "colorless",
  Grass = "grass",
  Fire = "fire",
  Water = "water",
  Lightning = "lightning",
  Psychic = "psychic",
  Fighting = "fighting",
  Darkness = "darkness",
  Metal = "metal",
  Dragon = "dragon",
  Fairy = "fairy",
}

export enum GamePhase {
  Setup = "setup",
  Mulligan = "mulligan",
  PlaceActive = "placeActive",
  PlaceBench = "placeBench",
  Active = "active",
  Finished = "finished",
}

export enum Zone {
  Deck = "deck",
  Hand = "hand",
  Active = "active",
  Bench = "bench",
  Prizes = "prizes",
  Discard = "discard",
  LostZone = "lostZone",
  Stadium = "stadium",
}

export enum PlayerId {
  P1 = "p1",
  P2 = "p2",
}

export type Supertype = "Pokémon" | "Trainer" | "Energy";
