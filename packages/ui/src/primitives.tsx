import type { HTMLAttributes, ReactNode } from "react";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timestamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

export function Money({ cents }: { readonly cents: bigint }) {
  const amount = usd.format(Math.abs(Number(cents)) / 100);
  return <span className="numeric">{cents < 0n ? `−${amount}` : amount}</span>;
}

export function Units({ micro }: { readonly micro: bigint }) {
  const negative = micro < 0n;
  const absolute = negative ? -micro : micro;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return <span className="numeric">{`${negative ? "−" : ""}${whole}.${fraction}`}</span>;
}

export function Percentage({ value }: { readonly value: number }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span className="numeric" data-sign={value > 0 ? "positive" : value < 0 ? "negative" : "zero"}>
      {sign}
      {Math.abs(value * 100).toFixed(2)}%
    </span>
  );
}

export function Timestamp({ value }: { readonly value: Date | string }) {
  return <time dateTime={new Date(value).toISOString()}>{timestamp.format(new Date(value))}</time>;
}

export type StatusTone = "neutral" | "positive" | "negative" | "warning" | "info";

export function StatusPill({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: StatusTone;
}) {
  return <span data-tone={tone} className="status-pill">{children}</span>;
}

export function Skeleton(props: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" {...props} className={`skeleton ${props.className ?? ""}`} />;
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  readonly title: string;
  readonly detail: string;
  readonly action?: ReactNode;
}) {
  return (
    <section className="state-block">
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

export function ErrorState({
  title,
  detail,
  retry,
}: {
  readonly title: string;
  readonly detail: string;
  readonly retry?: ReactNode;
}) {
  return (
    <section className="state-block" role="alert">
      <h2>{title}</h2>
      <p>{detail}</p>
      {retry}
    </section>
  );
}
