#!/usr/bin/env node
// Drop-in check: run the feasibility spike's UNMODIFIED compile-wasm.mjs on every
// example sketch, once with the reference binaries (@horang-corp/avr-gcc-wasm
// 0.2.0, the spike's node_modules) and once with our rebuilt tools, and diff:
//   * exit status + stderr of the whole pipeline
//   * SHA-256 of the produced Intel HEX
//   * the cc1plus .s output, byte for byte
//   * optionally (--native) the spike's compare-native.mjs: our .s vs native
//     /usr/bin cc1plus (GCC 7.3.0) with identical arguments
//
//   node test/compare.mjs --ours <dir with cc1plus.mjs/.wasm avr-*.mjs/.wasm> \
//        [--spike <spike toolchain dir>] [--examples <dir>] [--out <dir>] [--native]
//
// The spike dir must contain compile-wasm.mjs, lib/, bundle/ and
// node_modules/@horang-corp/avr-gcc-wasm/tools/. We never modify it: a sandbox
// copy (compile-wasm.mjs + lib + bundle, tools/ symlinked to --ours) is created
// under --out, so the exact same driver code runs against both binary sets.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, symlinkSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = {
  spike: "/tmp/claude-0/-home-user-zero1smartboard/a626cbbf-0720-5913-a320-79bc9bcea22a/scratchpad/upload-spike/toolchain",
  examples: resolve(new URL("../../../src/examples", import.meta.url).pathname),
  out: resolve("compare-out"), native: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--ours") opt.ours = resolve(argv[++i]);
  else if (a === "--spike") opt.spike = resolve(argv[++i]);
  else if (a === "--examples") opt.examples = resolve(argv[++i]);
  else if (a === "--out") opt.out = resolve(argv[++i]);
  else if (a === "--native") opt.native = true;
  else { console.error("unknown arg", a); process.exit(2); }
}
if (!opt.ours) { console.error("--ours <dir> is required"); process.exit(2); }
const TOOLS = ["cc1plus", "avr-as", "avr-ld", "avr-objcopy"];
for (const t of TOOLS) for (const ext of [".mjs", ".wasm"]) if (!existsSync(join(opt.ours, t + ext))) { console.error("missing", join(opt.ours, t + ext)); process.exit(2); }

// sandbox with the spike's driver + our tools
const sandbox = join(opt.out, "sandbox");
rmSync(sandbox, { recursive: true, force: true });
mkdirSync(join(sandbox, "node_modules/@horang-corp/avr-gcc-wasm"), { recursive: true });
for (const f of ["compile-wasm.mjs", "lib", "bundle"]) cpSync(join(opt.spike, f), join(sandbox, f), { recursive: true });
symlinkSync(opt.ours, join(sandbox, "node_modules/@horang-corp/avr-gcc-wasm/tools"));

const sha = (b) => createHash("sha256").update(b).digest("hex");
const readOr = (p) => (existsSync(p) ? readFileSync(p) : null);
function build(driverDir, ino, keep) {
  rmSync(keep, { recursive: true, force: true });
  mkdirSync(keep, { recursive: true });
  const hex = join(keep, "..", keep.split("/").pop() + ".hex");   // <out>/<set>/<name>.hex, where compare-native.mjs expects it
  const r = spawnSync("node", [join(driverDir, "compile-wasm.mjs"), ino, hex, "--keep", keep], { encoding: "utf8", maxBuffer: 1 << 26 });
  const h = readOr(hex), s = readOr(join(keep, "sketch.ino.cpp.s"));
  return { status: r.status, stderr: (r.stderr || "").trim(), stdout: r.stdout, hexSha: h ? sha(h) : null, sSha: s ? sha(s) : null, sBytes: s ? s.length : 0, hexBytes: h ? h.length : 0 };
}

const inos = readdirSync(opt.examples).filter((f) => f.endsWith(".ino")).sort();
const rows = [];
for (const f of inos) {
  const name = f.replace(/\.ino$/, "");
  const ino = join(opt.examples, f);
  const theirs = build(opt.spike, ino, join(opt.out, "theirs", name));
  const ours = build(sandbox, ino, join(opt.out, "ours", name));
  const row = { sketch: name, theirsStatus: theirs.status, oursStatus: ours.status,
    hexTheirs: theirs.hexSha, hexOurs: ours.hexSha, hexEqual: !!theirs.hexSha && theirs.hexSha === ours.hexSha,
    sEqual: !!theirs.sSha && theirs.sSha === ours.sSha, stderrEqual: theirs.stderr === ours.stderr, hexBytes: ours.hexBytes };
  if (!row.stderrEqual) row.stderr = { theirs: theirs.stderr.slice(0, 400), ours: ours.stderr.slice(0, 400) };
  if (opt.native && ours.status === 0) {
    const n = spawnSync("node", [join(opt.spike, "compare-native.mjs"), join(opt.out, "ours", name), "--bundle", join(opt.spike, "bundle")], { encoding: "utf8", maxBuffer: 1 << 26 });
    try { const j = JSON.parse(n.stdout); row.native = j; } catch { row.native = { error: (n.stderr || n.stdout).slice(0, 300) }; }
  }
  rows.push(row);
  console.error(`${name.padEnd(28)} theirs=${theirs.status} ours=${ours.status} hex=${row.hexEqual ? "SAME" : "DIFF"} .s=${row.sEqual ? "SAME" : "DIFF"} stderr=${row.stderrEqual ? "same" : "DIFF"}${row.native ? " native.s=" + (row.native.cc1plusAsmIdentical ?? JSON.stringify(row.native).slice(0, 80)) : ""}`);
}
const summary = { total: rows.length, hexEqual: rows.filter((r) => r.hexEqual).length, sEqual: rows.filter((r) => r.sEqual).length, oursOk: rows.filter((r) => r.oursStatus === 0).length, theirsOk: rows.filter((r) => r.theirsStatus === 0).length };
writeFileSync(join(opt.out, "compare.json"), JSON.stringify({ ours: opt.ours, spike: opt.spike, summary, rows }, null, 2));
const md = ["| sketch | horang exit | ours exit | HEX sha256 (horang) | HEX sha256 (ours) | HEX equal | .s equal | stderr equal | .s == native cc1plus |", "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.sketch} | ${r.theirsStatus} | ${r.oursStatus} | ${(r.hexTheirs || "-").slice(0, 16)} | ${(r.hexOurs || "-").slice(0, 16)} | ${r.hexEqual ? "yes" : "NO"} | ${r.sEqual ? "yes" : "NO"} | ${r.stderrEqual ? "yes" : "NO"} | ${r.native ? (r.native.cc1plusAsmIdentical ? "yes" : "NO") : "n/a"} |`)];
writeFileSync(join(opt.out, "compare.md"), md.join("\n") + "\n");
console.log(JSON.stringify(summary));
process.exit(summary.hexEqual === summary.total ? 0 : 1);
