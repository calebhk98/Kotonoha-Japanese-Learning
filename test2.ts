import kanjiData from "kanji-data";

console.time("search1");
kanjiData.searchWords("今日");
console.timeEnd("search1");

console.time("search2");
kanjiData.searchWords("天気");
console.timeEnd("search2");

console.time("search3");
kanjiData.searchWords("です");
console.timeEnd("search3");
