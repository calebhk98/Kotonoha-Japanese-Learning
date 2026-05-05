export interface ScoreBreakdown {
  jlptScore: number;
  joyoPenalty: number;
  highestGrade?: number | null;
  freqPenalty: number;     // adjustment based on rarity
  jlptValues: number[];    // jlpt levels of kanji found
  gradeValues: number[];   // kanji grades found
  priorities: string[];    // JMdict priority tags
}

export interface WordInfo {
  word: string;
  reading: string;
  meaning: string;               // primary meaning (most common)
  meanings?: string[];           // all meanings from dictionary, ordered by frequency
  jlpt: number;                  // 1 to 5, where 5 is N5, 1 is N1, 0 if NA
  joyo: boolean;
  score: number;                 // 1-100 (1=beginner, 100=native), adjusted if WaniKani data available
  baseScore?: number;            // original score before WaniKani adjustment
  wkMultiplier?: number;         // WaniKani SRS multiplier applied (0.05–1.0), undefined if no WK data
  wkSrsStage?: number;           // WaniKani SRS stage (1-9), undefined if not in WaniKani
  frequencyInContent?: number;   // how many times this word's base form appears in the source text
  breakdown?: ScoreBreakdown;
  isMorpheme?: boolean;          // true if this is a grammatical morpheme (conjugation, verb ending, etc.)
}

export type LessonType = 'mcq' | 'flashcard'; // multiple choice or flashcards
