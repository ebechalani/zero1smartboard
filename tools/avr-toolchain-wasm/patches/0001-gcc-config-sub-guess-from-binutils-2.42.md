# 0001 — GCC 7.3.0: newer config.sub / config.guess

**Applied by:** `build.sh stage_patch` (file copy, not a diff, because the files are
generated upstream and 100 KB of noise as a diff).

**What:** `gcc/config.sub` and `gcc/config.guess` (top level of the GCC tree) are
replaced by the copies shipped in the binutils 2.42 tarball.

**Why:** GCC 7.3.0's copies date from 2015/2016 and reject
`--host=wasm32-unknown-emscripten` ("Invalid configuration ... machine `wasm32-unknown'
not recognized"). The GNU config project added `wasm32` and the `emscripten` OS later;
binutils 2.42 (January 2024) ships those newer files. Both files are GPLv3+ with the
autoconf exception, same as GCC's own copies. No other GCC file is touched.
