import { createTokenizer } from './src/lib/tokenizers.js';

const tokenizer = await createTokenizer();

const testPhrases = ['とても美しかったです', 'とても楽しい'];

for (const phrase of testPhrases) {
  const tokens = await tokenizer.segment(phrase);
  console.log(`\n${phrase}:`);
  tokens.forEach(t => {
    console.log(`  surface: "${t.surface}", baseForm: "${t.baseForm}"`);
  });
}
