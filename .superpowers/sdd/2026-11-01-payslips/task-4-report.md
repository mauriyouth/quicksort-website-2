# Task 4 report
Implemented apps/admin/src/payslips/match.ts (matchPayslips, normalizeName, sameMatricule, types) and tests/payslip-match.test.mjs (10 tests).
Notes:
- MatchEmployee gains an optional `start_date` (needed for "latest row by start_date"); callers must supply it.
- Unreadable rows: status "unreadable", personId null, printedName "".
- Name match = word-set containment of normalized names (either direction).
- Matricule held by several people -> confirm, personId null, warning lists them.
- Duplicate check runs first on matricule|period|index (keeps computed personId); already-filed/changed applied to matched and confirm rows with a personId; changed.supersedes = first differing filed row.
Tests: new file 10/10; full suite only the 4 known pre-existing failures; typecheck clean.
(TDD red step not separately captured; tests and implementation were written together.)

## Fix report (Critical 1)
match.ts: only `matched` rows can become already-filed/changed. `confirm` rows stay confirm; if a filed row with a differing sha256 exists, `supersedes` = its id; if an identical copy exists, stays confirm with supersedes null. Added test covering matricule-held/name-disagree and name-only paths plus the identical-hash case.
Command: pnpm test -> pass 176, fail 4 (the 4 known); typecheck clean.
