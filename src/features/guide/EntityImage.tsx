import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Image as ImageIcon, ImagePlus, Search, Trash2 } from "lucide-react";
import { usePlatform } from "../../app/context";
import type { EntityKind, Platform } from "../../platform/types";
import { bytesToDataUrl, firstImageFile, toWebp } from "../../lib/image";
import { toast } from "../../ui/overlays";

// G-4 / P9-T1: The owner's own picture → cached reference picture (approved wiki, downloaded once, kept on this PC)
// → neutral placeholder. Images are Nexon's art: personal use only, never bundled or published.

type Source = "own" | "wiki" | null;
const inflight = new Map<string, Promise<Uint8Array | null>>();

async function fetchRemote(platform: Platform, url: string): Promise<Blob> {
  const doFetch: typeof fetch = platform.kind === "tauri" ? ((await import("@tauri-apps/plugin-http")).fetch as unknown as typeof fetch) : fetch;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Blob([await res.arrayBuffer()]);
}

/** Cached reference image, downloading it once if needed. Concurrent requests for the same image share one download. */
function cachedImage(platform: Platform, kind: EntityKind, id: string, url: string | undefined): Promise<Uint8Array | null> {
  const maxEdge = kind === "map" ? 960 : 256;
  const key = `${kind}:${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const hit = await platform.imageCacheRead(kind, id).catch(() => null);
    if (hit || !url) return hit;
    try {
      const bytes = await toWebp(await fetchRemote(platform, url), maxEdge);
      await platform.imageCacheSave(kind, id, bytes).catch(() => undefined);
      return bytes;
    } catch {
      return null; // offline or blocked: placeholder for now, retried next time
    }
  })();
  inflight.set(key, p);
  void p.finally(() => setTimeout(() => inflight.delete(key), 0));
  return p;
}

export function EntityImage({
  kind,
  id,
  name,
  url,
  className = "h-10 w-10",
  editable = true,
  fit = "contain",
  fallback,
  hideWhenMissing = false,
  natural = false,
}: {
  kind: EntityKind;
  id: string;
  name: string;
  url?: string;
  className?: string;
  editable?: boolean;
  /** "cover" for map pictures that fill a frame. */
  fit?: "contain" | "cover";
  /** Shown while there's no picture (default: an image icon). */
  fallback?: React.ReactNode;
  /** Render nothing at all until a picture exists (for decorative sprites). */
  hideWhenMissing?: boolean;
  /** Show the picture at its own shape (full width, auto height) — needed for overlays positioned in %. */
  natural?: boolean;
}) {
  const platform = usePlatform();
  const [state, setState] = useState<{ key: string; bytes: Uint8Array | null; source: Source } | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const key = `${kind}:${id}:${version}`;

  useEffect(() => {
    let live = true;
    void (async () => {
      const own = await platform.entityImageRead(kind, id).catch(() => null);
      if (own) return live && setState({ key, bytes: own, source: "own" });
      const ref = await cachedImage(platform, kind, id, url);
      if (live) setState({ key, bytes: ref, source: ref ? "wiki" : null });
    })();
    return () => {
      live = false;
    };
  }, [platform, kind, id, url, key]);

  const current = state?.key === key ? state : null;
  const src = useMemo(() => (current?.bytes ? bytesToDataUrl(current.bytes) : null), [current]);

  const saveOwn = async (file: File | null) => {
    if (!file) return;
    try {
      await platform.entityImageSave(kind, id, await toWebp(file, kind === "map" ? 960 : 512));
      setVersion((v) => v + 1);
      setOpen(false);
      toast({ message: `Saved your picture for ${name}` });
    } catch (err) {
      toast({ message: `Couldn't use that picture: ${String(err)}`, tone: "error" });
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = firstImageFile(e.clipboardData);
      if (f) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void saveOwn(f);
      }
    };
    window.addEventListener("paste", onPaste, { capture: true });
    return () => window.removeEventListener("paste", onPaste, { capture: true });
    // saveOwn is recreated each render; the listener only needs to exist while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (hideWhenMissing && !src) return null;
  const title = current?.source === "own" ? `${name} — your picture` : current?.source === "wiki" ? `${name} — image via MapleClassic Wiki · © Nexon` : name;
  const pic = (
    <span
      className={`relative ${natural && src ? "block" : "inline-flex items-center justify-center"} shrink-0 overflow-hidden rounded-xl bg-fill ${className}`}
      title={title}
      onDragOver={(e) => editable && e.preventDefault()}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        void saveOwn(firstImageFile(e.dataTransfer));
      }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={natural ? "block h-auto w-full" : `h-full w-full ${fit === "cover" ? "object-cover" : "object-contain [image-rendering:pixelated]"}`}
          draggable={false}
        />
      ) : (
        (fallback ?? <ImageIcon className="h-1/2 w-1/2 text-ink-3" aria-hidden />)
      )}
    </span>
  );
  if (!editable) return pic;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Picture options for ${name}`} className={`rounded-xl transition hover:ring-2 hover:ring-maple/40 ${fit === "cover" ? "block h-full w-full" : ""}`}>
          {pic}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} className="glass-strong z-50 w-64 space-y-1 rounded-2xl p-2 text-sm shadow-xl">
          <p className="px-2 pb-1 pt-1 text-xs text-ink-3">{current?.source === "wiki" ? "Image via MapleClassic Wiki · © Nexon" : current?.source === "own" ? "Your picture (only on this PC)" : "No picture yet"}</p>
          <button type="button" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 hover:bg-fill" onClick={() => fileInput.current?.click()}>
            <ImagePlus size={15} /> Use my own (or press Ctrl+V)
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 hover:bg-fill"
            onClick={() => void platform.openUrl(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`MapleStory Classic ${name}`)}`)}
          >
            <Search size={15} /> Find image online
          </button>
          {current?.source === "own" && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-danger hover:bg-fill"
              onClick={async () => {
                await platform.entityImageDelete(kind, id);
                setVersion((v) => v + 1);
                setOpen(false);
              }}
            >
              <Trash2 size={15} /> Remove my picture
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" className="hidden" aria-label={`Choose a picture for ${name}`} onChange={(e) => void saveOwn(e.currentTarget.files?.[0] ?? null)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
