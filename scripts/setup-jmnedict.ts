#!/usr/bin/env node
import { createWriteStream, existsSync, rmSync } from 'fs';
import { createGunzip } from 'zlib';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JMNEDICT_FILE = path.join(__dirname, 'jmnedict.json');
const JMNEDICT_GZ = path.join(__dirname, '.jmnedict.xml.gz');

function extractXmlValue(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1] : undefined;
}

function extractXmlValues(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const matches = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

async function downloadAndConvertJMnedict() {
  if (existsSync(JMNEDICT_FILE)) {
    console.log('✓ jmnedict.json already exists');
    return;
  }

  console.log('Downloading JMnedict dictionary (this may take a minute)...');
  console.log('From: http://ftp.edrdg.org/pub/Nihongo/JMnedict.xml.gz');

  return new Promise<void>((resolve, reject) => {
    const entries: any[] = [];
    let entryCount = 0;
    let startTime = Date.now();
    let buffer = '';

    const gunzip = createGunzip();
    const writeStream = createWriteStream(JMNEDICT_FILE);
    let firstWrite = true;

    gunzip.on('data', (chunk) => {
      buffer += chunk.toString();

      while (buffer.includes('</entry>')) {
        const startIdx = buffer.indexOf('<entry>');
        const endIdx = buffer.indexOf('</entry>') + '</entry>'.length;

        if (startIdx === -1) break;

        const entryXml = buffer.substring(startIdx, endIdx);
        buffer = buffer.substring(endIdx);

        try {
          const reb = extractXmlValue(entryXml, 'reb');
          if (!reb) continue;

          const keb = extractXmlValue(entryXml, 'keb');
          const meanings = extractXmlValues(entryXml, 'trans_det');
          if (meanings.length === 0) continue;

          const entry = { kana: reb, kanji: keb, meanings };
          entries.push(entry);
          entryCount++;

          if (entries.length >= 10000) {
            if (firstWrite) {
              writeStream.write('[\n');
              firstWrite = false;
            } else {
              writeStream.write(',\n');
            }
            writeStream.write(entries.map(e => JSON.stringify(e)).join(',\n'));
            entries.length = 0;

            if (entryCount % 100000 === 0) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              process.stdout.write(`\r  Processed ${entryCount} entries (${elapsed}s)...`);
            }
          }
        } catch (e) {
          // Skip parse errors
        }
      }
    });

    gunzip.on('end', () => {
      if (entries.length > 0) {
        if (firstWrite) {
          writeStream.write('[\n');
          firstWrite = false;
        } else {
          writeStream.write(',\n');
        }
        writeStream.write(entries.map(e => JSON.stringify(e)).join(',\n'));
      }
      writeStream.write('\n]\n');
      writeStream.end();
    });

    writeStream.on('finish', () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`\n✓ JMnedict setup complete: ${entryCount} entries in ${elapsed}s`);
      if (existsSync(JMNEDICT_GZ)) {
        rmSync(JMNEDICT_GZ);
      }
      resolve();
    });

    writeStream.on('error', reject);
    gunzip.on('error', reject);

    // Download and decompress
    const request = https.get(
      'https://ftp.edrdg.org/pub/Nihongo/JMnedict.xml.gz',
      { timeout: 120000 },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(gunzip);
      }
    );

    request.on('error', (e) => {
      console.warn(
        `\n⚠ Failed to download JMnedict: ${(e as any).message}\n` +
        `  The app will use a limited sample dictionary instead.\n` +
        `  To get the full dictionary later, run: npm run setup-jmnedict`
      );
      if (existsSync(JMNEDICT_GZ)) {
        rmSync(JMNEDICT_GZ);
      }
      resolve(); // Don't fail, just continue with sample
    });

    request.setTimeout(120000);
  });
}

downloadAndConvertJMnedict().catch(console.error);
