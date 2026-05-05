import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gunzipAsync = promisify(gunzip);

export async function ensureJmnedictPrepared(): Promise<string | null> {
  const projectRoot = path.join(__dirname, '../..');
  const jmnedictFile = path.join(projectRoot, 'jmnedict.json');
  const jmnedictGzFile = path.join(projectRoot, 'jmnedict.json.gz');

  // Check if already extracted
  if (existsSync(jmnedictFile)) {
    console.log('[JMnedict] Found dictionary file');
    return jmnedictFile;
  }

  // Try to decompress from .gz file
  if (existsSync(jmnedictGzFile)) {
    console.log('[JMnedict] Decompressing dictionary...');
    try {
      const data = readFileSync(jmnedictGzFile);
      const decompressed = await gunzipAsync(data);
      writeFileSync(jmnedictFile, decompressed);
      console.log('[JMnedict] Successfully decompressed dictionary');
      return jmnedictFile;
    } catch (e: any) {
      console.warn('[JMnedict] Failed to decompress:', e.message);
      return null;
    }
  }

  console.warn('[JMnedict] No dictionary file available');
  return null;
}
