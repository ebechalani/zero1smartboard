#!/usr/bin/env bash
# Rebuild the AVR toolchain (GCC 7.3.0 cc1plus, binutils 2.42 as/ld/objcopy) as
# WebAssembly ES modules with Emscripten. Same shape as @horang-corp/avr-gcc-wasm
# 0.2.0: MODULARIZE + EXPORT_ES6, MEMFS, no pthreads, no dynamic linking.
#
#   ./build.sh            # everything: fetch emsdk deps binutils gcc package
#   ./build.sh <stage>... # one or more stages (see the case at the bottom)
#
# Environment:
#   WORK   scratch directory (default: ./work). Sources, build trees, emsdk, out/.
#   JOBS   make -j (default: nproc)
#   EMSDK_VERSION  Emscripten release to install (default below; also in Dockerfile)
#
# Outputs (WORK/out/): cc1plus.mjs+wasm, avr-as.mjs+wasm, avr-ld.mjs+wasm,
# avr-objcopy.mjs+wasm, SHA256SUMS, SOURCES.txt, VERSIONS.json.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HERE/work}"
JOBS="${JOBS:-$(nproc)}"
EMSDK_VERSION="${EMSDK_VERSION:-6.0.10}"

SRC="$WORK/src"; DEPS="$WORK/deps"; OUT="$WORK/out"; LOGS="$WORK/logs"
mkdir -p "$SRC" "$DEPS" "$OUT" "$LOGS"

# ---- pinned sources -------------------------------------------------------
# GNU ftp mirrors (ftp.gnu.org, gcc.gnu.org, sourceware.org, mirrors.kernel.org)
# and api.github.com/tarball URLs were not reachable from the machine this was
# developed on. What is reachable and used here:
#   * github.com git clones            -> GCC (gcc-mirror/gcc, tag releases/gcc-7.3.0)
#   * archive.ubuntu.com pool          -> pristine upstream "*.orig.tar.*" tarballs
#                                         of binutils, mpfr, mpc (SHA-256 equal to the
#                                         upstream GNU tarballs) and gmp (+dfsg repack:
#                                         Debian removed non-free doc files only)
#   * storage.googleapis.com           -> emsdk toolchain binaries
GCC_REPO="https://github.com/gcc-mirror/gcc.git"
GCC_TAG="releases/gcc-7.3.0"
GCC_COMMIT="6184085fc664265dc78fd1ad4204c0cbef202628"   # commit the tag points to
UBUNTU_POOL="https://archive.ubuntu.com/ubuntu/pool/main"
BINUTILS_TAR="binutils_2.42.orig.tar.xz";   BINUTILS_URL="$UBUNTU_POOL/b/binutils/$BINUTILS_TAR"
BINUTILS_SHA="f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800"  # == binutils-2.42.tar.xz upstream
GMP_TAR="gmp_6.3.0+dfsg.orig.tar.xz";        GMP_URL="$UBUNTU_POOL/g/gmp/$GMP_TAR"
GMP_SHA="bd2966e6d277f79328e894a5a9f3ba3fbf2ed2be81def5f48623e30c23fb1572"
MPFR_TAR="mpfr4_4.2.1.orig.tar.xz";          MPFR_URL="$UBUNTU_POOL/m/mpfr4/$MPFR_TAR"
MPFR_SHA="277807353a6726978996945af13e52829e3abd7a9a5b7fb2793894e18f1fcbb2"      # == mpfr-4.2.1.tar.xz upstream
MPC_TAR="mpclib3_1.3.1.orig.tar.gz";         MPC_URL="$UBUNTU_POOL/m/mpclib3/$MPC_TAR"
MPC_SHA="ab642492f5cf882b74aa0cb730cd410a81edcdbec895183ce930e706c1c759b8"       # == mpc-1.3.1.tar.gz upstream
EMSDK_REPO="https://github.com/emscripten-core/emsdk.git"

HOST=wasm32-unknown-emscripten
BUILD="$(gcc -dumpmachine)"
PREFIX=/opt/avr-wasm            # only baked into default search paths that never exist in MEMFS

