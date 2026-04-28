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
  meaning: string;
  jlpt: number;     // 1 to 5, where 5 is N5, 1 is N1, 0 if NA
  joyo: boolean;
  score: number;    // 1-100 (1=beginner, 100=native)
  breakdown?: ScoreBreakdown;
}

export type LessonType = 'mcq' | 'flashcard'; // multiple choice or flashcards
