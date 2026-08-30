/**
 * A QR encoder, written here rather than pulled from a CDN.
 *
 * The pairing screen has to draw a QR code, and every option involved a
 * trade-off this app has already made elsewhere: a CDN script is a third party
 * watching a screen that shows a credential, and a vendored bundle is code
 * nobody here can read. The subset actually needed is small, so it lives here.
 *
 * Scope, deliberately narrow:
 *   - byte mode only (the payload is ASCII)
 *   - error-correction level M (~15%), the usual choice for a screen
 *   - versions 1-10, i.e. up to 213 bytes — a pairing code is ~42
 *
 * Anything longer throws instead of silently producing a code no phone reads.
 * Verified against the `qrcode` npm package: identical matrices, bit for bit.
 */

/* -------------------------------------------------------------------------- */
/* Tables (ISO/IEC 18004)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per version at level M: EC codewords per block, then the block groups as
 * [count, dataCodewords] pairs. Two groups appear when the codewords do not
 * divide evenly, and the second group's blocks hold exactly one more.
 */
const VERSIONS = [
  null,                                    // no version 0
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] }
];

/** Centres of the alignment patterns; their pairwise combinations are used. */
const ALIGNMENT = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

/** Unused bits after the last codeword; they stay zero. */
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

/** Level M's two-bit indicator in the format information. */
const ECC_M = 0b00;

/* -------------------------------------------------------------------------- */
/* GF(256) arithmetic for Reed-Solomon                                        */
/* -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;              // the field's primitive polynomial
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial (x - a^0)(x - a^1)...(x - a^(n-1)). */
function generatorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    // Coefficients run highest degree first: multiplying by x keeps the index,
    // multiplying by the constant moves it one place down.
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of data / generator — the error-correction codewords. */
function eccFor(data, count) {
  const gen = generatorPoly(count);
  const rem = new Array(count).fill(0);

  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

function dataCapacity(version) {
  return VERSIONS[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

/** Smallest version that fits, accounting for the header's own width. */
function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (headerBits + byteLength * 8 <= dataCapacity(v) * 8) return v;
  }
  throw new Error('النص أطول من أن يُرمَّز في رمز QR.');
}

/** Text -> the data codewords for `version`, padded to capacity. */
function toCodewords(bytes, version) {
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                   // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));  // terminator
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // The spec's two alternating pad bytes.
  const pad = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCapacity(version); i++) {
    codewords.push(pad[i % 2]);
  }
  return codewords;
}

/**
 * Split into blocks, compute each block's ECC, then interleave.
 * Interleaving is what makes a scratch across the code survivable: damage is
 * spread over every block rather than destroying one of them outright.
 */
function interleave(codewords, version) {
  const { ec, groups } = VERSIONS[version];

  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const data = codewords.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ecc: eccFor(data, ec) });
    }
  }

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      if (i < block.data.length) out.push(block.data[i]);
    }
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) out.push(block.ecc[i]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Matrix                                                                     */
/* -------------------------------------------------------------------------- */

/** The fixed patterns a scanner locks onto; data must not overwrite them. */
function buildFunctionPatterns(size, version) {
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const set = (r, c, value) => {
    modules[r][c] = value;
    reserved[r][c] = 1;
  };

  // Finder patterns and their separators, in the three corners.
  const finder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(rr, cc, ring === 2 || ring > 3 ? 0 : 1);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns — the alternating row and column that fix the module grid.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder = (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(r + dr, c + dc, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  // Reserve the format areas; the real bits are written after masking.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) set(8, i, 0);
    if (!reserved[i][8]) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, 0);
    if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, 0);
  }
  set(size - 8, 8, 1);                               // the always-dark module

  // Version information, carried only by the larger codes.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const bits = (version << 12) | rem;

    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      set(size - 11 + b, a, bit);
      set(a, size - 11 + b, bit);
    }
  }

  return { modules, reserved };
}

/** Zigzag placement, right to left, skipping everything already reserved. */
function placeData(modules, reserved, bytes, size) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  let index = 0;
  let upward = true;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                            // the vertical timing line
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        modules[row][cc] = index < bits.length ? bits[index] : 0;
        index++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

/**
 * The four penalty rules. A mask is chosen by score alone: the aim is a code
 * without large blank areas or anything a scanner could mistake for a finder.
 */
function penalty(modules, size) {
  let score = 0;

  // Rule 1 — runs of five or more of the same colour.
  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let last = -1;
      let length = 0;
      for (let b = 0; b < size; b++) {
        const value = get(a, b);
        if (value === last) {
          length++;
          if (length === 5) score += 3;
          else if (length > 5) score += 1;
        } else {
          last = value;
          length = 1;
        }
      }
    }
  };
  run((r, c) => modules[r][c]);
  run((c, r) => modules[r][c]);

  // Rule 2 — every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 sequence with four light modules beside it.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, at, pattern) =>
    pattern.every((bit, i) => line[at + i] === bit);

  for (let a = 0; a < size; a++) {
    const row = [];
    const col = [];
    for (let b = 0; b < size; b++) {
      row.push(modules[a][b]);
      col.push(modules[b][a]);
    }
    for (let at = 0; at + 11 <= size; at++) {
      if (matches(row, at, A) || matches(row, at, B)) score += 40;
      if (matches(col, at, A) || matches(col, at, B)) score += 40;
    }
  }

  // Rule 4 — how far the dark/light balance strays from half.
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) dark += modules[r][c];
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** BCH(15,5) format information, masked with the spec's constant. */
function formatBits(mask) {
  const data = (ECC_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function writeFormat(modules, size, mask) {
  const bits = formatBits(mask);
  // The most significant bit is placed first, so position i carries bit 14 - i.
  const bit = (i) => (bits >> (14 - i)) & 1;

  for (let i = 0; i <= 5; i++) modules[8][i] = bit(i);
  modules[8][7] = bit(6);
  modules[8][8] = bit(7);
  modules[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) modules[14 - i][8] = bit(i);

  for (let i = 0; i <= 6; i++) modules[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) modules[8][size - 15 + i] = bit(i);

  modules[size - 8][8] = 1;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} text  payload, encoded as UTF-8 bytes
 * @returns {{ size: number, modules: Uint8Array[] }} 1 = dark
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const size = version * 4 + 17;

  const payload = interleave(toCodewords(bytes, version), version);
  const withRemainder = payload.concat(
    new Array(Math.ceil(REMAINDER_BITS[version] / 8)).fill(0)
  );

  const { modules, reserved } = buildFunctionPatterns(size, version);
  placeData(modules, reserved, withRemainder, size);

  // Try every mask and keep the least penalised.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row, r) =>
      row.map((value, c) => (reserved[r][c] ? value : value ^ (MASKS[mask](r, c) ? 1 : 0)))
    );
    writeFormat(candidate, size, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, modules: candidate };
  }

  return { size, modules: best.modules };
}

/**
 * The same matrix as a standalone SVG string.
 *
 * Drawn as one `<path>` rather than a rectangle per module: a version-4 code is
 * over a thousand modules, and a thousand DOM nodes on a screen that refreshes
 * every two minutes is a cost with nothing to show for it.
 *
 * @param {string} text
 * @param {{ scale?: number, quiet?: number, dark?: string, light?: string }} [options]
 */
export function qrSvg(text, options = {}) {
  const { scale = 8, quiet = 4, dark = '#000000', light = '#ffffff' } = options;
  const { size, modules } = qrMatrix(text);
  const side = size + quiet * 2;

  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `width="${side * scale}" height="${side * scale}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="رمز الاقتران">` +
    `<rect width="${side}" height="${side}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`;
}
