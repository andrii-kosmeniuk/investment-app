const baseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const token = process.env.LIVE_FIRE_TOKEN;

export async function triggerScenario(
  scenario: string,
  payload: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  if (!token) throw new Error("LIVE_FIRE_TOKEN is required");
  const response = await fetch(`${baseUrl}/v1/live-fire/${scenario}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${scenario} failed with HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}
