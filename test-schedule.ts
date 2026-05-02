import { createTokenizer } from "./src/lib/tokenizers.js";

const testText = `まいあさ、ろくじにおきます。

あさごはんをたべます。

はちじにがっこうへいきます。

ごごさんじにかえります。

よる、べんきょうします。

じゅうじにねます。`;

async function test() {
  const tokenizer = await createTokenizer();
  const segments = await tokenizer.segment(testText);

  console.log("Tokenized output:\n");
  segments.forEach((seg) => {
    console.log(seg + " | ");
  });

  console.log("\n\nTotal segments:", segments.length);
}

test().catch(console.error);
