export type SeasonRuleWindow = {
  startWeek: number;
  endWeek: number;
};

export type SeasonRules = {
  seasonYear: number;
  recordWindow: SeasonRuleWindow;
  pointsWindow: SeasonRuleWindow;
};

export function getSeasonRules(seasonYear: number): SeasonRules {
  if (!Number.isInteger(seasonYear)) {
    throw new Error("getSeasonRules requires an integer seasonYear");
  }

  if (seasonYear <= 2025) {
    return {
      seasonYear,
      recordWindow: {
        startWeek: 1,
        endWeek: 13,
      },
      pointsWindow: {
        startWeek: 1,
        endWeek: 14,
      },
    };
  }

  return {
    seasonYear,
    recordWindow: {
      startWeek: 1,
      endWeek: 14,
    },
    pointsWindow: {
      startWeek: 1,
      endWeek: 14,
    },
  };
}
