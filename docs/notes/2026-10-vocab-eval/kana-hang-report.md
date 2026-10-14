# kana-hang report (diagnosis only, no code change)
Outcome: no bug in the code. Fuwa-Fuwa-Kumo is not hanging on its text; it is torch thread oversubscription when several enrich.py helpers share 4 cores.
Evidence:
- Isolated kana2kanji (zenz) on single sentences with default threads (4) at load ~14: 21-57 s per 14-24-char sentence. Same sentences with KOTONOHA_THREADS=1: 0.6-1.0 s. Spin-waiting torch threads explain the pinned 100% CPU. Generation is bounded (max_new_tokens=len+16), alignConverted is memoized; no infinite loop found.
- inspect-text on full Fuwa-Fuwa-Kumo with KOTONOHA_THREADS=1: 90 s.
- Under the shared flock, alone, default threads: resolve-content Fuwa-Fuwa-Kumo finished in 507 s (load was still ~7-10 from other work), 1 written, and resolved.json is byte-identical to committed (git status clean).
- Earlier with 1 thread (before the owner constraint): Fuwa-Fuwa-Kumo and Cherry-Blossom-Viewing also byte-identical to committed.
Not verified: whether KOTONOHA_THREADS=1 output is byte-identical for the whole corpus (only these two items checked); so no thread change is proposed.
Reverted: my load-aware thread chooser and kana2kanji max_time (load-dependent output, forbidden); branch reset to c1f5744, no commits.
Recommendation: run one context pipeline at a time (flock); optionally set KOTONOHA_THREADS=1 on shared machines after a corpus-wide byte-identity check.
