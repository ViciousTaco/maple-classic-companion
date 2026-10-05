import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useActiveProfile, usePlatform, useRoute, useRules } from "../../app/context";
import { bytesToObjectUrl, imageFiles, toWebp } from "../../lib/image";
import { Button, Field, inputClass } from "../../ui/kit";
import { Dialog, toast } from "../../ui/overlays";

// Quick note (I-19 / P2-T6b): effortless field notes saved to <data>\field-notes\inbox\<stamp>\.

export const useQuickNote = create<{ open: boolean; setOpen: (o: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const MEOWDB = /^https?:\/\/(?:www\.)?meowdb\.com\/msclassic\/(monsters|maps|item-db|quest-tracker)\/(\d{1,12})(?:[/?#].*)?$/i;
const KIND: Record<string, string> = { monsters: "monster", maps: "map", "item-db": "item", "quest-tracker": "quest" };

/** Recognises an exact MeowDB record link (the id becomes `ext.meowdb` under the link accuracy rule). */
export function parseMeowdbUrl(url: string): { kind: string; id: string } | null {
  const m = MEOWDB.exec(url.trim());
  return m ? { kind: KIND[m[1]!.toLowerCase()]!, id: m[2]! } : null;
}

export function buildNote(input: {
  text: string;
  url: string;
  character: { name: string; level: number; jobId: string } | null;
  screen: string;
  packVersion: string;
  imageCount: number;
  now: Date;
}) {
  const url = input.url.trim();
  return {
    format: "mcc-field-note",
    version: 1,
    createdAt: input.now.toISOString(),
    text: input.text.trim(),
    sourceUrl: url || null,
    meowdb: url ? parseMeowdbUrl(url) : null,
    character: input.character,
    screen: input.screen,
    packVersion: input.packVersion,
    imageCount: input.imageCount,
  };
}

const MAX_IMAGES = 8;

export function QuickNoteDialog() {
  const { open, setOpen } = useQuickNote();
  const platform = usePlatform();
  const rules = useRules();
  const route = useRoute();
  const character = useActiveProfile();
  const [images, setImages] = useState<{ bytes: Uint8Array; url: string }[]>([]);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setText("");
    setUrl("");
  };

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        // Large enough to keep in-game text legible.
        const bytes = await toWebp(f, 1920);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, { bytes, url: bytesToObjectUrl(bytes) }]));
      } catch (err) {
        toast({ message: `Couldn't add that picture: ${String(err)}`, tone: "error" });
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    // Capture phase so a pasted picture goes to the note, not to a screenshot picker underneath.
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste, { capture: true });
    return () => window.removeEventListener("paste", onPaste, { capture: true });
  }, [open]);

  const meow = url.trim() ? parseMeowdbUrl(url) : null;
  const canSave = !busy && (text.trim().length > 0 || images.length > 0);

  const save = async () => {
    setBusy(true);
    try {
      const note = buildNote({
        text,
        url,
        character: character ? { name: character.name, level: character.level, jobId: character.jobId } : null,
        screen: route,
        packVersion: rules.packVersion,
        imageCount: images.length,
        now: new Date(),
      });
      const id = await platform.fieldNoteCreate(JSON.stringify(note, null, 2));
      for (const img of images) await platform.fieldNoteAddImage(id, img.bytes);
      reset();
      setOpen(false);
      toast({ message: "Note saved", action: { label: "Open folder", onClick: () => void platform.revealFolder("field-notes") } });
    } catch (err) {
      toast({ message: `Couldn't save the note: ${String(err)}`, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Quick note"
      description="Paste screenshots (Ctrl+V), type what you saw, or paste text from a page you're reading. It's saved for the guide data."
      wide
    >
      <div className="space-y-4">
        <div
          className="flex min-h-24 flex-wrap gap-2 rounded-xl border-2 border-dashed border-hairline bg-field p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(imageFiles(e.dataTransfer));
          }}
        >
          {images.map((img, i) => (
            <div key={img.url} className="relative">
              <img src={img.url} alt={`Note picture ${i + 1}`} className="h-24 rounded-lg object-cover" />
              <button
                type="button"
                aria-label={`Remove picture ${i + 1}`}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                onClick={() => {
                  URL.revokeObjectURL(img.url);
                  setImages(images.filter((x) => x !== img));
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <button
              type="button"
              className="flex h-24 min-w-40 flex-1 items-center justify-center rounded-lg text-sm text-ink-3 hover:bg-fill"
              onClick={() => fileInput.current?.click()}
            >
              {images.length ? "+ add another" : "Paste, drop or click to add screenshots"}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            aria-label="Add note pictures"
            onChange={(e) => {
              void addFiles(Array.from(e.currentTarget.files ?? []));
              e.currentTarget.value = "";
            }}
          />
        </div>

        <Field label="What did you see?" hint='e.g. "Blue Mushroom Lv 19, 35 EXP, in The Blue Mushroom Forest, dropped Blue Mushroom Cap"'>
          {(id) => (
            <textarea id={id} className={`${inputClass} min-h-28`} value={text} maxLength={20000} onChange={(e) => setText(e.currentTarget.value)} />
          )}
        </Field>

        <Field
          label="Source link (optional)"
          hint={meow ? `✓ MeowDB ${meow.kind} #${meow.id} recognised — the guide can link to it exactly.` : "Paste the page address if you copied this from a website."}
        >
          {(id) => <input id={id} className={inputClass} value={url} placeholder="https://…" onChange={(e) => setUrl(e.currentTarget.value)} />}
        </Field>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-3">
            {character ? `Tagged with ${character.name} (Lv ${character.level}).` : "No character selected."} Notes stay on this PC.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>
              {busy ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
