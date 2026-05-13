#!/usr/bin/env tsx
// Survey music metadata to understand sourceUrl / mediaUrl / license patterns
// across all songs currently on disk.
//
// Usage: npx tsx scripts/survey-music-sources.ts

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const MUSIC_DIR = join(process.cwd(), "src", "music");

type Entry = {
  id: string;
  title: string;
  level: string;
  tags: string[];
  sourceUrl?: string;
  mediaUrl?: string;
  license?: string;
  hasTranscript: boolean;
  transcriptLines: number;
};

const dirs = readdirSync(MUSIC_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const entries: Entry[] = [];
for (const id of dirs) {
  const metaPath = join(MUSIC_DIR, id, "metadata.json");
  const transcriptPath = join(MUSIC_DIR, id, "transcript.md");
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  const hasTranscript = existsSync(transcriptPath);
  const transcriptLines = hasTranscript
    ? readFileSync(transcriptPath, "utf-8").split("\n").filter((l) => l.trim()).length
    : 0;
  entries.push({
    id,
    title: meta.title ?? "",
    level: meta.level ?? "?",
    tags: meta.tags ?? [],
    sourceUrl: meta.sourceUrl,
    mediaUrl: meta.mediaUrl,
    license: meta.license,
    hasTranscript,
    transcriptLines,
  });
}

console.log(`Total songs: ${entries.length}\n`);

// Source URL host distribution
const hostCounts = new Map<string, number>();
const noSource: string[] = [];
for (const e of entries) {
  if (!e.sourceUrl) {
    noSource.push(e.id);
    continue;
  }
  try {
    const host = new URL(e.sourceUrl).host;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  } catch {
    hostCounts.set(`(invalid: ${e.sourceUrl})`, 1);
  }
}
console.log("=== Lyrics source hosts ===");
[...hostCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([h, n]) => console.log(`  ${n.toString().padStart(3)}  ${h}`));
if (noSource.length) console.log(`  (no sourceUrl: ${noSource.length}) -> ${noSource.join(", ")}`);

// Media URL host distribution
const mediaHostCounts = new Map<string, number>();
const noMedia: string[] = [];
for (const e of entries) {
  if (!e.mediaUrl) {
    noMedia.push(e.id);
    continue;
  }
  try {
    const host = new URL(e.mediaUrl).host;
    mediaHostCounts.set(host, (mediaHostCounts.get(host) ?? 0) + 1);
  } catch {
    mediaHostCounts.set(`(invalid: ${e.mediaUrl})`, 1);
  }
}
console.log("\n=== Media URL hosts ===");
[...mediaHostCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([h, n]) => console.log(`  ${n.toString().padStart(3)}  ${h}`));
if (noMedia.length) console.log(`  (no mediaUrl: ${noMedia.length}) -> ${noMedia.join(", ")}`);

// License patterns
const licenseFirstLine = new Map<string, number>();
const noLicense: string[] = [];
for (const e of entries) {
  if (!e.license) {
    noLicense.push(e.id);
    continue;
  }
  const first = e.license.split("\n")[0].slice(0, 80);
  licenseFirstLine.set(first, (licenseFirstLine.get(first) ?? 0) + 1);
}
console.log("\n=== License first-line patterns (top 10) ===");
[...licenseFirstLine.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([line, n]) => console.log(`  ${n.toString().padStart(3)}  ${line}`));
if (noLicense.length) console.log(`  (no license: ${noLicense.length})`);

// Transcript stats
const noTranscript = entries.filter((e) => !e.hasTranscript);
console.log(`\n=== Transcripts ===`);
console.log(`  with transcript:    ${entries.length - noTranscript.length}`);
console.log(`  without transcript: ${noTranscript.length}`);
if (noTranscript.length) console.log(`  missing: ${noTranscript.map((e) => e.id).join(", ")}`);

// Level distribution
const levelCounts = new Map<string, number>();
for (const e of entries) levelCounts.set(e.level, (levelCounts.get(e.level) ?? 0) + 1);
console.log(`\n=== Levels ===`);
[...levelCounts.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([l, n]) => console.log(`  ${l}: ${n}`));

// Pick a few full examples per source host for sub-agents to reference
console.log("\n=== Sample entries (one per source host) ===");
const seenHosts = new Set<string>();
for (const e of entries) {
  if (!e.sourceUrl) continue;
  let host = "";
  try {
    host = new URL(e.sourceUrl).host;
  } catch {
    continue;
  }
  if (seenHosts.has(host)) continue;
  seenHosts.add(host);
  console.log(`\n--- ${e.id} (${e.level}) ---`);
  console.log(`  title:     ${e.title}`);
  console.log(`  sourceUrl: ${e.sourceUrl}`);
  console.log(`  mediaUrl:  ${e.mediaUrl}`);
  console.log(`  license:   ${e.license?.slice(0, 120)}...`);
}
