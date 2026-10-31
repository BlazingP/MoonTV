import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只生成 .env.kazumi。kazumi_* 源由 MoonTV 启动时按规则目录自动添加，
// 线上直接使用仓库里的 config.json，不再生成单独的配置副本。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicUrl = process.argv[2];
if (!publicUrl) {
  console.error(
    'Usage: node scripts/setup-kazumi.mjs https://your-moontv.example'
  );
  process.exit(1);
}
const url = new URL(publicUrl);
if (
  !['http:', 'https:'].includes(url.protocol) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/'
) {
  throw new Error(
    'Use the public MoonTV origin, including its port when needed; no path or credentials.'
  );
}
const envPath = resolve(root, '.env.kazumi');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
if (env && !/^KAZUMI_SECRET=.{32,}$/m.test(env)) {
  throw new Error(
    'Existing .env.kazumi has no valid signing secret; review it before continuing.'
  );
}
if (!env)
  env = `KAZUMI_SECRET=${randomBytes(32).toString(
    'hex'
  )}\nKAZUMI_BROWSER=true\n`;
env = env.replace(/^KAZUMI_PUBLIC_BASE=.*\r?\n?/gm, '');
env = env.trimEnd() + `\nKAZUMI_PUBLIC_BASE=${url.origin}/api/kazumi\n`;
writeFileSync(envPath, env, { mode: 0o600 });
console.log(
  'Signing secret saved in .env.kazumi. Keep this file stable across rebuilds.'
);
console.log(
  'Ready for: docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml up -d --build'
);
