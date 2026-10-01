#!/usr/bin/env node
// Release gate for a toolchain build (the "verify" job of the avr-toolchain-wasm
// workflow): every shipped tool must load AND do its job. A small C++ file and a
// small C file each go cc1plus / cc1 -> avr-as -> avr-ld -> avr-objcopy the way
// the site's worker runs the tools (one module per run, MEMFS, callMain), and
// each must end as an Intel HEX file. Exits 1 on the first failure.
//
//   node test/smoke.mjs <dir with cc1plus.mjs/.wasm, cc1, avr-as, avr-ld, avr-objcopy>
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? ".");
// what the site passes to the compilers and the assembler (bundle manifest "target" / "asArgs")
const TARGET = ["-mn-flash=1", "-mno-skip-bug", "-mmcu=avr5"];
const AS_ARGS = ["-mmcu=avr5", "-mno-skip-bug"];

async function run(tool, args, inputs, output) {
  const factory = (await import(pathToFileURL(`${dir}/${tool}.mjs`).href)).default;
  let stderr = "";
  const m = await factory({ noInitialRun: true, print: () => {}, printErr: (s) => { stderr += `${s}\n`; } });
  for (const [path, data] of Object.entries(inputs)) m.FS.writeFile(path, data);
  let status;
  try {
    status = m.callMain([...args]); // callMain() puts argv[0] in front of the array it is given
  } catch (e) {
    if (typeof e?.status !== "number") throw e;
    status = e.status;
  }
  if (status !== 0) throw new Error(`${tool} ${args.join(" ")} exited with ${status}\n${stderr}`);
  return m.FS.readFile(output);
}

async function pipeline(compiler, file, source) {
  const s = new TextDecoder().decode(await run(compiler, ["-quiet", `/${file}`, ...TARGET, "-Os", "-o", "/t.s"], { [`/${file}`]: source }, "/t.s"));
  if (!/^twice:/m.test(s)) throw new Error(`${compiler}: no 'twice:' label in the assembly\n${s}`);
  const o = await run("avr-as", [...AS_ARGS, "-o", "/t.o", "/t.s"], { "/t.s": s }, "/t.o");
  // the site gives ld the bundle's ldscripts/; a one-line script is enough to prove ld links
  const elf = await run("avr-ld", ["-mavr5", "-T", "/t.ld", "-e", "twice", "-o", "/t.elf", "/t.o"], { "/t.o": o, "/t.ld": "SECTIONS { .text 0 : { *(.text*) } }\n" }, "/t.elf");
  const hex = new TextDecoder().decode(await run("avr-objcopy", ["-O", "ihex", "-R", ".eeprom", "/t.elf", "/t.hex"], { "/t.elf": elf }, "/t.hex"));
  if (!/^:[0-9A-F]+\r?\n/.test(hex) || !hex.trimEnd().endsWith(":00000001FF")) throw new Error(`${compiler}: not an Intel HEX file\n${hex}`);
  console.log(`ok  ${compiler} -> avr-as -> avr-ld -> avr-objcopy: ${s.length} B of assembly, ${hex.trim().split("\n").length} HEX lines`);
}

try {
  await pipeline("cc1plus", "t.cpp", 'extern "C" int twice(int x) { return 2 * x; }\n');
  await pipeline("cc1", "t.c", "int twice(int x) { return 2 * x; }\n");
} catch (e) {
  console.error(`smoke test FAILED: ${e.message}`);
  process.exit(1);
}
