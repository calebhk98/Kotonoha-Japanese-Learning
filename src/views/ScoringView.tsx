function ScoringView() {
  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight mb-8">
        Scoring Guide
      </h2>
      <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm text-gray-800">
        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Base JLPT Points
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Each word receives a base score according to its estimated JLPT level.
          Rarer words score higher.
        </p>
        <ul className="list-disc list-inside space-y-2 mb-8">
          <li>
            <span className="font-medium text-indigo-600">N5</span>: +15 pts
            (Fundamentals)
          </li>
          <li>
            <span className="font-medium text-indigo-600">N4</span>: +25 pts
          </li>
          <li>
            <span className="font-medium text-indigo-600">N3</span>: +50 pts
          </li>
          <li>
            <span className="font-medium text-indigo-600">N2</span>: +75 pts
          </li>
          <li>
            <span className="font-medium text-indigo-600">N1</span>: +100 pts
            (Native / Advanced)
          </li>
        </ul>

        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Kanji Joyo Penalties
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          If a word contains kanji, it gets bonus penalty points based on the
          highest-grade kanji it contains.
        </p>
        <ul className="list-disc list-inside space-y-2 mb-8">
          <li>
            <span className="font-medium">Grade 1</span>: +5 pts
          </li>
          <li>
            <span className="font-medium">Grade 2</span>: +7 pts
          </li>
          <li>
            <span className="font-medium">Grade 3</span>: +10 pts
          </li>
          <li>
            <span className="font-medium">Grade 4</span>: +12 pts
          </li>
          <li>
            <span className="font-medium">Grade 5</span>: +15 pts
          </li>
          <li>
            <span className="font-medium">Grade 6</span>: +20 pts
          </li>
          <li>
            <span className="font-medium">Grade 8 (Middle School)</span>: +25
            pts
          </li>
          <li>
            <span className="font-medium">Grade 9+ (Non-Joyo)</span>: +30 pts
          </li>
        </ul>

        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Frequency Penalties
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Words are penalized or rewarded based on their frequency in standard
          Japanese corpora. Values range from -20 to +50.
        </p>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <span className="font-medium text-red-500">Very Common</span>{' '}
            (ichi1, news1, common kana): -20 pts
          </li>
          <li>
            <span className="font-medium text-orange-500">Common</span> (ichi2,
            news2): -10 pts
          </li>
          <li>
            <span className="font-medium">Frequent Loan/Spec 1</span> (gai1,
            spec1): 0 pts
          </li>
          <li>
            <span className="font-medium">Frequent Loan/Spec 2</span> (gai2,
            spec2): +5 pts
          </li>
          <li>
            <span className="font-medium">General Corpus Rank 1-5</span>{' '}
            (nf01-nf05): +10 pts
          </li>
          <li>
            <span className="font-medium">General Corpus Rank 6-10</span>{' '}
            (nf06-nf10): +15 pts
          </li>
          <li>
            <span className="font-medium text-green-600">
              General Corpus Rank 11-20
            </span>{' '}
            (nf11-nf20): +20 pts
          </li>
          <li>
            <span className="font-medium text-emerald-600">
              General Corpus Rank 21-30
            </span>{' '}
            (nf21-nf30): +30 pts
          </li>
          <li>
            <span className="font-medium text-teal-600">
              General Corpus Rank 31-48
            </span>{' '}
            (nf31-nf48): +40 pts
          </li>
          <li>
            <span className="font-medium text-blue-600">Very Rare</span> (No
            frequency tags): +50 pts
          </li>
        </ul>
      </div>
    </section>
  );
}

type ScoringViewProps = {};

export default ScoringView;
