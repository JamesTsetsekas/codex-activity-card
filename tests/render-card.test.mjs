import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCard, validateSummary } from '../scripts/lib/render-card.mjs';

const summary = { lifetimeTokens: 68_732_963_231, currentStreakDays: 57, peakDailyTokens: 2_506_421_660 };
const checkedAt = '2026-11-02T23:17:00.000Z';

for (const template of ['minimal', 'terminal', 'badge']) {
  for (const theme of ['dark', 'light']) {
    test(`${template}/${theme} is deterministic and self-contained`, () => {
      const options = { template, theme, checkedAt };
      const svg = renderCard(summary, options);
      assert.equal(svg, renderCard(summary, options));
      assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
      assert.match(svg, /role="img" aria-labelledby="title description"/);
      assert.match(svg, /68,732,963,231 lifetime tokens/);
      assert.match(svg, /current streak 57 days/);
      assert.match(svg, /peak daily tokens 2,506,421,660/);
      assert.match(svg, /source data timestamp unavailable/);
      assert.match(svg, /Hourly checks/);
      assert.doesNotMatch(svg, /<script|<foreignObject|href=|url\(|<image/);
      assert.ok(svg.includes(readFileSync(new URL('../assets/brands/codex.svg', import.meta.url), 'utf8').trim()));
    });
  }
}

test('validates and normalizes summary without carrying unrelated fields', () => {
  assert.deepEqual(validateSummary({ ...summary, private: 'unrelated' }), summary);
  for (const invalid of [null, undefined, [], 'usage', {}, { ...summary, lifetimeTokens: '123' }, { ...summary, lifetimeTokens: NaN }, { ...summary, lifetimeTokens: Infinity }, { ...summary, lifetimeTokens: -1 }, { ...summary, peakDailyTokens: 0.1 }, { ...summary, currentStreakDays: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => validateSummary(invalid), /Codex did not return/);
  }
});

test('zero usage and a one-day streak remain valid', () => {
  const svg = renderCard({ lifetimeTokens: 0, currentStreakDays: 0, peakDailyTokens: 0 }, { checkedAt });
  assert.match(svg, /current streak 0 days/);
  assert.match(svg, /id="lifetime-count"[^>]*>0<\/text>/);
  assert.match(renderCard({ ...summary, currentStreakDays: 1 }, { checkedAt }), />1 day<\/text>/);
});

test('long totals and streaks stay compact while the accessible description remains exact', () => {
  for (const template of ['minimal', 'terminal', 'badge']) {
    const svg = renderCard({ lifetimeTokens: Number.MAX_SAFE_INTEGER, currentStreakDays: 1000, peakDailyTokens: Number.MAX_SAFE_INTEGER }, { template, checkedAt });
    assert.match(svg, /9,007,199,254,740,991 lifetime tokens/);
    assert.match(svg, /current streak 1,000 days/);
    assert.match(svg, /id="streak-count"[^>]*>1,000(?: days|d streak)<\/text>/);
    assert.match(renderCard({ ...summary, currentStreakDays: Number.MAX_SAFE_INTEGER }, { template, checkedAt }), /current streak 9,007,199,254,740,991 days/);
  }
});

test('text-only rendering removes the brand mark', () => {
  for (const template of ['minimal', 'terminal', 'badge']) {
    const svg = renderCard(summary, { checkedAt, logo: false, template });
    assert.doesNotMatch(svg, /fill-rule="evenodd"/);
    assert.match(svg, /Codex|codex/);
  }
});

test('validates presentation options and timestamps before interpolation', () => {
  for (const options of [null, [], { template: '<script>' }, { theme: '__proto__' }, { cadence: '<script>' }, { logo: 'yes' }, { checkedAt: 'not a date' }, { checkedAt: '2026-11-02T23:17:00Z<script>' }, { checkedAt: '2026-11-02' }, { checkedAt: '2026-02-31T00:00:00Z' }]) {
    assert.throws(() => renderCard(summary, options));
  }
  assert.match(renderCard(summary, { checkedAt, cadence: 'daily' }), /Daily checks/);
  assert.match(renderCard(summary, { checkedAt, cadence: 'manual' }), /Manual refresh/);
});
