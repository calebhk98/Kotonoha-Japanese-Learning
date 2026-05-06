import kanjiData from "kanji-data";

const words = kanjiData.getWords('水');
console.log('Words for 水:', words.slice(0, 5));
