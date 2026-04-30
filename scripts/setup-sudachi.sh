#!/bin/bash

# Enable better error handling
set -o pipefail

echo "🔨 Setting up Sudachi WASM with embedded dictionary..."
echo ""

# Check if already built
if [ -d "sudachi-wasm-built" ] && [ -f "sudachi-wasm-built/index_bg.wasm" ]; then
    echo "✅ Sudachi WASM already built and present"
    echo "   Location: $(pwd)/sudachi-wasm-built/"
    echo "   Size: $(du -sh sudachi-wasm-built/index_bg.wasm | cut -f1)"
    exit 0
fi

# Check for required tools
echo "📋 Checking prerequisites..."
if ! command -v cargo &> /dev/null; then
    echo "📦 Rust not found. Installing Rust..."
    echo "   ⏳ Downloading and installing (this may take 1-2 minutes)..."

    # Download and run rustup installer with output
    if curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; then
        # Source the Rust environment
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

# Create temp directory for build
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "📥 Cloning Sudachi repository..."
echo "   ⏳ Downloading source code..."
cd "$TEMP_DIR"
git clone --depth 1 https://github.com/hi-ogawa/sudachi.rs.git sudachi-rs
echo "✅ Repository cloned"
cd sudachi-rs

echo ""
echo "📚 Downloading dictionary..."
echo "   ⏳ Fetching UniDic dictionary (68 MB)..."
bash fetch_dictionary.sh
echo "✅ Dictionary downloaded"

echo ""
echo "🔨 Building Sudachi WASM with embedded dictionary..."
echo "   ⏳ This will take 2-3 minutes (compiling Rust to WebAssembly)..."
echo "   Watch for 'Compiling' and 'Finished' messages below..."
cd sudachi-wasm

echo ""
echo "   Step 1/3: Updating Rust dependencies..."
cargo update --aggressive
echo "✅ Dependencies updated"

echo ""
echo "   Step 2/3: Building WebAssembly binary (main compilation)..."
SUDACHI_WASM_EMBED_DICTIONARY="../../resources/system.dic" npm run build:embed
echo "✅ WASM binary built successfully"

echo ""
echo "📦 Installing built WASM to project..."
ORIGINAL_DIR=$(pwd)
cd - > /dev/null  # Go back to original directory
mkdir -p sudachi-wasm-built
cp "$TEMP_DIR/sudachi-rs/sudachi-wasm/pkg/"* sudachi-wasm-built/
WASM_SIZE=$(du -sh sudachi-wasm-built/index_bg.wasm | cut -f1)
echo "✅ WASM binary installed (${WASM_SIZE})"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Sudachi WASM setup complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "   Location:     sudachi-wasm-built/"
echo "   Type:         WebAssembly binary with embedded dictionary"
echo "   Dictionary:   UniDic (2025 update)"
echo "   Size:         ~208 MB"
echo "   Accuracy:     83% on critical hiragana words"
echo "   Tokenizer:    Sudachi WASM (Mode C - Compound)"
echo ""
echo "🚀 You can now run:"
echo "   npm run dev"
echo ""
echo "💡 For future development:"
echo "   TOKENIZER=tinysegmenter npm run dev  (fallback: 60% accuracy)"
echo "   TOKENIZER=sudachi-wasm npm run dev   (default: 83% accuracy)"
echo ""
