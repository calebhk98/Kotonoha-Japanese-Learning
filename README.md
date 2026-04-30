# Kotonoha - Japanese Learning App

A smart vocabulary learning tool that analyzes Japanese content (stories, videos, music) and helps you track progress. The app intelligently scores words based on JLPT levels, kanji complexity, and frequency.

## Features

- **Content Analysis**: Extract vocabulary from any Japanese text
- **Smart Scoring**: Words are scored based on JLPT level, kanji grade, and frequency in standard Japanese corpora
- **Progress Tracking**: Mark words as known and track your learning progress
- **Import/Export**: Back up and restore your vocabulary progress
- **Offline Ready**: All data stored locally in your browser via localStorage
- **No API Keys**: Everything runs locally — no external AI services needed

## Quick Start

**Prerequisites**: Node.js 18+ (Rust will be auto-installed if needed)

```bash
# Install dependencies (also builds Sudachi WASM tokenizer)
npm install

# Start dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

> **Note**: First-time setup automatically installs Rust and builds the Sudachi WASM tokenizer (~3-5 minutes). See [TOKENIZER_SETUP.md](TOKENIZER_SETUP.md) for detailed instructions and troubleshooting.

## How It Works

1. **Local Processing**: Japanese text is tokenized using **Sudachi WASM** (a WebAssembly tokenizer with 83% accuracy on hiragana words)
2. **Word Dictionary**: Words are looked up in the `kanji-data` dictionary to determine meanings and readings
3. **Scoring System**:
   - **JLPT Points**: N5 (+15) → N1 (+100) based on kanji difficulty
   - **Kanji Penalties**: Grades 1-6 add +5 to +20 points; non-standard kanji add +30
   - **Frequency Adjustments**: Common words get -20 to -10; rare words get +40 to +50
4. **Content Difficulty**: Stories are sorted by the total score of unknown words

## Build & Deploy

```bash
# Build for production
npm run build

# Preview production build
npm preview
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js
- **Libraries**: kuromoji (tokenizer), kanji-data (dictionary), lucide-react (icons)

## Development Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Check TypeScript compilation
- `npm run clean` - Remove build artifacts
