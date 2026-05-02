import { createTokenizer } from "./src/lib/tokenizers.js";

const testText = `むかしむかし、あるところに、おじいさんとおばあさんがいました。おじいさんは山へ川へ洗濯に行きました。おばあさんが川で洗濯をしていると、大きな桃が流れてきました`;

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
