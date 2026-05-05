export const morphemeDefinitions: Record<string, string> = {
  // Past tense marker
  た: "Past tense marker",
  だ: "Copula / To be",

  // Adjective endings
  い: "Adjective ending (-i adjective)",
  かった: "Past tense adjective",

  // Verb forms
  す: "Causative marker",
  される: "Passive voice marker",
  さ: "Passive voice marker",
  せ: "Causative passive",
  ん: "Negative form / Emphatic particle",
  ぬ: "Negative form (classical)",
  ない: "Negative form",
  なかった: "Past negative",

  // Auxiliary verbs and endings
  ます: "Polite form marker",
  ました: "Past polite form",
  なさい: "Imperative form",

  // Honorific/humble prefixes
  お: "Honorific prefix",
  ご: "Honorific prefix",

  // Conditional and tentative
  ば: "Conditional form",
  たら: "Conditional form",
  ます: "Polite form",
  ました: "Polite past form",
  て: "Conjunctive form",
  た: "Past tense",
  ている: "Progressive form (is doing)",

  // Sentence particles
  ね: "Sentence final particle (agreement/confirmation)",
  よ: "Sentence final particle (assertion/emphasis)",
  な: "Sentence final particle (prohibition/emphasis)",
  もの: "Sentence final particle (explanation)",

  // Other particles (that slipped through as single kana)
  も: "Also / too / even",
  か: "Question particle",
  の: "Possession / nominalizer",
  を: "Object marker",
  が: "Subject marker",
  は: "Topic marker",
  へ: "Direction marker",
  に: "Location / target marker",
  で: "Location / means marker",
  と: "With / and",
  から: "From / because",
  まで: "Until / up to",

  // Less common but significant
  し: "Verb stem / conditional form",
  する: "To do",
  いる: "To be (animate) / Progressive form",
  ある: "To be (inanimate) / to exist",
  いく: "To go / to continue",
  くる: "To come",

  // Small tsu variations
  っ: "Geminate consonant marker",

  // Negative variations
  ぬ: "Negative form (archaic/literary)",

  // Additional verb forms
  られる: "Passive / potential form",
  れる: "Passive / potential form",
  せる: "Causative form",

  // Verb stems and additional components
  き: "Verb stem / past tense form (行く→行った)",
  け: "Verb stem (助ける, etc.)",
  げ: "Verb stem (逃げる, etc.)",
  べ: "Verb stem (食べる, etc.)",
  り: "Verb connection / stem (帰る, etc.)",
  れ: "Verb stem variation",
  め: "Verb stem (止める, etc.)",
  じ: "Hour/o'clock indicator (時)",
  ま: "Counter/word component (毎朝, etc.)",
  あ: "Verb stem component",
  う: "Verb stem / auxiliary",
  く: "Verb stem / adverbial",
  み: "Suffix / verb stem",
  む: "Suffix / verb direction",
  ち: "Verb stem component",
};

export function getMorphemeDefinition(morpheme: string): string | undefined {
  return morphemeDefinitions[morpheme];
}

export function isMorpheme(token: string): boolean {
  return token.length === 1 && /[ぁ-ん]/.test(token) && morphemeDefinitions.hasOwnProperty(token);
}
