const calculateRounds = players => {
  switch (players) {
    case players > 410:
      return 10;
    case players > 226:
      return 9;
    default:
      return Math.ceil(Math.log(players) / Math.log(2));
  }
};

const calculateTriangle = (players, _rounds) => {
  const rounds = _rounds ? _rounds + 1 : calculateRounds(players) + 1;
  const records = [];

  const triangle = { 11: players };

  for (let x = 2; x <= rounds; x++) {
    for (let y = 1; y <= x; y++) {
      const num1 = triangle[10 * (x - 1) + (y - 1)] || 0;
      const num2 = triangle[10 * (x - 1) + y] || 0;

      triangle[10 * x + y] = Math.floor(num1 / 2) + Math.ceil(num2 / 2);

      if (x === rounds) records.push(`${rounds - y}-${y - 1}`);
    }
  }

  const keys = Object.keys(triangle);
  const last = keys[keys.length - 1].toString()[0];

  const output = {};

  keys
    .filter(key => key.toString()[0] === last)
    .forEach((key, index) => (output[records[index]] = triangle[key]));

  return output;
};

export const calculateEventStats = data => {
  const numRounds = data[0].record.split('-').reduce((a, b) => Number(a) + Number(b));
  const rdDist = calculateTriangle(10 ** 4, numRounds);
  const bins = Object.assign({}, ...data.map(obj => ({ [obj.record]: obj.count })));

  let numPlayers = [];
  for (let i = 0; i < Object.keys(bins).length; i++) {
    if (Object.keys(bins).length - i <= 2) {
      const result = Object.keys(bins)[i];
      const playersEstimate = Math.ceil(bins[result] / (rdDist[result] / 10 ** 4));

      let rdDistEstimate = calculateTriangle(playersEstimate, numRounds);
      let errorCount = 0;
      for (let n = 0; n < Object.keys(bins).length; n++) {
        errorCount -= Math.abs(
          rdDistEstimate[Object.keys(bins)[n]] - bins[Object.keys(bins)[n]]
        );
      }

      // Handle prelims and top 16 only premier events.
      if (
        i == Object.keys(bins).length - 1 &&
        32 > Object.values(bins).reduce((a, b) => a + b)
      )
        errorCount = 0;

      if (errorCount == 0) numPlayers = playersEstimate;
      if (errorCount !== 0 && i == Object.keys(bins).length - 1) {
        for (let _i = playersEstimate; _i > 0; _i--) {
          rdDistEstimate = calculateTriangle(_i, numRounds);
          errorCount = 0;
          for (let n = 1; n < Object.keys(bins).length - 1; n++) {
            errorCount -= Math.abs(
              rdDistEstimate[Object.keys(bins)[n]] - bins[Object.keys(bins)[n]]
            );
          }
          if (errorCount == 0) numPlayers = _i;
        }
      }
    }
  }
  return {
    truncPlayers: Object.values(bins).reduce((a, b) => a + b),
    truncTriangle: bins,
    numPlayers: numPlayers,
    triangle: calculateTriangle(numPlayers, numRounds),
  };
};

/**
 * Converts an integer to an ordinal.
 */
export const getNumberWithOrdinal = (n) => {
  let s = ["th", "st", "nd", "rd"],
      v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}