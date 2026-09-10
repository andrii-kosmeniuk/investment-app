"use client";

import { useCallback, useState, useTransition } from "react";
import { Button, InlineAlert } from "@corgi/ui";
import { createLinkTokenAction, linkBankAction } from "../server/actions";

interface PlaidAccount {
  readonly id: string;
  readonly mask?: string | null;
}

interface PlaidMetadata {
  readonly institution?: { readonly name?: string | null } | null;
  readonly accounts?: readonly PlaidAccount[];
}

interface PlaidHandler {
  open(): void;
}

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess(publicToken: string, metadata: PlaidMetadata): void;
        onExit(error: { display_message?: string | null } | null): void;
      }): PlaidHandler;
    };
  }
}

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadLinkScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LINK_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Plaid Link failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = LINK_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid Link failed to load"));
    document.head.append(script);
  });
}

/**
 * Plaid Link, loaded on demand. The link token is minted server-side per click;
 * the public token goes straight back to a server action and is exchanged by
 * the API. The browser never sees an access token.
 */
export function PlaidLinkButton() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "negative" | "positive" | "info"; text: string } | null>(null);

  const open = useCallback(() => {
    start(async () => {
      setMessage(null);
      const token = await createLinkTokenAction();
      if (!token.ok || !token.data) {
        setMessage({
          tone: "negative",
          text: token.code === "plaid_not_configured" ? "Bank linking is not available in this environment yet." : token.error ?? "Could not start bank linking.",
        });
        return;
      }
      try {
        await loadLinkScript();
      } catch (error) {
        setMessage({ tone: "negative", text: error instanceof Error ? error.message : "Plaid Link failed to load." });
        return;
      }
      const handler = window.Plaid!.create({
        token: token.data.linkToken,
        onSuccess: (publicToken, metadata) => {
          const account = metadata.accounts?.[0];
          if (!account) {
            setMessage({ tone: "negative", text: "Plaid returned no account to link." });
            return;
          }
          start(async () => {
            const linked = await linkBankAction({
              publicToken,
              accountId: account.id,
              institutionName: metadata.institution?.name ?? "Bank",
              accountMask: account.mask ?? "0000",
            });
            setMessage(
              linked.ok
                ? { tone: "positive", text: "Bank linked. You can add money now." }
                : { tone: "negative", text: linked.error ?? "The bank could not be linked." },
            );
          });
        },
        onExit: (error) => {
          if (error) setMessage({ tone: "info", text: error.display_message ?? "Bank linking was cancelled." });
        },
      });
      handler.open();
    });
  }, []);

  return (
    <span className="plaid-link">
      <Button variant="secondary" pending={pending} onClick={open}>
        Link a bank
      </Button>
      {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
    </span>
  );
}
