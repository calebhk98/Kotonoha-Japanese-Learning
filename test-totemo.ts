import kanjiData from "kanji-data";

const words = ['とても', 'とても美しかったです', 'とても楽しい'];

for (const word of words) {
  const results = kanjiData.searchWords(word);
  console.log(`"${word}": found ${results.length} entries`);
  if (results.length > 0) {
    const first = results[0] as any;
    console.log(`  Meaning: ${first.meanings?.[0]?.glosses?.slice(0, 2).join(", ")}`);
  }
}
