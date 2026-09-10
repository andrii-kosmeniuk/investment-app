import { triggerScenario } from "./client.js";

const [customerId, symbol] = process.argv.slice(2);
if (!customerId || !symbol) {
  throw new Error("usage: tamper-file.ts <customer-id> <symbol>");
}
await triggerScenario("tamper-custodian-file", {
  customerId,
  symbol,
  unitsDeltaMicro: "1000",
});
