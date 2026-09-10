import { triggerScenario } from "./client.js";

const [symbol, tradeDate, price] = process.argv.slice(2);
if (!symbol || !tradeDate || !price) {
  throw new Error("usage: corrected-close.ts <symbol> <YYYY-MM-DD> <price>");
}
await triggerScenario("corrected-close", { symbol, tradeDate, price });
