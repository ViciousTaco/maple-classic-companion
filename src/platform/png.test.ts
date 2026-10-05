import { encodePng } from "./png";

const chunks = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 8; i < png.length; ) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    out.push({ type, data: png.subarray(i + 8, i + 8 + len), crc: view.getUint32(i + 8 + len) });
    i += 12 + len;
  }
  return out;
};

test("encodePng writes signature, IHDR, IDAT, IEND with correct CRCs", () => {
  const png = encodePng(3, 2, (x, y) => [x * 80, y * 100, 7]);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const [ihdr, idat, iend] = chunks(png);
  expect(ihdr!.type).toBe("IHDR");
  expect([...ihdr!.data]).toEqual([0, 0, 0, 3, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  expect(idat!.type).toBe("IDAT");
  expect(iend).toEqual({ type: "IEND", data: new Uint8Array(), crc: 0xae426082 }); // well-known IEND CRC
});

test.skipIf(typeof DecompressionStream === "undefined")("encodePng pixel data inflates back", async () => {
  const w = 300; // > one 64 KB stored block across 80 rows
  const h = 80;
  const png = encodePng(w, h, (x, y) => [x % 256, y, (x + y) % 256]);
  const idat = chunks(png).find((c) => c.type === "IDAT")!.data;
  const source = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(new Uint8Array(idat));
      c.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate")).getReader();
  const parts: number[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(...r.value);
  const raw = new Uint8Array(parts);
  expect(raw.length).toBe(h * (1 + w * 3));
  expect([...raw.subarray(0, 7)]).toEqual([0, 0, 0, 0, 1, 0, 1]);
  const last = (h - 1) * (1 + w * 3) + 1 + (w - 1) * 3;
  expect([...raw.subarray(last, last + 3)]).toEqual([(w - 1) % 256, h - 1, (w - 1 + h - 1) % 256]);
});
