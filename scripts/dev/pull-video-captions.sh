#!/usr/bin/env bash
# Pull Japanese captions into transcript.md from YouTube or NHK educational PDF.
#
# Usage:
#   # YouTube videos:
#   scripts/dev/pull-video-captions.sh https://www.youtube.com/watch?v=ABC123 video-id
#
#   # NHK高校講座 (学習メモ PDF):
#   scripts/dev/pull-video-captions.sh \
#     'https://edu.web.nhk/kokokoza/watch/?das_id=D0022120068_00000' \
#     nhk-history-meiji \
#     --nhk-das-id D0022120068_00000
#
# Output:
#   src/videos/<video_id>/transcript.md   (cleaned plain text, captions only)
#   src/videos/<video_id>/.captions.vtt   (raw WebVTT for YouTube; omitted for NHK)
#
# YouTube: Tries manual (uploader) subtitles first, then auto-generated as a
# fallback. Auto-generated captions are noisy and need a human pass.
# NHK: Downloads the 学習メモ PDF, extracts Japanese text, cleans to transcript.md

set -euo pipefail

URL="${1:-}"
ID="${2:-}"
NHK_DAS_ID="${3:-}"  # --nhk-das-id for NHK高校講座

if [[ -z "$URL" || -z "$ID" ]]; then
  echo "Usage: $0 <url> <video_id> [--nhk-das-id DAS_ID]" >&2
  exit 1
fi

OUT_DIR="src/videos/${ID}"
mkdir -p "$OUT_DIR"

# Detect NHK vs YouTube
if [[ "$URL" == *"edu.web.nhk"* ]]; then
  # NHK 高校講座 path
  if [[ -z "$NHK_DAS_ID" ]]; then
    echo "ERROR: NHK URL detected but --nhk-das-id not provided" >&2
    exit 1
  fi

  echo "[1/2] Downloading NHK 学習メモ PDF…"
  pdf_url="https://edu.web.nhk/kokokoza/download/pdf/?das_id=${NHK_DAS_ID}"
  pdf_path="${OUT_DIR}/.notes.pdf"

  if ! command -v curl >/dev/null; then
    echo "ERROR: curl not found. Install with: apt-get install curl" >&2
    exit 1
  fi

  if ! command -v pdftotext >/dev/null; then
    echo "ERROR: pdftotext not found. Install with: apt-get install poppler-utils" >&2
    exit 1
  fi

  curl -s -o "$pdf_path" "$pdf_url" || {
    echo "ERROR: Failed to download PDF from $pdf_url" >&2
    exit 2
  }

  if [[ ! -s "$pdf_path" ]]; then
    echo "ERROR: Downloaded PDF is empty or missing" >&2
    rm -f "$pdf_path"
    exit 2
  fi

  echo "[2/2] Extracting Japanese text from PDF…"
  python3 - "$pdf_path" "${OUT_DIR}/transcript.md" <<'PY'
import subprocess, re, sys
pdf, out = sys.argv[1], sys.argv[2]

text = subprocess.run(["pdftotext", "-", pdf], capture_output=True, text=True, check=True).stdout

lines = []
for raw in text.split("\n"):
    line = raw.strip()
    if not line:
        continue
    if re.match(r"^(P\d+|ページ\d+|-+)$", line):
        continue
    if re.match(r"^(あ|い|う|え|お).*", line) and len(line) < 10:
        continue
    if line.startswith(("学習メモ", "NHK", "©")):
        continue
    lines.append(line)

deduped = []
for l in lines:
    if not deduped or deduped[-1] != l:
        deduped.append(l)

with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(deduped) + "\n")
print(f"  wrote {out} ({len(deduped)} lines from PDF)")
PY

  rm -f "$pdf_path"
  echo "Done. Review ${OUT_DIR}/transcript.md (may need cleanup — PDF extraction is approximate)."

else
  # YouTube path
  if ! command -v yt-dlp >/dev/null; then
    echo "yt-dlp not found. Install with: pip install --user yt-dlp" >&2
    exit 1
  fi

  VTT_PATH="${OUT_DIR}/.captions.vtt"

  echo "[1/3] Listing available subtitle tracks…"
  yt-dlp --list-subs "$URL" 2>&1 | sed -n '/Available subtitles\|Available automatic captions/,/^\s*$/p' || true

  echo "[2/3] Downloading Japanese subtitles (manual preferred, auto fallback)…"
  if yt-dlp \
      --skip-download \
      --write-sub --sub-lang "ja,ja-JP,ja-Jpan" --sub-format vtt \
      -o "${OUT_DIR}/.captions.%(ext)s" \
      "$URL" 2>/dev/null && ls "${OUT_DIR}"/.captions*.vtt >/dev/null 2>&1; then
    echo "  -> got manual subtitles"
  else
    echo "  -> no manual subs, trying auto-generated"
    yt-dlp \
      --skip-download \
      --write-auto-sub --sub-lang "ja,ja-JP,ja-Jpan" --sub-format vtt \
      -o "${OUT_DIR}/.captions.%(ext)s" \
      "$URL"
  fi

  src=$(ls "${OUT_DIR}"/.captions*.vtt 2>/dev/null | head -n1 || true)
  if [[ -z "$src" ]]; then
    echo "ERROR: no .vtt file was produced (video may have no Japanese captions)" >&2
    exit 2
  fi
  [[ "$src" != "$VTT_PATH" ]] && mv "$src" "$VTT_PATH"

  echo "[3/3] Cleaning VTT -> transcript.md"
  python3 - "$VTT_PATH" "${OUT_DIR}/transcript.md" <<'PY'
import re, sys
vtt, out = sys.argv[1], sys.argv[2]
lines = []
with open(vtt, encoding="utf-8") as f:
    for raw in f:
        line = raw.rstrip("\n")
        if line.startswith(("WEBVTT", "NOTE", "STYLE", "Kind:", "Language:")):
            continue
        if "-->" in line:
            continue
        if not line.strip():
            continue
        if re.fullmatch(r"\d+", line.strip()):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line.strip())

  deduped = []
  for l in lines:
      if not deduped or deduped[-1] != l:
          deduped.append(l)

  with open(out, "w", encoding="utf-8") as f:
      f.write("\n".join(deduped) + "\n")
  print(f"  wrote {out} ({len(deduped)} lines)")
PY

  echo "Done. Review ${OUT_DIR}/transcript.md and clean up auto-caption noise if needed."
fi
