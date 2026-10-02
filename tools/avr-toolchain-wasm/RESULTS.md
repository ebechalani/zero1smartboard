# Results of the verification run (2026-09-27, development machine)

Binaries: `WORK/out` of `./build.sh` at emsdk 6.0.10 (SHA256SUMS below).
Reference: `@horang-corp/avr-gcc-wasm` 0.2.0 `tools/` as installed by the feasibility spike.
Driver: the spike's unmodified `compile-wasm.mjs` (`lib/arduino-build.mjs`, `lib/wasm-toolchain.mjs`),
bundle = spike's `bundle/` (core.a and libraries prebuilt natively, avr-libc 2.0.0 sysroot).
Native column: `/usr/lib/gcc/avr/7.3.0/cc1plus` (Debian gcc-avr 1:7.3.0+Atmel3.7.0-1) with identical
arguments on the same `sketch.ino.cpp` (spike's `compare-native.mjs`).

Command: `node test/compare.mjs --ours $WORK/out --out cmp --native`

## 21 example sketches (`src/examples/*.ino`)

| sketch | horang exit | ours exit | HEX sha256 (horang) | HEX sha256 (ours) | HEX equal | .s equal | stderr equal | .s == native cc1plus |
|---|---|---|---|---|---|---|---|---|
| 01_blink_red | 0 | 0 | 196df0f8aa4a35ee | 196df0f8aa4a35ee | yes | yes | yes | yes |
| 02_traffic_lights | 0 | 0 | 04d228fb77d277b2 | 04d228fb77d277b2 | yes | yes | yes | yes |
| 03_buzzer_melody | 0 | 0 | a7bf195d77f4e7e4 | a7bf195d77f4e7e4 | yes | yes | yes | yes |
| 04_rgb_rainbow | 0 | 0 | 382fce8e7504c6ea | 382fce8e7504c6ea | yes | yes | yes | yes |
| 05_seven_segment_counter | 0 | 0 | 3ee111eb5e65ab06 | 3ee111eb5e65ab06 | yes | yes | yes | yes |
| 06_servo_sweep | 0 | 0 | c76d36a783349a1b | c76d36a783349a1b | yes | yes | yes | yes |
| 07_dc_motor | 0 | 0 | d4fc0906f7e0463c | d4fc0906f7e0463c | yes | yes | yes | yes |
| 10_button_led | 0 | 0 | 5874d6ed075fd702 | 5874d6ed075fd702 | yes | yes | yes | yes |
| 11_button_toggle | 0 | 0 | becd3a7f150aaeee | becd3a7f150aaeee | yes | yes | yes | yes |
| 12_potentiometer_serial | 0 | 0 | ccb9bda27f27a893 | ccb9bda27f27a893 | yes | yes | yes | yes |
| 13_ldr_night_light | 0 | 0 | 35117b9aca2cfb97 | 35117b9aca2cfb97 | yes | yes | yes | yes |
| 14_dht22_serial | 0 | 0 | 33fdc48f94b97de8 | 33fdc48f94b97de8 | yes | yes | yes | yes |
| 15_ultrasonic_distance | 0 | 0 | 580be3252ea8961b | 580be3252ea8961b | yes | yes | yes | yes |
| 16_serial_echo | 0 | 0 | 6c822734f064e22f | 6c822734f064e22f | yes | yes | yes | yes |
| 20_lcd_hello | 0 | 0 | 3f77fed103115f82 | 3f77fed103115f82 | yes | yes | yes | yes |
| 21_lcd_custom_char | 0 | 0 | 7fed1102532dc0f3 | 7fed1102532dc0f3 | yes | yes | yes | yes |
| 30_parking_sensor | 0 | 0 | 44d68de5799860aa | 44d68de5799860aa | yes | yes | yes | yes |
| 31_greenhouse | 0 | 0 | a9cdda7da578355d | a9cdda7da578355d | yes | yes | yes | yes |
| 32_reaction_game | 0 | 0 | 600287f03c3a0c30 | 600287f03c3a0c30 | yes | yes | yes | yes |
| 33_dimmer | 0 | 0 | 66e0fc5898f10ab2 | 66e0fc5898f10ab2 | yes | yes | yes | yes |
| 34_i2c_scanner | 0 | 0 | b4d5a9bba8e52dda | b4d5a9bba8e52dda | yes | yes | yes | yes |

Summary: 21/21 HEX SHA-256 identical to horang's, 21/21 `cc1plus` `.s` byte-identical to horang's,
21/21 `.s` byte-identical to native avr-gcc 7.3.0, 21/21 identical (empty) stderr and exit status 0.

## Error / warning behaviour (hand-written sketches, `WORK/errtest/`)

| sketch | what it exercises | exit horang / ours | stderr identical | hex identical |
|---|---|---|---|---|
| e1_syntax | missing `;` (parse error) | 1 / 1 | yes | n/a |
| e2_undeclared | undeclared variable + function (`error:` + `note: suggested alternative`) | 1 / 1 | yes | n/a |
| e3_link | undefined reference at link time (ld diagnostics) | 1 / 1 | yes | n/a |
| e4_template_heavy | deep template recursion (`sum<400>`, `Fib<40>`) — compiler stack | 0 / 0 | yes | yes |
| e5_warning | narrowing / unused / string-literal conversions | 0 / 0 | yes | yes |

## Build times (4 vCPU, 15 GB RAM, host build, `make -j4`)

| stage | wall time |
|---|---|
| gmp + mpfr + mpc (Emscripten host) | 2 min 05 s |
| binutils 2.42 configure + as/ld/objcopy + link | 3 min 15 s |
| GCC 7.3.0 configure + `all-gcc` (-k) + `cc1plus`/`cc1` link | 4 min 20 s (7 min on the first, cold-cache run) |
| **total from clean build trees** | **≈ 10–13 min** (+ 1–3 min for the 800 MB GCC clone and 330 MB emsdk download) |

## Artifacts (SHA-256)

    73bf7e969d5557e0067666122e993b6eea2dac02ff36df60e52f14d2ea0215b2  avr-as.wasm
    bc4b9487b6bca00c59f2cf56a6b94936eba00df87571ad5a6ba91b5c67d798a6  avr-ld.wasm
    cfa70b9ee15039d0e69cb3955f591bdbd9c3eee1a97ef762e4e98df2ec266dff  avr-objcopy.wasm
    fcfd2a27597db1882a1d05f99f1d214f8e599763430b8779b46e7eb49b9a76d3  cc1.wasm
    578d568db15ae3c56607b784df6561c40c3c77acca0c6fb402538452d70c7f1e  cc1plus.wasm
    5cdf5a14c9808355655db08ef64062cd03a041a46a3445513824fa7c6b9e8202  avr-as.mjs
    65878332a03d46ad103485778580b6e9d7120cc3431a572ccb9a2bdb15714728  avr-ld.mjs
    fe25a6033c6595bc7a02ef39ed93259e0c3edf33662d2dfc1183bd3953435c08  avr-objcopy.mjs
    8b771d216d24fed48d0de6f58237f401f3c06f66f1193d18a35164a77f78c036  cc1.mjs
    1328d4754e080466256e55cf1e1bf94ee14c7281edc5bf334a902b3de0c76c12  cc1plus.mjs

Sizes: avr-as.mjs 68042 B; avr-as.wasm 691932 B; avr-ld.mjs 74626 B; avr-ld.wasm 977157 B; avr-objcopy.mjs 69040 B; avr-objcopy.wasm 662944 B; cc1.mjs 108633 B; cc1.wasm 10247955 B; cc1plus.mjs 109841 B; cc1plus.wasm 11309948 B; 

## Determinism

binutils (as, ld, objcopy) was built twice from a wiped build tree with the final flags
(`-ffile-prefix-map=$WORK=/w`, same emsdk, same host): all six `.wasm`/`.mjs` files are
**bit-identical** (`cmp`). No absolute build path remains in any of the five `.wasm` files
(`strings | grep` of the work directory: 0 hits). GCC was built once with the final flags; its
determinism across two runs is checked by the CI workflow (two independent Docker builds must
produce the same `SHA256SUMS`) and is not demonstrated here.

## Docker build (the CI environment, 2026-10-01)

The first release run (`avr-toolchain-wasm-v1.0.0`) failed in `./build.sh gcc`:
`build.sh` configures GCC with `--with-as=/usr/bin/avr-as --with-ld=/usr/bin/avr-ld`,
and `gcc/configure` stops with `cannot execute: /usr/bin/avr-ld` when they are
missing. The development machine had `binutils-avr`; the `debian:bookworm-slim`
image did not. Reproduced on the development machine by pointing both options at
missing files: the same error and `make` exit status 2 after the same ~2–3 minutes.
The Dockerfile now uses `ubuntu:24.04` with `binutils-avr`
(2.26.20160125+Atmel3.7.0-2, the same as the development machine).

A full `docker build` of that Dockerfile on the development machine (only the
sandbox's proxy certificate and https package sources added) passed every stage
(gcc: 5 min 50 s; 17 min in total). Compared with the host build above:

| file | Docker build SHA-256 | vs host build |
|---|---|---|
| avr-as / avr-ld / avr-objcopy (`.wasm` + `.mjs`) | as listed above | identical |
| cc1.mjs, cc1plus.mjs | as listed above | identical |
| cc1plus.wasm | `6474a632041fc8f5890ad4f4b3c7d7ccb570db60a5d1af011d5559cf0730201d` | 16 bytes differ |
| cc1.wasm | `d09a6503d6e0fc908679da5295c08a91f4c08f25b4df96b0d2204ba6f0c50ace` | 16 bytes differ |

The 16 bytes are GCC's `executable_checksum` (used only to validate precompiled
headers and printed by `-version`). `genchecksum` hashes the object files together
with `gcc/checksum-options`, the link command line, which contains the build
directories (`-ffile-prefix-map=$WORK=/w`, `--pre-js $HERE/emscripten-pre.js`).
Re-running `genchecksum` on the host build's objects with only those two paths
changed to the Docker ones gives exactly the Docker values, so every object file
(all generated code) is identical. Two builds at the same paths, such as the two
CI builds in `/build`, produce identical files; builds at other paths differ in
these 16 bytes only. With the Docker-built tools, `npm run test:hardware-sim`
(90 tests, `ZERO1_REQUIRE_TOOLCHAIN=1`), `tests/upload-toolchain-node.test.ts`
and `test/smoke.mjs` pass.
