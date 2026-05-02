import { createTokenizer } from './src/lib/tokenizers.js';

const tokenizer = await createTokenizer();

const testWords = ['食べました', '会いました', '着いて'];

for (const word of testWords) {
  const tokens = await tokenizer.segment(word);
  console.log(`\n${word}:`);
  tokens.forEach(t => {
    console.log(`  surface: "${t.surface}", baseForm: "${t.baseForm}"`);
  });
}
