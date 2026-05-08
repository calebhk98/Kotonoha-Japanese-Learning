#!/bin/bash

# Compress dictionary cache files for storage in git
# This reduces the cache from ~390MB to ~61MB for the word cache

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

compress_cache() {
  local file="$1"
  local compressed="$file.gz"
  local temp_file="${file}.tmp"

  if [ ! -f "$file" ]; then
    echo "⚠️  File not found: $file"
    return 1
  fi

  echo "🎨 Formatting $file with newlines..."
  # Format JSON with indentation for readability using streaming approach
  # This prevents corruption from partial writes or process interruption
  node -e "
    const fs = require('fs');
    const readline = require('readline');

    try {
      const data = JSON.parse(fs.readFileSync('$file', 'utf-8'));

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Write to temporary file first to avoid partial writes to original
        const tempFile = '$temp_file';
        const stream = fs.createWriteStream(tempFile, { flags: 'w', encoding: 'utf-8' });

        stream.on('error', (err) => {
          console.error('Write error:', err);
          process.exit(1);
        });

        const entries = Object.entries(data);
        stream.write('{\\n');

        for (let i = 0; i < entries.length; i++) {
          const [key, value] = entries[i];
          try {
            const keyStr = JSON.stringify(key);
            const valueStr = JSON.stringify(value);
            const line = '  ' + keyStr + ': ' + valueStr + (i < entries.length - 1 ? ',' : '');
            stream.write(line + '\\n');
          } catch (e) {
            console.error('Error serializing entry ' + i + ':', e.message);
            // Skip corrupted entries but continue
            if (i < entries.length - 1) {
              stream.write('  \"__error__\": null,\\n');
            }
          }
        }

        stream.write('}\\n');
        stream.end();

        stream.on('finish', () => {
          // Verify the temp file is valid JSON before replacing original
          try {
            JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
            fs.renameSync(tempFile, '$file');
            console.log('✓ Cache formatted successfully');
          } catch (e) {
            console.error('✗ Formatted cache is invalid JSON:', e.message);
            fs.unlinkSync(tempFile);
            process.exit(1);
          }
        });
      }
    } catch (e) {
      console.error('Error reading or parsing cache:', e.message);
      process.exit(1);
    }
  " || {
    rm -f "$temp_file"
    echo "⚠️  Failed to format cache"
    return 1
  }

  echo "📦 Compressing $file..."
  # -k keeps the original file, -9 uses maximum compression
  gzip -k -9 "$file" || {
    echo "⚠️  Failed to compress cache"
    return 1
  }

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
