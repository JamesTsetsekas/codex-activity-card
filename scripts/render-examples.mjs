import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderCard } from './lib/render-card.mjs';

// Fixed illustrative values keep previews reproducible without an account sign-in.
const summary = {
  lifetimeTokens: 128_432_187,
  currentStreakDays: 23,
  peakDailyTokens: 9_612_340,
};
const checkedAt = '2026-10-01T12:00:00.000Z';
const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter(argument => argument !== '--check');
if (unknown.length) throw new Error(`Unknown example option: ${unknown[0]}`);

const assets = new URL('../assets/', import.meta.url);
const examples = new URL('examples/', assets);
if (!check) await mkdir(examples, { recursive: true });

async function save(url, contents) {
  if (check) {
    const existing = await readFile(url, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing !== contents) {
      throw new Error(`Preview is missing or out of date: ${fileURLToPath(url)}. Run npm run examples.`);
    }
    return;
  }
  await writeFile(url, contents, 'utf8');
}

for (const template of ['minimal', 'terminal', 'badge']) {
  for (const theme of ['dark', 'light']) {
    const svg = renderCard(summary, { template, theme, checkedAt, cadence: 'hourly' });
    await save(new URL(`${template}-${theme}.svg`, examples), svg);
    if (template === 'minimal' && theme === 'dark') {
      await save(new URL('codex-activity.svg', assets), svg);
    }
  }
}

console.log(check ? 'All seven example SVGs are current.' : 'Rendered seven example SVGs from illustrative aggregate data.');
