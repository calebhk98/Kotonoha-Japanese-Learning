#!/bin/bash

# Compress dictionary cache files for storage in git
# This reduces the cache from ~390MB to ~61MB for the word cache

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

compress_cache() {
  local file="$1"
  local compressed="$file.gz"

  if [ ! -f "$file" ]; then
    echo "⚠️  File not found: $file"
    return 1
  fi

  echo "📦 Compressing $file..."
  # -k keeps the original file, -9 uses maximum compression
  gzip -k -9 "$file"

  local original_size=$(du -h "$file" | awk '{print $1}')
  local compressed_size=$(du -h "$compressed" | awk '{print $1}')
  echo "✅ Compressed: $original_size → $compressed_size"
}

echo "🔨 Compressing dictionary caches..."
echo ""

compress_cache ".word-cache.json" || echo "ℹ️  .word-cache.json not found (cache not yet built)"
compress_cache ".jisho-cache.json" || echo "ℹ️  .jisho-cache.json not found (cache not yet built)"

echo ""
echo "✨ Cache compression complete"
echo "You can now commit the .gz files to git"
