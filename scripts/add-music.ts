#!/usr/bin/env npx tsx
/**
 * CLI tool to add new music to the collection.
 *
 * Usage:
 *   npx tsx scripts/add-music.ts --id "pokemon-theme" --title "めざせポケモンマスター" \
 *     --level N5 --youtube "https://www.youtube.com/watch?v=..." \
 *     --lyrics-url "https://www.uta-net.com/song/9951/" \
 *     --lyricist "戸田昭吾" --composer "たなかひろかず" --performer "松本梨香" \
 *     --year 1997 --tags "anime,children's song,1997"
 *
 *   npx tsx scripts/add-music.ts --help
 */

import fs from "fs";
import path from "path";
import { fetchUnetLyrics } from "./fetch-uta-net.js";

interface MusicArgs {
  id?: string;
  title?: string;
  description?: string;
  level?: string;
  youtube?: string;
  "lyrics-url"?: string;
  lyricist?: string;
  composer?: string;
  performer?: string;
  year?: string;
  tags?: string;
  "no-fetch"?: boolean;
  help?: boolean;
}

function parseArgs(): MusicArgs {
  const args: MusicArgs = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--no-fetch") {
      args["no-fetch"] = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) {
        args[key as keyof MusicArgs] = process.argv[++i] as never;
      }
    }
  }

  return args;
}

function showHelp() {
  console.log(`
🎵 Add New Music

Usage: npx tsx scripts/add-music.ts [options]

Required Options:
  --id ID               Unique ID (e.g., pokemon-theme)
  --title TITLE         Song title in Japanese
  --level LEVEL         Difficulty: N5, N4, N3, N2, N1
  --youtube URL         YouTube link
  --lyrics-url URL      uta-net.com or j-lyric.net URL
  --lyricist NAME       作詞
  --composer NAME       作曲
  --performer NAME      歌手
  --year YEAR           Release year (YYYY)

Optional Options:
  --description TEXT    Song description (long-form context)
  --tags TAGS           Comma-separated tags (e.g., anime,children's song,2008)
  --no-fetch            Create metadata only; don't fetch lyrics from URL

Examples:
  npx tsx scripts/add-music.ts \\
    --id pokemon-theme \\
    --title "めざせポケモンマスター" \\
    --level N5 \\
    --youtube "https://www.youtube.com/watch?v=jbHG7fsZVkM" \\
    --lyrics-url "https://www.uta-net.com/song/9951/" \\
    --lyricist "戸田昭吾" --composer "たなかひろかず" --performer "松本梨香" \\
    --year 1997 \\
    --tags "anime,children's song,1997,opening-theme"
`);
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Validate required fields
  const required = [
    "id",
    "title",
    "level",
    "youtube",
    "lyrics-url",
    "lyricist",
    "composer",
    "performer",
    "year",
  ];
  const missing = required.filter((k) => !args[k as keyof MusicArgs]);

  if (missing.length > 0) {
    console.error(
      `❌ Missing required options: ${missing.join(", ")}\n`
    );
    showHelp();
    process.exit(1);
  }

  const musicDir = path.join(process.cwd(), "src", "music", args.id!);

  // Check if already exists
  if (fs.existsSync(musicDir)) {
    console.error(`❌ Directory already exists: ${musicDir}`);
    process.exit(1);
  }

  // Create directory
  fs.mkdirSync(musicDir, { recursive: true });
  console.log(`✅ Created directory: ${musicDir}`);

  // Parse tags
  const tags = args.tags
    ? args.tags.split(",").map((t) => t.trim())
    : [];

  // Build license field
  const licenseText =
    `© ${args.lyricist} (lyrics) / ${args.composer} (music). ` +
    `All rights reserved. This app links externally and does not host the lyrics. ` +
    `Lyrics are served from ${args["lyrics-url"]} for educational purposes.`;

  // Create metadata.json
  const metadata = {
    id: args.id,
    title: args.title,
    type: "music",
    description:
      args.description ||
      `${args.title} (${args.year}) performed by ${args.performer}. ` +
      `Lyrics by ${args.lyricist}, music by ${args.composer}.`,
    level: args.level,
    tags,
    sourceUrl: args["lyrics-url"],
    mediaUrl: args.youtube,
    license: licenseText,
  };

  const metadataPath = path.join(musicDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  console.log(`✅ Created: ${metadataPath}`);

  // Fetch or create placeholder transcript
  const transcriptPath = path.join(musicDir, "transcript.md");

  if (args["no-fetch"]) {
    // Write placeholder
    fs.writeFileSync(
      transcriptPath,
      `# ${args.title}\n\n` +
        `Lyrics to be sourced from: ${args["lyrics-url"]}\n` +
        `(Placeholder — run with fetch to populate)\n`
    );
    console.log(`✅ Created placeholder: ${transcriptPath}`);
  } else {
    // Attempt to fetch
    console.log(`⏳ Fetching lyrics from ${args["lyrics-url"]}...`);
    const lyrics = await fetchUnetLyrics(args["lyrics-url"]!);

    if (lyrics) {
      fs.writeFileSync(transcriptPath, lyrics + "\n");
      console.log(`✅ Created: ${transcriptPath}`);
    } else {
      // Fallback to placeholder
      fs.writeFileSync(
        transcriptPath,
        `# ${args.title}\n\n` +
          `(Fetch failed. Please copy lyrics manually from: ${args["lyrics-url"]})\n`
      );
      console.log(
        `⚠️  Fetch failed. Created placeholder: ${transcriptPath}`
      );
    }
  }

  console.log(`\n✨ Music added: ${args.id}`);
  console.log(`   Title:      ${args.title}`);
  console.log(`   Level:      ${args.level}`);
  console.log(`   Performer:  ${args.performer}`);
  console.log(`   Year:       ${args.year}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