# Emscripten link flags shared by all four tools (== shape of horang's glue:
# ES module factory, MEMFS forced in, FS + callMain exported, runtime exits after main).
EM_COMMON=(-O2
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain
  -sEXIT_RUNTIME=1 -sINVOKE_RUN=1 -sALLOW_UNIMPLEMENTED_SYSCALLS=1
  -sNO_DISABLE_EXCEPTION_CATCHING=0 -sSUPPORT_LONGJMP=wasm
  -sASSERTIONS=0 -sWASM_BIGINT=1
  --pre-js "$HERE/emscripten-pre.js")   # argv[0] = "./this.program" (see that file)
# cc1plus recurses deeply (templates, RTL passes): give it a bigger stack.
EM_STACK_GCC=-sSTACK_SIZE=32MB
EM_STACK_BINUTILS=-sSTACK_SIZE=8MB

# clang >= 16 turns these old-C idioms (used by the 2018-era configure tests
# and sources) into hard errors; keep them warnings so configure probes see the
# truth and libiberty/bfd compile.
C_COMPAT="-Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=int-conversion -Wno-error=incompatible-function-pointer-types -Wno-error=incompatible-pointer-types"

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
# The stages send the tools' output to $LOGS/*.log; when a step fails, show the
# end of the newest log and any configure error, or CI only says "exit code 2".
show_logs_on_error() {
  local newest
  newest="$(ls -t "$LOGS"/*.log 2>/dev/null | head -1)" || true
  [ -n "$newest" ] || return 0
  { echo "---- last 40 lines of $newest ----"; tail -n 40 "$newest"
    echo "---- configure errors in $LOGS ----"; grep -h "configure: error" "$LOGS"/*.log || echo "(none)"; } >&2
}
trap show_logs_on_error ERR
sha_check() { echo "$2  $1" | sha256sum -c - >/dev/null || { echo "SHA-256 mismatch for $1" >&2; exit 1; }; }
fetch_tar() { local url="$1" name="$2" sha="$3"; [ -f "$SRC/$name" ] || curl -sSfL -o "$SRC/$name" "$url"; sha_check "$SRC/$name" "$sha"; }

stage_fetch() {
  log "fetch sources"
  export GIT_TERMINAL_PROMPT=0
  if [ ! -d "$SRC/gcc/.git" ]; then git clone --depth 1 --branch "$GCC_TAG" "$GCC_REPO" "$SRC/gcc"; fi
  local got; got="$(git -C "$SRC/gcc" rev-parse HEAD)"
  [ "$got" = "$GCC_COMMIT" ] || { echo "gcc checkout is $got, expected $GCC_COMMIT" >&2; exit 1; }
  fetch_tar "$BINUTILS_URL" "$BINUTILS_TAR" "$BINUTILS_SHA"
  fetch_tar "$GMP_URL" "$GMP_TAR" "$GMP_SHA"
  fetch_tar "$MPFR_URL" "$MPFR_TAR" "$MPFR_SHA"
  fetch_tar "$MPC_URL" "$MPC_TAR" "$MPC_SHA"
  cd "$SRC"
  [ -d binutils-2.42 ] || tar xf "$BINUTILS_TAR"
  [ -d gmp-6.3.0+dfsg ] || tar xf "$GMP_TAR"
  [ -d mpfr-4.2.1 ] || tar xf "$MPFR_TAR"
  [ -d mpc-1.3.1 ] || tar xf "$MPC_TAR"
  stage_patch
}

stage_patch() {
  log "apply patches"
  # GCC 7.3.0's config.sub/config.guess (2015) do not know wasm32 or emscripten.
  # Use the ones shipped by binutils 2.42 (same GNU config project, newer). This
  # is patches/0001-gcc-config-sub-guess-from-binutils-2.42.md in prose.
  for f in config.sub config.guess; do
    cmp -s "$SRC/binutils-2.42/$f" "$SRC/gcc/$f" || cp "$SRC/binutils-2.42/$f" "$SRC/gcc/$f"
  done
  # gmp "+dfsg" repack: Debian removed doc/ (GFDL). configure still wants doc/Makefile.in;
  # give it a no-op one (patches/0002-gmp-dfsg-doc-stub.md).
  if [ ! -f "$SRC/gmp-6.3.0+dfsg/doc/Makefile.in" ]; then
    mkdir -p "$SRC/gmp-6.3.0+dfsg/doc"
    printf '# stub: documentation removed from the +dfsg tarball\nall install install-data install-exec uninstall clean distclean mostlyclean maintainer-clean check dvi info html pdf ps install-info installcheck tags ctags distdir install-dvi install-html install-pdf install-ps:\n\t@:\n' > "$SRC/gmp-6.3.0+dfsg/doc/Makefile.in"
  fi
  for p in "$HERE"/patches/*.patch; do
    [ -e "$p" ] || continue
    local dir; dir="$(sed -n 's/^# *Apply-in: *//p' "$p" | head -1)"
    [ -n "$dir" ] || { echo "patch $p lacks '# Apply-in:' header" >&2; exit 1; }
    if patch -d "$SRC/$dir" -p1 -N --dry-run -s -F0 < "$p" >/dev/null 2>&1; then
      patch -d "$SRC/$dir" -p1 -N -F0 < "$p"
    else
      # already applied (reverse applies cleanly) or genuinely broken
      patch -d "$SRC/$dir" -p1 -R --dry-run -s -F0 < "$p" >/dev/null 2>&1 || { echo "patch $p does not apply" >&2; exit 1; }
    fi
  done
}

stage_emsdk() {
  log "emsdk $EMSDK_VERSION"
  export GIT_TERMINAL_PROMPT=0
  [ -d "$WORK/emsdk/.git" ] || git clone --depth 1 "$EMSDK_REPO" "$WORK/emsdk"
  ( cd "$WORK/emsdk" && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" ) >"$LOGS/emsdk.log" 2>&1
}

em_env() {
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$WORK/emsdk/emsdk_env.sh"
  export EM_CACHE="$WORK/emsdk/.em_cache"   # inside WORK: no ~/.emscripten_cache surprises
  export CC=emcc CXX=em++ AR=emar RANLIB=emranlib NM=llvm-nm STRIP=true
  export CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++
  # GCC 7 is C++98/03 code; its configure only forces a -std when bootstrapping, so
  # clang would otherwise default to gnu++17 and reject 'register' (cp/cfns.gperf).
  # -ffile-prefix-map: __FILE__ strings (gcc_assert/internal_error messages, bfd
  # asserts) would otherwise embed this machine's absolute source path in the .wasm
  # and make the build irreproducible across checkouts.
  export CFLAGS="-O2 $C_COMPAT -ffile-prefix-map=$WORK=/w" CXXFLAGS="-O2 -std=gnu++11 -ffile-prefix-map=$WORK=/w"
  # configure probes are compiled and *linked* with these; keep them minimal here,
  # the real program links pass the EM_COMMON flags explicitly.
  export LDFLAGS=""
  # Emscripten's libc declares psignal() in <signal.h> but does not define it, so
  # the link probe fails and libiberty would then define its own (with a
  # conflicting non-const prototype). Nothing in cc1plus/binutils calls it.
  export ac_cv_func_psignal=yes
}

stage_deps() {
  em_env
  log "gmp"
  mkdir -p "$WORK/build-gmp" && cd "$WORK/build-gmp"
  [ -f config.status ] || "$SRC/gmp-6.3.0+dfsg/configure" --build="$BUILD" --host="$HOST" --prefix="$DEPS" \
      --disable-shared --enable-static --disable-assembly --enable-cxx=no --without-readline >"$LOGS/gmp-configure.log" 2>&1
  make -j"$JOBS" >"$LOGS/gmp-make.log" 2>&1 && make install >>"$LOGS/gmp-make.log" 2>&1
  log "mpfr"
  mkdir -p "$WORK/build-mpfr" && cd "$WORK/build-mpfr"
  [ -f config.status ] || "$SRC/mpfr-4.2.1/configure" --build="$BUILD" --host="$HOST" --prefix="$DEPS" \
      --disable-shared --enable-static --with-gmp="$DEPS" >"$LOGS/mpfr-configure.log" 2>&1
  make -j"$JOBS" >"$LOGS/mpfr-make.log" 2>&1 && make install >>"$LOGS/mpfr-make.log" 2>&1
  log "mpc"
  mkdir -p "$WORK/build-mpc" && cd "$WORK/build-mpc"
  [ -f config.status ] || "$SRC/mpc-1.3.1/configure" --build="$BUILD" --host="$HOST" --prefix="$DEPS" \
      --disable-shared --enable-static --with-gmp="$DEPS" --with-mpfr="$DEPS" >"$LOGS/mpc-configure.log" 2>&1
  make -j"$JOBS" >"$LOGS/mpc-make.log" 2>&1 && make install >>"$LOGS/mpc-make.log" 2>&1
  ls "$DEPS/lib"/libgmp.a "$DEPS/lib"/libmpfr.a "$DEPS/lib"/libmpc.a
}

stage_binutils() {
  em_env
  log "binutils configure"
  mkdir -p "$WORK/build-binutils" && cd "$WORK/build-binutils"
  [ -f config.status ] || "$SRC/binutils-2.42/configure" --build="$BUILD" --host="$HOST" --target=avr --prefix="$PREFIX" \
      --disable-nls --disable-shared --enable-static --disable-plugins --disable-werror \
      --disable-gdb --disable-gdbserver --disable-sim --disable-gprofng --disable-libctf --disable-libdecnumber \
      --disable-readline --without-zstd --without-system-zlib --disable-gold --disable-libbacktrace \
      >"$LOGS/binutils-configure.log" 2>&1
  log "binutils make"
  # always relink the three programs with the current EM_COMMON flags (make does not track LDFLAGS)
  rm -f gas/as-new gas/as-new.wasm ld/ld-new ld/ld-new.wasm binutils/objcopy binutils/objcopy.wasm
  # scriptdir='' => SCRIPTDIR="" so the only baked script path is "/ldscripts" (== horang's MEMFS layout;
  # patches/0003 makes ld try it first regardless of argv[0])
  make -j"$JOBS" MAKEINFO=true scriptdir='' LDFLAGS="${EM_COMMON[*]} $EM_STACK_BINUTILS" \
       all-libiberty all-bfd all-opcodes all-gas all-ld all-binutils >"$LOGS/binutils-make.log" 2>&1
  stage_binutils_package
}

# The Makefiles name the programs as-new / ld-new / objcopy (+ .wasm). We rename
# to the names the front-end loads (avr-as, avr-ld, avr-objcopy) and patch the
# single baked-in wasm file name inside the glue accordingly.
rename_tool() { # <built path without extension> <new base name>
  local built="$1" name="$2" js
  if [ -f "$built.js" ]; then js="$built.js"; elif [ -f "$built.mjs" ]; then js="$built.mjs"; else js="$built"; fi
  [ -f "$built.wasm" ] || { echo "missing $built.wasm" >&2; exit 1; }
  cp "$built.wasm" "$OUT/$name.wasm"
  sed "s#$(basename "$built")\.wasm#$name.wasm#g" "$js" > "$OUT/$name.mjs"
  if [ "$(basename "$built")" != "$name" ] && grep -q "[^-]$(basename "$built")\.wasm" "$OUT/$name.mjs"; then
    echo "error: '$(basename "$built").wasm' still mentioned in $name.mjs" >&2; exit 1
  fi
}

stage_binutils_package() {
  cd "$WORK/build-binutils"
  rename_tool gas/as-new avr-as
  rename_tool ld/ld-new avr-ld
  rename_tool binutils/objcopy avr-objcopy
  ls -la "$OUT"/avr-*.wasm
}

stage_gcc() {
  em_env
  log "gcc configure"
  # gcc/configure (run by 'make all-gcc') probes these for assembler features.
  for t in /usr/bin/avr-as /usr/bin/avr-ld; do
    [ -x "$t" ] || { echo "$t not found: install binutils-avr (GCC's configure needs it, see Dockerfile)" >&2; exit 1; }
  done
  mkdir -p "$WORK/build-gcc" && cd "$WORK/build-gcc"
  [ -f config.status ] || "$SRC/gcc/configure" --build="$BUILD" --host="$HOST" --target=avr --prefix="$PREFIX" \
      --with-gmp="$DEPS" --with-mpfr="$DEPS" --with-mpc="$DEPS" --without-isl \
      --enable-languages=c,c++ --disable-nls --disable-shared --disable-threads --disable-lto --disable-plugin \
      --disable-libssp --disable-libgomp --disable-libquadmath --disable-libstdcxx --disable-bootstrap \
      --with-dwarf2 --disable-werror --disable-decimal-float --disable-libatomic --disable-libvtv \
      --with-as=/usr/bin/avr-as --with-ld=/usr/bin/avr-ld \
      >"$LOGS/gcc-configure.log" 2>&1
  log "gcc make all-gcc"
  rm -f gcc/cc1plus gcc/cc1plus.wasm gcc/cc1 gcc/cc1.wasm   # always relink with the current EM_COMMON flags
  # all-gcc also links gcov-tool, which needs ftw() (not in Emscripten's libc) and is
  # not shipped: keep going past that (-k), then demand the two compilers we ship.
  make -k -j"$JOBS" MAKEINFO=true LDFLAGS="${EM_COMMON[*]} $EM_STACK_GCC" all-gcc >"$LOGS/gcc-make.log" 2>&1 || true
  make -j"$JOBS" MAKEINFO=true LDFLAGS="${EM_COMMON[*]} $EM_STACK_GCC" -C gcc cc1plus cc1 >"$LOGS/gcc-make-cc1.log" 2>&1
  stage_gcc_package
}

stage_gcc_package() {
  cd "$WORK/build-gcc"
  rename_tool gcc/cc1plus cc1plus
  [ -f gcc/cc1.wasm ] && rename_tool gcc/cc1 cc1 || true
  ls -la "$OUT"/cc1*.wasm
}

stage_package() {
  log "package"
  cd "$OUT"
  rm -f SHA256SUMS SOURCES.txt VERSIONS.json
  sha256sum *.wasm *.mjs > SHA256SUMS
  {
    echo "gcc        $GCC_REPO tag $GCC_TAG commit $GCC_COMMIT"
    echo "binutils   2.42   $BINUTILS_URL sha256 $BINUTILS_SHA"
    echo "gmp        6.3.0  $GMP_URL sha256 $GMP_SHA (Debian +dfsg repack of upstream gmp-6.3.0; only doc/ files removed)"
    echo "mpfr       4.2.1  $MPFR_URL sha256 $MPFR_SHA"
    echo "mpc        1.3.1  $MPC_URL sha256 $MPC_SHA"
    echo "emsdk      $EMSDK_VERSION  $EMSDK_REPO  ($(cd "$WORK/emsdk" && git rev-parse HEAD))"
    echo "emscripten $(cat "$WORK/emsdk/upstream/emscripten/emscripten-version.txt" | tr -d '"')"
    echo "clang      $("$WORK/emsdk/upstream/bin/clang" --version | head -1)"
    echo "patches    $(ls "$HERE"/patches/ | tr '\n' ' ')"
  } > SOURCES.txt
  cat SOURCES.txt
}

if [ $# -eq 0 ]; then set -- fetch emsdk deps binutils gcc package; fi
for stage in "$@"; do
  case "$stage" in
    fetch) stage_fetch ;; patch) stage_patch ;; emsdk) stage_emsdk ;; deps) stage_deps ;;
    binutils) stage_binutils ;; binutils-package) stage_binutils_package ;;
    gcc) stage_gcc ;; gcc-package) stage_gcc_package ;; package) stage_package ;;
    *) echo "unknown stage $stage" >&2; exit 2 ;;
  esac
done
log "done"
