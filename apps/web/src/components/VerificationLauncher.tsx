"use client";

import { useState, useTransition } from "react";
import type { KycStatus } from "@corgi/contracts";
import { Button, InlineAlert } from "@corgi/ui";
import { startVerificationAction } from "../server/actions";

/**
 * Opens Persona's hosted flow in a new tab. The session token is fetched on
 * click, never rendered into the page, and the rail only advances when the
 * webhook lands — so this button says "start/continue", never "done".
 */
export function VerificationLauncher({ status }: { readonly status: KycStatus }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const launch = () =>
    start(async () => {
      setError(null);
      const result = await startVerificationAction();
      if (!result.ok || !result.data) {
        setError(
          result.code === "persona_not_configured"
            ? "Identity verification is not available in this environment yet."
            : result.error ?? "Verification could not be started.",
        );
        return;
      }
      window.open(result.data.url, "_blank", "noopener");
      setOpened(true);
    });

  return (
    <span className="verification-launcher">
      <Button variant={status === "not_started" ? "primary" : "secondary"} pending={pending} onClick={launch}>
        {status === "not_started" ? "Start verification" : "Continue verification"}
      </Button>
      {opened ? (
        <InlineAlert tone="info">
          Verification opened in a new tab. This page updates once the provider reports a result; refresh to check.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="negative">{error}</InlineAlert> : null}
    </span>
  );
}
