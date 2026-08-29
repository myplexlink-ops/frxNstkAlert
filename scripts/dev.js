'use strict';

// `npm run dev` re-exports npm's own resolved config as npm_config_* env
// vars for the script it launches — including this machine's global
// `allow-scripts` allowlist (~/.npmrc). netlify-cli's bootstrap spawns its
// OWN nested `npm install` inside .netlify/plugins/ to install build
// integrations (e.g. the Neon plugin), and that install inherits the
// leaked npm_config_allow_scripts var. npm's allow-scripts feature
// explicitly refuses a CLI/env-sourced policy for a project-scoped
// install (npm/lib/utils/resolve-allow-scripts.js), so the nested install
// aborts with EALLOWSCRIPTS and takes `netlify dev` down with it. Strip
// the leaked policy vars so the nested install falls through to its own
// (unset) policy instead.
const { spawn } = require('child_process');

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_(allow_scripts|strict_allow_scripts|dangerously_allow_all_scripts)/i.test(key)) {
    delete env[key];
  }
}

const args = ['dev', ...process.argv.slice(2)];
const quote = (s) => (process.platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, `'\\''`)}'`);

const bin = process.platform === 'win32' ? 'netlify.cmd' : 'netlify';
const child = spawn([bin, ...args].map(quote).join(' '), {
  stdio: 'inherit',
  env,
  shell: true,
});
child.on('exit', (code, signal) => process.exit(code != null ? code : (signal ? 1 : 0)));
