import { Transaction } from "./types";

function csvField(v: string | undefined): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportTransactionsCSV(txns: Transaction[]): void {
  const header = "date,market_id,market_name,outcome,side,shares,price,fees,notional,realized_pnl,notes";
  const rows = txns.map((t) => [
    t.createdAt, csvField(t.marketId), csvField(t.marketName),
    t.outcome, t.side, t.shares, t.price, t.fees, t.notional, t.realizedPnl,
    csvField((t.notes ?? "").replace(/\n/g, " ")),
  ].join(","));
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `polybot_transactions_${Date.now()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
