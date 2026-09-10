import { triggerScenario } from "./client.js";

const eventId = process.argv[2];
if (!eventId) throw new Error("usage: replay-fill.ts <event-id>");
await triggerScenario("replay-fill", { eventId });
