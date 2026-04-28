export type ContentType = 'story' | 'video' | 'music';

export interface Content {
  id: string;
  title: string;
  type: ContentType;
  description: string;
  text: string; // The transcript or story
  mediaUrl?: string;
  imageUrl?: string;
}

export const INITIAL_CONTENT: Content[] = [
  {
    id: "story-1",
    title: "桃太郎 (Momotaro) - Beginner",
    type: "story",
    description: "The classic Japanese folktale of Momotaro, the peach boy.",
    text: "むかしむかし、あるところに、おじいさんとおばあさんがいました。おじいさんは山へ川へ洗濯に行きました。おばあさんが川で洗濯をしていると、大きな桃が流れてきました。",
    imageUrl: "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?q=80&w=600&auto=format&fit=crop"
  },
  {
    id: "story-2",
    title: "東京旅行 (Tokyo Trip)",
    type: "story",
    description: "A short diary entry about a trip to Tokyo.",
    text: "昨日、新幹線で東京に行きました。東京はとても人が多くて賑やかでした。昼ごはんに美味しいお寿司を食べました。とても楽しい一日でした。",
    imageUrl: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=600&auto=format&fit=crop"
  },
  {
    id: "music-1",
    title: "桜の季節 (Season of Sakura)",
    type: "music",
    description: "A beautiful acoustic song about cherry blossoms.",
    text: "春の風が吹いて、桜の花びらが舞い散る。君と一緒に歩いた道を思い出す。桜の季節はいつも少し寂しい。",
    mediaUrl: "https://www.youtube.com/watch?v=0k1J9E72aB8", // Random relaxing JP music
    imageUrl: "https://images.unsplash.com/photo-1493957988430-a5f2e15f39a3?q=80&w=600&auto=format&fit=crop"
  },
  {
    id: "video-1",
    title: "Making Matcha (Vlog)",
    type: "video",
    description: "Learn how to prepare traditional Japanese matcha tea.",
    text: "本日は、伝統的な抹茶の点て方をご紹介します。まず、お湯を沸かし、茶碗を温めます。次に、抹茶の粉を入れます。そして、茶筅で素早く泡立てます。完成です。",
    mediaUrl: "https://www.youtube.com/watch?v=YfW5m2Mh4gA", // Making matcha
    imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?q=80&w=600&auto=format&fit=crop"
  },
  {
    id: "story-3",
    title: "星空の夜 (Starry Night)",
    type: "story",
    description: "A relaxing short read about stargazing.",
    text: "夜空を見上げると、無数の星が輝いていました。宇宙の広さを感じながら、私は静かに深呼吸をしました。",
    imageUrl: "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?q=80&w=600&auto=format&fit=crop"
  }
];


