#!/bin/sh
# Mutation check of firestore.rules (docs/CLASSROOM.md §7.1, Appendix B): every file in
# tests-emulator/mutations/ removes one protection, and the rules suite must catch each one.
# Run from the repository root with the Firestore emulator up, e.g.
#   npx --yes firebase-tools@15.31.0 emulators:exec --only firestore --project demo-zero1 "sh tests-emulator/mutations.sh"
# Exit status 1 when a mutation survives.
status=0
for f in tests-emulator/mutations/*.rules; do
  n=$(basename "$f" .rules)
  if RULES_FILE="$f" npx vitest run --config vitest.emulator.config.ts tests-emulator/firestore.rules.test.ts > "/tmp/z1-mutation-$n.log" 2>&1; then
    echo "SURVIVED  $n (no test failed; see /tmp/z1-mutation-$n.log)"
    status=1
  else
    echo "caught    $n: $(grep -E '^ +Tests ' "/tmp/z1-mutation-$n.log" | tr -s ' ')"
  fi
done
exit $status
