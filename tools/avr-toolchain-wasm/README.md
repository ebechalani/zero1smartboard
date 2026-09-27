# avr-toolchain-wasm — open rebuild of the AVR compiler for the ZERO1 simulator

The ZERO1 simulator compiles Arduino sketches **in the browser**: GCC's C++
compiler proper (`cc1plus`) and GNU binutils (`as`, `ld`, `objcopy`) run as
WebAssembly inside a Web Worker. The feasibility spike used the prebuilt binaries
of `@horang-corp/avr-gcc-wasm` 0.2.0. Those are GPLv3 programs published
without their corresponding source or build scripts, so this folder rebuilds
them **from pinned upstream sources with a fully scripted, reproducible build**,
and proves the rebuilt binaries are drop-in replacements.

## What is built

| Tool | Upstream | Output | Size (this build) |
|---|---|---|---|
| `cc1plus` (GCC C++ compiler proper) | GCC 7.3.0 (`releases/gcc-7.3.0`, commit `6184085f…`) | `cc1plus.mjs` + `cc1plus.wasm` | 11.31 MB wasm (horang: 13.84 MB) |
| `cc1` (GCC C compiler proper — bonus, not in horang's set) | GCC 7.3.0 | `cc1.mjs` + `cc1.wasm` | 10.25 MB |
| `avr-as` | binutils 2.42 | `avr-as.mjs` + `avr-as.wasm` | 0.69 MB (horang: 0.76 MB) |
| `avr-ld` | binutils 2.42 | `avr-ld.mjs` + `avr-ld.wasm` | 0.98 MB (horang: 1.08 MB) |
| `avr-objcopy` | binutils 2.42 | `avr-objcopy.mjs` + `avr-objcopy.wasm` | 0.66 MB (horang: 0.73 MB) |

Configuration: `--build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten --target=avr`
(a canadian cross), `-O2`, Emscripten 6.0.10. Each `.mjs` is an ES-module factory
(`-sMODULARIZE -sEXPORT_ES6`) with MEMFS (`-sFORCE_FILESYSTEM`), `FS` and
`callMain` exported, `-sEXIT_RUNTIME=1`, memory growth, **no pthreads / no
SharedArrayBuffer, no dynamic linking** — the same shape the spike's
`lib/wasm-toolchain.mjs` drives: `FS.writeFile` → `callMain(args)` → `FS.readFile`,
one fresh instance per run, `ld` finds its scripts in `/ldscripts/avr5.xn`.
Full flag list: `EM_COMMON` in `build.sh`.

Not rebuilt (separate, non-GPL projects supplied by the front end at run time):
avr-libc 2.0.0 (headers, `libc.a`, `libm.a`, `crtatmega328p.o`), `libgcc.a` for
avr, the Arduino core and libraries. There is no `lto1` (like horang: `--disable-lto`;
the LTO flow needs the driver to spawn `lto-wrapper`, impossible without `fork/exec`).

## Why (licence)

GCC and binutils are GPL-3.0-or-later. Distributing `.wasm` builds of them
(that is what a web page does) requires offering the *corresponding source*
(GPLv3 §6): the exact sources, all patches and the scripts that control
compilation. This folder **is** that corresponding source: `build.sh`,
`Dockerfile`, `patches/`, `emscripten-pre.js`, and `SOURCES.txt`/`SHA256SUMS`
produced next to the binaries. See `THIRD_PARTY_NOTICES.md`.

## How to build

```sh
# Docker (what CI does): ~15 min on 4 cores, ~6 GB disk
cd tools/avr-toolchain-wasm
docker build -t avr-toolchain-wasm .
mkdir -p out && docker run --rm -v "$PWD/out:/build/work/out-mount" avr-toolchain-wasm

# or directly on a Debian/Ubuntu host with build-essential git curl python3 flex bison texinfo
WORK=/some/scratch/dir JOBS=4 ./build.sh        # stages: fetch emsdk deps binutils gcc package
```

Stages are idempotent (`./build.sh binutils`, `./build.sh gcc-package`, ...).
Outputs land in `$WORK/out/`: the ten `.mjs`/`.wasm` files, `SHA256SUMS`,
`SOURCES.txt` (exact commits/tarball hashes/emsdk revision), `VERSIONS.json`.

Measured on the development machine (4 vCPU, 15 GB RAM, host build, no Docker
daemon available): gmp+mpfr+mpc 2 min, binutils 3 min 15 s, GCC configure +
`all-gcc` + link 7 min, total wall time of a from-scratch run ≈ **13 minutes**
(the clone of GCC at depth 1 is ~800 MB and takes 1–3 min more, depending on
the network). The reproducible re-run (with `-ffile-prefix-map`) took the same.

### Where the sources come from (and why not ftp.gnu.org)

GNU's ftp mirrors, gcc.gnu.org, sourceware.org and `api.github.com`/`codeload`
tarball URLs are blocked on the network the build was developed on. Reachable
and used (all pinned by commit or SHA-256 in `build.sh`):

* **GCC** — `git clone --depth 1 --branch releases/gcc-7.3.0 https://github.com/gcc-mirror/gcc.git`
  (official mirror; commit `6184085fc664265dc78fd1ad4204c0cbef202628`).
* **binutils 2.42, mpfr 4.2.1, mpc 1.3.1** — Ubuntu's source pool
  (`archive.ubuntu.com/ubuntu/pool/main/...*.orig.tar.*`). These are the pristine
  upstream tarballs: their SHA-256 equal the GNU release tarballs
  (`f6e4d41f…`, `27780735…`, `ab642492…`).
* **gmp 6.3.0** — Ubuntu's `gmp_6.3.0+dfsg.orig.tar.xz`: upstream gmp-6.3.0 with the
  GFDL `doc/` directory removed. No C source differs; `patches/0002` stubs the
  missing `doc/Makefile.in`. Swap in the pristine tarball via `GMP_URL/GMP_SHA` if you have it.
* **isl** — not used (`--without-isl`; Graphite is off by default, no effect on code generation).
* **emsdk 6.0.10** — `github.com/emscripten-core/emsdk` + binaries from `storage.googleapis.com`.
* `bminor/binutils-gdb` on GitHub was *also* blocked (403) here, hence the tarball route.

## Patches (see `patches/README.md`)

1. GCC's 2015 `config.sub/config.guess` → the 2024 ones from binutils 2.42 (accept `wasm32-unknown-emscripten`).
2. gmp `+dfsg`: no-op `doc/Makefile.in`.
3. `ld/ldfile.c`: under `__EMSCRIPTEN__`, try `/ldscripts` before the argv[0]-relative search.
4. `emscripten-pre.js`: `argv[0]` defaults to `./this.program` (pre-4.x Emscripten behaviour,
   which horang's glue has; Emscripten 6 would otherwise use `process.argv[1]` under Node and
   change diagnostic prefixes / ld's script search).

Build knobs that are not source changes: `ac_cv_func_psignal=yes` (Emscripten's
libc declares but does not define `psignal`), `scriptdir=''` for ld,
`-std=gnu++11` (clang 24 defaults to C++17 and rejects `register` in GCC 7),
`-Wno-error=implicit-function-declaration,...` for configure probes,
`-ffile-prefix-map=$WORK=/w` so `__FILE__` strings in asserts do not embed the
build path, `all-gcc` run with `-k` because `gcov-tool` needs `ftw()` (absent in
Emscripten libc; not shipped), then `make -C gcc cc1plus cc1` is required to succeed.

## Verification

`test/compare.mjs` runs the spike's **unmodified** `compile-wasm.mjs`
(the exact browser code path) on every sketch of `src/examples/*.ino` against
(a) horang's binaries and (b) ours (symlinked as the package's `tools/`),
compares exit status, stderr, the `cc1plus` `.s` byte for byte and the SHA-256
of the `.hex`, and with `--native` also runs the spike's `compare-native.mjs`
(`.s` vs the native `/usr/lib/gcc/avr/7.3.0/cc1plus` with identical arguments,
`-nostdinc`, same virtual include tree).

```sh
node test/compare.mjs --ours /path/to/out --out /tmp/cmp --native \
     --spike /path/to/upload-spike/toolchain    # -> compare.md / compare.json
```

Result on all **21 examples** (see `RESULTS.md` for the table with hashes):

| check | result |
|---|---|
| pipeline exit status, horang vs ours | 21/21 identical (all 0) |
| stderr of the whole pipeline | 21/21 identical (empty) |
| `cc1plus` `.s` output, horang vs ours | **21/21 byte-identical** |
| `.hex` SHA-256, horang vs ours | **21/21 identical** |
| `cc1plus` `.s`, ours vs native avr-gcc 7.3.0 (Debian 1:7.3.0+Atmel3.7.0-1) | 21/21 byte-identical |

Error/warning behaviour (`RESULTS.md`, five hand-written sketches: syntax error,
undeclared identifiers, unresolved symbol at link, deep template recursion,
narrowing/unused warnings): exit codes, full stderr (messages, line:column,
"suggested alternative" notes, ld's undefined-reference text) and hex are
identical between horang's binaries and ours.

## Known limitations / unverified

* **Determinism**: binutils was built twice here from wiped build trees and came out
  bit-identical; GCC was built once with the final flags. The CI workflow builds
  twice in Docker and fails if the two `SHA256SUMS` differ. No absolute build path
  is embedded in any `.wasm` (`-ffile-prefix-map`).
* The spike's `cc1-diff` found 5 of 38 core/library `.cpp` files where **horang's**
  cc1plus differs from the native Debian compiler (register allocation
  differences, e.g. `HardwareSerial.cpp`). Our build is identical to horang's on
  the 21 sketches; whether it is identical to horang on those 5 files, and which
  side differs from Debian (Debian carries Atmel's device patches), was not
  re-run. It does not affect the shipped HEX because the core is prebuilt natively.
* `cc1` (C front end) is built and loads, but the front end still compiles `.c`
  library files through `cc1plus` (spike HACK); wiring `cc1` in is future work.
* The Dockerfile's base image is pinned by tag, not digest (documented inline).
* Browser run of *our* binaries was not repeated (same Emscripten shape and the
  Node path is identical code; the spike's Playwright runs covered horang's).
* Emscripten 6.0.10 glue is newer than horang's; it exports the same runtime
  methods the spike uses (`FS`, `callMain`, `noInitialRun`, `print/printErr`,
  `instantiateWasm`, `onMemoryGrowth` not needed).
