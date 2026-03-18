import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function start(args) {
  const child = spawn(`${npmCommand} ${args.join(' ')}`, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    shutdownAll();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  children.push({ child });
}

function shutdownAll() {
  for (const { child } of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownAll();
  process.exit(0);
});

start(['run', 'dev']);
start(['run', 'dev:api']);
