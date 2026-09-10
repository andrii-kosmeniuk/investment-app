import { triggerScenario } from "./client.js";

const [customerId, symbol, exDate, payDate, amountCents] = process.argv.slice(2);
if (!customerId || !symbol || !exDate || !payDate || !amountCents) {
  throw new Error(
    "usage: late-dividend.ts <customer-id> <symbol> <ex-date> <pay-date> <amount-cents>",
  );
}
await triggerScenario("late-dividend", {
  customerId,
  symbol,
  exDate,
  payDate,
  amountCents,
});
