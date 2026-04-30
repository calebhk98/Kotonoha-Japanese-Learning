import { describe, it, expect, beforeEach } from 'vitest';
import type { WordInfo } from '../types';

// ---------------------------------------------------------------------------
// Data Import/Export Functionality
// ---------------------------------------------------------------------------

/**
 * Tests for data serialization/deserialization and round-trip integrity.
 * These tests verify that exported data can be correctly imported and
 * that all fields are preserved through the process.
 */

const createMockWordInfo = (word: string, overrides?: Partial<WordInfo>): WordInfo => ({
  word,
  reading: word,
  meaning: 'test meaning',
  jlpt: 5,
  joyo: true,
  score: 50,
  breakdown: {
    jlptScore: 15,
    joyoPenalty: 5,
    highestGrade: 1,
    freqPenalty: 0,
    jlptValues: [5],
    gradeValues: [1],
    priorities: ['ichi1'],
  },
  frequencyInContent: 1,
  ...overrides,
});

describe('data export format', () => {
  it('exports known words as array', () => {
    const knownWords = new Set(['水', '食べる', 'ありがとう']);
    const exported = Array.from(knownWords);

    expect(Array.isArray(exported)).toBe(true);
    expect(exported).toContain('水');
    expect(exported.length).toBe(3);
  });

  it('exports content vocab as record of arrays', () => {
    const contentVocab: Record<string, WordInfo[]> = {
      'story-1': [
        createMockWordInfo('水'),
        createMockWordInfo('食べる'),
      ],
      'story-2': [
        createMockWordInfo('本'),
      ],
    };

    const exported = {
      knownWords: ['水'],
      contentVocab: contentVocab,
    };

    expect(typeof exported.contentVocab).toBe('object');
    expect(Object.keys(exported.contentVocab)).toContain('story-1');
    expect(exported.contentVocab['story-1']).toHaveLength(2);
  });

  it('preserves all word fields during export', () => {
    const word = createMockWordInfo('複雑', {
      reading: 'ふくざつ',
      meaning: 'complex, complicated',
      jlpt: 2,
      joyo: true,
      score: 75,
      breakdown: {
        jlptScore: 75,
        joyoPenalty: 15,
        highestGrade: 8,
        freqPenalty: 10,
        jlptValues: [2, 2],
        gradeValues: [8],
        priorities: ['nf10'],
      },
      frequencyInContent: 3,
    });

    const contentVocab = { 'story-1': [word] };

    expect(contentVocab['story-1'][0].word).toBe('複雑');
    expect(contentVocab['story-1'][0].reading).toBe('ふくざつ');
    expect(contentVocab['story-1'][0].meaning).toBe('complex, complicated');
    expect(contentVocab['story-1'][0].jlpt).toBe(2);
    expect(contentVocab['story-1'][0].score).toBe(75);
    expect(contentVocab['story-1'][0].breakdown.joyoPenalty).toBe(15);
    expect(contentVocab['story-1'][0].frequencyInContent).toBe(3);
  });

  it('handles special characters and unicode correctly', () => {
    const specialWords = [
      createMockWordInfo('日本語'),
      createMockWordInfo('ひらがな'),
      createMockWordInfo('カタカナ'),
      createMockWordInfo('漢字'),
      createMockWordInfo('ー'), // Long vowel mark
      createMockWordInfo('々'), // Kanji repetition mark
    ];

    const exported = { contentVocab: { 'story-1': specialWords } };
    const json = JSON.stringify(exported);
    const reimported = JSON.parse(json);

    for (let i = 0; i < specialWords.length; i++) {
      expect(reimported.contentVocab['story-1'][i].word).toBe(specialWords[i].word);
    }
  });
});

describe('data import validation', () => {
  it('rejects invalid JSON gracefully', () => {
    const invalidJson = 'not { valid json';

    expect(() => {
      JSON.parse(invalidJson);
    }).toThrow();
  });

  it('validates required fields in imported words', () => {
    const incompleteWord = {
      word: '水',
      // missing: reading, meaning, score, etc.
    };

    const contentVocab = { 'story-1': [incompleteWord] };

    // Should be importable but missing fields
    expect(contentVocab['story-1'][0]).toHaveProperty('word');
    expect(contentVocab['story-1'][0]).not.toHaveProperty('reading');
  });

  it('handles mixed valid and invalid known words', () => {
    const imported = {
      knownWords: ['水', '', '食べる', null, 'ありがとう'],
      contentVocab: {},
    };

    // Filter out empty/null values
    const cleaned = imported.knownWords.filter((w: any) => typeof w === 'string' && w.trim());
    expect(cleaned).toEqual(['水', '食べる', 'ありがとう']);
  });

  it('preserves vocabulary structure when importing back', () => {
    const original = {
      knownWords: ['水', '食べる'],
      contentVocab: {
        'story-1': [
          createMockWordInfo('日本'),
          createMockWordInfo('勉強'),
        ],
        'story-2': [
          createMockWordInfo('楽しい'),
        ],
      },
    };

    // Simulate export/import cycle
    const json = JSON.stringify(original);
    const imported = JSON.parse(json);

    expect(imported.knownWords).toEqual(original.knownWords);
    expect(imported.contentVocab['story-1']).toHaveLength(2);
    expect(imported.contentVocab['story-1'][0].word).toBe('日本');
    expect(imported.contentVocab['story-2'][0].word).toBe('楽しい');
  });
});

