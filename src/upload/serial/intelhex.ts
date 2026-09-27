/**
 * Intel HEX parser (the format avr-objcopy / arduino-cli produce for AVR sketches).
 *
 * Supported record types:
 *   00 data, 01 end-of-file, 02 extended segment address, 03 start segment address,
 *   04 extended linear address, 05 start linear address.
 * Every record's checksum is verified (two's complement of the byte sum, so the sum of
 * all bytes of a record including the checksum must be 0 mod 256).
 *
 * No dependencies, works in the browser and in Node.
 */

export type HexErrorCode = 'HEX_CHECKSUM' | 'HEX_PARSE';

export class HexParseError extends Error {
  readonly code: HexErrorCode;
  /** 1-based line number in the .hex text, when known. */
  readonly line: number | undefined;
  constructor(code: HexErrorCode, message: string, line?: number) {
    super(line !== undefined ? `Intel HEX line ${line}: ${message}` : message);
    this.name = 'HexParseError';
    this.code = code;
    this.line = line;
  }
}

export interface HexSegment {
  /** Absolute byte address of data[0]. */
  address: number;
  data: Uint8Array;
}

export interface ParsedHex {
  /** Contiguous data blocks, sorted by address, adjacent records merged. */
  segments: HexSegment[];
  /** Lowest address that holds data (0 if the file has no data). */
  minAddress: number;
  /** One past the highest address that holds data (0 if the file has no data). */
  maxAddress: number;
  /** Number of data bytes in the file. */
  dataBytes: number;
  /** Start address from a type 03 (CS:IP → linear) or 05 record, if present. Informational only. */
  startAddress?: number;
  /** Number of records (lines) parsed, including the EOF record. */
  records: number;
}

const HEX_DIGITS = /^[0-9A-Fa-f]*$/;

/**
 * Parse Intel HEX text. Throws HexParseError on any malformed or corrupt record.
 * `maxAddress` bounds the addresses we accept (default 16 MiB) so a corrupt extended
 * address record cannot make us allocate a huge image later.
 */
