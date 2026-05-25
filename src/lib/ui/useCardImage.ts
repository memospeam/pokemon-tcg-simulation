import { useState, useEffect } from "react";
import type { CardDefinition } from "@/lib/models/definition";
import { cardImageSmall, cardImageLarge } from "./cardImageUrl";

/**
 * Module-level cache: card name (lowercase) → { small, large } URLs.
 * Persists for the lifetime of the page so each name is fetched at most once.
 */
const imageCache = new Map<string, { small: string; large: string }>();
const pendingFetches = new Set<string>();

async function fetchImagesByName(name: string): Promise<{ small: string; large: string }> {
  const q = `name:"${name.replace(/"/g, '\\"')}"`;
  const params = new URLSearchParams({ q, pageSize: "1", orderBy: "-set.releaseDate" });
  try {
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?${params}`);
    if (!res.ok) return { small: "", large: "" };
    const data = await res.json();
    const card = data.data?.[0];
    return {
      small: card?.images?.small ?? "",
      large: card?.images?.large ?? "",
    };
  } catch {
    return { small: "", large: "" };
  }
}

/**
 * Returns the best available small image URL for a card.
 * If cardImageSmall() can derive a URL from the apiId, that is returned
 * synchronously. Otherwise, fetches from pokemontcg.io by card name (lazy,
 * cached per name) and returns "" until the response arrives.
 */
export function useCardImage(def: CardDefinition): string {
  const immediate = cardImageSmall(def);
  const [fallback, setFallback] = useState<string>(() => {
    return imageCache.get(def.name.toLowerCase())?.small ?? "";
  });

  useEffect(() => {
    if (immediate) return; // already have a URL
    const key = def.name.toLowerCase();
    const cached = imageCache.get(key);
    if (cached !== undefined) {
      setFallback(cached.small);
      return;
    }
    if (pendingFetches.has(key)) return;
    pendingFetches.add(key);
    fetchImagesByName(def.name)
      .then((urls) => {
        imageCache.set(key, urls);
        setFallback(urls.small);
      })
      .finally(() => {
        pendingFetches.delete(key);
      });
  }, [immediate, def.name]);

  return immediate || fallback;
}

/**
 * Returns the best available large image URL for a card.
 * Falls back to the small URL if large is not available.
 */
export function useCardImageLarge(def: CardDefinition): string {
  const immediateSmall = cardImageSmall(def);
  const immediateLarge = cardImageLarge(def);
  const [fallback, setFallback] = useState<{ small: string; large: string }>(() => {
    return imageCache.get(def.name.toLowerCase()) ?? { small: "", large: "" };
  });

  useEffect(() => {
    if (immediateLarge || immediateSmall) return;
    const key = def.name.toLowerCase();
    const cached = imageCache.get(key);
    if (cached !== undefined) {
      setFallback(cached);
      return;
    }
    if (pendingFetches.has(key)) return;
    pendingFetches.add(key);
    fetchImagesByName(def.name)
      .then((urls) => {
        imageCache.set(key, urls);
        setFallback(urls);
      })
      .finally(() => {
        pendingFetches.delete(key);
      });
  }, [immediateLarge, immediateSmall, def.name]);

  return immediateLarge || fallback.large || fallback.small || immediateSmall;
}
