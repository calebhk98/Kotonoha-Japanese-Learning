# Kotonoha - Japanese Learning App

A smart vocabulary learning tool that analyzes Japanese content (stories, videos, music) and helps you track your progress. Read authentic Japanese stories, extract vocabulary, and build your language skills with intelligent word scoring based on JLPT levels and kanji complexity.

---

## Getting Started (5 minutes)

### Clone & Install

```bash
# Clone the repository
git clone https://github.com/calebhk98/Kotonoha-Japanese-Learning.git
cd Kotonoha-Japanese-Learning

# Install dependencies (Node.js 18+ required)
npm install
```

The install script automatically builds the **Sudachi WASM tokenizer** (a morphological analyzer that runs in your browser). If Rust isn't installed, it will be auto-installed during setup (~3-5 minutes total). This is needed to accurately break down Japanese text into words.

### Run the App

```bash
# Start the development server
npm run dev
```

Open your browser to **http://localhost:3000**

> **Troubleshooting**: If the tokenizer build fails, see [TOKENIZER_SETUP.md](TOKENIZER_SETUP.md) for detailed steps.

---

## Features

- **104 Curated Stories**: Classic folktales, modern stories, and literary classics from N5 (beginner) to N4 (intermediate)
- **Smart Vocabulary Extraction**: Japanese text is automatically tokenized and analyzed
- **Intelligent Scoring**: Words are scored by JLPT level, kanji complexity, and frequency
- **Progress Tracking**: Mark words as known and track your learning progress
- **Offline Ready**: All data stored locally in your browser (no account needed)
- **No API Keys**: Everything runs locally on your machine

## Content Library

The app includes **104 curated Japanese stories** organized by difficulty:

- **Classic Folktales** (16): Momotaro, Urashima Taro, Kaguya-hime, and more
- **N5 Everyday Stories** (57): Daily routines, school, food, nature, holidays, and more
- **N5-N4 Transition Classics** (13): Literary works from Akutagawa, Natsume Soseki, Miyazawa Kenji
- **Aesop's Fables** (7): Western classics adapted to Japanese
- **Themed Stories** (11): Seasonal, personal life, and specialized topics

See [STORIES_LIST.md](STORIES_LIST.md) for the complete catalog.

## How It Works

1. **Select a Story**: Browse 104 curated Japanese stories by difficulty level
2. **Extract Vocabulary**: The app automatically tokenizes the text and identifies unfamiliar words
3. **Score Words**: Each word gets a difficulty score based on:
   - JLPT level (N5 beginner to N1 advanced)
   - Kanji grade and complexity
   - Frequency in standard Japanese
4. **Track Progress**: Mark words as known and watch your vocabulary grow
5. **Practice**: Re-read stories to reinforce vocabulary

---

## For Developers

### Quick Start

Want to contribute stories, fix bugs, or extend features? See [DEVELOPMENT.md](DEVELOPMENT.md) for:
- Project structure overview
- How to add new stories
- Development workflow
- Running tests and linting
- Contributing guidelines

### Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js
- **Tokenization**: Sudachi WASM (default), Sudachi-TS, Lindera, Kuromoji, TinySegmenter
- **Dictionary**: kanji-data
- **UI**: lucide-react (icons)

### Development Scripts

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Check TypeScript compilation
npm run clean        # Remove build artifacts
npm run test         # Run tests
```

### Build & Deploy for Production

```bash
npm run build
npm run preview
```

---

## Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md) - Developer guide and contribution workflow
- [STORIES_LIST.md](STORIES_LIST.md) - Complete story catalog (104 implemented stories)
- [SONGS_LIST.md](SONGS_LIST.md) - Japanese songs for learning
- [VIDEOS.md](VIDEOS.md) - Japanese videos and content recommendations
- [TOKENIZER_SETUP.md](TOKENIZER_SETUP.md) - Tokenizer configuration and troubleshooting
