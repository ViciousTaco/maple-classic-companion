// Plan §8.8 (ported from Astra app/timing.mjs). `parseExplicitTimes` / `convertedReferences` were added in P7-T3.

export const SYDNEY = "Australia/Sydney";

export function zonedParts(input: string | Date, timeZone: string = SYDNEY) {
  const instant = new Date(input);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  const offsetMin = Math.round((Date.parse(wall + "Z") - instant.getTime()) / 60000);
  const zone = timeZone !== SYDNEY ? "" : offsetMin === 660 ? "AEDT" : offsetMin === 600 ? "AEST" : "";
  return { wall, offsetMin, zone };
}

/** e.g. "Wed 7 Oct 2026, 5:00 am AEDT". `timeZone` undefined = the PC's zone. */
export function formatWhen(input: string | Date, timeZone: string | undefined = SYDNEY): string {
  const d = new Date(input);
  const text = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(/\s/g, " "); // Intl uses narrow no-break spaces
  const zone = timeZone === SYDNEY ? zonedParts(d).zone : "";
  return zone ? `${text} ${zone}` : text;
}

// ---------------------------------------------------------------------------------------------
// Explicit times in article text (ported from Astra timing.mjs, P7-T3)
// All comparisons use instants in UTC; Sydney civil time is only a display value.
// ---------------------------------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_RX =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Minutes east of UTC. A source abbreviation always means exactly this fixed offset. */
const SOURCE_OFFSETS_MIN = {
  UTC: 0,
  GMT: 0,
  PDT: -420,
  PST: -480,
  EDT: -240,
  EST: -300,
  CDT: -300,
  CST: -360,
  CEST: 120,
  CET: 60,
  AEST: 600,
  AEDT: 660,
} as const;
type SourceZone = keyof typeof SOURCE_OFFSETS_MIN;

const TIMESTAMP_RX = new RegExp(
  String.raw`\b(${MONTH_RX})\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\s*(?:at\s+|[,|]\s*(?:Time:\s*)?)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*\(?(${Object.keys(SOURCE_OFFSETS_MIN).join("|")})\b`,
  "gi",
);

export interface ExplicitTimeError {
  /** The matched text, verbatim. */
  source: string;
  index: number;
  error: string;
  utc?: undefined;
  wall?: undefined;
  zone?: undefined;
  offsetMin?: undefined;
}
export interface ExplicitTimeOk {
  source: string;
  index: number;
  /** ISO instant (`...Z`) after applying the source abbreviation's fixed offset. */
  utc: string;
  /** Sydney wall clock `YYYY-MM-DDTHH:mm:ss`. */
  wall: string;
  zone: string;
  offsetMin: number;
  error?: undefined;
}
export type ExplicitTime = ExplicitTimeOk | ExplicitTimeError;

/**
 * Finds complete "Month D, YYYY [at] h[:mm] AM|PM ZONE" timestamps. The abbreviation carries its stated
 * fixed offset: a source "AEST" is UTC+10 even in summer, never "Sydney time". Entries with an
 * impossible calendar date or clock time come back with `error` and no `utc`. Anything missing a year,
 * a time or a recognised zone is not matched at all.
 */
export function parseExplicitTimes(text: string): ExplicitTime[] {
  const result: ExplicitTime[] = [];
  for (const m of text.matchAll(TIMESTAMP_RX)) {
    const [
      source = "",
      monthName = "",
      dayText = "",
      yearText = "",
      hourText = "",
      minuteText,
      meridiem = "",
      zoneText = "",
    ] = m;
    const index = m.index ?? 0;
    const month = MONTHS.findIndex((x) => x.startsWith(monthName.toLowerCase())) + 1;
    const day = Number(dayText);
    const year = Number(yearText);
    const rawHour = Number(hourText);
    const minute = Number(minuteText || 0);
    const hour = (rawHour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
    const zone = zoneText.toUpperCase() as SourceZone;
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (
      rawHour < 1 ||
      rawHour > 12 ||
      minute > 59 ||
      local.getUTCMonth() !== month - 1 ||
      local.getUTCDate() !== day
    ) {
      result.push({ source, error: "Invalid date or clock time in source", index });
      continue;
    }
    const utc = new Date(local.getTime() - SOURCE_OFFSETS_MIN[zone] * 60000).toISOString();
    result.push({ source, utc, index, ...zonedParts(utc) });
  }
  return result;
}

export interface DateExcerpt {
  excerpt: string;
}
export type ConvertedReference<T extends DateExcerpt> = T & {
  utc: string | null;
  zone: string | null;
  parsedSource?: string;
  conversion: string;
};

/** Converts every complete timestamp in each excerpt; excerpts with none are marked "Needs review". */
export function convertedReferences<T extends DateExcerpt>(
  refs: readonly T[],
): ConvertedReference<T>[] {
  return refs.flatMap((ref): ConvertedReference<T>[] => {
    const times = parseExplicitTimes(ref.excerpt);
    if (!times.length)
      return [
        {
          ...ref,
          conversion: "Needs review: no complete date, time and zone",
          utc: null,
          zone: null,
        },
      ];
    return times.map((time) => ({
      ...ref,
      utc: time.utc || null,
      zone: time.zone || null,
      parsedSource: time.source,
      conversion: time.error
        ? "Needs review: " + time.error
        : "Converted stated timestamp. Other wording may need review.",
    }));
  });
}
