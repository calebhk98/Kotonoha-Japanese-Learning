import kuromoji from "kuromoji";

const text = `はじめまして。

わたしのなまえはたなかです。

にほんじんです。

とうきょうにすんでいます。

がくせいです。

どうぞよろしくおねがいします。`;

kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
  if (err) {
    console.error("Error building tokenizer:", err);
    process.exit(1);
  }

  const tokens = tokenizer.tokenize(text);

  console.log("=== KUROMOJI TOKENIZATION OUTPUT ===\n");
  tokens.forEach((token, idx) => {
    console.log(`[${idx}] "${token.surface_form}" (basic: "${token.basic_form}")`);
  });

  console.log("\n=== WORDS ONLY (non-punctuation, non-single-kana) ===\n");
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const words = new Set<string>();
  tokens.forEach((token) => {
    if (token.surface_form.trim() === '' || isPunctuation(token.surface_form) || isSingleKana(token.surface_form)) {
      return;
    }
    const word = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    if (!isSingleKana(word)) {
      words.add(word);
    }
  });

  Array.from(words).forEach(word => console.log(`  - ${word}`));
});
