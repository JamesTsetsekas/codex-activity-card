import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { collectUsage } from '../scripts/lib/collect-usage.mjs';

const summary = { lifetimeTokens: 1234, currentStreakDays: 17, peakDailyTokens: 234 };

function fakeServer(onRequest) {
  const server = new EventEmitter();
  server.stdout = new PassThrough();
  server.stdin = new PassThrough();
  server.kills = 0;
  server.kill = () => { server.kills++; server.stdout.end(); return true; };
  const requests = [];
  let input = '';
  server.stdin.on('data', chunk => {
    input += chunk.toString();
    let newline;
    while ((newline = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        requests.push(message);
        queueMicrotask(() => onRequest?.(message, server));
      }
    }
  });
  server.reply = message => server.stdout.write(`${JSON.stringify(message)}\n`);
  return { server, requests, spawnProcess: () => server };
}

test('collector initializes before asking for usage and returns only the summary', async () => {
  const fake = fakeServer((message, server) => {
    if (message.method === 'initialize') {
      server.stdout.write('not JSON\n');
      server.reply({ method: 'unrelated/notification', params: { private: 'unrelated content' } });
      server.reply({ id: 1, result: {} });
    }
    if (message.method === 'account/usage/read') {
      server.reply({ id: 2, result: { summary, private: 'not collected' } });
    }
  });
  assert.deepEqual(await collectUsage({ spawnProcess: fake.spawnProcess }), summary);
  assert.deepEqual(fake.requests.map(message => message.method), ['initialize', 'initialized', 'account/usage/read']);
  assert.equal(fake.server.kills, 1);
});

test('repeated initialization replies do not trigger duplicate usage requests', async () => {
  const fake = fakeServer((message, server) => {
    if (message.method === 'initialize') {
      server.reply({ id: 1, result: {} });
      server.reply({ id: 1, result: {} });
    }
    if (message.method === 'account/usage/read') server.reply({ id: 2, result: { summary } });
  });
  await collectUsage({ spawnProcess: fake.spawnProcess });
  assert.equal(fake.requests.filter(message => message.method === 'account/usage/read').length, 1);
});

test('server errors are generic and cannot leak raw diagnostic payloads', async () => {
  for (const failAt of ['initialize', 'account/usage/read']) {
    const fake = fakeServer((message, server) => {
      if (message.method === failAt) server.reply({ id: message.id, error: { message: 'private credential-like payload' } });
      else if (message.method === 'initialize') server.reply({ id: 1, result: {} });
    });
    await assert.rejects(collectUsage({ spawnProcess: fake.spawnProcess }), error => {
      assert.doesNotMatch(error.message, /private|credential|payload/);
      return true;
    });
    assert.equal(fake.server.kills, 1);
  }
});

test('a stalled app-server times out and is terminated', async () => {
  const fake = fakeServer();
  await assert.rejects(collectUsage({ spawnProcess: fake.spawnProcess, timeoutMs: 30 }), /timed out/);
  assert.equal(fake.server.kills, 1);
});

test('startup and early exit failures reject promptly without exposing server details', async () => {
  for (const event of ['error', 'exit']) {
    const fake = fakeServer((message, server) => {
      if (message.method === 'initialize') server.emit(event, new Error('private startup detail'));
    });
    await assert.rejects(collectUsage({ spawnProcess: fake.spawnProcess }), error => {
      assert.doesNotMatch(error.message, /private startup detail/);
      return true;
    });
    assert.equal(fake.server.kills, 1);
  }
});
