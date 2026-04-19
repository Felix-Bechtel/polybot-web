// Quick-add keyword bundles for the alerts watchlist.
// Felix can toggle a category to add/remove its terms atomically.

export interface Category {
  id: string;
  label: string;
  terms: string[];
}

export const CATEGORIES: Category[] = [
  { id: "politics-us", label: "US politics",
    terms: ["trump", "biden", "harris", "congress", "supreme court", "fed", "recession"] },
  { id: "geopolitics", label: "Geopolitics",
    terms: ["ukraine", "russia", "china", "taiwan", "israel", "iran", "nato", "gaza"] },
  { id: "crypto", label: "Crypto",
    terms: ["bitcoin", "ethereum", "solana", "ETF"] },
  { id: "macro", label: "Macro",
    terms: ["CPI", "rate cut", "jobs report", "oil", "eggs"] },
  { id: "tech", label: "Tech",
    terms: ["openai", "nvidia", "AI chips", "apple", "tesla"] },
  { id: "sports", label: "Sports",
    terms: ["NBA", "NFL", "UEFA", "world cup"] },
];

export function mergeCategory(current: string[], cat: Category): string[] {
  const set = new Set(current.map((s) => s.toLowerCase()));
  for (const t of cat.terms) if (!set.has(t.toLowerCase())) current = [...current, t];
  // keep unique, preserve order
  return Array.from(new Set(current));
}

export function removeCategory(current: string[], cat: Category): string[] {
  const drop = new Set(cat.terms.map((s) => s.toLowerCase()));
  return current.filter((t) => !drop.has(t.toLowerCase()));
}
