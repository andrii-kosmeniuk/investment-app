import { triggerScenario } from "./client.js";

const transferId = process.argv[2];
if (!transferId) throw new Error("usage: bounce.ts <transfer-id>");
await triggerScenario("bounce-deposit", { transferId, achReturnCode: "R01" });
