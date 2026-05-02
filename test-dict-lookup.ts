import kanjiData from "kanji-data";

console.log("Testing dictionary lookups:\n");

const words = ["好き", "好きです", "描く", "描きました", "考える", "考えました"];

for (const word of words) {
  const results = kanjiData.searchWords(word);
  console.log(`"${word}": found ${results.length} entries`);
  if (results.length > 0) {
    const first = results[0] as any;
    console.log(`  First variant: written="${first.variants?.[0]?.written}", pronounced="${first.variants?.[0]?.pronounced}"`);
    console.log(`  Meaning: ${first.meanings?.[0]?.glosses?.slice(0, 3).join(", ")}`);
  }
}
