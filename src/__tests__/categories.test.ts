import { describe, it, expect } from "vitest";
import { CATEGORIES, mergeCategory, removeCategory } from "../lib/categories";

describe("categories", () => {
  const politics = CATEGORIES.find((c) => c.id === "politics-us")!;

  it("adds all category terms without duplicating existing ones", () => {
    const base = ["bitcoin", "trump"];
    const next = mergeCategory(base, politics);
    expect(next).toContain("bitcoin");
    for (const t of politics.terms) expect(next).toContain(t);
    // no duplicates
    expect(new Set(next).size).toBe(next.length);
  });

  it("removes exactly the category terms, preserving others", () => {
    const base = ["bitcoin", ...politics.terms, "eggs"];
    const next = removeCategory(base, politics);
    expect(next).toEqual(["bitcoin", "eggs"]);
  });

  it("is idempotent: merge twice = merge once", () => {
    const once = mergeCategory([], politics);
    const twice = mergeCategory(once, politics);
    expect(twice).toEqual(once);
  });
});
