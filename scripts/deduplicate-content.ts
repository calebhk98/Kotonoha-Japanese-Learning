import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface ContentMetadata {
  id: string;
  title: string;
  type: 'story' | 'music' | 'video';
  [key: string]: any;
}

function getContentHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('md5').update(content).digest('hex');
}

function loadMetadata(metadataPath: string): ContentMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  } catch {
    return null;
  }
}

function removeDuplicates() {
  const duplicates: Map<
    string,
    Array<{
      path: string;
      metadataPath: string;
      folderPath: string;
      id: string;
      type: string;
      metadata: ContentMetadata;
    }>
  > = new Map();

  const contentBaseDir = path.join(process.cwd(), 'src');

  // First pass: collect all content with hashes
  for (const contentType of ['stories', 'music', 'videos']) {
    const typeDir = path.join(contentBaseDir, contentType);
    if (!fs.existsSync(typeDir)) continue;

    const folders = fs.readdirSync(typeDir).filter(f => {
      return fs.statSync(path.join(typeDir, f)).isDirectory();
    });

    for (const folder of folders) {
      const folderPath = path.join(typeDir, folder);
      const metadataPath = path.join(folderPath, 'metadata.json');
      const contentFileName = contentType === 'stories' ? 'content.md' : 'transcript.md';
      const contentPath = path.join(folderPath, contentFileName);

      if (!fs.existsSync(metadataPath) || !fs.existsSync(contentPath)) continue;

      const metadata = loadMetadata(metadataPath);
      if (!metadata) continue;

      const hash = getContentHash(contentPath);

      if (!duplicates.has(hash)) {
        duplicates.set(hash, []);
      }

      duplicates.get(hash)!.push({
        path: contentPath,
        metadataPath,
        folderPath,
        id: metadata.id,
        type: contentType,
        metadata,
      });
    }
  }

  // Second pass: identify and remove duplicates
  const removed: Array<{ type: string; id: string; reason: string }> = [];
  let totalFreed = 0;

  for (const [hash, items] of duplicates) {
    if (items.length <= 1) continue; // Not a duplicate

    // Sort to determine which to keep: stories > music > videos, then by ID
    const sorted = [...items].sort((a, b) => {
      const typePriority = { story: 0, music: 1, video: 2 };
      if (typePriority[a.type] !== typePriority[b.type]) {
        return typePriority[a.type] - typePriority[b.type];
      }
      return a.id.localeCompare(b.id);
    });

    const keep = sorted[0];
    const toRemove = sorted.slice(1);

    for (const item of toRemove) {
      try {
        // Calculate freed space
        const metadataSize = fs.statSync(item.metadataPath).size;
        const contentSize = fs.statSync(item.path).size;
        const freed = metadataSize + contentSize;
        totalFreed += freed;

        // Remove the folder
        fs.rmSync(item.folderPath, { recursive: true, force: true });

        removed.push({
          type: item.type,
          id: item.id,
          reason: `Duplicate of ${keep.type}/${keep.id}`,
        });

        console.log(`✓ Removed ${item.type}/${item.id} (freed ${freed} bytes)`);
      } catch (error) {
        console.error(
          `✗ Error removing ${item.type}/${item.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // Summary
  console.log('\n========== DEDUPLICATION SUMMARY ==========');
  console.log(`Total items removed: ${removed.length}`);
  console.log(`Total space freed: ${(totalFreed / 1024).toFixed(2)} KB`);
  console.log(`\nRemoved items:`);

  for (const item of removed) {
    console.log(`  - ${item.type}/${item.id}: ${item.reason}`);
  }
}

removeDuplicates();
