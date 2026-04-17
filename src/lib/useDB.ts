// React hook: subscribes to db changes and re-renders.
import { useEffect, useState } from "react";
import { db } from "./db";
import { DBState } from "./types";

export function useDB(): DBState {
  const [state, setState] = useState<DBState>(() => db.load());
  useEffect(() => db.subscribe((s) => setState(s)), []);
  return state;
}
