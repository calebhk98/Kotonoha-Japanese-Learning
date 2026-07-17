#!/bin/bash

# Decompress dictionary cache files if compressed versions exist
# This allows users to avoid the ~20 minute cache rebuilding process

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

decompress_if_needed() {
  local compressed_file="$1"
  local decompressed_file="$2"

  if [ -f "$compressed_file" ]; then
    if [ ! -f "$decompressed_file" ] || [ "$compressed_file" -nt "$decompressed_file" ]; then
      echo "📦 Decompressing $compressed_file..."
      gunzip -c "$compressed_file" > "$decompressed_file"
      echo "✅ Decompressed $decompressed_file"
    fi
  fi
}

# Decompress cache files
decompress_if_needed ".word-cache.json.gz" ".word-cache.json"

echo "✨ Cache setup complete"
