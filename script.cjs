const fs = require('fs');

const types = ['story', 'music', 'video'];
const themes = ['旅行 (Travel)', '食べ物 (Food)', '仕事 (Work)', '学校 (School)', '趣味 (Hobbies)', '動物 (Animals)', '季節 (Seasons)', 'スポーツ (Sports)'];

const contents = [];

function generateText() {
    const sentences = [
        "今日はいい天気です。散歩に行きました。",
        "猫が寝ています。とても可愛いです。",
        "昨日、新しい本を買いました。面白かったです。",
        "桜が咲いています。春が来ましたね。",
        "美味しいラーメンを食べました。",
        "明日から夏休みです。海に行きたいです。"
    ];
    let numStr = Math.floor(Math.random() * 3) + 1;
    let s = [];
    for(let i=0; i<numStr; i++) s.push(sentences[Math.floor(Math.random()*sentences.length)]);
    return s.join(" ");
}

for(let i=10; i<=110; i++) {
  const type = types[Math.floor(Math.random() * types.length)];
  const theme = themes[Math.floor(Math.random() * themes.length)];

  contents.push({
    id: `content-${i}`,
    title: `${theme} #${Math.floor(Math.random()*100)}`,
    type: type,
    description: `A short ${type} about ${theme}.`,
    text: generateText(),
  });
}

const currentObj = fs.readFileSync('src/data/content.ts', 'utf8');
const toExport = "export const GENERATED_CONTENT: Content[] = " + JSON.stringify(contents, null, 2) + ";";

fs.writeFileSync('src/data/content.ts', currentObj + "\n\n" + toExport);