export function parseIntelHex(text: string, opts: { maxAddress?: number } = {}): ParsedHex {
  const addrLimit = opts.maxAddress ?? 0x1000000;
  const lines = text.split(/\r\n|\r|\n/);
  // Collect bytes per absolute address (sparse), then build segments.
  const chunks: { address: number; data: Uint8Array; line: number }[] = [];
  let base = 0; // from record types 02/04
  let sawEof = false;
  let records = 0;
  let startAddress: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i].trim();
    if (raw === '') continue;
    if (sawEof) {
      // Data after the EOF record is ignored by avrdude too, but it usually means a
      // concatenated/corrupt file. Be strict: refuse it.
      throw new HexParseError('HEX_PARSE', 'data after the end-of-file record', lineNo);
    }
    if (raw[0] !== ':') {
      throw new HexParseError('HEX_PARSE', `record does not start with ':' (got ${JSON.stringify(raw.slice(0, 8))})`, lineNo);
    }
    const hex = raw.slice(1);
    if (!HEX_DIGITS.test(hex)) {
      throw new HexParseError('HEX_PARSE', 'record contains a non-hexadecimal character', lineNo);
    }
    if (hex.length < 10 || hex.length % 2 !== 0) {
      throw new HexParseError('HEX_PARSE', `record too short or odd length (${hex.length} hex digits)`, lineNo);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let j = 0; j < bytes.length; j++) bytes[j] = parseInt(hex.substr(j * 2, 2), 16);
    const count = bytes[0];
    if (bytes.length !== count + 5) {
      throw new HexParseError('HEX_PARSE', `byte count says ${count} data bytes but the record holds ${bytes.length - 5}`, lineNo);
    }
    let sum = 0;
    for (let j = 0; j < bytes.length; j++) sum = (sum + bytes[j]) & 0xff;
    if (sum !== 0) {
      const expected = (0x100 - ((sum - bytes[bytes.length - 1]) & 0xff)) & 0xff;
      throw new HexParseError(
        'HEX_CHECKSUM',
        `checksum error (record says 0x${hex2(bytes[bytes.length - 1])}, computed 0x${hex2(expected)}) — the file is corrupt`,
        lineNo,
      );
    }
    records++;
    const offset = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + count);
    switch (type) {
      case 0x00: {
        const address = base + offset;
        if (address + count > addrLimit) {
          throw new HexParseError('HEX_PARSE', `data at 0x${address.toString(16)} is beyond the address limit`, lineNo);
        }
        if (count > 0) chunks.push({ address, data: data.slice(), line: lineNo });
        break;
      }
      case 0x01:
        if (count !== 0) throw new HexParseError('HEX_PARSE', 'end-of-file record with data', lineNo);
        sawEof = true;
        break;
      case 0x02:
        if (count !== 2) throw new HexParseError('HEX_PARSE', 'extended segment address record must hold 2 bytes', lineNo);
        base = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x03:
        if (count !== 4) throw new HexParseError('HEX_PARSE', 'start segment address record must hold 4 bytes', lineNo);
        startAddress = (((data[0] << 8) | data[1]) << 4) + ((data[2] << 8) | data[3]);
        break;
      case 0x04:
        if (count !== 2) throw new HexParseError('HEX_PARSE', 'extended linear address record must hold 2 bytes', lineNo);
        base = ((data[0] << 8) | data[1]) * 0x10000;
        break;
      case 0x05:
        if (count !== 4) throw new HexParseError('HEX_PARSE', 'start linear address record must hold 4 bytes', lineNo);
        startAddress = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
        break;
      default:
        throw new HexParseError('HEX_PARSE', `unknown record type 0x${hex2(type)}`, lineNo);
    }
  }
  if (!sawEof) {
    throw new HexParseError('HEX_PARSE', 'no end-of-file record (:00000001FF) — the file is truncated');
  }

  // Merge chunks into sorted, contiguous segments; reject conflicting overlaps.
  chunks.sort((a, b) => a.address - b.address);
  const segments: HexSegment[] = [];
  let cur: { address: number; bytes: number[] } | null = null;
  let dataBytes = 0;
  for (const c of chunks) {
    if (cur && c.address < cur.address + cur.bytes.length) {
      // Overlap: allow only if identical.
      for (let k = 0; k < c.data.length; k++) {
        const a = c.address + k;
        const idx = a - cur.address;
        if (idx < cur.bytes.length) {
          if (cur.bytes[idx] !== c.data[k]) {
            throw new HexParseError('HEX_PARSE', `conflicting data for address 0x${a.toString(16)}`, c.line);
          }
        } else {
          cur.bytes.push(c.data[k]);
          dataBytes++;
        }
      }
      continue;
    }
    if (cur && c.address === cur.address + cur.bytes.length) {
      for (const b of c.data) cur.bytes.push(b);
      dataBytes += c.data.length;
      continue;
    }
    if (cur) segments.push({ address: cur.address, data: Uint8Array.from(cur.bytes) });
    cur = { address: c.address, bytes: Array.from(c.data) };
    dataBytes += c.data.length;
  }
  if (cur) segments.push({ address: cur.address, data: Uint8Array.from(cur.bytes) });

  const minAddress = segments.length ? segments[0].address : 0;
  const last = segments[segments.length - 1];
  const maxAddress = last ? last.address + last.data.length : 0;
  return { segments, minAddress, maxAddress, dataBytes, startAddress, records };
}

/**
 * Flatten parsed segments into a flash image starting at address 0, `size` bytes long,
 * unprogrammed bytes set to `fill` (0xFF = erased flash).
 */
export function hexToImage(hex: ParsedHex, size = hex.maxAddress, fill = 0xff): Uint8Array {
  const img = new Uint8Array(size).fill(fill);
  for (const s of hex.segments) {
    if (s.address + s.data.length > size) {
      throw new RangeError(`segment at 0x${s.address.toString(16)} does not fit in a ${size}-byte image`);
    }
    img.set(s.data, s.address);
  }
  return img;
}

/** Serialise bytes to Intel HEX (16 data bytes per record, type 04 records when crossing 64 KiB). Used by tests/fixtures. */
export function toIntelHex(data: Uint8Array, startAddress = 0, bytesPerRecord = 16): string {
  const out: string[] = [];
  let upper = -1;
  for (let off = 0; off < data.length; off += bytesPerRecord) {
    const addr = startAddress + off;
    const hi = addr >>> 16;
    if (hi !== upper) {
      upper = hi;
      out.push(record(0, 0x04, Uint8Array.of((hi >> 8) & 0xff, hi & 0xff)));
    }
    out.push(record(addr & 0xffff, 0x00, data.subarray(off, Math.min(off + bytesPerRecord, data.length))));
  }
  out.push(':00000001FF');
  return out.join('\n') + '\n';
}

function record(offset: number, type: number, data: Uint8Array): string {
  const bytes = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  bytes.push((0x100 - sum) & 0xff);
  return ':' + bytes.map(hex2).join('');
}

function hex2(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}
