import { createTokenizer } from "./src/lib/tokenizers.js";

const testText = `昨日、新幹線で東京に行きました。東京はとても人が多くて賑やかでした。昼ごはんに美味しいお寿司を食べました。とても楽しい一日でした。`;

async function test() {
  const tokenizer = await createTokenizer();
  const segments = await tokenizer.segment(testText);

  console.log("Tokenized output:\n");
  segments.forEach((seg) => {
    console.log(seg + " | ");
  });

  console.log("\nTotal segments:", segments.length);
}

test().catch(console.error);