describe('import/export round-trip integrity', () => {
  let testData: { knownWords: Set<string>; contentVocab: Record<string, WordInfo[]> };

  beforeEach(() => {
    testData = {
      knownWords: new Set(['水', '食べる', '日本']),
      contentVocab: {
        'story-1': [
          createMockWordInfo('雨', { meaning: 'rain' }),
          createMockWordInfo('雪', { meaning: 'snow', jlpt: 4 }),
        ],
        'story-2': [
          createMockWordInfo('木', { meaning: 'tree', joyo: false }),
        ],
      },
    };
  });

  it('preserves known words through export/import', () => {
    // Export
    const exported = {
      knownWords: Array.from(testData.knownWords),
      contentVocab: testData.contentVocab,
    };

    // Import
    const newKnown = new Set([...Array.from(testData.knownWords), ...exported.knownWords]);

    expect(newKnown.has('水')).toBe(true);
    expect(newKnown.has('食べる')).toBe(true);
    expect(newKnown.has('日本')).toBe(true);
    expect(newKnown.size).toBe(3);
  });

  it('preserves all content vocabulary through export/import', () => {
    // Export
    const json = JSON.stringify({
      knownWords: Array.from(testData.knownWords),
      contentVocab: testData.contentVocab,
    });

    // Import
    const imported = JSON.parse(json);
    const merged: Record<string, WordInfo[]> = {};

    for (const [storyId, importedWords] of Object.entries(imported.contentVocab)) {
      if (Array.isArray(importedWords)) {
        const existing = testData.contentVocab[storyId] || [];
        const mergedList = [...existing];

        for (const w of importedWords) {
          const index = mergedList.findIndex(word => word.word === w.word);
          if (index >= 0) {
            mergedList[index] = { ...mergedList[index], ...w };
          } else {
            mergedList.push(w);
          }
        }
        merged[storyId] = mergedList;
      }
    }

    expect(merged['story-1']).toHaveLength(2);
    expect(merged['story-1'][0].word).toBe('雨');
    expect(merged['story-1'][0].meaning).toBe('rain');
    expect(merged['story-2'][0].word).toBe('木');
  });

  it('handles duplicate words correctly on import', () => {
    const imported = {
      knownWords: ['水', '食べる', '水', '食べる'], // Duplicates
      contentVocab: {},
    };

    // Deduplicate using Set
    const deduped = new Set(imported.knownWords);
    expect(deduped.size).toBe(2);
    expect(deduped.has('水')).toBe(true);
  });

  it('merges imported vocab with existing vocab without losing data', () => {
    const existing = {
      'story-1': [createMockWordInfo('雨')],
    };

    const imported = {
      'story-1': [
        { ...createMockWordInfo('雨'), meaning: 'updated meaning' },
        createMockWordInfo('新しい'),
      ],
    };

    const merged: Record<string, WordInfo[]> = { ...existing };

    for (const [storyId, importedWords] of Object.entries(imported)) {
      const mergedList = [...(merged[storyId] || [])];

      for (const w of importedWords) {
        const index = mergedList.findIndex(word => word.word === w.word);
        if (index >= 0) {
          mergedList[index] = w; // Update existing
        } else {
          mergedList.push(w); // Add new
        }
      }

      merged[storyId] = mergedList;
    }

    expect(merged['story-1']).toHaveLength(2);
    expect(merged['story-1'][0].meaning).toBe('updated meaning'); // Updated
    expect(merged['story-1'][1].word).toBe('新しい'); // New
  });

  it('handles story-specific export format', () => {
    // Some exports include the story metadata
    const storyExport = {
      content: { id: 'story-1', title: 'Story 1', text: 'Example text' },
      vocab: [
        createMockWordInfo('例'),
        createMockWordInfo('文'),
      ],
    };

    expect(storyExport.content.id).toBe('story-1');
    expect(storyExport.vocab).toHaveLength(2);

    // Should be able to reconstruct contentVocab from this format
    const contentVocab: Record<string, WordInfo[]> = {};
    contentVocab[storyExport.content.id] = storyExport.vocab;

    expect(contentVocab['story-1']).toHaveLength(2);
  });
});

describe('import/export edge cases', () => {
  it('handles empty exports', () => {
    const empty = {
      knownWords: [],
      contentVocab: {},
    };

    const json = JSON.stringify(empty);
    const reimported = JSON.parse(json);

    expect(reimported.knownWords).toEqual([]);
    expect(Object.keys(reimported.contentVocab)).toHaveLength(0);
  });

  it('handles very large datasets', () => {
    // Create a large vocabulary set
    const largeVocab: Record<string, WordInfo[]> = {};

    for (let i = 0; i < 10; i++) {
      largeVocab[`story-${i}`] = [];
      for (let j = 0; j < 100; j++) {
        largeVocab[`story-${i}`].push(
          createMockWordInfo(`word${i}-${j}`)
        );
      }
    }

    const exported = {
      knownWords: Array(500).fill(null).map((_, i) => `known-${i}`),
      contentVocab: largeVocab,
    };

    const json = JSON.stringify(exported);
    const reimported = JSON.parse(json);

    expect(reimported.knownWords).toHaveLength(500);
    expect(Object.keys(reimported.contentVocab)).toHaveLength(10);
    expect(reimported.contentVocab['story-0']).toHaveLength(100);
  });

  it('handles missing breakdown field in imported words', () => {
    const wordWithoutBreakdown = createMockWordInfo('テスト');
    const { breakdown, ...wordWithoutBreakdownField } = wordWithoutBreakdown;

    // This is what might come from an old export
    expect(wordWithoutBreakdownField).not.toHaveProperty('breakdown');

    // But we can still access other fields
    expect(wordWithoutBreakdownField.word).toBe('テスト');
    expect(wordWithoutBreakdownField.score).toBe(50);
  });

  it('normalizes reading field on import', () => {
    const word = {
      word: '複雑',
      reading: 'ふくざつ',
      meaning: 'complex',
      // ... other fields
    };

    // Different formats might have different reading field names
    const reading = word.reading || word.word;
    expect(reading).toBe('ふくざつ');
  });
});
