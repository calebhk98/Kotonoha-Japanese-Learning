#!/usr/bin/env tsx
/**
 * Summarize metadata across src/videos/* so we can see what fields the
 * existing entries actually use, what levels/creators/tags are represented,
 * and which entries are missing fields like mediaUrl or transcript.md.
 *
 * Usage: npx tsx scripts/dev/video-metadata-summary.ts
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const VIDEOS_DIR = join(process.cwd(), "src", "videos");

type Meta = {
  id?: string;
  title?: string;
  type?: string;
  description?: string;
  level?: string;
  tags?: string[];
  creator?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  license?: string;
  dateAdded?: string;
  [k: string]: unknown;
};

type Row = {
  dir: string;
  meta: Meta | null;
  hasTranscript: boolean;
  transcriptLines: number;
  fields: string[];
};

const rows: Row[] = [];

for (const name of readdirSync(VIDEOS_DIR).sort()) {
  const full = join(VIDEOS_DIR, name);
  if (!statSync(full).isDirectory()) continue;

  const metaPath = join(full, "metadata.json");
  const transcriptPath = join(full, "transcript.md");

  let meta: Meta | null = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch (e) {
      meta = null;
    }
  }

  let transcriptLines = 0;
  const hasTranscript = existsSync(transcriptPath);
  if (hasTranscript) {
    transcriptLines = readFileSync(transcriptPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0).length;
  }

  rows.push({
    dir: name,
    meta,
    hasTranscript,
    transcriptLines,
    fields: meta ? Object.keys(meta) : [],
  });
}

console.log(`# Video metadata summary (${rows.length} folders)\n`);

// ---- 1. Field usage across metadata.json ----
const fieldCounts = new Map<string, number>();
for (const r of rows) {
  for (const f of r.fields) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
}
console.log("## Field coverage");
for (const [f, c] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(16)} ${c}/${rows.length}`);
}

// ---- 2. Level distribution ----
console.log("\n## Level distribution");
const levelCounts = new Map<string, number>();
for (const r of rows) {
  const lvl = r.meta?.level ?? "(missing)";
  levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
}
for (const [lvl, c] of [...levelCounts.entries()].sort()) {
  console.log(`  ${lvl.padEnd(10)} ${c}`);
}

// ---- 3. Creator distribution ----
console.log("\n## Creator distribution");
const creatorCounts = new Map<string, number>();
for (const r of rows) {
  const c = r.meta?.creator ?? "(missing)";
  creatorCounts.set(c, (creatorCounts.get(c) ?? 0) + 1);
}
for (const [c, n] of [...creatorCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}  ${c}`);
}

// ---- 4. Tag distribution (top 30) ----
console.log("\n## Top tags");
const tagCounts = new Map<string, number>();
for (const r of rows) {
  for (const t of r.meta?.tags ?? []) {
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
}
const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [t, n] of topTags) {
  console.log(`  ${String(n).padStart(2)}  ${t}`);
}

// ---- 5. Health checks ----
console.log("\n## Health checks");
const missingMedia = rows.filter((r) => !r.meta?.mediaUrl);
const missingTranscript = rows.filter((r) => !r.hasTranscript);
const missingLevel = rows.filter((r) => !r.meta?.level);
const missingSource = rows.filter((r) => !r.meta?.sourceUrl);
console.log(`  missing mediaUrl:    ${missingMedia.length}  -> ${missingMedia.map((r) => r.dir).join(", ") || "(none)"}`);
console.log(`  missing transcript:  ${missingTranscript.length}  -> ${missingTranscript.map((r) => r.dir).join(", ") || "(none)"}`);
console.log(`  missing level:       ${missingLevel.length}  -> ${missingLevel.map((r) => r.dir).join(", ") || "(none)"}`);
console.log(`  missing sourceUrl:   ${missingSource.length}  -> ${missingSource.map((r) => r.dir).join(", ") || "(none)"}`);

// ---- 6. Per-video one-line summary ----
console.log("\n## Per-video summary");
console.log("level     | lines | dir | mediaUrl");
console.log("----------+-------+-----+---------");
for (const r of rows) {
  const lvl = (r.meta?.level ?? "?").padEnd(9);
  const lines = String(r.transcriptLines).padStart(5);
  const url = r.meta?.mediaUrl ?? "(no mediaUrl)";
  console.log(`${lvl} | ${lines} | ${r.dir} | ${url}`);
}
