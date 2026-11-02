import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseArguments, updateCards } from '../scripts/update-codex-card.mjs';

const summary = { lifetimeTokens: 68_732_963_231, currentStreakDays: 157, peakDailyTokens: 2_506_421_660 };
const firstCheck = '2026-11-02T23:30:00.000Z';
const laterCheck = '2026-11-04T12:17:00.000Z';
const clock = value => () => new Date(value);

async function workspace(run) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'codex-card-tests-'));
  try { await run(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), parent);
    assert.ok(basename(directory).startsWith('codex-card-tests-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('CLI defaults and explicit configuration are independent', () => {
  const defaults = parseArguments([]);
  assert.equal(defaults.template, 'minimal');
  assert.equal(defaults.theme, 'dark');
  assert.equal(defaults.cadence, 'hourly');
  assert.equal(defaults.logo, true);
  const custom = parseArguments(['--template', 'terminal', '--theme', 'light', '--cadence', 'manual', '--no-logo']);
  assert.equal(custom.template, 'terminal');
  assert.equal(custom.theme, 'light');
  assert.equal(custom.cadence, 'manual');
  assert.equal(custom.logo, false);
});

test('unsupported, missing, and duplicate arguments fail before starting Codex', () => {
  for (const args of [
    ['--unknown'], ['--output'], ['--input', '--theme', 'dark'],
    ['--theme', 'blue'], ['--template', 'html'], ['--cadence', 'never'],
    ['--theme', 'dark', '--theme', 'light'], ['--no-logo', '--no-logo'],
  ]) assert.throws(() => parseArguments(args));
});

test('one account request can generate a missing primary and all six variants', async () => workspace(async directory => {
  const output = join(directory, 'nested', 'card.svg');
  const variants = join(directory, 'gallery');
  const options = parseArguments(['--output', output, '--variants-dir', variants]);
  let requests = 0;
  const result = await updateCards(options, {
    readUsage: async () => { requests++; return summary; }, now: clock(firstCheck),
  });
  assert.equal(requests, 1);
  assert.equal(result.changed, 7);
  assert.match(await readFile(output, 'utf8'), /<svg\b/);
  assert.deepEqual((await readdir(variants)).sort(), [
    'codex-badge-dark.svg', 'codex-badge-light.svg', 'codex-minimal-dark.svg',
    'codex-minimal-light.svg', 'codex-terminal-dark.svg', 'codex-terminal-light.svg',
  ]);
}));

test('unchanged checks across days preserve SVG bytes and mtime while status advances', async () => workspace(async directory => {
  const output = join(directory, 'card.svg');
  const status = join(directory, 'private', 'status.json');
  const options = parseArguments(['--output', output, '--status', status]);
  await updateCards(options, { readUsage: async () => summary, now: clock(firstCheck) });
  const before = await readFile(output, 'utf8');
  const beforeMtime = (await stat(output)).mtimeMs;
  const result = await updateCards(options, { readUsage: async () => summary, now: clock(laterCheck) });
  assert.equal(result.changed, 0);
  assert.equal(await readFile(output, 'utf8'), before);
  assert.equal((await stat(output)).mtimeMs, beforeMtime);
  const health = JSON.parse(await readFile(status, 'utf8'));
  assert.deepEqual(health, { ok: true, checkedAt: laterCheck, changed: 0 });
  assert.doesNotMatch(JSON.stringify(health), /lifetimeTokens|68732963231/);
}));

test('new usage and presentation choices refresh the timestamp and card', async () => workspace(async directory => {
  const output = join(directory, 'card.svg');
  const options = parseArguments(['--output', output]);
  await updateCards(options, { readUsage: async () => summary, now: clock(firstCheck) });
  const before = await readFile(output, 'utf8');
  const result = await updateCards(options, {
    readUsage: async () => ({ ...summary, currentStreakDays: 158 }), now: clock(laterCheck),
  });
  const updated = await readFile(output, 'utf8');
  assert.equal(result.changed, 1);
  assert.notEqual(updated, before);
  assert.ok(updated.includes(laterCheck));
  const restyled = await updateCards({ ...options, theme: 'light' }, {
    readUsage: async () => ({ ...summary, currentStreakDays: 158 }), now: clock(laterCheck),
  });
  assert.equal(restyled.changed, 1);
  assert.notEqual(await readFile(output, 'utf8'), updated);
}));

test('failed usage or invalid counts leave the last good image and record a generic failure', async () => workspace(async directory => {
  const output = join(directory, 'card.svg');
  const status = join(directory, 'status.json');
  const options = parseArguments(['--output', output, '--status', status]);
  await updateCards(options, { readUsage: async () => summary, now: clock(firstCheck) });
  const before = await readFile(output, 'utf8');
  for (const readUsage of [
    async () => { throw new Error('sensitive server message must not enter status'); },
    async () => ({ ...summary, lifetimeTokens: -1 }),
    async () => ({ ...summary, peakDailyTokens: Number.MAX_SAFE_INTEGER + 1 }),
    async () => ({ lifetimeTokens: 123 }),
  ]) {
    await assert.rejects(updateCards(options, { readUsage, now: clock(laterCheck) }));
    assert.equal(await readFile(output, 'utf8'), before);
    const health = JSON.parse(await readFile(status, 'utf8'));
    assert.equal(health.ok, false);
    assert.equal(health.checkedAt, laterCheck);
    assert.doesNotMatch(JSON.stringify(health), /sensitive|lifetimeTokens|68732963231/);
  }
}));

test('colliding input, status, primary, and variant paths are rejected without touching files', async () => workspace(async directory => {
  const output = join(directory, 'card.svg');
  await writeFile(output, 'existing card');
  const configurations = [
    ['--output', output, '--input', output],
    ['--output', output, '--status', output],
    ['--output', output, '--input', join(directory, 'input.json'), '--status', join(directory, 'input.json')],
    ['--output', join(directory, 'codex-terminal-dark.svg'), '--variants-dir', directory],
  ];
  for (const args of configurations) {
    let requests = 0;
    await assert.rejects(updateCards(parseArguments(args), { readUsage: async () => { requests++; return summary; } }));
    assert.equal(requests, 0);
  }
  assert.equal(await readFile(output, 'utf8'), 'existing card');
}));

test('Windows path casing cannot let status overwrite an image', { skip: process.platform !== 'win32' }, async () => workspace(async directory => {
  const output = join(directory, 'card.svg');
  await writeFile(output, 'existing card');
  let requests = 0;
  const options = parseArguments(['--output', output, '--status', output.toUpperCase()]);
  await assert.rejects(updateCards(options, { readUsage: async () => { requests++; return summary; } }));
  assert.equal(requests, 0);
  assert.equal(await readFile(output, 'utf8'), 'existing card');
}));

test('offline CLI renders valid aggregates and rejects malformed JSON without replacing the card', async () => workspace(async directory => {
  const input = join(directory, 'summary.json');
  const output = join(directory, 'card.svg');
  const script = fileURLToPath(new URL('../scripts/update-codex-card.mjs', import.meta.url));
  await writeFile(input, JSON.stringify(summary));
  const run = () => spawnSync(process.execPath, [script, '--input', input, '--output', output], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const before = await readFile(output, 'utf8');
  await writeFile(input, '{invalid private input');
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /private input/);
  assert.equal(await readFile(output, 'utf8'), before);
}));
