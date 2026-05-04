# Story Collection

Stories for Japanese language learning are stored as individual folders, each containing:
- `metadata.json` - Story metadata (title, description, level, etc.)
- `content.md` - Story content in markdown format

## Directory Structure

```
src/stories/
├── story-folder-1/
│   ├── metadata.json
│   └── content.md
├── story-folder-2/
│   ├── metadata.json
│   └── content.md
└── ...
```

## Adding a New Story

### Quick Method: Use the CLI

```bash
npm run add-story -- --title "Story Title" --description "A description"
```

Optional flags:
- `--level n5` - Set difficulty level (n5, n4, n3, etc.)
- `--imageUrl https://...` - Add story cover image

### Manual Method

1. Create a new folder: `src/stories/my-story-name/`
2. Add `metadata.json`:
   ```json
   {
     "id": "story-123",
     "title": "My Story Title",
     "type": "story",
     "description": "A brief description",
     "level": "n5",
     "imageUrl": "https://...",
     "dateAdded": "2026-05-04"
   }
   ```
3. Add `content.md` with your story:
   ```markdown
   # My Story

   日本語のストーリーをここに書きます。

   マークダウン形式で書くことができます。
   ```

## Story Metadata Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | ✓ | string | Unique identifier (e.g., "story-123") |
| `title` | ✓ | string | Story title in Japanese and English |
| `type` | ✓ | string | Must be "story" |
| `description` | ✓ | string | Brief description of the story |
| `level` | ✗ | string | JLPT level: n5, n4, n3, n2, n1 |
| `imageUrl` | ✗ | string | URL to story cover image |
| `tags` | ✗ | string[] | Tags for categorization |
| `author` | ✗ | string | Story author/contributor |
| `dateAdded` | ✗ | ISO string | Date story was added |

## Content Guidelines

- Write in **Japanese** (hiragana, katakana, and kanji)
- Use **Markdown format** for content
- Keep stories **appropriate for learners**
- Aim for **clear, simple language** based on intended level

## Testing Stories

After adding or modifying stories:

```bash
# Quick test (summary only)
npm run test:stories

# Full test with detailed output
npm run test:stories:full
```

## Migrating from Old Format

If moving stories from `src/data/content.ts`:

```bash
npm run migrate-stories
```

This will automatically convert all hardcoded stories to the new file-based format.

## Future Features

- Admin interface for adding/editing stories
- Web UI story editor
- Story categories and search
- User-submitted stories
- Story statistics and analytics
