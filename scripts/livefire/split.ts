import { triggerScenario } from "./client.js";

const [customerId, symbol, effectiveDate] = process.argv.slice(2);
if (!customerId || !symbol || !effectiveDate) {
  throw new Error("usage: split.ts <customer-id> <symbol> <effective-date>");
}
await triggerScenario("split", {
  customerId,
  symbol,
  effectiveDate,
  numerator: 2,
  denominator: 1,
});
