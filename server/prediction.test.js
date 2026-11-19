'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { predict } = require('./prediction');

const base = {
  leagueAvgHomeGoals: 1.45,
  leagueAvgAwayGoals: 1.15,
  homeAttack: 1.12,
  homeDefense: 0.94,
  awayAttack: 0.98,
  awayDefense: 1.08,
  homeXgFor: 1.62,
  homeXgAgainst: 0.96,
  awayXgFor: 1.21,
  awayXgAgainst: 1.38
};

test('1-X-2 probabilities sum to 100%', () => {
  const result = predict(base);
  const total = result.probabilities.homeWin + result.probabilities.draw + result.probabilities.awayWin;
  assert.ok(Math.abs(total - 100) < 0.11);
});

test('Elo is not claimed when ratings are absent', () => {
  const result = predict(base);
  assert.equal(result.dataQuality.eloUsed, false);
  assert.equal(result.model.includes('Elo'), false);
});

test('Elo is used only when both verified ratings are supplied', () => {
  const result = predict({ ...base, homeElo: 1680, awayElo: 1610 });
  assert.equal(result.dataQuality.eloUsed, true);
  assert.equal(result.model.includes('Elo'), true);
});

test('invalid team-strength input is rejected', () => {
  assert.throws(() => predict({ ...base, homeAttack: 0 }), /homeAttack/);
});
