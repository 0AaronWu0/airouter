# Task 1 Review

## Review scope

- `chrome-popup-admin/popup.js`
- `openai.js`
- `test/chrome-popup-admin.test.js`
- `test/openai-admin-refresh.test.js`

## Review rounds

### Round 1

- Correctness reviewer: P1, empty/null rates were coerced to `0`.
- Quality reviewer: P1, the frontend test only checked source patterns and did not execute sorting behavior.

### Round 2

- Correctness reviewer: P1, boolean/array values could still be coerced to numeric rates.
- Quality reviewer: P2, boundary coverage could be expanded.

### Round 3

- Correctness reviewer: P1, runtime numeric-string real rates were not treated as overrides.
- Quality reviewer: P2, missing regression coverage for runtime-rate precedence and multiple candidates.

## Fixes

- Added strict rate parsing in the popup and backend: only finite numbers and non-empty numeric strings are valid.
- Added executable popup sorting coverage for active-first, numeric ascending, duplicate-rate index ordering, and invalid-rate fallback.
- Added backend coverage for ignoring invalid rates, preferring runtime real rates, and selecting the global lowest available rate.
- Updated admin snapshot serialization to expose normalized runtime real rates.

## Final conclusion

PASS

## Verification

- Target tests: 25 passed.
- Full suite: 214 passed.
- `git diff --check`: passed.

## Follow-up items

- None.
