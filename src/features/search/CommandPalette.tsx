import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { CornerDownLeft, Gem, LayoutGrid, Map as MapIcon, ScrollText, Search, Skull, UserRound } from "lucide-react";
import { create } from "zustand";
import { navigate, usePack } from "../../app/context";
import type { Pack } from "../../data/pack";
import { mapName } from "../guide/text";

// I-27: Ctrl+K search across screens, maps, monsters, items, quests and NPCs.

export const useSearch = create<{ open: boolean; setOpen: (o: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export type SearchHit = { kind: "screen" | "map" | "monster" | "item" | "quest" | "npc"; label: string; detail: string; go: string };

const SCREENS: [string, string][] = [
  ["Home", "/home"],
  ["Train", "/train"],
  ["Plan / Projections", "/plan"],
  ["Loot", "/loot"],
  ["Gear & stats", "/gear"],
  ["Quests", "/quests"],
  ["News & events", "/news"],
  ["Maps", "/maps"],
  ["Characters", "/characters"],
  ["Analyse (screen reader)", "/watch"],
  ["Settings", "/settings"],
];

const q = (s: string) => `?q=${encodeURIComponent(s)}`;

/** Ranks: exact > starts with > word starts with > contains. Max `limit` hits. */
export function searchAll(pack: Pack | null, text: string, limit = 12): SearchHit[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return SCREENS.slice(0, 6).map(([label, go]) => ({ kind: "screen", label, detail: "Screen", go }));
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n === needle) return 0;
    if (n.startsWith(needle)) return 1;
    if (n.split(/[\s'(-]+/).some((w) => w.startsWith(needle))) return 2;
    if (n.includes(needle)) return 3;
    return 9;
  };
  const hits: (SearchHit & { s: number })[] = [];
  const add = (h: SearchHit) => {
    const s = score(h.label);
    if (s < 9) hits.push({ ...h, s });
  };
  for (const [label, go] of SCREENS) add({ kind: "screen", label, detail: "Screen", go });
  if (pack) {
    for (const m of pack.maps) add({ kind: "map", label: m.name, detail: m.isTown ? "Town" : "Map", go: `/maps${q(m.name)}` });
    for (const m of pack.monsters) add({ kind: "monster", label: m.name, detail: `Monster · Lv ${m.level}`, go: `/maps${q(m.name)}` });
    for (const i of pack.items) add({ kind: "item", label: i.name, detail: `Item · ${i.category}${i.reqLevel ? ` · Lv ${i.reqLevel}` : ""}`, go: `/loot${q(i.name)}` });
    for (const x of pack.quests) add({ kind: "quest", label: x.name, detail: `Quest · Lv ${x.minLevel}+`, go: `/quests${q(x.name)}` });
    for (const n of pack.npcs) add({ kind: "npc", label: n.name, detail: `NPC · ${mapName(pack, n.mapId)}`, go: `/maps${q(mapName(pack, n.mapId))}` });
  }
  return hits.sort((a, b) => a.s - b.s || a.label.length - b.label.length || a.label.localeCompare(b.label)).slice(0, limit);
}

const ICON = { screen: LayoutGrid, map: MapIcon, monster: Skull, item: Gem, quest: ScrollText, npc: UserRound } as const;

export function CommandPalette() {
  const { open, setOpen } = useSearch();
  const pack = usePack();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const hits = useMemo(() => searchAll(pack, text), [pack, text]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (h: SearchHit | undefined) => {
    if (!h) return;
    navigate(h.go);
    setOpen(false);
    setText("");
    setActive(0);
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="scrim fixed inset-0 z-40 bg-black/30 backdrop-blur-[3px]" />
        <D.Content className="glass-strong fixed left-1/2 top-[14vh] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-[26px] p-0 shadow-2xl">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search maps, monsters, items, quests, NPCs and screens</D.Description>
          <label className="flex items-center gap-3 border-b border-hairline px-5 py-4">
            <Search size={20} className="text-ink-3" />
            <input
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(hits.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(hits[active]);
                }
              }}
              placeholder="Search maps, monsters, items, quests, NPCs…"
              aria-label="Search"
              className="w-full bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3"
            />
            <kbd className="rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
          </label>
          <ul ref={list} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
            {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing found for "{text}"</li>}
            {hits.map((h, i) => {
              const Icon = ICON[h.kind];
              return (
                <li key={`${h.kind}-${h.label}-${h.go}`} data-index={i} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${i === active ? "bg-maple/15" : "hover:bg-fill"}`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${i === active ? "bg-maple text-white" : "bg-fill text-ink-2"}`}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{h.label}</span>
                      <span className="block truncate text-xs text-ink-3">{h.detail}</span>
                    </span>
                    {i === active && <CornerDownLeft size={15} className="text-ink-3" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
