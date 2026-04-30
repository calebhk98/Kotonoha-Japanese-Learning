# Tokenizer Setup Guide

## Quick Start

The project uses **Sudachi WASM** for accurate Japanese tokenization (83% accuracy on hiragana words).

### First-Time Setup (One Command)

```bash
npm run setup-sudachi
```

This automatically:
- Clones the Sudachi repository
- Downloads the UniDic dictionary
- Builds the WASM binary (~2-3 minutes)
- Copies to `sudachi-wasm-built/`

### Run the Server

```bash
npm run dev
```

The server will use Sudachi WASM by default for tokenization.

## Troubleshooting

### "Sudachi WASM not initialized" Error

**Solution**: Run the setup script
```bash
npm run setup-sudachi
```

### "Rust not found" Error During Setup

**Solution**: Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Then retry:
```bash
npm run setup-sudachi
```

### "wasm-pack not found" Error

**Solution**: Let the setup script install it (it will automatically)
```bash
npm run setup-sudachi
```

### Setup Takes Too Long

The first build compiles Rust to WebAssembly (2-3 minutes). Subsequent runs are instant because the built files are cached.

If interrupted, just run again:
```bash
npm run setup-sudachi
```

## Switching Tokenizers

### Use TinySegmenter (Fallback)
```bash
TOKENIZER=tinysegmenter npm run dev
```

### Use Sudachi WASM (Default)
```bash
TOKENIZER=sudachi-wasm npm run dev
# or simply:
npm run dev
```

## What Gets Built?

The setup script builds:
- **index.js** - JavaScript wrapper for WASM
- **index_bg.wasm** - Binary WASM module (208MB)
  - Contains Sudachi morphological analyzer
  - Includes UniDic dictionary (2025 update)
  - Supports 3 tokenization modes (A, B, C)
- **index_bg.wasm.d.ts** - TypeScript type definitions

Location: `sudachi-wasm-built/`

## How Tokenization Works

### Input
```
"わたしのなまえはたなかです"
```

### Sudachi Morphemes (Raw)
```
わたし (noun)
の (particle)
なまえ (noun)
は (particle)
た (verb)
なか (suffix)
です (aux)
```

### Smart Filtering
1. Filters out particles (は, が, を, etc.)
2. Combines prefixes with following words
3. Combines suffixes with preceding words
4. Filters punctuation

### Result
```
わたし
なまえ
たなか ✓ (combined "た" + "なか")
です
```

## Accuracy

| Tokenizer | Accuracy | Speed | Notes |
|-----------|----------|-------|-------|
| Sudachi WASM | 83% | ~3ms | Default, recommended |
| TinySegmenter | 60% | <1ms | Fallback, lightweight |
| Kuromoji | 20% | ~10ms | Poor hiragana support |

Test case: 6 critical hiragana words
- Sudachi gets 5/6 correct (83%)
- TinySegmenter gets 3/6 correct (50%)

## Development

### Testing Different Tokenizers

```bash
# Test Sudachi WASM
node test-sudachi-improved.mjs

# Test TinySegmenter  
node test-simple.mjs

# Compare tokenization modes
node test-sudachi-modes.mjs
```

### Updating the Dictionary

To use a newer UniDic version:

1. Download the latest dictionary from [Sudachi Dictionary Releases](https://github.com/WorksApplications/SudachiDict/releases)
2. Build with the new dictionary:
   ```bash
   cd /tmp/sudachi.rs
   SUDACHI_WASM_EMBED_DICTIONARY=/path/to/new/dict.dic npm run build:embed
   ```
3. Copy to your project:
   ```bash
   cp -r pkg /path/to/project/sudachi-wasm-built
   ```

## FAQ

**Q: Do I need to rebuild Sudachi WASM?**
A: No, the setup script handles everything. Just run it once per computer.

**Q: Can I share sudachi-wasm-built/ across computers?**
A: Yes, the WASM binary is platform-independent. You can commit a pre-built version or share it.

**Q: What if the build fails?**
A: Check that you have:
- Rust installed (`rustc --version`)
- Node.js 18+ (`node --version`)
- 2GB+ free disk space
- Internet connection (for dependencies)

**Q: Can I use a different dictionary?**
A: Yes, rebuild the WASM with a different dictionary file. See "Updating the Dictionary" above.

**Q: What's the difference between tokenization modes A, B, C?**
- **A (Shortest path)**: Most splits, fastest
- **B (Moderate)**: Balanced
- **C (Compound)**: Fewest splits, keeps compounds together (default, most accurate)

---

For more details, see the [tokenizer implementation](src/lib/tokenizers.ts) and [issue #23](https://github.com/calebhk98/Kotonoha-Japanese-Learning/issues/23).
