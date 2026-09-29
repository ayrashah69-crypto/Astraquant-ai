export const usd = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export const price = (n: number) => (n < 10 ? n.toFixed(4) : n < 1000 ? n.toFixed(2) : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

export const pct = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const qty = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4).replace(/\.?0+$/, ""));

export const signClass = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-destructive" : "text-muted-foreground");

export const dt = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
