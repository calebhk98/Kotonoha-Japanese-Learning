#!/bin/bash

# Enable better error handling
set -o pipefail

# Pinned upstream commit of https://github.com/hi-ogawa/sudachi.rs (issue #250).
# The reading/dictionary_form patch (scripts/sudachi-wasm-reading.patch) and the
# committed WASM artifacts were verified against exactly this commit — bump it
# deliberately, rebuild, re-run the tokenization fingerprint check, and recommit
# the artifacts together.
SUDACHI_RS_COMMIT=20af696d463884590ba40d15be08d7f163663d67

echo "🔨 Setting up Sudachi WASM (binary + separate UniDic dictionary)..."
echo ""

# ---------------------------------------------------------------------------
# Fast paths: use existing/compressed artifacts when possible (issue #254:
# the dictionary ships as system.dic[.gz] SEPARATE from the wasm binary, so
# glue rebuilds don't recommit a 200MB blob. Legacy embedded builds — a
# single index_bg.wasm > 100MB — are still recognized and work).
# ---------------------------------------------------------------------------
mkdir -p sudachi-wasm-built

decompress_if_needed() {
    local gz="$1" out="$2"
    if [ -f "$gz" ] && [ ! -f "$out" ]; then
        echo "📦 Decompressing $(basename "$out")..."
        gunzip -c "$gz" > "$out"
        echo "✅ $(basename "$out") ready ($(du -sh "$out" | cut -f1))"
    fi
}

decompress_if_needed sudachi-wasm-built/index_bg.wasm.gz sudachi-wasm-built/index_bg.wasm
decompress_if_needed sudachi-wasm-built/system.dic.gz  sudachi-wasm-built/system.dic

if [ -f "sudachi-wasm-built/index_bg.wasm" ]; then
    WASM_BYTES=$(stat -c%s sudachi-wasm-built/index_bg.wasm 2>/dev/null || stat -f%z sudachi-wasm-built/index_bg.wasm)
    if [ -f "sudachi-wasm-built/system.dic" ]; then
        echo "✅ Sudachi WASM ready (split build: wasm + system.dic)"
        exit 0
    elif [ "$WASM_BYTES" -gt 100000000 ]; then
        echo "✅ Sudachi WASM ready (legacy embedded-dictionary build)"
        exit 0
    else
        echo "⚠️  Split-build wasm present but system.dic missing — rebuilding."
    fi
fi

# ---------------------------------------------------------------------------
# Full build from source
# ---------------------------------------------------------------------------
echo "📋 Checking prerequisites..."
if ! command -v cargo &> /dev/null; then
    echo "📦 Rust not found. Installing Rust..."
    echo "   ⏳ Downloading and installing (this may take 1-2 minutes)..."
    if curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; then
        export PATH="$HOME/.cargo/bin:$PATH"
        echo "✅ Rust installed successfully"
        echo "   $(rustc --version)"
        echo ""
    else
        echo "❌ Failed to install Rust. Please install manually from https://rustup.rs/"
        exit 1
    fi
fi

set -e
if ! command -v wasm-pack &> /dev/null; then
    echo "📦 Installing wasm-pack..."
    echo "   ⏳ Downloading and compiling (this may take 1-2 minutes)..."
    cargo install wasm-pack
    echo "✅ wasm-pack installed: $(wasm-pack --version)"
    echo ""
fi

echo "✅ Prerequisites met"
echo ""

PROJECT_DIR=$(pwd)
TEMP_DIR=$(mktemp -d)

echo "📥 Cloning Sudachi repository (pinned: ${SUDACHI_RS_COMMIT:0:12})..."
cd "$TEMP_DIR"
git init -q sudachi-rs
cd sudachi-rs
git remote add origin https://github.com/hi-ogawa/sudachi.rs.git
git fetch --depth 1 origin "$SUDACHI_RS_COMMIT"
git checkout -q "$SUDACHI_RS_COMMIT"
echo "✅ Repository at pinned commit"

echo ""
echo "🩹 Applying Kotonoha patch (expose reading_form / dictionary_form)..."
if ! git apply --check "$PROJECT_DIR/scripts/sudachi-wasm-reading.patch"; then
    echo "❌ Patch no longer applies — upstream drifted past the pinned commit?"
    exit 1
fi
git apply "$PROJECT_DIR/scripts/sudachi-wasm-reading.patch"
echo "✅ Patch applied"

echo ""
echo "📚 Downloading dictionary..."
echo "   ⏳ Fetching UniDic dictionary (68 MB)..."
bash fetch_dictionary.sh
echo "✅ Dictionary downloaded"

echo ""
echo "🔨 Building Sudachi WASM (dictionary NOT embedded — issue #254)..."
echo "   ⏳ This will take 2-3 minutes (compiling Rust to WebAssembly)..."
cd sudachi-wasm

echo ""
echo "   Step 1/2: Building WebAssembly binary..."
# No `cargo update` here: the patch carries an updated Cargo.lock (the
# upstream lockfile's wasm-bindgen doesn't compile on current Rust), so
# dependency versions are pinned by the patch itself.
npx --yes wasm-pack build --target web --out-name index
rm -f pkg/package.json pkg/.gitignore pkg/README.md
echo "✅ WASM binary built successfully"

echo ""
echo "   Step 2/2: Installing to project..."
cd "$PROJECT_DIR"
cp "$TEMP_DIR/sudachi-rs/sudachi-wasm/pkg/"* sudachi-wasm-built/ 2>/dev/null || true
# Remove any legacy embedded artifacts so the split pair is authoritative
cp "$TEMP_DIR/sudachi-rs/resources/system.dic" sudachi-wasm-built/system.dic

echo "   Compressing artifacts for git (committed as *.gz)..."
gzip -9 -c sudachi-wasm-built/index_bg.wasm > sudachi-wasm-built/index_bg.wasm.gz
gzip -9 -c sudachi-wasm-built/system.dic  > sudachi-wasm-built/system.dic.gz

WASM_SIZE=$(du -sh sudachi-wasm-built/index_bg.wasm | cut -f1)
DICT_SIZE=$(du -sh sudachi-wasm-built/system.dic | cut -f1)

rm -rf "$TEMP_DIR"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Sudachi WASM setup complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "   Location:     sudachi-wasm-built/"
echo "   Binary:       index_bg.wasm (${WASM_SIZE}, glue only)"
echo "   Dictionary:   system.dic (${DICT_SIZE}, UniDic — loaded at runtime)"
echo "   Pinned src:   hi-ogawa/sudachi.rs @ ${SUDACHI_RS_COMMIT:0:12}"
echo "   Tokenizer:    Sudachi WASM (Mode C - Compound)"
echo ""
echo "🚀 You can now run:"
echo "   npm run dev"
echo ""
