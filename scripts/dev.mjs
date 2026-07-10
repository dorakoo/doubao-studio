import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const preferredPort = 5173;
const children = new Set();
let shuttingDown = false;

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available development port found from ${startPort} to ${startPort + 99}`);
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${signal || `code ${code}`}`));
    });
  });
}

async function waitForServer(url, viteProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (viteProcess.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (code ${viteProcess.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
}

async function main() {
  const port = await findAvailablePort(preferredPort);
  const devServerUrl = `http://${host}:${port}`;
  if (port !== preferredPort) {
    console.log(`[dev] Port ${preferredPort} is occupied; using ${port} instead.`);
  }

  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProcess = run(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort']);
  await waitForServer(devServerUrl, viteProcess);

  const tscBin = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  await waitForExit(run(process.execPath, [tscBin, '-p', 'tsconfig.main.json']), 'Main-process build');

  const electronPath = require('electron');
  const electronProcess = run(electronPath, ['.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
  });

  electronProcess.once('exit', (code) => {
    stopChildren();
    process.exitCode = code ?? 0;
  });
}

process.once('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});
process.once('exit', stopChildren);

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  stopChildren();
  process.exitCode = 1;
});
