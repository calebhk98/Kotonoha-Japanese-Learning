import { createTokenizer } from "./src/lib/tokenizers.js";

const testText = `はじめまして。

わたしのなまえはたなかです。

にほんじんです。

とうきょうにすんでいます。

がくせいです。

どうぞよろしくおねがいします。`;

console.log("Input text:");
console.log(JSON.stringify(testText));
console.log("\n---\n");

async function test() {
  const tokenizer = await createTokenizer();
  const segments = await tokenizer.segment(testText);

  console.log(`Total segments: ${segments.length}`);
  console.log("\nSegments:");
  segments.forEach((seg, i) => {
    console.log(`[${i}] "${seg}" (length: ${seg.length}, repr: ${JSON.stringify(seg)})`);
  });
}

test().catch(console.error);
