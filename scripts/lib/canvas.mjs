// Shared pixel canvas, PNG encoder and colour helpers used by every mascot's placeholder art.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

/** @typedef {number[]} Rgba */

export class Canvas {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Record<string, Rgba>} [palette]
   */
  constructor(width, height, palette = {}) {
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.data = new Uint8Array(width * height * 4);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {Rgba} rgba
   */
  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(rgba, (y * this.width + x) * 4);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Rgba}
   */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    return Array.from(this.data.subarray(i, i + 4));
  }

  /**
   * @param {Canvas} source
   * @param {number} dx
   * @param {number} dy
   * @param {number} [scale]
   */
  blit(source, dx, dy, scale = 1) {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const px = source.get(x, y);
        if (px[3] === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            this.set(dx + x * scale + sx, dy + y * scale + sy, px);
          }
        }
      }
    }
  }
}

/**
 * @param {Canvas} source
 * @param {number} scale
 */
export function upscale(source, scale) {
  const out = new Canvas(source.width * scale, source.height * scale);
  out.blit(source, 0, 0, scale);
  return out;
}

/**
 * Recolours a palette for a mood: greyscale toward `saturation`, then scale by `brightness`.
 * Keys in `skip` (typically eye and highlight whites) pass through unchanged.
 * @param {Record<string, Rgba>} palette
 * @param {number} brightness
 * @param {number} saturation
 * @param {string[]} [skip]
 * @returns {Record<string, Rgba>}
 */
export function tintPalette(palette, brightness, saturation, skip = []) {
  /** @type {Record<string, Rgba>} */
  const out = {};
  for (const [name, [r, g, b, a]] of Object.entries(palette)) {
    if (skip.includes(name)) {
      out[name] = [r, g, b, a];
      continue;
    }
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const channel = (/** @type {number} */ c) =>
      Math.max(0, Math.min(255, Math.round((grey + (c - grey) * saturation) * brightness)));
    out[name] = [channel(r), channel(g), channel(b), a];
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Canvas} canvas */
export function encodePng(canvas) {
  const { width, height, data } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
