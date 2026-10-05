import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { bytesToDataUrl, canvasToWebp, firstImageFile } from "../../lib/image";
import { Button } from "../../ui/kit";
import { Dialog, toast } from "../../ui/overlays";

// Portrait 3:4 crop (plan §9.3). Display frame and output size.
const FRAME_W = 270;
const FRAME_H = 360;
const OUT_W = 384;
const OUT_H = 512;

type Crop = { zoom: number; dx: number; dy: number };

function clampCrop(c: Crop, imgW: number, imgH: number): Crop {
  const base = Math.max(FRAME_W / imgW, FRAME_H / imgH);
  const w = imgW * base * c.zoom;
  const h = imgH * base * c.zoom;
  const maxX = (w - FRAME_W) / 2;
  const maxY = (h - FRAME_H) / 2;
  return { zoom: c.zoom, dx: Math.max(-maxX, Math.min(maxX, c.dx)), dy: Math.max(-maxY, Math.min(maxY, c.dy)) };
}

export function CropDialog({
  file,
  onCancel,
  onDone,
}: {
  file: File | null;
  onCancel: () => void;
  onDone: (bytes: Uint8Array) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, dx: 0, dy: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; start: Crop } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setCrop({ zoom: 1, dx: 0, dy: 0 });
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight) : 1;
  const scale = base * crop.zoom;

  const onPointerDown = (e: RPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: crop };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || !img) return;
    setCrop(clampCrop({ ...d.start, dx: d.start.dx + e.clientX - d.x, dy: d.start.dy + e.clientY - d.y }, img.naturalWidth, img.naturalHeight));
  };

  const finish = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d")!;
      const k = OUT_W / FRAME_W;
      const w = img.naturalWidth * scale * k;
      const h = img.naturalHeight * scale * k;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, OUT_W / 2 - w / 2 + crop.dx * k, OUT_H / 2 - h / 2 + crop.dy * k, w, h);
      onDone(await canvasToWebp(canvas));
    } catch (err) {
      toast({ message: `Couldn't use that image: ${String(err)}`, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onCancel()} title="Crop your screenshot" description="Drag to move · use the slider to zoom">
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative cursor-grab touch-none overflow-hidden rounded-xl bg-black active:cursor-grabbing"
          style={{ width: FRAME_W, height: FRAME_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
        >
          {img && (
            <img
              src={img.src}
              alt="Screenshot being cropped"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(calc(-50% + ${crop.dx}px), calc(-50% + ${crop.dy}px))`,
              }}
            />
          )}
        </div>
        <label className="flex w-full max-w-xs items-center gap-3 text-sm">
          Zoom
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={crop.zoom}
            className="flex-1 accent-[var(--maple)]"
            onChange={(e) => img && setCrop(clampCrop({ ...crop, zoom: Number(e.currentTarget.value) }, img.naturalWidth, img.naturalHeight))}
          />
        </label>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={finish} disabled={!img || busy}>
            {busy ? "Saving…" : "Use this"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Character portrait: paste (Ctrl+V anywhere while mounted), drag-drop or file pick → crop → `onBytes`.
 * `bytes` is the current image (null = none).
 */
export function ScreenshotPicker({
  bytes,
  onBytes,
  onRemove,
}: {
  bytes: Uint8Array | null;
  onBytes: (bytes: Uint8Array) => void | Promise<void>;
  onRemove?: () => void;
}) {
  const [pending, setPending] = useState<File | null>(null);
  const url = useMemo(() => (bytes ? bytesToDataUrl(bytes) : null), [bytes]);
  const fileInput = useRef<HTMLInputElement>(null);

  const accept = useCallback((f: File | null) => {
    if (f) setPending(f);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = firstImageFile(e.clipboardData);
      if (f) {
        e.preventDefault();
        accept(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  return (
    <div className="flex w-48 flex-col items-start gap-3">
      <div
        className="flex h-60 w-48 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-hairline bg-field"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          accept(firstImageFile(e.dataTransfer));
        }}
      >
        {url ? (
          <img src={url} alt="Character screenshot" className="h-full w-full object-cover" />
        ) : (
          <span className="p-2 text-center text-xs text-ink-3">Paste or drop a picture</span>
        )}
      </div>
      <div className="space-y-2 text-xs">
        <p className="text-ink-2">
          Press <kbd className="rounded border bg-field px-1">Win</kbd>+<kbd className="rounded border bg-field px-1">Shift</kbd>+
          <kbd className="rounded border bg-field px-1">S</kbd> in game, then <kbd className="rounded border bg-field px-1">Ctrl</kbd>+
          <kbd className="rounded border bg-field px-1">V</kbd> here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            {url ? "Replace…" : "Choose file…"}
          </Button>
          {url && onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          className="hidden"
          aria-label="Choose screenshot file"
          onChange={(e) => {
            accept(e.currentTarget.files?.[0] ?? null);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <CropDialog
        file={pending}
        onCancel={() => setPending(null)}
        onDone={async (b) => {
          setPending(null);
          await onBytes(b);
        }}
      />
    </div>
  );
}
