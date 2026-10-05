import { PACK_FILES, type Drop, type GameMap, type Item, type Monster, type Npc, type PackData, type PackKey, type Quest, type Skill, type TrainingSpot, type Video } from "./schema/pack";
import { formatIssue, parsePackFiles, validatePack, PACK_KEYS } from "./validate";

// Plan P3-T10: load the active or bundled pack, validate it, build indexes.

export type MapLink = GameMap["links"][number] & { from: string };

export type PackIndex = {
  monsterById: Map<string, Monster>;
  mapById: Map<string, GameMap>;
  itemById: Map<string, Item>;
  npcById: Map<string, Npc>;
  questById: Map<string, Quest>;
  spotById: Map<string, TrainingSpot>;
  skillById: Map<string, Skill>;
  videoById: Map<string, Video>;
  dropsByMob: Map<string, Drop[]>;
  dropsByItem: Map<string, Drop[]>;
  spotsByMap: Map<string, TrainingSpot[]>;
  questsByNpc: Map<string, Quest[]>;
  /** Outgoing links per map (the route graph). */
  linksFrom: Map<string, MapLink[]>;
};

export type Pack = PackData & { index: PackIndex };

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function buildIndexes(data: PackData): Pack {
  return {
    ...data,
    index: {
      monsterById: byId(data.monsters),
      mapById: byId(data.maps),
      itemById: byId(data.items),
      npcById: byId(data.npcs),
      questById: byId(data.quests),
      spotById: byId(data.trainingSpots),
      skillById: byId(data.skills),
      videoById: byId(data.videos),
      dropsByMob: groupBy(data.drops, (d) => d.mobId),
      dropsByItem: groupBy(data.drops, (d) => d.itemId),
      spotsByMap: groupBy(data.trainingSpots, (s) => s.mapId),
      questsByNpc: groupBy(data.quests, (q) => q.startNpcId),
      linksFrom: new Map(data.maps.map((m) => [m.id, m.links.map((l) => ({ ...l, from: m.id }))])),
    },
  };
}

export type ParseResult = { ok: true; pack: Pack } | { ok: false; problems: string[] };

/** Shape (rule 1) + integrity (rules 1–2) check, then indexes. Never throws. */
export function parsePack(raw: Partial<Record<PackKey, unknown>>): ParseResult {
  const parsed = parsePackFiles(raw);
  if (!parsed.pack) return { ok: false, problems: parsed.issues.map(formatIssue) };
  const issues = validatePack(parsed.pack, { level: "integrity" });
  if (issues.length) return { ok: false, problems: issues.map(formatIssue) };
  return { ok: true, pack: buildIndexes(parsed.pack) };
}

/** Where a pack can be read from: an installed pack (P8) or the baseline bundled in the exe. */
export type PackSource = {
  kind: "installed" | "bundled";
  /** Returns the parsed JSON of one built pack file, e.g. "monsters.json". */
  read(file: string): Promise<unknown>;
};

export type LoadResult =
  | { ok: true; pack: Pack; from: PackSource["kind"]; fellBack: { from: PackSource["kind"]; problem: string } | null }
  | { ok: false; problems: string[] };

/** Tries each source in order; the first that loads cleanly wins (plan §8.6 step 10). */
export async function loadPack(sources: PackSource[]): Promise<LoadResult> {
  const failures: { from: PackSource["kind"]; problem: string }[] = [];
  for (const src of sources) {
    try {
      const raw: Partial<Record<PackKey, unknown>> = {};
      await Promise.all(
        PACK_KEYS.map(async (key) => {
          raw[key] = await src.read(PACK_FILES[key]);
        }),
      );
      const r = parsePack(raw);
      if (r.ok) return { ok: true, pack: r.pack, from: src.kind, fellBack: failures[0] ?? null };
      failures.push({ from: src.kind, problem: r.problems.slice(0, 3).join("; ") });
    } catch (err) {
      failures.push({ from: src.kind, problem: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: false, problems: failures.map((f) => `${f.from}: ${f.problem}`) };
}

/** The baseline copied into the frontend build at `/baseline/` (P3-T10). */
export function bundledSource(fetchFn: typeof fetch = fetch, base = "baseline/", timeoutMs = 15_000): PackSource {
  return {
    kind: "bundled",
    async read(file) {
      // A stalled read must never leave the app on the loading screen forever.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${base}${file}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        throw ctl.signal.aborted ? new Error(`${file}: timed out`) : err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Version of the bundled baseline, from its manifest. */
export async function bundledVersion(fetchFn: typeof fetch = fetch, base = "baseline/"): Promise<string | null> {
  try {
    const res = await fetchFn(`${base}manifest.json`);
    return res.ok ? ((await res.json()) as { packVersion: string }).packVersion : null;
  } catch {
    return null;
  }
}
