# 0002 — gmp 6.3.0 (+dfsg repack): stub doc/Makefile.in

**Applied by:** `build.sh stage_patch` (writes the file if absent).

**What:** creates `doc/Makefile.in` in the gmp source tree with no-op rules for every
target automake recurses into (all, install, clean, distclean, check, info ...).

**Why:** the only gmp source reachable from the build machine was the Debian/Ubuntu
`gmp_6.3.0+dfsg.orig.tar.xz`, which is upstream gmp-6.3.0 with the GFDL `doc/`
directory removed (Debian's "dfsg" repack). `configure` is otherwise unchanged and
still lists `doc/Makefile` in `AC_CONFIG_FILES`, so `config.status` fails with
"cannot find input file: doc/Makefile.in". The stub only affects documentation; no
C source is modified. If you have the pristine `gmp-6.3.0.tar.xz`, use it instead
(set `GMP_TAR`/`GMP_URL`/`GMP_SHA` in build.sh) and this stub becomes a no-op.
