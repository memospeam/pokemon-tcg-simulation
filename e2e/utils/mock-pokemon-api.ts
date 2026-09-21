import type { Page } from "@playwright/test";

function parseQuery(q: string): { name: string; setCode?: string; number?: string } {
  const name = q.match(/name:"([^"]+)"/)?.[1] ?? q.match(/name:(\S+)/)?.[1] ?? "Mock Card";
  const setCode = q.match(/set\.ptcgoCode:(\S+)/)?.[1];
  const number = q.match(/number:(\S+)/)?.[1];
  return { name, setCode, number };
}

function mockCard(name: string, setCode?: string, number?: string) {
  const isEnergy = /energy/i.test(name);
  const id = `${(setCode ?? "mock").toLowerCase()}-${number ?? name.replace(/\s+/g, "-").toLowerCase()}`;
  return {
    id,
    name,
    supertype: isEnergy ? "Energy" : "Pokémon",
    subtypes: ["Basic"],
    hp: isEnergy ? undefined : "70",
    types: isEnergy ? [name.replace(/ energy/i, "")] : ["Psychic"],
    set: {
      id: (setCode ?? "mock").toLowerCase(),
      name: setCode ?? "Mock",
      ptcgoCode: setCode,
    },
    number: number ?? "1",
    images: { small: "", large: "" },
  };
}

/** Stub pokemontcg.io so Resolve / Quick Dragapult stay offline. */
export async function mockPokemonTcgApi(page: Page) {
  await page.route("**/api.pokemontcg.io/v2/cards**", async (route) => {
    const url = new URL(route.request().url());
    const { name, setCode, number } = parseQuery(url.searchParams.get("q") ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [mockCard(name, setCode, number)] }),
    });
  });
}
