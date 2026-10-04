#!/usr/bin/env node
// Android 只负责运行和停止进程，游戏规则与 /ws 协议继续由上游服务器实现。
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

function argumentsFrom(argv) {
  const options = { host: '127.0.0.1', port: 32173, nonce: '', root: path.dirname(fileURLToPath(import.meta.url)) };
  const seen = new Set();
  for (const arg of argv) {
    const match = /^--(host|port|nonce|root)=(.*)$/.exec(arg);
    if (!match || seen.has(match[1])) throw new Error(`invalid or repeated argument: ${arg}`);
    seen.add(match[1]);
    options[match[1]] = match[2];
  }
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('invalid port');
  if (!['127.0.0.1', '0.0.0.0'].includes(options.host)) throw new Error('invalid host');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.nonce)) throw new Error('invalid nonce');
  options.root = path.resolve(options.root);
  return options;
}

try {
  const options = argumentsFrom(process.argv.slice(2));
  const { startServer } = await import(pathToFileURL(path.join(options.root, 'server/index.js')));
  const { version: app } = JSON.parse(await readFile(path.join(options.root, 'package.json'), 'utf8'));
  let server;
  let stopping = false;
  let closePromise;
  async function stop() {
    stopping = true;
    if (!server || closePromise) return closePromise;
    const timeout = setTimeout(() => process.exit(1), 5000);
    timeout.unref();
    closePromise = server.close().finally(() => clearTimeout(timeout));
    return closePromise;
  }
  const signal = () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.on('SIGTERM', signal);
  process.on('SIGINT', signal);
  server = await startServer({
    host: options.host, port: options.port, quiet: true, trustProxy: false,
    publicDir: path.join(options.root, 'public'),
    dataDir: path.join(options.root, 'data'),
    sharedDir: path.join(options.root, 'shared'),
  });
  // 服务实际监听后才发出握手；nonce 防止把其他进程误认为本次启动的服务器。
  if (stopping) await stop();
  else process.stdout.write(`SP_READY ${JSON.stringify({ port: server.port, pid: process.pid, nonce: options.nonce, app })}\n`);
} catch (error) {
  process.stderr.write(`SP_ERROR ${JSON.stringify({ message: error.message })}\n`);
  process.exitCode = 1;
}
