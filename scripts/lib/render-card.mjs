import { readFileSync } from 'node:fs';

const logoSvg = readFileSync(new URL('../../assets/brands/codex.svg', import.meta.url), 'utf8').trim();
const templates = new Set(['minimal', 'terminal', 'badge']);
const themes = {
  dark: { surface: '#171c19', border: '#354039', text: '#f1f5ee', muted: '#a6b4a9', accent: '#b4dca5', rule: '#354039' },
  light: { surface: '#fafcf8', border: '#d4ddd2', text: '#222d24', muted: '#5a6b5e', accent: '#3e6734', rule: '#d4ddd2' },
};
const cadences = { hourly: 'Hourly checks', daily: 'Daily checks', manual: 'Manual refresh' };
const sans = 'Segoe UI, Helvetica, Arial, sans-serif';
const mono = 'SFMono-Regular, Consolas, Liberation Mono, monospace';

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function validateSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('Codex did not return a usage summary; card unchanged.');
  }
  const normalized = {};
  for (const key of ['lifetimeTokens', 'currentStreakDays', 'peakDailyTokens']) {
    if (!Number.isSafeInteger(summary[key]) || summary[key] < 0) {
      throw new Error(`Codex did not return a valid ${key} value; card unchanged.`);
    }
    normalized[key] = summary[key];
  }
  return normalized;
}

