/**
 * Business-date arithmetic on ISO `YYYY-MM-DD` strings. The market's clock is
 * America/New_York; every "as of" date in the product is a business date in
 * that zone, never the server's local date.
 */
export const MARKET_TIME_ZONE = "America/New_York";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): string {
  if (!ISO_DAY.test(value)) throw new TypeError(`Expected YYYY-MM-DD, got ${value}`);
  return value;
}

function utcMidnight(date: string): number {
  assertIsoDate(date);
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const value = new Date(utcMidnight(date));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function firstOfMonth(date: string): string {
  return `${assertIsoDate(date).slice(0, 7)}-01`;
}

export function firstOfYear(date: string): string {
  return `${assertIsoDate(date).slice(0, 4)}-01-01`;
}

export function isWeekend(date: string): boolean {
  const weekday = new Date(utcMidnight(date)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The last weekday strictly before `date` (holidays are out of scope; see CUT_LIST). */
export function previousBusinessDay(date: string): string {
  let candidate = addDays(date, -1);
  while (isWeekend(candidate)) candidate = addDays(candidate, -1);
  return candidate;
}

function wallClockParts(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const out: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

/** The business date (YYYY-MM-DD) that `now` falls on in `timeZone`. */
export function businessDate(now: Date, timeZone = MARKET_TIME_ZONE): string {
  const p = wallClockParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The UTC instant at which the wall clock in `timeZone` reads `date` at `time` (HH:MM:SS.mmm). */
export function zonedInstant(date: string, time: string, timeZone = MARKET_TIME_ZONE): Date {
  assertIsoDate(date);
  const guess = new Date(`${date}T${time}Z`);
  const wall = wallClockParts(guess, timeZone);
  const asIfUtc = Date.UTC(
    wall.year!,
    wall.month! - 1,
    wall.day!,
    wall.hour!,
    wall.minute!,
    wall.second!,
    guess.getUTCMilliseconds(),
  );
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

/**
 * The last instant of `date` in `timeZone`. Used as the `effectiveAt` cutoff
 * when valuing a business day, so a fill at 15:59 ET on the date counts and a
 * deposit settled the next morning does not.
 */
export const endOfBusinessDay = (date: string, timeZone = MARKET_TIME_ZONE): Date =>
  zonedInstant(date, "23:59:59.999", timeZone);

/** 16:00 in the market's zone — the effective time we give date-only corporate actions. */
export const atMarketClose = (date: string, timeZone = MARKET_TIME_ZONE): Date =>
  zonedInstant(date, "16:00:00.000", timeZone);
