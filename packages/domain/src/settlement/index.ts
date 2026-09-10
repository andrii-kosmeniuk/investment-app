const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function addBusinessDays(
  tradeDate: string,
  businessDays: number,
  holidays: ReadonlySet<string>,
): string {
  if (!ISO_DAY.test(tradeDate)) throw new TypeError("tradeDate must be YYYY-MM-DD");
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new RangeError("businessDays must be a non-negative integer");
  }
  const date = new Date(`${tradeDate}T12:00:00Z`);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(iso)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export const contractualSettlementDate = (
  tradeDate: string,
  holidays: ReadonlySet<string>,
): string => addBusinessDays(tradeDate, 1, holidays);
