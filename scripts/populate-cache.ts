import { getStories } from '../src/data/content.js';
import http from 'http';

async function makeRequest(method: string, path: string, data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function populateCache() {
  console.log('Starting cache population via API...\n');
  
  const stories = getStories();
  let totalWords = 0;
  
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    console.log(`[${i+1}/${stories.length}] Processing: ${story.title}`);
    
    try {
      const result = await makeRequest('POST', '/api/batch-extract', {
        texts: [{
          id: story.id,
          text: story.text
        }]
      });
      
      if (result && result[0] && result[0].words) {
        const words = result[0].words.length;
        totalWords += words;
        console.log(`  ✓ Cached ${words} words\n`);
      }
    } catch (error) {
      console.error(`  ✗ Error: ${error}\n`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log(`\n✨ Cache population complete!`);
  console.log(`Total words processed: ${totalWords}`);
}

populateCache().catch(console.error);
