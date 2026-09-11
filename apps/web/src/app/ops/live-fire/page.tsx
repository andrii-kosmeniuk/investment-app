import type { Metadata } from "next";
import { StatusPill } from "@corgi/ui";
import { LiveFireConsole } from "../../../components/LiveFireConsole";
import { OpsPage, OpsSignedOut, opsContext } from "../../../server/ops-page";

export const metadata: Metadata = { title: "Live fire · Operations" };

export default async function LiveFirePage() {
  const context = await opsContext();
  if (!context) return <OpsSignedOut current="/ops/live-fire" title="Live fire" />;
  return (
    <OpsPage context={context} current="/ops/live-fire">
      <header>
        <div>
          <h1>Live fire</h1>
          <p>Each button runs the same use-case the nightly jobs run. What you see afterwards on the customer&rsquo;s pages is the real system, not a script.</p>
        </div>
        <StatusPill tone="positive">Operator session open</StatusPill>
      </header>
      <LiveFireConsole />
    </OpsPage>
  );
}
