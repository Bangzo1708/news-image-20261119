// news-image-20261119 — "19 November 2026: The World in One Day"
//
// The entry image lives in this repository as entry.png (a JPEG file kept
// under the .png name the competition requires). This program copies it to
// the grader's output directory and then re-reads what it wrote, refusing
// to finish unless the copy is byte-for-byte identical, the right size, the
// right dimensions, and a whole image file. No network, no randomness, no
// image library: every check below is done by hand on the raw bytes, so the
// two graded runs can only ever produce the same file.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The competition's hard limits for the image (see competition.yaml).
const MAX_BYTES = 1048576; // 1 MiB
const WANT_WIDTH = 1024;
const WANT_HEIGHT = 1024;

function fail(message) {
  console.error(`main.ts: FAIL — ${message}`);
  process.exit(1);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Walk a JPEG's markers until a Start Of Frame segment tells us the size.
// Returns { width, height } or null when no SOF segment is found.
function jpegDimensions(bytes) {
  // A JPEG always opens with SOI (FF D8); the next two bytes are a marker.
  let pos = 2;
  while (pos + 9 < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    // Standalone markers carry no length field, so skip past them.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(pos + 2);
    if (segmentLength < 2 || pos + 2 + segmentLength > bytes.length) return null;
    // SOF0..SOF15 except the markers reserved for other uses (C4, C8, CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = bytes.readUInt16BE(pos + 5);
      const width = bytes.readUInt16BE(pos + 7);
      return { width, height };
    }
    // SOS (start of scan) means the compressed data follows; no SOF after it.
    if (marker === 0xda) return null;
    pos += 2 + segmentLength;
  }
  return null;
}

// Read width/height out of a PNG's IHDR chunk (bytes 16..24 of the file).
function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Confirm the file is a whole image: a PNG must close with its IEND chunk,
// a JPEG must close with its EOI marker (FF D9). Anything else is refused.
function hasProperEnding(bytes, kind) {
  if (kind === 'png') {
    const tail = bytes.subarray(bytes.length - 12);
    return tail.readUInt32BE(0) === 0 && tail.toString('latin1', 4, 8) === 'IEND';
  }
  return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(here, 'entry.png');
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const destPath = join(outDir, 'entry.png');

  let source;
  try {
    source = readFileSync(sourcePath);
  } catch (err) {
    fail(`cannot read ${sourcePath} (${err.code ?? err.message})`);
  }
  const sourceHash = sha256Hex(source);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(destPath, source);

  // --- Verify the copy we just wrote, from disk, not from memory. ---
  const written = readFileSync(destPath);
  if (written.length !== source.length) {
    fail(`output is ${written.length} bytes, entry.png is ${source.length} bytes`);
  }
  if (!written.equals(source)) fail('output differs from entry.png byte for byte');
  if (sha256Hex(written) !== sourceHash) fail('SHA-256 of output does not match entry.png');

  if (written.length > MAX_BYTES) {
    fail(`output is ${written.length} bytes, over the ${MAX_BYTES}-byte limit`);
  }

  const isPng = written.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = written[0] === 0xff && written[1] === 0xd8 && written[2] === 0xff;
  if (!isPng && !isJpeg) fail('output is neither a PNG nor a JPEG (bad magic bytes)');

  const kind = isPng ? 'png' : 'jpeg';
  const dims = kind === 'png' ? pngDimensions(written) : jpegDimensions(written);
  if (dims === null) fail(`could not parse ${kind.toUpperCase()} dimensions from the output header`);
  if (dims.width !== WANT_WIDTH || dims.height !== WANT_HEIGHT) {
    fail(`output is ${dims.width}x${dims.height}, expected exactly ${WANT_WIDTH}x${WANT_HEIGHT}`);
  }

  if (!hasProperEnding(written, kind)) {
    fail(`output is a truncated ${kind.toUpperCase()} (missing end marker)`);
  }

  console.log(
    `main.ts: OK — entry.png (${kind.toUpperCase()}, ${dims.width}x${dims.height}, ` +
    `${written.length} bytes, sha256 ${sourceHash.slice(0, 16)}…) copied to ${destPath}`,
  );
}

main();
