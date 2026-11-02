import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Read only the account's aggregate summary; never expose raw server messages. */
export function collectUsage({ spawnProcess = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const server = spawnProcess('codex', ['app-server'], {
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = createInterface({ input: server.stdout });
    let settled = false;
    let initialized = false;
    const timeout = setTimeout(() => finish(new Error('Codex usage request timed out.')), timeoutMs);

    function finish(error, summary) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      if (process.platform === 'win32' && server.pid) {
        // npm's Windows shim runs under cmd.exe; terminate its owned descendants too.
        const killer = spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        });
        killer.on('error', () => server.kill());
        killer.on('exit', code => { if (code !== 0) server.kill(); });
      } else {
        server.kill();
      }
      server.stdin.destroy();
      server.stdout.destroy();
      if (error) reject(error);
      else resolve(summary);
    }

    function send(message) {
      if (!settled) server.stdin.write(`${JSON.stringify(message)}\n`);
    }

    server.on('error', () => finish(new Error('Could not start the Codex CLI.')));
    server.on('exit', () => finish(new Error('Codex app-server exited before returning usage.')));
    server.stdin.on('error', () => finish(new Error('Could not send a request to Codex app-server.')));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.id === 1 && !initialized) {
        if (message.error) return finish(new Error('Codex app-server initialization failed.'));
        initialized = true;
        send({ method: 'initialized' });
        send({ method: 'account/usage/read', id: 2 });
      } else if (message?.id === 2 && initialized) {
        if (message.error) return finish(new Error('Codex usage is unavailable for this sign-in.'));
        finish(null, message.result?.summary);
      }
    });
    send({
      method: 'initialize', id: 1,
      params: { clientInfo: { name: 'codex_activity_card', title: 'Codex Activity Card', version: '1.2.0' } },
    });
  });
}
