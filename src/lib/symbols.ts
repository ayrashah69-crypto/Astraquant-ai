// Client-safe list of tradable symbols. Kept out of market.server.ts so that code which is
// reachable from the browser (e.g. zod schemas in trading.functions.ts) never has a top-level
// import of a server-only module that in turn pulls in the provider adapter.
export const SYMBOLS = ["BTC-USD", "ETH-USD", "AAPL", "MSFT", "NVDA", "TSLA", "EUR-USD", "GOLD"] as const;
