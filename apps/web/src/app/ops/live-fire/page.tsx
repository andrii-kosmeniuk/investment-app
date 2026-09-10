import type { Metadata } from "next";
import { StatusPill } from "@corgi/ui";
import { LiveFireConsole } from "../../../components/LiveFireConsole";
import { OperatorSignIn } from "../../../components/OperatorSignIn";
import { OpsShell } from "../../../components/OpsShell";
import { opsSignOutAction } from "../../../server/ops-actions";
import { readOperatorToken } from "../../../server/ops-session";

export const metadata: Metadata = { title: "Live fire · Operations" };

export default async function LiveFirePage() {
  const signedIn = (await readOperatorToken()) !== null;
  return (
    <OpsShell
      current="/ops/live-fire"
      account={
        signedIn ? (
          <form action={opsSignOutAction}>
            <button type="submit" className="text-link">
              Close operator session
            </button>
          </form>
        ) : null
      }
    >
      <header>
        <div>
          <h1>Live fire</h1>
          <p>Each button runs the same use-case the nightly jobs run. What you see afterwards on the customer&rsquo;s pages is the real system, not a script.</p>
        </div>
        <StatusPill tone={signedIn ? "positive" : "neutral"}>{signedIn ? "Operator session open" : "Operator token required"}</StatusPill>
      </header>
      {signedIn ? <LiveFireConsole /> : <OperatorSignIn />}
    </OpsShell>
  );
}