function compact(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function exact(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function streak(value) {
  return value < 10_000 ? exact(value) : compact(value);
}

function text(x, y, value, { fill, size = 14, weight = 400, family = sans, anchor = 'start', id } = {}) {
  return `<text${id ? ` id="${id}"` : ''} x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function logo(x, y) {
  return `<g transform="translate(${x} ${y})"><rect x="-4" y="-4" width="32" height="32" rx="8" fill="#ffffff"/>${logoSvg}</g>`;
}

function header(palette, showLogo, terminal = false) {
  return [
    showLogo ? logo(28, 24) : '',
    text(showLogo ? 68 : 28, 42, terminal ? 'codex / activity' : 'Codex activity', { fill: palette.text, size: 18, weight: 600, family: terminal ? mono : sans }),
  ].join('\n');
}

function footer(palette, dateLabel, cadence, y) {
  return [
    `<path d="M28 ${y - 23}H612" stroke="${palette.rule}"/>`,
    text(28, y, `Updated ${dateLabel}`, { fill: palette.muted, size: 12, id: 'updated-at' }),
    text(612, y, cadences[cadence], { fill: palette.muted, size: 12, anchor: 'end', id: 'refresh-state' }),
  ].join('\n');
}

function minimal(summary, palette, options, dateLabel) {
  const lifetime = compact(summary.lifetimeTokens);
  const streakLabel = `${streak(summary.currentStreakDays)} ${summary.currentStreakDays === 1 ? 'day' : 'days'}`;
  return {
    height: 242,
    content: [
      header(palette, options.logo),
      text(28, 96, 'Lifetime tokens', { fill: palette.muted, size: 14 }),
      text(25, 158, lifetime, { fill: palette.accent, size: lifetime.length > 7 ? 44 : 58, weight: 600, family: mono, id: 'lifetime-count' }),
      `<path d="M372 80V180" stroke="${palette.rule}"/>`,
      text(396, 94, 'Current streak', { fill: palette.muted, size: 13 }),
      text(396, 124, streakLabel, { fill: palette.text, size: streakLabel.length > 12 ? 21 : 26, weight: 500, family: mono, id: 'streak-count' }),
      text(396, 157, 'Peak daily tokens', { fill: palette.muted, size: 13 }),
      text(396, 185, compact(summary.peakDailyTokens), { fill: palette.text, size: 26, weight: 500, family: mono, id: 'peak-count' }),
      footer(palette, dateLabel, options.cadence, 222),
    ].join('\n'),
  };
}

function terminal(summary, palette, options, dateLabel) {
  return {
    height: 256,
    content: [
      header(palette, options.logo, true),
      text(28, 82, '> account usage', { fill: palette.muted, size: 13, family: mono }),
      ...[
        ['lifetime tokens', compact(summary.lifetimeTokens), 'lifetime-count'],
        ['current streak', `${streak(summary.currentStreakDays)} ${summary.currentStreakDays === 1 ? 'day' : 'days'}`, 'streak-count'],
        ['peak daily tokens', compact(summary.peakDailyTokens), 'peak-count'],
      ].flatMap(([label, value, id], index) => [
        text(28, 117 + index * 34, label, { fill: palette.muted, size: 15, family: mono }),
        text(612, 117 + index * 34, value, { fill: index === 0 ? palette.accent : palette.text, size: 19, weight: 500, family: mono, anchor: 'end', id }),
      ]),
      footer(palette, dateLabel, options.cadence, 236),
    ].join('\n'),
  };
}

function badge(summary, palette, options) {
  return {
    height: 54,
    content: [
      options.logo ? logo(18, 15) : '',
      text(options.logo ? 54 : 18, 32, 'Codex', { fill: palette.text, size: 14, weight: 600 }),
      `<path d="M116 14V40" stroke="${palette.rule}"/>`,
      text(134, 32, `${compact(summary.lifetimeTokens)} tokens`, { fill: palette.accent, size: 13, family: mono, id: 'lifetime-count' }),
      text(314, 32, `${streak(summary.currentStreakDays)}d streak`, { fill: palette.text, size: 13, family: mono, id: 'streak-count' }),
      text(622, 32, `${compact(summary.peakDailyTokens)} peak`, { fill: palette.text, size: 13, family: mono, anchor: 'end', id: 'peak-count' }),
    ].join('\n'),
  };
}

export function renderCard(input, options = {}) {
  const summary = validateSummary(input);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Card options must be an object.');
  const config = { template: 'minimal', theme: 'dark', checkedAt: new Date().toISOString(), cadence: 'hourly', logo: true, ...options };
  if (!templates.has(config.template)) throw new Error('Choose a template: minimal, terminal, or badge.');
  if (!Object.hasOwn(themes, config.theme)) throw new Error('Choose a theme: dark or light.');
  if (!Object.hasOwn(cadences, config.cadence)) throw new Error('Choose a cadence: hourly, daily, or manual.');
  if (typeof config.logo !== 'boolean') throw new Error('The logo option must be a boolean.');
  if (typeof config.checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(config.checkedAt) || Number.isNaN(Date.parse(config.checkedAt))) {
    throw new Error('checkedAt must be a valid UTC ISO timestamp.');
  }
  const date = new Date(config.checkedAt);
  const canonicalInput = config.checkedAt.includes('.')
    ? config.checkedAt.replace(/\.(\d+)Z$/, (_match, fraction) => `.${fraction.padEnd(3, '0')}Z`)
    : config.checkedAt.replace(/Z$/, '.000Z');
  if (date.toISOString() !== canonicalInput) throw new Error('checkedAt must be a valid UTC ISO timestamp.');
  const dateLabel = `${date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })} · ${date.toISOString().slice(11, 16)} UTC`;
  const palette = themes[config.theme];
  const { height, content } = ({ minimal, terminal, badge })[config.template](summary, palette, config, dateLabel);
  const description = `Codex account aggregate: ${exact(summary.lifetimeTokens)} lifetime tokens; current streak ${exact(summary.currentStreakDays)} days; peak daily tokens ${exact(summary.peakDailyTokens)}. Card updated after a successful account check at ${date.toISOString()}; source data timestamp unavailable. ${cadences[config.cadence]}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}" role="img" aria-labelledby="title description">
<title id="title">Codex activity</title>
<desc id="description">${escapeXml(description)}</desc>
<rect x="0.5" y="0.5" width="639" height="${height - 1}" rx="${config.template === 'badge' ? 10 : 16}" fill="${palette.surface}" stroke="${palette.border}"/>
${content}
</svg>\n`;
}
