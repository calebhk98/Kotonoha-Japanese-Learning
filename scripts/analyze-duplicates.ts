import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface ContentMetadata {
  id: string;
  title: string;
  type: 'story' | 'music' | 'video';
  description: string;
  level?: string;
  imageUrl?: string;
  mediaUrl?: string;
  tags?: string[];
  author?: string;
  artist?: string;
  creator?: string;
  dateAdded?: string;
}

interface DuplicateGroup {
  hash: string;
  count: number;
  items: Array<{
    path: string;
    id: string;
    type: 'story' | 'music' | 'video';
    metadata: ContentMetadata;
    fileSize: number;
  }>;
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

function analyze() {
  const duplicates: Map<string, DuplicateGroup> = new Map();
  const contentBaseDir = path.join(process.cwd(), 'src');

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
      const fileSize = fs.statSync(contentPath).size;

      if (!duplicates.has(hash)) {
        duplicates.set(hash, {
          hash,
          count: 0,
          items: [],
        });
      }

      const group = duplicates.get(hash)!;
      group.count++;
      group.items.push({
        path: contentPath,
        id: metadata.id,
        type: contentType as 'story' | 'music' | 'video',
        metadata,
        fileSize,
      });
    }
  }

  // Filter to only groups with duplicates
  const duplicateGroups = Array.from(duplicates.values()).filter(g => g.count > 1);

  console.log(`\n========== DUPLICATE ANALYSIS ==========`);
  console.log(`Total duplicate groups: ${duplicateGroups.length}`);
  console.log(`Total duplicate items: ${duplicateGroups.reduce((sum, g) => sum + g.count, 0)}\n`);

  // Sort by count (most duplicated first)
  duplicateGroups.sort((a, b) => b.count - a.count);

  for (const group of duplicateGroups) {
    console.log(`\n--- Hash: ${group.hash} (${group.count} copies) ---`);
    console.log(`Content size: ${group.items[0].fileSize} bytes\n`);

    for (const item of group.items) {
      console.log(
        `  [${item.type.toUpperCase()}] ${item.id}: "${item.metadata.title}"`
      );
      console.log(`    Path: ${item.path}`);
      if (item.metadata.dateAdded) {
        console.log(`    Added: ${item.metadata.dateAdded}`);
      }
      if (item.metadata.description) {
        console.log(`    Desc: ${item.metadata.description.substring(0, 60)}...`);
      }
    }
  }

  // Print deduplication suggestions
  console.log(`\n\n========== DEDUPLICATION STRATEGY ==========`);
  console.log(`Based on analysis, here are recommended items to keep (one per group):\n`);

  for (const group of duplicateGroups) {
    // Strategy: keep the first by ID (lowest), prioritize stories > music > videos
    const sorted = [...group.items].sort((a, b) => {
      const typePriority = { story: 0, music: 1, video: 2 };
      if (typePriority[a.type] !== typePriority[b.type]) {
        return typePriority[a.type] - typePriority[b.type];
      }
      return a.id.localeCompare(b.id);
    });

    const keep = sorted[0];
    const remove = sorted.slice(1);

    console.log(`Keep: ${keep.type}/${keep.id} (${keep.metadata.title})`);
    console.log(`Remove: ${remove.map(r => `${r.type}/${r.id}`).join(', ')}`);
    console.log('');
  }

  return duplicateGroups;
}

analyze();
