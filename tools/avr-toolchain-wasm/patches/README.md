# patches/

Every source modification the build makes, one file each, with the reason. There
are deliberately no `.patch` diffs at the moment: the two changes are file
replacements/additions that `build.sh stage_patch` performs and documents here.
`build.sh` also applies any `*.patch` placed in this directory (unified diff, `-p1`,
with a `# Apply-in: <source dir name>` header line) so that future fixes can be
real diffs.

Configure-time knobs that are NOT source patches but matter for a faithful build
are documented in `build.sh` next to where they are set (`ac_cv_func_psignal=yes`,
`scriptdir=''` for ld, the `-Wno-error=...` set for clang >= 16).
