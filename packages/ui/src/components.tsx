import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Money, StatusPill, type StatusTone } from "./primitives.js";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly pending?: boolean;
}

/** The primary button is the one pill in the system. `pending` keeps the label visible. */
export function Button({ variant = "primary", pending = false, children, className, ...rest }: ButtonProps) {
  return (
    <button
      type={rest.type ?? "button"}
      data-variant={variant}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      className={["button", className].filter(Boolean).join(" ")}
      {...rest}
      disabled={rest.disabled || pending}
    >
      <span className="button__label">{children}</span>
      {pending ? <span className="button__spinner" aria-hidden="true" /> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Field                                                               */
/* ------------------------------------------------------------------ */

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly prefix?: string;
}

/** Label above, hint or inline error below; errors never replace the label. */
export function Field({ id, label, hint, error, prefix, className, ...input }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["field", className].filter(Boolean).join(" ")} data-invalid={error ? "true" : undefined}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="field__control">
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      </div>
      {error ? (
        <p id={`${id}-error`} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline alert                                                        */
/* ------------------------------------------------------------------ */

export type AlertTone = "info" | "warning" | "negative" | "positive";

export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
}: {
  readonly tone?: AlertTone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="inline-alert" data-tone={tone} role={tone === "negative" ? "alert" : "status"}>
      <div className="inline-alert__body">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      {action ? <div className="inline-alert__action">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Environment badge                                                   */
/* ------------------------------------------------------------------ */

export function EnvironmentBadge({ environment }: { readonly environment: "sandbox" | "production" }) {
  if (environment === "production") return null;
  return (
    <span className="environment-badge" title="Sandbox rails: no real money moves">
      Sandbox
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export type TimelineState = "done" | "current" | "upcoming" | "failed";

export interface TimelineStep {
  readonly key: string;
  readonly label: string;
  readonly state: TimelineState;
  readonly detail?: ReactNode;
}

/** Deposit and onboarding progress. States come from the server; never optimistic. */
export function Timeline({ steps, orientation = "horizontal" }: { readonly steps: readonly TimelineStep[]; readonly orientation?: "horizontal" | "vertical" }) {
  return (
    <ol className="timeline" data-orientation={orientation}>
      {steps.map((step, index) => (
        <li key={step.key} className="timeline__step" data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="timeline__marker" aria-hidden="true">
            {step.state === "done" ? "✓" : step.state === "failed" ? "!" : String(index + 1).padStart(2, "0")}
          </span>
          <span className="timeline__label">{step.label}</span>
          {step.detail ? <span className="timeline__detail">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Allocation bar                                                      */
/* ------------------------------------------------------------------ */

export interface AllocationSegment {
  readonly symbol: string;
  readonly weightBps: number;
}

const bps = (value: number): string => `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;

/** Target weights as a segmented bar. Segments share one hue ramp; the legend carries the numbers. */
export function AllocationBar({ segments, label }: { readonly segments: readonly AllocationSegment[]; readonly label?: string }) {
  return (
    <div className="allocation">
      <div className="allocation__bar" role="img" aria-label={label ?? segments.map((segment) => `${segment.symbol} ${bps(segment.weightBps)}`).join(", ")}>
        {segments.map((segment, index) => (
          <span key={segment.symbol} style={{ flexGrow: segment.weightBps }} data-index={index} />
        ))}
      </div>
      <ul className="allocation__legend">
        {segments.map((segment, index) => (
          <li key={segment.symbol}>
            <span className="allocation__swatch" data-index={index} aria-hidden="true" />
            <span className="allocation__symbol">{segment.symbol}</span>
            <span className="numeric">{bps(segment.weightBps)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cash breakdown                                                      */
/* ------------------------------------------------------------------ */

export interface CashBreakdownProps {
  readonly settledCents: bigint;
  readonly pendingDepositCents: bigint;
  readonly unsettledBuysCents: bigint;
  readonly unsettledSellsCents: bigint;
  readonly availableToInvestCents: bigint;
  readonly availableToWithdrawCents: bigint;
}

/** Every cash bucket, each labelled with what it can do. No bucket is hidden when zero. */
export function CashBreakdown(cash: CashBreakdownProps) {
  const rows: readonly { label: string; cents: bigint; note: string }[] = [
    { label: "Settled cash", cents: cash.settledCents, note: "Cleared and on your books" },
    { label: "Pending deposits", cents: cash.pendingDepositCents, note: "In transit by ACH; not yet yours to invest" },
    { label: "Unsettled buys", cents: -cash.unsettledBuysCents, note: "Owed for trades settling T+1" },
    { label: "Unsettled sells", cents: cash.unsettledSellsCents, note: "Proceeds settling T+1; not withdrawable" },
  ];
  return (
    <dl className="cash-breakdown">
      {rows.map((row) => (
        <div key={row.label} className="cash-breakdown__row">
          <dt>
            {row.label}
            <span>{row.note}</span>
          </dt>
          <dd>
            <Money cents={row.cents} />
          </dd>
        </div>
      ))}
      <div className="cash-breakdown__row cash-breakdown__row--total">
        <dt>Available to invest</dt>
        <dd>
          <Money cents={cash.availableToInvestCents} />
        </dd>
      </div>
      <div className="cash-breakdown__row cash-breakdown__row--total">
        <dt>Available to withdraw</dt>
        <dd>
          <Money cents={cash.availableToWithdrawCents} />
        </dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Summary (key/value facts)                                           */
/* ------------------------------------------------------------------ */

export interface SummaryItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: StatusTone;
}

export function Summary({ items, columns = 4 }: { readonly items: readonly SummaryItem[]; readonly columns?: 2 | 3 | 4 }) {
  return (
    <dl className="summary" style={{ "--summary-columns": columns } as React.CSSProperties}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.tone ? <StatusPill tone={item.tone}>{item.value}</StatusPill> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Page heading                                                        */
/* ------------------------------------------------------------------ */

export function PageHeading({ title, eyebrow, aside, children }: { readonly title: ReactNode; readonly eyebrow?: ReactNode; readonly aside?: ReactNode; readonly children?: ReactNode }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow ? <p className="page-heading__eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </div>
      {aside ? <div className="page-heading__aside">{aside}</div> : null}
    </header>
  );
}
