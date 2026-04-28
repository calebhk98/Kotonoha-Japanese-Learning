import kanjiData from "kanji-data";

const dictionaryEntries = kanjiData.searchWords("いい");
const goodMatches = dictionaryEntries.map(e => e.variants.filter(v => v.pronounced === 'いい' || v.written === 'いい')).flat();
console.log("Variations for いい:", goodMatches);

const jpDict = kanjiData.searchWords("良い");
console.log("Variations for 良い:", jpDict.map(e => e.variants));
