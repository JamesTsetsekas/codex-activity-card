import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectUsage } from './lib/collect-usage.mjs';
import { renderCard, validateSummary } from './lib/render-card.mjs';

const templates = ['minimal', 'terminal', 'badge'];
const themes = ['dark', 'light'];
const help = `Usage: node scripts/update-codex-card.mjs [options]

  --output PATH       Primary SVG (default: assets/codex-activity.svg)
  --template NAME     minimal (default), terminal, or badge
  --theme NAME        dark (default) or light
  --palette NAME      neutral (default) or green
  --background NAME   transparent (default) or solid
  --cadence NAME      hourly (default), daily, or manual; display label only
  --no-logo           Use a text-only product label
  --variants-dir DIR  Also write all six layout/theme combinations
  --input PATH        Read an aggregate JSON fixture instead of Codex
  --status PATH       Write latest check status locally, outside your public repo
  --help              Show this help

Schedule the command separately. Existing cards remain untouched on invalid usage.
Unchanged cards keep their update timestamp and are not rewritten.
`;

export function parseArguments(args) {
  const options = {
    output: fileURLToPath(new URL('../assets/codex-activity.svg', import.meta.url)),
    template: 'minimal', theme: 'dark', palette: 'neutral', background: 'transparent', cadence: 'hourly', logo: true,
  };
  const values = new Map([
    ['--output', 'output'], ['--template', 'template'], ['--theme', 'theme'],
    ['--cadence', 'cadence'], ['--variants-dir', 'variantsDir'],
    ['--palette', 'palette'], ['--background', 'background'],
    ['--input', 'input'], ['--status', 'status'],
  ]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Option ${flag} was provided more than once.`);
    seen.add(flag);
    if (flag === '--help') { options.help = true; continue; }
    if (flag === '--no-logo') { options.logo = false; continue; }
    const name = values.get(flag);
    if (!name) throw new Error('Unknown option. Use --help for supported options.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Provide a value after ${flag}.`);
    options[name] = value;
  }
  if (!templates.includes(options.template)) throw new Error('Template must be minimal, terminal, or badge.');
  if (!themes.includes(options.theme)) throw new Error('Theme must be dark or light.');
  if (!['neutral', 'green'].includes(options.palette)) throw new Error('Palette must be neutral or green.');
  if (!['transparent', 'solid'].includes(options.background)) throw new Error('Background must be transparent or solid.');
  if (!['hourly', 'daily', 'manual'].includes(options.cadence)) throw new Error('Cadence must be hourly, daily, or manual.');
  for (const name of ['output', 'variantsDir', 'input', 'status']) {
    if (options[name]) options[name] = resolve(options[name]);
  }
  return options;
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** A failed write cannot truncate the previous good image. */
async function atomicWrite(path, content, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function documentFor(summary, options, checkedAt) {
  const svg = renderCard(summary, { ...options, checkedAt });
  return svg.replace('</desc>', `</desc>\n  <metadata id="codex-activity-card" data-updated-at="${checkedAt}"/>`);
}

async function pathIdentity(path) {
  if (!path) return null;
  let current = resolve(path);
  const missing = [];
  while (true) {
    try {
      const canonical = resolve(await realpath(current), ...missing);
      return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

async function destinations(options) {
  const files = [{ path: options.output, template: options.template, theme: options.theme }];
  if (options.variantsDir) {
    for (const template of templates) {
      for (const theme of themes) {
        files.push({ path: resolve(options.variantsDir, `codex-${template}-${theme}.svg`), template, theme });
      }
    }
  }
  const [inputKey, statusKey] = await Promise.all([pathIdentity(options.input), pathIdentity(options.status)]);
  const unique = new Map();
  for (const file of files) {
    const key = await pathIdentity(file.path);
    if (key === inputKey || key === statusKey) {
      throw new Error('Input, status, and image output paths must be different.');
    }
    const previous = unique.get(key);
    if (previous && (previous.template !== file.template || previous.theme !== file.theme)) {
      throw new Error('The primary output conflicts with a different requested variant.');
    }
    unique.set(key, file);
  }
  if (inputKey && inputKey === statusKey) throw new Error('Input and status paths must be different.');
  return [...unique.values()];
}

export async function updateCards(options, { readUsage = collectUsage, now = () => new Date() } = {}) {
  const files = await destinations(options);
  const checkedAt = now().toISOString();
  let changed = 0;
  try {
    let raw;
    if (options.input) {
      try { raw = JSON.parse(await readFile(options.input, 'utf8')); }
      catch { throw new Error('Could not read a valid aggregate JSON input file.'); }
    } else {
      raw = await readUsage();
    }
    const summary = validateSummary(raw);
    // Render and validate every output before touching any existing image.
    const pending = [];
    for (const file of files) {
      const rendering = { template: file.template, theme: file.theme, palette: options.palette, background: options.background, cadence: options.cadence, logo: options.logo };
      const existing = await readOptional(file.path);
      const stored = existing?.match(/<metadata id="codex-activity-card" data-updated-at="([^"]+)"\s*\/>/)?.[1];
      const previousAt = stored && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stored)
        && Number.isFinite(Date.parse(stored)) && new Date(stored).toISOString() === stored ? stored : checkedAt;
      if (existing === documentFor(summary, rendering, previousAt)) continue;
      pending.push({ path: file.path, content: documentFor(summary, rendering, checkedAt) });
    }
    for (const file of pending) {
      await atomicWrite(file.path, file.content);
      changed++;
    }
    if (options.status) {
      await atomicWrite(options.status, `${JSON.stringify({ ok: true, checkedAt, changed }, null, 2)}\n`, 0o600);
    }
    return { changed, checkedAt };
  } catch (error) {
    if (options.status) {
      // Raw app-server errors, usage, and credentials never enter diagnostics.
      await atomicWrite(options.status, `${JSON.stringify({ ok: false, checkedAt, error: 'Activity card refresh failed.' }, null, 2)}\n`, 0o600)
        .catch(() => {});
    }
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const { changed } = await updateCards(options);
  console.log(changed ? `Updated ${changed} activity card${changed === 1 ? '' : 's'}.` : 'Cards already current.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code ? 'Could not access an activity card file; check paths and permissions.' : error.message);
    process.exitCode = 1;
  });
}
