/**
 * Minimal `ar rcs` in JS (there is no avr-ar.wasm): a GNU/SysV archive with a
 * symbol index ("/" member) built from each ELF32 object's global/weak defined
 * symbols, so avr-ld.wasm pulls members on demand exactly like with a real core.a.
 *
 * Port of the feasibility spike's toolchain/lib/ar.mjs (logic unchanged).
 */
const enc = new TextEncoder();

/** Names of the defined GLOBAL/WEAK symbols of an ELF32 relocatable object. */
export function definedSymbols(obj: Uint8Array): string[] {
  const dv = new DataView(obj.buffer, obj.byteOffset, obj.byteLength);
  const shoff = dv.getUint32(0x20, true);
  const shentsize = dv.getUint16(0x2e, true);
  const shnum = dv.getUint16(0x30, true);
  const sh = (i: number) => {
    const b = shoff + i * shentsize;
    return {
      type: dv.getUint32(b + 4, true),
      offset: dv.getUint32(b + 16, true),
      size: dv.getUint32(b + 20, true),
      link: dv.getUint32(b + 24, true),
      entsize: dv.getUint32(b + 36, true),
    };
  };
  const out: string[] = [];
  for (let i = 0; i < shnum; i++) {
    const s = sh(i);
    if (s.type !== 2) continue; // SHT_SYMTAB
    const str = sh(s.link);
    for (let o = s.offset + s.entsize; o < s.offset + s.size; o += s.entsize) {
      const name = dv.getUint32(o, true);
      const info = obj[o + 12];
      const shndx = dv.getUint16(o + 14, true);
      const bind = info >> 4;
      if ((bind === 1 || bind === 2) && shndx !== 0) {
        // GLOBAL/WEAK, defined (incl. COMMON)
        let n = '';
        for (let k = str.offset + name; obj[k]; k++) n += String.fromCharCode(obj[k]);
        out.push(n);
      }
    }
  }
  return out;
}

const pad = (s: string, n: number): string => (s + ' '.repeat(n)).slice(0, n);

function header(name: string, size: number): Uint8Array {
  return enc.encode(pad(name, 16) + pad('0', 12) + pad('0', 6) + pad('0', 6) + pad('644', 8) + pad(String(size), 10) + '`\n');
}

/** Build an `ar` archive from [name, object bytes] members (names of at most 15 characters). */
export function createArchive(members: [string, Uint8Array][]): Uint8Array {
  const syms = members.map(([, d]) => definedSymbols(d));
  const strBytes = enc.encode(
    syms
      .flat()
      .map((s) => s + '\0')
      .join(''),
  );
  const nsyms = syms.flat().length;
  const symSize = 4 + 4 * nsyms + strBytes.length;
  const symPadded = symSize + (symSize & 1);
  let off = 8 + 60 + symPadded;
  const offsets = members.map(([, d]) => {
    const o = off;
    off += 60 + d.length + (d.length & 1);
    return o;
  });
  const out = new Uint8Array(off);
  let p = 0;
  const put = (b: Uint8Array) => {
    out.set(b, p);
    p += b.length;
  };
  put(enc.encode('!<arch>\n'));
  put(header('/', symSize));
  const dv = new DataView(out.buffer);
  dv.setUint32(p, nsyms);
  p += 4;
  syms.forEach((list, i) => {
    for (let k = 0; k < list.length; k++) {
      dv.setUint32(p, offsets[i]);
      p += 4;
    }
  });
  put(strBytes);
  if (symSize & 1) put(enc.encode('\n'));
  members.forEach(([name, d]) => {
    put(header(name + '/', d.length));
    put(d);
    if (d.length & 1) put(enc.encode('\n'));
  });
  return out;
}
