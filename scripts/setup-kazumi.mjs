import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicUrl = process.argv[2];
if (!publicUrl) {
  console.error(
    'Usage: node scripts/setup-kazumi.mjs https://your-moontv.example [existing-config.json]'
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
const input = resolve(root, process.argv[3] || 'config.json');
const config = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
config.api_site ||= {};
const rules = readdirSync(resolve(root, 'services/kazumi-bridge/rules')).filter(
  (file) => file.endsWith('.json')
);
for (const file of rules) {
  const key = file.slice(0, -5);
  const rule = JSON.parse(
    readFileSync(resolve(root, 'services/kazumi-bridge/rules', file), 'utf8')
  );
  const sourceKey = `kazumi_${key}`;
  const api = `http://kazumi-bridge:8787/vod/${key}`;
  if (config.api_site[sourceKey] && config.api_site[sourceKey].api !== api) {
    throw new Error(
      `Existing source ${sourceKey} conflicts with the bridge; nothing was written.`
    );
  }
  config.api_site[sourceKey] = { api, name: `Kazumi · ${rule.name}` };
}
const envPath = resolve(root, '.env.kazumi');
const output = resolve(root, 'config.kazumi.json');
if (existsSync(output)) {
  throw new Error(
    'config.kazumi.json already exists. Review and rename it before generating again.'
  );
}
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
writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
console.log(
  `Prepared ${rules.length} Kazumi sources in config.kazumi.json; existing config.json was preserved.`
);
console.log(
  'Signing secret saved in .env.kazumi. Keep this file stable across rebuilds.'
);
console.log(
  'Ready for: docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml up -d --build'
);
