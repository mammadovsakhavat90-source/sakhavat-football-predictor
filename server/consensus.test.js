'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  competitionMatches,
  feedPickForMatch,
  normalizeProbabilities,
  normalizeTeam,
  sanitizeFootballAnalytics,
  sanitizeKiqiq
} = require('./consensus');

const now = Date.parse('2026-11-19T18:00:00.000Z');
const match = {
  match_id: 123,
  date_unix: Date.parse('2026-11-20T20:00:00.000Z') / 1000,
  league: { league_id: 15 },
  home_team: { team_name: 'Manchester United' },
  away_team: { team_name: 'Wolverhampton Wanderers' }
};

test('team normalizer handles accents and known aliases', () => {
  assert.equal(normalizeTeam('Wolves'), normalizeTeam('Wolverhampton Wanderers'));
  assert.equal(normalizeTeam('Pogo\u0144 Szczecin'), normalizeTeam('Pogon Szczecin'));
});

test('competition must match the fixture competition', () => {
  assert.equal(competitionMatches(match, { league_slug: 'premier-league' }, 'footballAnalytics'), true);
  assert.equal(competitionMatches(match, { league_slug: 'la-liga' }, 'footballAnalytics'), false);
});

test('probabilities must be finite and add up to a plausible total', () => {
  const p = normalizeProbabilities({ home_win_prob: 0.55, draw_prob: 0.25, away_win_prob: 0.20 });
  assert.ok(p);
  assert.ok(Math.abs(p[0] - 55) < 0.001);
  assert.equal(normalizeProbabilities({ home_win_prob: 0.55, draw_prob: 0.25, away_win_prob: 0.05 }), null);
});

test('Football Analytics requires fresh feed and a prematch publication', () => {
  const row = {
    league_slug: 'premier-league',
    home_team: 'Manchester United',
    away_team: 'Wolves',
    kickoff_utc: '2026-11-20T20:00:00.000Z',
    pick_written_utc: '2026-11-19T05:00:00.000Z',
    pick: '1'
  };
  assert.equal(feedPickForMatch(match, row, 'footballAnalytics', { fresh: true }, now), '1');
  assert.equal(feedPickForMatch(match, row, 'footballAnalytics', { fresh: false }, now), null);
  assert.equal(feedPickForMatch(match, { ...row, league_slug: 'la-liga' }, 'footballAnalytics', { fresh: true }, now), null);
  assert.equal(feedPickForMatch(match, { ...row, pick_written_utc: '2026-11-21T00:00:00Z' }, 'footballAnalytics', { fresh: true }, now), null);
});

test('KiqIQ requires fresh metadata, correct competition, teams and kickoff', () => {
  const row = {
    competition: 'Premier League',
    home: 'Manchester United',
    away: 'Wolverhampton Wanderers',
    kickoff_iso: '2026-11-20T20:00:00.000Z',
    home_win_prob: 0.5,
    draw_prob: 0.3,
    away_win_prob: 0.2
  };
  const meta = { fresh: true, generatedAt: '2026-11-19T17:55:00.000Z' };
  assert.equal(feedPickForMatch(match, row, 'kiqiq', meta, now), '1');
  assert.equal(feedPickForMatch(match, row, 'kiqiq', { ...meta, fresh: false }, now), null);
  assert.equal(feedPickForMatch(match, { ...row, kickoff_iso: '2026-11-20T22:00:00Z' }, 'kiqiq', meta, now), null);
});

test('stale and unsupported feeds are rejected', () => {
  const stale = sanitizeKiqiq({
    generated_at: '2026-11-18T00:00:00Z',
    fixtures: [{
      competition: 'Premier League', home: 'Manchester United', away: 'Wolves',
      kickoff_iso: '2026-11-20T20:00:00Z',
      home_win_prob: 0.5, draw_prob: 0.3, away_win_prob: 0.2
    }]
  }, now);
  assert.equal(stale.fresh, false);
  assert.equal(stale.fixtures.length, 0);

  const badFa = sanitizeFootballAnalytics({
    generated_at: '2026-11-19T17:55:00Z',
    data: [{
      league_slug: 'unknown', home_team: 'A', away_team: 'B',
      kickoff_utc: '2026-11-20T20:00:00Z',
      pick_written_utc: '2026-11-19T05:00:00Z', pick: '1'
    }]
  }, now);
  assert.equal(badFa.fixtures.length, 0);
});
