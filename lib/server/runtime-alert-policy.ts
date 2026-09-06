export type RunnerHealthStatus = "ACTIVE" | "INACTIVE" | "FAILED" | "UNKNOWN" | "INTENTIONAL_STOP";
export type RunnerAlertTransition = "UNHEALTHY" | "RECOVERED" | "NONE";

const unhealthy = new Set<RunnerHealthStatus>(["INACTIVE", "FAILED", "UNKNOWN"]);
const NEW_YORK_TIME_ZONE = "America/New_York";

function datePartsInNewYork(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (ordinal - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset));
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(day - 1);
  if (weekday === 0) date.setUTCDate(day + 1);
  return date;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isUsEquityHoliday(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const observed = [
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ];
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  observed.push(easter);
  return observed.some((holiday) => holiday.getUTCFullYear() === date.getUTCFullYear() && holiday.getUTCMonth() === date.getUTCMonth() && holiday.getUTCDate() === date.getUTCDate());
}

/** True only during the US equity regular session used by the V52 sleeve. */
export function isUsEquityRegularSessionAt(at: Date) {
  const parts = datePartsInNewYork(at);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!year || !month || !day || ["Sat", "Sun"].includes(parts.weekday) || isUsEquityHoliday(year, month, day)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function shouldTreatV52StopAsIntentional(markerPresent: boolean, at: Date = new Date()) {
  return markerPresent && !isUsEquityRegularSessionAt(at);
}

/** Alerting is observational only. It never changes a trading gate. */
export function classifyRunnerAlertTransition(
  previous: RunnerHealthStatus | undefined,
  current: RunnerHealthStatus,
): RunnerAlertTransition {
  if (current === "INTENTIONAL_STOP") return "NONE";
  if (unhealthy.has(current) && !unhealthy.has(previous as RunnerHealthStatus)) return "UNHEALTHY";
  if (current === "ACTIVE" && unhealthy.has(previous as RunnerHealthStatus)) return "RECOVERED";
  return "NONE";
}
