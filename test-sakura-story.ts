import { createTokenizer } from "./src/lib/tokenizers.js";

const testText = `来週、私の親友のサクラちゃんの誕生日です。
「何をプレゼントしようかな」と考えました。
お金がないので、高いものは買えません。でも、何か特別なものをあげたいです。
そうだ！絵を描こうと思いました。サクラちゃんは絵が好きです。
一週間かけて、サクラちゃんの似顔絵を描きました。私たちが一緒に写っている絵です。
背景には桜の花を描きました。サクラちゃんの名前のように。
誕生日の日、サクラちゃんにプレゼントをあげました。
「わあ！すごい！ありがとう！」サクラちゃんはとても喜んでくれました。
「一生大切にするね」と言ってくれました。
私もとても嬉しかったです。`;

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
