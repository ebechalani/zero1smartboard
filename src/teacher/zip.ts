/**
 * A store-only zip writer for the dashboard's downloads (docs/CLASSROOM.md §4.13): no
 * compression (the sketches are small and gzip would need a dependency), CRC-32 per entry,
 * UTF-8 file names (general purpose flag bit 11), DOS date/time from each entry's date.
 * Pure: no DOM beyond Blob.
 */

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
  date?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, as zip uses it) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The zip (MS-DOS) date and time fields of `date` in local time; 1980 at the earliest. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

class ByteWriter {
  readonly parts: Uint8Array[] = [];
  length = 0;

  u16(value: number): void {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value & 0xffff, true);
    this.push(bytes);
  }
  u32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.push(bytes);
  }
  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }
  blob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
}

/**
 * The entries as one zip file (store method). Names are used as given: the caller makes them
 * unique. An empty list gives an empty (but valid) archive.
 */
export function makeZip(files: readonly ZipEntry[]): Blob {
  const out = new ByteWriter();
  const central = new ByteWriter();
  let count = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = toBytes(file.data);
    const crc = crc32(data);
    const { time, date } = dosDateTime(file.date ?? new Date());
    const offset = out.length;
    // Local file header.
    out.u32(0x04034b50);
    out.u16(20); // version needed: 2.0
    out.u16(0x0800); // flags: UTF-8 names
    out.u16(0); // method: store
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(data.length);
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // extra length
    out.push(name);
    out.push(data);
    // Central directory entry.
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20);
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attributes
    central.u32(0); // external attributes
    central.u32(offset);
    central.push(name);
    count++;
  }
  const centralOffset = out.length;
  const centralSize = central.length;
  for (const part of central.parts) out.push(part);
  // End of central directory.
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(count);
  out.u16(count);
  out.u32(centralSize);
  out.u32(centralOffset);
  out.u16(0);
  return out.blob('application/zip');
}

/**
 * `name` made unique among `taken` by appending `-2`, `-3`, … before the extension; the chosen
 * name is added to `taken`.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
