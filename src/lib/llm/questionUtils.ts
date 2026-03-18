export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function includesAnyTerm(
  question: string,
  terms: readonly string[]
): boolean {
  const normalizedQuestion = normalizeSearchText(question);

  return terms.some((term) =>
    normalizedQuestion.includes(normalizeSearchText(term))
  );
}

export function extractSeasonYearFromQuestion(question: string): number | null {
  const match = question.match(/\b(20\d{2})\b/);

  if (!match) {
    return null;
  }

  const seasonYear = Number(match[1]);

  return Number.isInteger(seasonYear) ? seasonYear : null;
}

export function extractWeekFromQuestion(question: string): number | null {
  const match = question.match(/\bweek\s+(\d{1,2})\b/i);

  if (!match) {
    return null;
  }

  const week = Number(match[1]);

  return Number.isInteger(week) ? week : null;
}

export function extractRoundFromQuestion(question: string): number | null {
  const patterns: Array<[RegExp, number]> = [
    [/\b1st(?:\s+|-)?round\b/i, 1],
    [/\bfirst(?:\s+|-)?round\b/i, 1],
    [/\b2nd(?:\s+|-)?round\b/i, 2],
    [/\bsecond(?:\s+|-)?round\b/i, 2],
    [/\b3rd(?:\s+|-)?round\b/i, 3],
    [/\bthird(?:\s+|-)?round\b/i, 3],
    [/\b4th(?:\s+|-)?round\b/i, 4],
    [/\bfourth(?:\s+|-)?round\b/i, 4],
    [/\b5th(?:\s+|-)?round\b/i, 5],
    [/\bfifth(?:\s+|-)?round\b/i, 5],
    [/\b6th(?:\s+|-)?round\b/i, 6],
    [/\bsixth(?:\s+|-)?round\b/i, 6],
    [/\b7th(?:\s+|-)?round\b/i, 7],
    [/\bseventh(?:\s+|-)?round\b/i, 7],
    [/\b8th(?:\s+|-)?round\b/i, 8],
    [/\beighth(?:\s+|-)?round\b/i, 8],
    [/\b9th(?:\s+|-)?round\b/i, 9],
    [/\bninth(?:\s+|-)?round\b/i, 9],
    [/\b10th(?:\s+|-)?round\b/i, 10],
    [/\btenth(?:\s+|-)?round\b/i, 10],
  ];

  for (const [pattern, round] of patterns) {
    if (pattern.test(question)) {
      return round;
    }
  }

  const explicitRoundMatch = question.match(/\bround\s+(\d{1,2})\b/i);

  if (!explicitRoundMatch) {
    return null;
  }

  const round = Number(explicitRoundMatch[1]);

  return Number.isInteger(round) ? round : null;
}

export function extractRoundAndPick(
  question: string
): { round: number; pickNumber: number } | null {
  const dotMatch = question.match(/\b(\d{1,2})\.(\d{1,2})\b/);

  if (dotMatch) {
    const round = Number(dotMatch[1]);
    const pickNumber = Number(dotMatch[2]);

    if (Number.isInteger(round) && Number.isInteger(pickNumber)) {
      return { round, pickNumber };
    }
  }

  const explicitMatch = question.match(
    /\bround\s+(\d{1,2})\s+pick\s+(\d{1,2})\b/i
  );

  if (explicitMatch) {
    const round = Number(explicitMatch[1]);
    const pickNumber = Number(explicitMatch[2]);

    if (Number.isInteger(round) && Number.isInteger(pickNumber)) {
      return { round, pickNumber };
    }
  }

  const reversedMatch = question.match(
    /\bpick\s+(\d{1,2})\s+in\s+round\s+(\d{1,2})\b/i
  );

  if (!reversedMatch) {
    return null;
  }

  const pickNumber = Number(reversedMatch[1]);
  const round = Number(reversedMatch[2]);

  if (!Number.isInteger(round) || !Number.isInteger(pickNumber)) {
    return null;
  }

  return { round, pickNumber };
}