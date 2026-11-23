[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/globalcuan/makefun-hidden-spec-cli-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/globalcuan/makefun-hidden-spec-cli-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

# mend — one patch tool for every AI edit format

A [make.fun hidden-spec-cli-01](https://make.fun/bounty/hidden-spec-cli-01-run-20261122) entry. `mend` (main.ts, Node 22, standard library only) reads all four edit formats AI models write — unified diffs, SEARCH/REPLACE blocks, V4A patches and text-editor tool calls as JSON — finds the lines an edit names even when whitespace or indentation drifted (three matching tiers), and changes every file or none.

Run: `node main.ts [options] [PATCH]`. `SPEC.md` is the written specification it implements; `node check.ts <practice.json>` runs the public practice set.
