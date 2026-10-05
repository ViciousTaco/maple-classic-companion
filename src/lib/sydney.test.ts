import { convertedReferences, formatWhen, parseExplicitTimes, zonedParts } from "./sydney";

// Plan §8.8 required table — all must pass exactly.
test.each([
  ["2026-10-06T18:00:00Z", "2026-10-07T05:00:00", "AEDT"], // Founder's Access start
  ["2026-10-21T18:00:00Z", "2026-10-22T05:00:00", "AEDT"], // Grand Launch
  ["2026-10-20T23:59:00Z", "2026-10-21T10:59:00", "AEDT"], // Founder's First Step ends
  ["2026-10-15T06:59:00Z", "2026-10-15T17:59:00", "AEDT"], // package sale ends
  ["2026-11-30T23:59:00Z", "2026-12-01T10:59:00", "AEDT"], // package claim deadline
  ["2026-10-03T15:59:59Z", "2026-10-04T01:59:59", "AEST"], // last second before DST starts
  ["2026-10-03T16:00:00Z", "2026-10-04T03:00:00", "AEDT"], // DST starts (2→3)
  ["2027-04-03T15:59:59Z", "2027-04-04T02:59:59", "AEDT"], // last second before DST ends
  ["2027-04-03T16:00:00Z", "2027-04-04T02:00:00", "AEST"], // DST ends (3→2)
])("%s → %s %s", (utc, wall, zone) => {
  const r = zonedParts(utc);
  expect(r.wall).toBe(wall);
  expect(r.zone).toBe(zone);
});

test("invalid input throws", () => {
  expect(() => zonedParts("nope")).toThrow("Invalid timestamp");
});

test("formatWhen shows the Sydney zone", () => {
  expect(formatWhen("2026-10-06T18:00:00Z")).toMatch(/Wed.*7 Oct 2026.*5:00 am AEDT/i);
});

// ---------------------------------------------------------------------------------------------
// parseExplicitTimes / convertedReferences (ported from Astra app/timing.test.mjs, P7-T3)
// ---------------------------------------------------------------------------------------------

test("launch times match Sydney DST rather than fixed AEST", () => {
  const [founder] = parseExplicitTimes("October 6, 2026 at 11:00 AM PDT");
  expect(founder?.utc).toBe("2026-10-06T18:00:00.000Z");
  expect(founder?.wall).toBe("2026-10-07T05:00:00");
  expect(founder?.zone).toBe("AEDT");
  const [launch] = parseExplicitTimes("October 21, 2026 at 11:00 AM PDT");
  expect(launch?.wall).toBe("2026-10-22T05:00:00");
  // A source "AEST" is UTC+10 even in summer: 4:00 AM AEST on 7 Oct is 18:00 UTC on 6 Oct.
  expect(parseExplicitTimes("October 7, 2026 4:00 AM AEST")[0]?.utc).toBe(founder?.utc);
  expect(parseExplicitTimes("October 6, 2026 6:00 PM UTC")[0]?.utc).toBe(founder?.utc);
});

test("source abbreviations keep their stated fixed offsets", () => {
  const utc = (text: string) => parseExplicitTimes(text)[0]?.utc;
  expect(utc("January 5, 2027 9:00 AM PST")).toBe("2027-01-05T17:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM EDT")).toBe("2027-07-05T13:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM EST")).toBe("2027-07-05T14:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM CEST")).toBe("2027-07-05T07:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM AEDT")).toBe("2027-07-04T22:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM AEST")).toBe("2027-07-04T23:00:00.000Z");
  expect(utc("July 5, 2027 9:00 AM GMT")).toBe("2027-07-05T09:00:00.000Z");
});

test("accepts the other spellings Nexon uses", () => {
  const utc = (text: string) => parseExplicitTimes(text)[0]?.utc;
  const expected = "2026-10-06T18:00:00.000Z";
  expect(utc("Oct. 6th, 2026 | Time: 6:00 PM UTC")).toBe(expected);
  expect(utc("Oct 6, 2026, 6 PM UTC")).toBe(expected);
  expect(utc("OCTOBER 6, 2026 6:00 pm (UTC)")).toBe(expected);
});

test("midnight, noon, year rollover, and invalid calendar dates", () => {
  expect(parseExplicitTimes("April 24, 2026 12:00 AM UTC")[0]?.wall).toBe("2026-04-24T10:00:00");
  expect(parseExplicitTimes("April 24, 2026 12:00 PM UTC")[0]?.wall).toBe("2026-04-24T22:00:00");
  expect(zonedParts("2026-12-31T14:00:00Z").wall).toBe("2027-01-01T01:00:00");
  expect(parseExplicitTimes("February 30, 2026 12:00 AM UTC")[0]?.error).toBeTruthy();
  expect(parseExplicitTimes("April 24, 2026 13:00 PM UTC")[0]?.error).toBeTruthy();
  expect(parseExplicitTimes("April 24, 2026 12:60 PM UTC")[0]?.error).toBeTruthy();
  expect(parseExplicitTimes("April 24, 2026 0:30 PM UTC")[0]?.error).toBeTruthy();
});

test("an invalid timestamp is reported with its source text and has no instant", () => {
  const [bad] = parseExplicitTimes("Ends on February 30, 2026 12:00 AM UTC.");
  expect(bad?.source).toBe("February 30, 2026 12:00 AM UTC");
  expect(bad?.index).toBe(8);
  expect(bad?.utc).toBeUndefined();
});

test("missing years or time zones remain unconverted", () => {
  for (const excerpt of [
    "October 7, 14 | 12:00 AM UTC",
    "October 6, 2026 at 11:00 AM",
    "4:00 AM AEST October 7",
    "October 6, 2026 at 11:00 AM PT",
  ]) {
    expect(parseExplicitTimes(excerpt)).toEqual([]);
    const [ref] = convertedReferences([{ excerpt }]);
    expect(ref?.utc).toBeNull();
    expect(ref?.conversion).toMatch(/Needs review/);
  }
});

test("explicit date ranges convert both endpoints, never inventing missing years", () => {
  const t = parseExplicitTimes("October 6, 2026 6:00 PM UTC - October 20, 2026 11:59 PM UTC");
  expect(t).toHaveLength(2);
  expect(t[1]?.wall).toBe("2026-10-21T10:59:00");
});

test("convertedReferences keeps the original fields and flags errors", () => {
  const refs = convertedReferences([
    { excerpt: "October 6, 2026 at 11:00 AM PDT / October 7, 4:00 AM AEST", id: 7 },
    { excerpt: "February 30, 2026 12:00 AM UTC", id: 8 },
  ]);
  expect(refs).toHaveLength(2); // only the first complete timestamp matches in the first excerpt
  expect(refs[0]).toMatchObject({
    id: 7,
    utc: "2026-10-06T18:00:00.000Z",
    zone: "AEDT",
    parsedSource: "October 6, 2026 at 11:00 AM PDT",
    conversion: "Converted stated timestamp. Other wording may need review.",
  });
  expect(refs[1]).toMatchObject({
    id: 8,
    utc: null,
    zone: null,
    conversion: expect.stringMatching(/^Needs review: Invalid/),
  });
});
