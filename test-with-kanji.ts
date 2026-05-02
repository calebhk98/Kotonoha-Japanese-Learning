import { createTokenizer } from "./src/lib/tokenizers.js";

const hiraganaOnly = `まいあさ、ろくじにおきます。

あさごはんをたべます。

はちじにがっこうへいきます。

ごごさんじにかえります。

よる、べんきょうします。

じゅうじにねます。`;

const withKanji = `毎朝、六時に起きます。

朝食を食べます。

八時に学校へ行きます。

午後三時に帰ります。

夜、勉強します。

十時に寝ます。`;

async function test() {
  const tokenizer = await createTokenizer();

  console.log("=== HIRAGANA ONLY ===\n");
  const hiraganaSegments = await tokenizer.segment(hiraganaOnly);
  hiraganaSegments.forEach(seg => console.log(seg + " | "));

  console.log("\n\n=== WITH KANJI ===\n");
  const kanjiSegments = await tokenizer.segment(withKanji);
  kanjiSegments.forEach(seg => console.log(seg + " | "));
}

test().catch(console.error);
