import { createWriteStream } from 'node:fs';
import { link, mkdir, unlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(process.argv[2] ?? `backups/aikefu-${stamp}.dump`);
const temporaryOutput = `${output}.${randomUUID()}.partial`;
const directory = path.dirname(output);
await mkdir(directory, { recursive: true });

const check = spawnSync(docker, ['compose', 'ps', '--status', 'running', 'postgres'], { stdio: 'ignore' });
if (check.status !== 0) throw new Error('Postgres 容器未运行，请先启动 docker compose');

const child = spawn(docker, ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'], { stdio: ['ignore', 'pipe', 'inherit'] });
const closed = new Promise((resolve) => child.once('close', resolve));
try {
  await pipeline(child.stdout, createWriteStream(temporaryOutput, { flags: 'wx' }));
  const exitCode = await closed;
  if (exitCode !== 0) throw new Error(`pg_dump 失败，退出码 ${exitCode}`);
  await link(temporaryOutput, output);
  console.log(`备份完成：${output}`);
} catch (error) {
  child.kill();
  await closed;
  throw error;
} finally {
  await unlink(temporaryOutput).catch(() => undefined);
}
