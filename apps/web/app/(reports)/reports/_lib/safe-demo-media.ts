import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

type CuratedMedia = Readonly<{
  artifactId: string;
  module: "building";
  reportVersionId: "report_demo_v2";
  bytes: Uint8Array;
  contentHash: string;
}>;

const WIDTH = 320;
const HEIGHT = 180;

export function curatedDemoMedia(artifactId: string): CuratedMedia | null {
  if (
    artifactId !== "media_bathroom_context" &&
    artifactId !== "media_tile_annotation"
  ) {
    return null;
  }
  const bytes = renderSafeTileProxy(artifactId === "media_tile_annotation");
  return {
    artifactId,
    module: "building",
    reportVersionId: "report_demo_v2",
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function renderSafeTileProxy(annotated: boolean): Uint8Array {
  const stride = WIDTH * 3 + 1;
  const pixels = Buffer.alloc(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * stride;
    pixels[row] = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const index = row + 1 + x * 3;
      const grout = x % 80 < 4 || y % 60 < 4;
      const crack = Math.abs(y - (72 + Math.sin(x / 18) * 18)) < 2;
      const annotation =
        annotated &&
        x > 52 &&
        x < 270 &&
        y > 44 &&
        y < 132 &&
        (x < 58 || x > 264 || y < 50 || y > 126);
      const colour = annotation
        ? ([125, 34, 54] as const)
        : crack
          ? ([63, 69, 67] as const)
          : grout
            ? ([176, 181, 178] as const)
            : ([222, 225, 221] as const);
      pixels[index] = colour[0];
      pixels[index + 1] = colour[1];
      pixels[index + 2] = colour[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk(
      "IHDR",
      (() => {
        const data = Buffer.alloc(13);
        data.writeUInt32BE(WIDTH, 0);
        data.writeUInt32BE(HEIGHT, 4);
        data[8] = 8;
        data[9] = 2;
        return data;
      })(),
    ),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
