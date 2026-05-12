#!/usr/bin/env bash
# Pull Japanese captions for a YouTube URL into a transcript.md file.
#
# Usage:
#   scripts/dev/pull-video-captions.sh <youtube_url> <video_id>
#   scripts/dev/pull-video-captions.sh https://www.youtube.com/watch?v=ABC123 nhk-history-meiji
#
# Output:
#   src/videos/<video_id>/transcript.md   (cleaned plain text, captions only)
#   src/videos/<video_id>/.captions.vtt   (raw WebVTT, for reference)
#
# Tries manual (uploader) Japanese subtitles first, then auto-generated as a
# fallback. Auto-generated captions are noisy and need a human pass.

set -euo pipefail

URL="${1:-}"
ID="${2:-}"

if [[ -z "$URL" || -z "$ID" ]]; then
  echo "Usage: $0 <youtube_url> <video_id>" >&2
  exit 1
fi

if ! command -v yt-dlp >/dev/null; then
  echo "yt-dlp not found. Install with: pip install --user yt-dlp" >&2
  exit 1
fi

OUT_DIR="src/videos/${ID}"
mkdir -p "$OUT_DIR"
VTT_PATH="${OUT_DIR}/.captions.vtt"

echo "[1/3] Listing available subtitle tracks…"
yt-dlp --list-subs "$URL" 2>&1 | sed -n '/Available subtitles\|Available automatic captions/,/^\s*$/p' || true

echo "[2/3] Downloading Japanese subtitles (manual preferred, auto fallback)…"
# Manual subs first
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

# yt-dlp names the file something like .captions.ja.vtt — normalize.
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
        # Skip WebVTT header, timing cues, blank lines, NOTE/STYLE blocks, cue ids
        if line.startswith(("WEBVTT", "NOTE", "STYLE", "Kind:", "Language:")):
            continue
        if "-->" in line:
            continue
        if not line.strip():
            continue
        if re.fullmatch(r"\d+", line.strip()):
            continue
        # Strip inline timing tags like <00:00:01.000><c>
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line.strip())

# Dedup consecutive duplicate lines (auto-captions repeat lines as they grow)
deduped = []
for l in lines:
    if not deduped or deduped[-1] != l:
        deduped.append(l)

with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(deduped) + "\n")
print(f"  wrote {out} ({len(deduped)} lines)")
PY

echo "Done. Review ${OUT_DIR}/transcript.md and clean up auto-caption noise if needed."
