export const MAX_IMAGE_BYTES = 400 * 1024;

/** First image in a paste or drop, if any (plan §9.3). */
export function firstImageFile(data: DataTransfer | null): File | null {
  return imageFiles(data)[0] ?? null;
}

/** All images in a paste or drop. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  if (out.length === 0) {
    for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  }
  return out;
}

/** Encodes WebP under `maxBytes`, lowering quality as needed. */
export async function canvasToWebp(canvas: HTMLCanvasElement, maxBytes = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= maxBytes) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error("Couldn't make the image small enough");
}

/** Downscales to `maxEdge` px on the long edge (keeping aspect ratio) and encodes WebP under `maxBytes`. */
export async function toWebp(source: Blob, maxEdge = 512, maxBytes = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  const bmp = await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvasToWebp(canvas, maxBytes);
}

export function bytesToObjectUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart]));
}

/** Mime type from magic bytes (WebP / PNG / JPEG), defaulting to WebP. */
export function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return "image/webp";
}

/** A data: URL needs no revoking, so it can be derived during render. */
export function bytesToDataUrl(bytes: Uint8Array): string {
  return `data:${imageMime(bytes)};base64,${bytesToBase64(bytes)}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
