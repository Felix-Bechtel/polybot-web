// React hook: subscribes to db changes and re-renders.
import { useEffect, useState } from "react";
import { db } from "./db";
export function useDB() {
    const [state, setState] = useState(() => db.load());
    useEffect(() => db.subscribe((s) => setState(s)), []);
    return state;
}
