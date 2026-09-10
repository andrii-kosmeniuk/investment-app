import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState, InlineAlert, PageHeading, Timeline } from "@corgi/ui";
import { VerificationLauncher } from "../../../components/VerificationLauncher";
import { ONBOARDING_STEP_HREF, ONBOARDING_STEP_LABEL } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const api = await requireApi();
  const result = await load(() => api.onboarding());
  if (result.error) {
    return <ErrorState title="We couldn't load your onboarding status" detail={`${result.error.message} Nothing has changed on your account.`} />;
  }
  const view = result.data!;
  const identity = view.identity;
  const allDone = view.steps.every((step) => step.status === "complete");

  return (
    <>
      <PageHeading eyebrow="Getting started" title="Five steps, in order.">
        <p>Each step is confirmed by the provider or by the ledger, never by a redirect.</p>
      </PageHeading>

      <Timeline
        orientation="vertical"
        steps={view.steps.map((step) => ({
          key: step.key,
          label: ONBOARDING_STEP_LABEL[step.key],
          state: step.status === "complete" ? "done" : step.status === "blocked" ? "failed" : step.status,
          detail:
            step.key === "identity" && step.status !== "complete" ? (
              <span className="onboarding-identity">
                {step.detail}
                {identity.canStart ? <VerificationLauncher status={identity.status} /> : null}
              </span>
            ) : step.status === "current" && step.key !== "identity" ? (
              <span>
                {step.detail} <Link href={ONBOARDING_STEP_HREF[step.key]}>{ONBOARDING_STEP_LABEL[step.key]} →</Link>
              </span>
            ) : (
              step.detail
            ),
        }))}
      />

      {identity.status === "declined" ? (
        <InlineAlert tone="negative" title="Verification declined">
          The provider could not verify your identity. Money cannot be added or invested. Contact support to review the decision.
        </InlineAlert>
      ) : null}

      {allDone ? (
        <InlineAlert tone="positive" title="You're set up">
          Your portfolio is live. <Link href="/portfolio">See it</Link>.
        </InlineAlert>
      ) : null}
    </>
  );
}
