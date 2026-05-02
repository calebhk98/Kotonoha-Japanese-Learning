import { createTokenizer } from './src/lib/tokenizers.js';

const tokenizer = await createTokenizer();
const tokens = await tokenizer.segment('好きです');
console.log('Tokens for 好きです:');
tokens.forEach((t, i) => {
  console.log(`[${i}] surface: "${t.surface}", baseForm: "${t.baseForm}"`);
});

const tokens2 = await tokenizer.segment('描きました');
console.log('\nTokens for 描きました:');
tokens2.forEach((t, i) => {
  console.log(`[${i}] surface: "${t.surface}", baseForm: "${t.baseForm}"`);
});
