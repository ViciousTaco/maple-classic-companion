import type { Pack } from "../data/pack";

// Plan P4-T8: shortest routes over map links.

export type RouteStep = {
  from: string;
  to: string;
  kind: "portal" | "taxi" | "ship" | "hidden";
  costMeso?: number;
  /** Where the portal is on the "from" map's picture (% across / down), when recorded. */
  pos?: { x: number; y: number };
};

/**
 * Dijkstra over map links: cost 1 per hop (taxis/ships also 1, with their meso cost noted).
 * Hidden links are used only when `unlockedAreas` contains the destination's region.
 */
export function findRoute(pack: Pack, from: string, to: string, unlockedAreas: string[] = []): RouteStep[] | null {
  if (!pack.index.mapById.has(from) || !pack.index.mapById.has(to)) return null;
  if (from === to) return [];
  const unlocked = new Set(unlockedAreas);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, RouteStep>();
  const done = new Set<string>();
  // Small graphs: a sorted frontier array is plenty and keeps results deterministic.
  const frontier: string[] = [from];
  while (frontier.length) {
    frontier.sort((a, b) => dist.get(a)! - dist.get(b)! || a.localeCompare(b));
    const cur = frontier.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const link of pack.index.linksFrom.get(cur) ?? []) {
      const target = pack.index.mapById.get(link.to);
      if (!target) continue;
      if (link.kind === "hidden" && !unlocked.has(target.region)) continue;
      const d = dist.get(cur)! + 1;
      if (d < (dist.get(link.to) ?? Infinity)) {
        dist.set(link.to, d);
        prev.set(link.to, {
          from: cur,
          to: link.to,
          kind: link.kind,
          ...(link.costMeso !== undefined ? { costMeso: link.costMeso } : {}),
          ...(link.pos ? { pos: link.pos } : {}),
        });
        frontier.push(link.to);
      }
    }
  }
  if (!prev.has(to)) return null;
  const steps: RouteStep[] = [];
  for (let at = to; at !== from; ) {
    const step = prev.get(at)!;
    steps.unshift(step);
    at = step.from;
  }
  return steps;
}

/** Nearest town by portal hops from a map (breadth-first, portals only — plan §8.7 convenience). */
export function nearestTown(pack: Pack, mapId: string): { mapId: string; hops: number } | null {
  const start = pack.index.mapById.get(mapId);
  if (!start) return null;
  if (start.isTown) return { mapId, hops: 0 };
  const seen = new Set([mapId]);
  let layer = [mapId];
  for (let hops = 1; layer.length; hops++) {
    const next: string[] = [];
    for (const id of layer)
      for (const l of pack.index.linksFrom.get(id) ?? []) {
        if (l.kind !== "portal" || seen.has(l.to)) continue;
        const m = pack.index.mapById.get(l.to);
        if (!m) continue;
        if (m.isTown) return { mapId: m.id, hops };
        seen.add(l.to);
        next.push(l.to);
      }
    layer = next.sort();
  }
  return null;
}
