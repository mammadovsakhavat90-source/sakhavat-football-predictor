'use strict';

const COMPETITION_ALIASES = Object.freeze({
  '10': ['laliga', 'spanishlaliga', 'primeradivision'],
  '15': ['premierleague', 'englishpremierleague', 'epl'],
  '45': ['championsleague', 'uefachampionsleague', 'ucl'],
  '46': ['europaleague', 'uefaeuropaleague', 'uel'],
  '50': ['worldcup', 'fifaworldcup', 'fifaworldcup2026']
});

const compact = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

const TEAM_ALIASES = Object.freeze({
  wolves: 'wolverhamptonwanderers',
  manutd: 'manchesterunited',
  manchesterutd: 'manchesterunited',
  athleticbilbao: 'athleticclub',
  inter: 'intermilan',
  internazionale: 'intermilan',
  psv: 'psveindhoven'
});

function normalizeTeam(value) {
  let result = compact(value).replace(/^the/, '');
  result = result.replace(/(footballclub|soccerclub|fc|afc|cf|sc|ac|club)$/, '');
  return TEAM_ALIASES[result] || result;
}

function getLeagueId(match) {
  return String(match?.league?.league_id ?? match?.league_id ??
    match?.competition?.league_id ?? '');
}

function competitionMatches(match, row, source) {
  const aliases = COMPETITION_ALIASES[getLeagueId(match)] || [];
  const values = source === 'footballAnalytics'
    ? [row?.league_slug, row?.league]
    : [row?.competition, row?.league_name, row?.league];
  return aliases.length > 0 && values.some(value => aliases.includes(compact(value)));
}

function sameTeams(match, row, source) {
  const home = source === 'footballAnalytics' ? row?.home_team : row?.home;
  const away = source === 'footballAnalytics' ? row?.away_team : row?.away;
  const matchHome = match?.home_team?.team_name ?? match?.home_team?.name ??
    match?.home_team_name ?? match?.home;
  const matchAway = match?.away_team?.team_name ?? match?.away_team?.name ??
    match?.away_team_name ?? match?.away;
  return !!normalizeTeam(home) && !!normalizeTeam(away) &&
    normalizeTeam(home) === normalizeTeam(matchHome) &&
    normalizeTeam(away) === normalizeTeam(matchAway);
}

function parseTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function isFreshTimestamp(value, maxAgeMs, now = Date.now()) {
  const time = parseTime(value);
  return time !== null && time <= now + 5 * 60 * 1000 &&
    now - time <= maxAgeMs;
}

function normalizeProbabilities(row) {
  if (!row) return null;
  let values = [Number(row.home_win_prob), Number(row.draw_prob), Number(row.away_win_prob)];
  if (!values.every(Number.isFinite) || values.some(value => value < 0)) return null;
  let sum = values.reduce((total, value) => total + value, 0);
  if (values.every(value => value <= 1) && sum >= 0.85 && sum <= 1.15) {
    values = values.map(value => value * 100);
    sum *= 100;
  }
  if (sum < 85 || sum > 115) return null;
  return values.map(value => value / sum * 100);
}

function sanitizeFootballAnalytics(payload, now = Date.now()) {
  const generatedAt = payload?.generated_at || null;
  const fresh = isFreshTimestamp(generatedAt, 6 * 60 * 60 * 1000, now);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const fixtures = fresh ? rows.filter(row => {
    const kickoff = parseTime(row?.kickoff_utc);
    const written = parseTime(row?.pick_written_utc);
    const supportedCompetition = Object.values(COMPETITION_ALIASES).some(aliases =>
      aliases.includes(compact(row?.league_slug)) || aliases.includes(compact(row?.league)));
    return !!row?.home_team && !!row?.away_team && supportedCompetition &&
      ['1', 'X', '2'].includes(String(row?.pick || '').toUpperCase()) &&
      kickoff !== null && kickoff > now &&
      written !== null && written <= now + 5 * 60 * 1000 &&
      written < kickoff && now - written <= 7 * 24 * 60 * 60 * 1000;
  }) : [];
  return {
    fresh,
    generatedAt,
    ageSeconds: parseTime(generatedAt) === null ? null :
      Math.max(0, Math.round((now - parseTime(generatedAt)) / 1000)),
    count: fixtures.length,
    fixtures,
    error: fresh ? null : 'Football Analytics məlumatı köhnədir və ya generated_at yoxdur.'
  };
}

function sanitizeKiqiq(payload, now = Date.now()) {
  const generatedAt = payload?.generated_at || null;
  const fresh = isFreshTimestamp(generatedAt, 30 * 60 * 1000, now);
  const rows = Array.isArray(payload?.fixtures) ? payload.fixtures : [];
  const fixtures = fresh ? rows.filter(row => {
    const kickoff = parseTime(row?.kickoff_iso);
    const supportedCompetition = Object.values(COMPETITION_ALIASES).some(aliases =>
      aliases.includes(compact(row?.competition)) || aliases.includes(compact(row?.league_name)));
    return !!row?.home && !!row?.away && supportedCompetition &&
      kickoff !== null && kickoff > now &&
      kickoff <= now + 14 * 24 * 60 * 60 * 1000 &&
      !!normalizeProbabilities(row);
  }) : [];
  return {
    fresh,
    generatedAt,
    ageSeconds: parseTime(generatedAt) === null ? null :
      Math.max(0, Math.round((now - parseTime(generatedAt)) / 1000)),
    count: fixtures.length,
    fixtures,
    error: fresh ? null : 'KiqIQ məlumatı 30 dəqiqədən köhnədir və ya generated_at yoxdur.'
  };
}

function feedPickForMatch(match, row, source, sourceMeta, now = Date.now()) {
  if (!match || !row || sourceMeta?.fresh !== true) return null;
  const kickoff = Number(match.date_unix) > 0
    ? Number(match.date_unix) * 1000
    : parseTime(match.match_date || match.kickoff);
  const sourceKickoff = parseTime(source === 'footballAnalytics'
    ? row.kickoff_utc : row.kickoff_iso);
  if (!kickoff || !sourceKickoff || kickoff <= now ||
      Math.abs(sourceKickoff - kickoff) > 30 * 60 * 1000) return null;
  if (!competitionMatches(match, row, source) || !sameTeams(match, row, source)) return null;

  if (source === 'footballAnalytics') {
    const written = parseTime(row.pick_written_utc);
    if (!written || written > now + 5 * 60 * 1000 ||
        written >= kickoff || now - written > 7 * 24 * 60 * 60 * 1000) return null;
    const pick = String(row.pick || '').toUpperCase();
    return ['1', 'X', '2'].includes(pick) ? pick : null;
  }

  const generatedAt = parseTime(sourceMeta.generatedAt);
  if (!generatedAt || generatedAt > kickoff) return null;
  const probabilities = normalizeProbabilities(row);
  if (!probabilities) return null;
  return ['1', 'X', '2'][probabilities.indexOf(Math.max(...probabilities))];
}

module.exports = {
  COMPETITION_ALIASES,
  compact,
  normalizeTeam,
  getLeagueId,
  competitionMatches,
  sameTeams,
  isFreshTimestamp,
  normalizeProbabilities,
  sanitizeFootballAnalytics,
  sanitizeKiqiq,
  feedPickForMatch
};
