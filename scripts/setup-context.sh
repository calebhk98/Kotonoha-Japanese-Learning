#!/usr/bin/env bash
# One-time setup for the sentence-translation context step
# (scripts/context/enrich.py): a Python venv with CPU-only torch and the two
# small models (FuguMT ja->en, bge-small-en). Optional: without it the
# pipeline runs exactly as before, just with no translations and no
# translation-based sense choice.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
VENV=.venv-context
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
"$VENV/bin/pip" install -q -r scripts/context/requirements.txt
export HF_HOME="${KOTONOHA_MODELS:-$PWD/.models}"
"$VENV/bin/python" - <<'PY'
from huggingface_hub import snapshot_download
for repo in ("staka/fugumt-ja-en", "BAAI/bge-small-en-v1.5"):
    snapshot_download(repo)
    print("downloaded", repo)
PY
echo '{"sentences":[{"text":"契約を結ぶことになった。","candidates":[{"start":3,"end":5,"senses":[["to tie","to bind"],["to conclude (a contract)"]]}]}]}' \
  | "$VENV/bin/python" scripts/context/enrich.py | tail -1