export const GENERATED_CONTENT: Content[] = [
  {
    "id": "content-10",
    "title": "学校 (School) #95",
    "type": "video",
    "description": "A short video about 学校 (School).",
    "text": "明日から夏休みです。海に行きたいです。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-11",
    "title": "趣味 (Hobbies) #41",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "美味しいラーメンを食べました。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-12",
    "title": "旅行 (Travel) #96",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-13",
    "title": "学校 (School) #33",
    "type": "music",
    "description": "A short music about 学校 (School).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-14",
    "title": "スポーツ (Sports) #95",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "美味しいラーメンを食べました。 昨日、新しい本を買いました。面白かったです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-15",
    "title": "学校 (School) #33",
    "type": "music",
    "description": "A short music about 学校 (School).",
    "text": "明日から夏休みです。海に行きたいです。 今日はいい天気です。散歩に行きました。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-16",
    "title": "仕事 (Work) #71",
    "type": "music",
    "description": "A short music about 仕事 (Work).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-17",
    "title": "季節 (Seasons) #42",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "明日から夏休みです。海に行きたいです。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-18",
    "title": "食べ物 (Food) #4",
    "type": "music",
    "description": "A short music about 食べ物 (Food).",
    "text": "昨日、新しい本を買いました。面白かったです。 桜が咲いています。春が来ましたね。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-19",
    "title": "趣味 (Hobbies) #12",
    "type": "story",
    "description": "A short story about 趣味 (Hobbies).",
    "text": "猫が寝ています。とても可愛いです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-20",
    "title": "季節 (Seasons) #14",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-21",
    "title": "旅行 (Travel) #10",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-22",
    "title": "スポーツ (Sports) #48",
    "type": "story",
    "description": "A short story about スポーツ (Sports).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-23",
    "title": "旅行 (Travel) #96",
    "type": "music",
    "description": "A short music about 旅行 (Travel).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-24",
    "title": "動物 (Animals) #40",
    "type": "video",
    "description": "A short video about 動物 (Animals).",
    "text": "今日はいい天気です。散歩に行きました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-25",
    "title": "季節 (Seasons) #22",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-26",
    "title": "趣味 (Hobbies) #85",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "今日はいい天気です。散歩に行きました。 美味しいラーメンを食べました。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-27",
    "title": "季節 (Seasons) #5",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-28",
    "title": "仕事 (Work) #43",
    "type": "video",
    "description": "A short video about 仕事 (Work).",
    "text": "桜が咲いています。春が来ましたね。 昨日、新しい本を買いました。面白かったです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-29",
    "title": "食べ物 (Food) #45",
    "type": "story",
    "description": "A short story about 食べ物 (Food).",
    "text": "今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-30",
    "title": "学校 (School) #93",
    "type": "video",
    "description": "A short video about 学校 (School).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-31",
    "title": "旅行 (Travel) #62",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "美味しいラーメンを食べました。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-32",
    "title": "趣味 (Hobbies) #22",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-33",
    "title": "動物 (Animals) #80",
    "type": "video",
    "description": "A short video about 動物 (Animals).",
    "text": "今日はいい天気です。散歩に行きました。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-34",
    "title": "季節 (Seasons) #12",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-35",
    "title": "季節 (Seasons) #69",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "今日はいい天気です。散歩に行きました。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-36",
    "title": "食べ物 (Food) #45",
    "type": "video",
    "description": "A short video about 食べ物 (Food).",
    "text": "今日はいい天気です。散歩に行きました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-37",
    "title": "趣味 (Hobbies) #28",
    "type": "music",
    "description": "A short music about 趣味 (Hobbies).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-38",
    "title": "スポーツ (Sports) #41",
    "type": "story",
    "description": "A short story about スポーツ (Sports).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-39",
    "title": "仕事 (Work) #7",
    "type": "story",
    "description": "A short story about 仕事 (Work).",
    "text": "今日はいい天気です。散歩に行きました。 美味しいラーメンを食べました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-40",
    "title": "旅行 (Travel) #76",
    "type": "music",
    "description": "A short music about 旅行 (Travel).",
    "text": "美味しいラーメンを食べました。 桜が咲いています。春が来ましたね。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-41",
    "title": "動物 (Animals) #12",
    "type": "video",
    "description": "A short video about 動物 (Animals).",
    "text": "明日から夏休みです。海に行きたいです。 桜が咲いています。春が来ましたね。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-42",
    "title": "動物 (Animals) #30",
    "type": "story",
    "description": "A short story about 動物 (Animals).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-43",
    "title": "旅行 (Travel) #50",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-44",
    "title": "仕事 (Work) #98",
    "type": "music",
    "description": "A short music about 仕事 (Work).",
    "text": "明日から夏休みです。海に行きたいです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-45",
    "title": "旅行 (Travel) #93",
    "type": "story",
    "description": "A short story about 旅行 (Travel).",
    "text": "桜が咲いています。春が来ましたね。 昨日、新しい本を買いました。面白かったです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-46",
    "title": "学校 (School) #89",
    "type": "story",
    "description": "A short story about 学校 (School).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-47",
    "title": "仕事 (Work) #89",
    "type": "video",
    "description": "A short video about 仕事 (Work).",
    "text": "明日から夏休みです。海に行きたいです。 明日から夏休みです。海に行きたいです。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-48",
    "title": "仕事 (Work) #45",
    "type": "video",
    "description": "A short video about 仕事 (Work).",
    "text": "猫が寝ています。とても可愛いです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-49",
    "title": "旅行 (Travel) #9",
    "type": "story",
    "description": "A short story about 旅行 (Travel).",
    "text": "明日から夏休みです。海に行きたいです。 今日はいい天気です。散歩に行きました。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-50",
    "title": "動物 (Animals) #62",
    "type": "music",
    "description": "A short music about 動物 (Animals).",
    "text": "今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-51",
    "title": "学校 (School) #49",
    "type": "video",
    "description": "A short video about 学校 (School).",
    "text": "桜が咲いています。春が来ましたね。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-52",
    "title": "食べ物 (Food) #58",
    "type": "video",
    "description": "A short video about 食べ物 (Food).",
    "text": "美味しいラーメンを食べました。 美味しいラーメンを食べました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-53",
    "title": "学校 (School) #71",
    "type": "music",
    "description": "A short music about 学校 (School).",
    "text": "桜が咲いています。春が来ましたね。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-54",
    "title": "食べ物 (Food) #37",
    "type": "music",
    "description": "A short music about 食べ物 (Food).",
    "text": "桜が咲いています。春が来ましたね。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-55",
    "title": "スポーツ (Sports) #43",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。 桜が咲いています。春が来ましたね。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-56",
    "title": "仕事 (Work) #9",
    "type": "story",
    "description": "A short story about 仕事 (Work).",
    "text": "明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-57",
    "title": "趣味 (Hobbies) #79",
    "type": "music",
    "description": "A short music about 趣味 (Hobbies).",
    "text": "桜が咲いています。春が来ましたね。 今日はいい天気です。散歩に行きました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-58",
    "title": "動物 (Animals) #41",
    "type": "story",
    "description": "A short story about 動物 (Animals).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-59",
    "title": "食べ物 (Food) #61",
    "type": "music",
    "description": "A short music about 食べ物 (Food).",
    "text": "猫が寝ています。とても可愛いです。 明日から夏休みです。海に行きたいです。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-60",
    "title": "旅行 (Travel) #44",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-61",
    "title": "季節 (Seasons) #98",
    "type": "story",
    "description": "A short story about 季節 (Seasons).",
    "text": "桜が咲いています。春が来ましたね。 美味しいラーメンを食べました。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-62",
    "title": "動物 (Animals) #39",
    "type": "story",
    "description": "A short story about 動物 (Animals).",
    "text": "今日はいい天気です。散歩に行きました。 今日はいい天気です。散歩に行きました。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-63",
    "title": "季節 (Seasons) #93",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "今日はいい天気です。散歩に行きました。 明日から夏休みです。海に行きたいです。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-64",
    "title": "スポーツ (Sports) #27",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-65",
    "title": "季節 (Seasons) #62",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "昨日、新しい本を買いました。面白かったです。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-66",
    "title": "趣味 (Hobbies) #32",
    "type": "music",
    "description": "A short music about 趣味 (Hobbies).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-67",
    "title": "趣味 (Hobbies) #59",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-68",
    "title": "仕事 (Work) #62",
    "type": "music",
    "description": "A short music about 仕事 (Work).",
    "text": "桜が咲いています。春が来ましたね。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-69",
    "title": "趣味 (Hobbies) #53",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "今日はいい天気です。散歩に行きました。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-70",
    "title": "仕事 (Work) #47",
    "type": "music",
    "description": "A short music about 仕事 (Work).",
    "text": "昨日、新しい本を買いました。面白かったです。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-71",
    "title": "季節 (Seasons) #63",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "猫が寝ています。とても可愛いです。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-72",
    "title": "趣味 (Hobbies) #10",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-73",
    "title": "旅行 (Travel) #64",
    "type": "video",
    "description": "A short video about 旅行 (Travel).",
    "text": "美味しいラーメンを食べました。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-74",
    "title": "学校 (School) #95",
    "type": "video",
    "description": "A short video about 学校 (School).",
    "text": "今日はいい天気です。散歩に行きました。 猫が寝ています。とても可愛いです。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-75",
    "title": "スポーツ (Sports) #67",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-76",
    "title": "趣味 (Hobbies) #31",
    "type": "music",
    "description": "A short music about 趣味 (Hobbies).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-77",
    "title": "スポーツ (Sports) #7",
    "type": "story",
    "description": "A short story about スポーツ (Sports).",
    "text": "昨日、新しい本を買いました。面白かったです。 美味しいラーメンを食べました。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-78",
    "title": "スポーツ (Sports) #37",
    "type": "video",
    "description": "A short video about スポーツ (Sports).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-79",
    "title": "スポーツ (Sports) #35",
    "type": "video",
    "description": "A short video about スポーツ (Sports).",
    "text": "桜が咲いています。春が来ましたね。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-80",
    "title": "食べ物 (Food) #26",
    "type": "video",
    "description": "A short video about 食べ物 (Food).",
    "text": "猫が寝ています。とても可愛いです。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-81",
    "title": "季節 (Seasons) #64",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-82",
    "title": "動物 (Animals) #97",
    "type": "story",
    "description": "A short story about 動物 (Animals).",
    "text": "明日から夏休みです。海に行きたいです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-83",
    "title": "季節 (Seasons) #54",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "昨日、新しい本を買いました。面白かったです。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-84",
    "title": "食べ物 (Food) #73",
    "type": "music",
    "description": "A short music about 食べ物 (Food).",
    "text": "今日はいい天気です。散歩に行きました。 昨日、新しい本を買いました。面白かったです。 昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-85",
    "title": "スポーツ (Sports) #58",
    "type": "video",
    "description": "A short video about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-86",
    "title": "趣味 (Hobbies) #20",
    "type": "music",
    "description": "A short music about 趣味 (Hobbies).",
    "text": "桜が咲いています。春が来ましたね。 桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-87",
    "title": "スポーツ (Sports) #33",
    "type": "story",
    "description": "A short story about スポーツ (Sports).",
    "text": "明日から夏休みです。海に行きたいです。 美味しいラーメンを食べました。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-88",
    "title": "食べ物 (Food) #96",
    "type": "story",
    "description": "A short story about 食べ物 (Food).",
    "text": "今日はいい天気です。散歩に行きました。 猫が寝ています。とても可愛いです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-89",
    "title": "旅行 (Travel) #56",
    "type": "music",
    "description": "A short music about 旅行 (Travel).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-90",
    "title": "動物 (Animals) #69",
    "type": "music",
    "description": "A short music about 動物 (Animals).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-91",
    "title": "趣味 (Hobbies) #7",
    "type": "story",
    "description": "A short story about 趣味 (Hobbies).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-92",
    "title": "季節 (Seasons) #6",
    "type": "video",
    "description": "A short video about 季節 (Seasons).",
    "text": "美味しいラーメンを食べました。 昨日、新しい本を買いました。面白かったです。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-93",
    "title": "仕事 (Work) #19",
    "type": "music",
    "description": "A short music about 仕事 (Work).",
    "text": "猫が寝ています。とても可愛いです。 美味しいラーメンを食べました。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-94",
    "title": "学校 (School) #89",
    "type": "story",
    "description": "A short story about 学校 (School).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-95",
    "title": "仕事 (Work) #46",
    "type": "story",
    "description": "A short story about 仕事 (Work).",
    "text": "昨日、新しい本を買いました。面白かったです。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-96",
    "title": "食べ物 (Food) #31",
    "type": "story",
    "description": "A short story about 食べ物 (Food).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-97",
    "title": "趣味 (Hobbies) #82",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "桜が咲いています。春が来ましたね。"
  },
  {
    "id": "content-98",
    "title": "仕事 (Work) #97",
    "type": "story",
    "description": "A short story about 仕事 (Work).",
    "text": "明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-99",
    "title": "季節 (Seasons) #46",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "美味しいラーメンを食べました。 今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-100",
    "title": "食べ物 (Food) #31",
    "type": "story",
    "description": "A short story about 食べ物 (Food).",
    "text": "昨日、新しい本を買いました。面白かったです。 猫が寝ています。とても可愛いです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-101",
    "title": "季節 (Seasons) #70",
    "type": "story",
    "description": "A short story about 季節 (Seasons).",
    "text": "今日はいい天気です。散歩に行きました。"
  },
  {
    "id": "content-102",
    "title": "趣味 (Hobbies) #14",
    "type": "video",
    "description": "A short video about 趣味 (Hobbies).",
    "text": "美味しいラーメンを食べました。"
  },
  {
    "id": "content-103",
    "title": "スポーツ (Sports) #45",
    "type": "video",
    "description": "A short video about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-104",
    "title": "スポーツ (Sports) #37",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-105",
    "title": "趣味 (Hobbies) #45",
    "type": "story",
    "description": "A short story about 趣味 (Hobbies).",
    "text": "昨日、新しい本を買いました。面白かったです。 猫が寝ています。とても可愛いです。 猫が寝ています。とても可愛いです。"
  },
  {
    "id": "content-106",
    "title": "季節 (Seasons) #23",
    "type": "music",
    "description": "A short music about 季節 (Seasons).",
    "text": "桜が咲いています。春が来ましたね。 美味しいラーメンを食べました。"
  },
  {
    "id": "content-107",
    "title": "動物 (Animals) #97",
    "type": "video",
    "description": "A short video about 動物 (Animals).",
    "text": "明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-108",
    "title": "食べ物 (Food) #77",
    "type": "music",
    "description": "A short music about 食べ物 (Food).",
    "text": "昨日、新しい本を買いました。面白かったです。"
  },
  {
    "id": "content-109",
    "title": "スポーツ (Sports) #78",
    "type": "music",
    "description": "A short music about スポーツ (Sports).",
    "text": "猫が寝ています。とても可愛いです。 明日から夏休みです。海に行きたいです。"
  },
  {
    "id": "content-110",
    "title": "旅行 (Travel) #29",
    "type": "story",
    "description": "A short story about 旅行 (Travel).",
    "text": "今日はいい天気です。散歩に行きました。"
  }
];