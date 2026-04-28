import fetch from 'node-fetch';
const ALL_CONTENT = [
  "むかしむかし、あるところに、おじいさんとおばあさんがいました。おじいさんは山へ川へ洗濯に行きました。おばあさんが川で洗濯をしていると、大きな桃が流れてきました。",
  "昨日、新幹線で東京に行きました。東京はとても人が多くて賑やかでした。昼ごはんに美味しいお寿司を食べました。とても楽しい一日でした。",
  "春の風が吹いて、桜の花びらが舞い散る。君と一緒に歩いた道を思い出す。桜の季節はいつも少し寂しい。",
  "本日は、伝統的な抹茶の点て方をご紹介します。まず、お湯を沸かし、茶碗を温めます。次に、抹茶の粉を入れます。そして、茶筅で素早く泡立てます。完成です。",
  "夜空を見上げると、無数の星が輝いていました。宇宙の広さを感じながら、私は静かに深呼吸をしました。"
]
async function run() {
  const reqs = ALL_CONTENT.map(text => fetch("http://localhost:3000/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      }).then(r => r.json()));
  await Promise.all(reqs);
  console.log("Done");
}
run();
