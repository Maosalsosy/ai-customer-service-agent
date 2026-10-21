import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const source = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('用法：node scripts/db-restore-verify.mjs <备份文件> [新建的验证库名]');
await access(source);

const target = process.argv[3] ?? `aikefu_restore_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
if (!/^aikefu_restore_[a-zA-Z0-9_]+$/.test(target)) {
  throw new Error('验证库名必须以 aikefu_restore_ 开头，脚本只允许恢复到新建的隔离数据库');
}

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const userResult = spawnSync(docker, ['compose', 'exec', '-T', 'postgres', 'printenv', 'POSTGRES_USER'], { encoding: 'utf8' });
if (userResult.status !== 0) throw new Error('无法读取 Postgres 容器配置，请确认容器正在运行');
const user = userResult.stdout.trim();
if (!user) throw new Error('Postgres 用户配置为空');

const exists = spawnSync(docker, ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${target}'`], { encoding: 'utf8' });
if (exists.status !== 0) throw new Error('无法检查验证数据库状态');
if (exists.stdout.trim() === '1') throw new Error(`验证数据库 ${target} 已存在；脚本不会覆盖或删除数据库`);

const create = spawnSync(docker, ['compose', 'exec', '-T', 'postgres', 'createdb', '-U', user, target], { stdio: 'inherit' });
if (create.status !== 0) throw new Error(`创建隔离验证库 ${target} 失败`);

const restore = spawn(docker, ['compose', 'exec', '-T', 'postgres', 'pg_restore', '--username', user, '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', target], { stdio: ['pipe', 'inherit', 'inherit'] });
const restoreClosed = new Promise((resolve) => restore.once('close', resolve));
await pipeline(createReadStream(source), restore.stdin);
const restoreCode = await restoreClosed;
if (restoreCode !== 0) throw new Error(`pg_restore 失败，退出码 ${restoreCode}；隔离验证库保留供排查：${target}`);

const verify = spawnSync(docker, ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', target, '-tAc', 'SELECT COUNT(*) FROM tenants'], { encoding: 'utf8' });
if (verify.status !== 0) throw new Error(`恢复完成但 tenants 校验失败；验证库保留：${target}`);
console.log(`恢复校验完成：${target}；租户行数 ${verify.stdout.trim()}`);
console.log('此脚本不会覆盖生产库。确认验证结果后，再按运维变更流程切换 DATABASE_URL。');
