# Third-party notices — avr-toolchain-wasm

The WebAssembly binaries produced by this folder (`cc1plus.wasm`, `cc1.wasm`,
`avr-as.wasm`, `avr-ld.wasm`, `avr-objcopy.wasm` and their `.mjs` glue) are
derivative works of the following GNU projects. **This folder is the complete
corresponding source in the sense of GPLv3 section 6**: `build.sh` +
`Dockerfile` reproduce the binaries from the exact upstream revisions listed
below, and every modification is in `patches/` (or written out in `build.sh`
where it is a configure/make knob rather than a source change).

| Component | Version | Exact source | License |
|---|---|---|---|
| GCC (cc1plus, cc1; libcpp, libiberty, libdecnumber, libbacktrace, zlib inside) | 7.3.0 | git `https://github.com/gcc-mirror/gcc.git`, tag `releases/gcc-7.3.0`, commit `6184085fc664265dc78fd1ad4204c0cbef202628` (tag object `40b0dfe18728cdf3c2072ff0469b87a074450349`) | GPL-3.0-or-later (with GCC Runtime Library Exception for the runtime parts, none of which are shipped here) |
| GNU binutils (as, ld, objcopy; bfd, opcodes, libiberty inside) | 2.42 | `binutils_2.42.orig.tar.xz` from archive.ubuntu.com, SHA-256 `f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800` (byte-identical to upstream `binutils-2.42.tar.xz`) | GPL-3.0-or-later |
| GMP | 6.3.0 | `gmp_6.3.0+dfsg.orig.tar.xz` from archive.ubuntu.com, SHA-256 `bd2966e6d277f79328e894a5a9f3ba3fbf2ed2be81def5f48623e30c23fb1572` (upstream gmp-6.3.0 minus the GFDL `doc/` directory) | LGPL-3.0-or-later OR GPL-2.0-or-later |
| MPFR | 4.2.1 | `mpfr4_4.2.1.orig.tar.xz` from archive.ubuntu.com, SHA-256 `277807353a6726978996945af13e52829e3abd7a9a5b7fb2793894e18f1fcbb2` (== upstream `mpfr-4.2.1.tar.xz`) | LGPL-3.0-or-later |
| MPC | 1.3.1 | `mpclib3_1.3.1.orig.tar.gz` from archive.ubuntu.com, SHA-256 `ab642492f5cf882b74aa0cb730cd410a81edcdbec895183ce930e706c1c759b8` (== upstream `mpc-1.3.1.tar.gz`) | LGPL-3.0-or-later |
| Emscripten SDK (compiler, JS glue templates, musl-based libc, libc++, compiler-rt linked into the .wasm) | emsdk 6.0.10 (emscripten 6.0.10, clang 24.0.0git a06d9165905ce89b5ffef2bbb84c886d60a9b8bf) | `https://github.com/emscripten-core/emsdk.git`, `./emsdk install 6.0.10` | MIT / University of Illinois NCSA (Emscripten), MIT (musl), Apache-2.0 with LLVM exception (libc++, compiler-rt) |
| GNU config.sub / config.guess (copied from binutils 2.42 into the GCC tree) | 2024-01-01 | see patches/0001 | GPL-3.0-or-later with Autoconf exception |

Not rebuilt and not part of this folder (they are separate projects the front
end supplies at run time): avr-libc 2.0.0 headers/`libc.a`/`libm.a`/`crt*.o`
(modified BSD licence), `libgcc.a` for avr (GCC Runtime Library Exception),
the Arduino AVR core and libraries (LGPL-2.1).

## Patches / modifications

* `patches/0001-gcc-config-sub-guess-from-binutils-2.42.md` — newer config.sub/config.guess so GCC's configure accepts `wasm32-unknown-emscripten`.
* `patches/0002-gmp-dfsg-doc-stub.md` — no-op `doc/Makefile.in` for the +dfsg gmp tarball.
* `patches/0003-ld-search-root-ldscripts.patch` — ld looks in `/ldscripts` first when built with Emscripten.
* `emscripten-pre.js` — JS pre-script: `argv[0]` defaults to `./this.program` (Emscripten < 4 behaviour).
* Build knobs (in `build.sh`): `ac_cv_func_psignal=yes`, `scriptdir=''` for ld, `-std=gnu++11` and
  `-Wno-error=implicit-function-declaration,...` for clang >= 16, `--disable-lto --disable-plugin --disable-nls --disable-shared --disable-threads`, `--without-isl`.

## Licence texts

GCC and binutils: GNU General Public License version 3, see
`COPYING3` at the root of each source tree (https://www.gnu.org/licenses/gpl-3.0.txt).
The binaries embed the standard GNU version banners ("GNU C++14 7.3.0", "GNU ld (GNU Binutils) 2.42").
GMP/MPFR/MPC: GNU Lesser General Public License version 3 (`COPYING.LESSER`).
Emscripten: `emsdk/upstream/emscripten/LICENSE`.

## How to get the source of a shipped binary

`SOURCES.txt` next to the binaries repeats the table above with the exact
commit/tarball/SHA-256 used for that build, and `SHA256SUMS` identifies the
binaries. Running `./build.sh` (or `docker build`) in this folder at the same
git revision rebuilds them.
