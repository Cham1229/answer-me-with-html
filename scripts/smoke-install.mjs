#!/usr/bin/env node
// Real-install smoke test (called by the CI install job, needs network):
// 1. npx skills add <repo> -l recognizes the skill (fails here when the YAML header is broken, see PR #2);
// 2. install once for real with a temporary HOME, then render a page with the installed am.mjs;
// 3. claude plugin validate checks the manifests of the marketplace and the always-on plugin.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'am-smoke-'));
const env = { ...process.env, HOME: home, AM_HOME: join(home, '.answer-me-with-html'), AM_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const step = (name) => process.stdout.write(`\n▶ ${name}\n`);
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function find(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (['node_modules', '.npm', '.git', 'docs', 'test', 'bench'].includes(e)) continue;
    if (e === name) return p;
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    }
  }
  return null;
}

try {
  step('npx skills add -l');
  const list = strip(sh('npx', ['-y', 'skills@latest', 'add', ROOT, '-l']));
  // Check only key signals, not the full wording: a skip / parse error fails, and the list must contain the skill name.
  if (/Skipped|parse error|No (valid )?skills found/i.test(list) || !/answer-me-with-html/.test(list)) {
    throw new Error(`skills CLI did not recognize the skill:\n${list}`);
  }
  process.stdout.write('✓ skills CLI recognizes answer-me-with-html\n');

  step('npx skills add -g (temporary HOME)');
  sh('npx', ['-y', 'skills@latest', 'add', ROOT, '-g', '-a', 'claude-code', '-y', '--copy']);
  const installed = find(join(home, '.claude'), 'am.mjs');
  if (!installed) throw new Error('am.mjs not found after install');
  const out = sh(process.execPath, [installed, 'render', '-', '--no-open'], { input: '## A 标题\n```flow\nA -> B\n```\n' });
  if (!/^✓ /m.test(out)) throw new Error(`the installed am.mjs cannot render a page:\n${out}`);
  process.stdout.write(`✓ ${installed} can render a page\n`);

  step('claude plugin install (isolated config directory)');
  const cfg = join(home, '.claude-config');
  const claude = (...args) => sh('npx', ['-y', '@anthropic-ai/claude-code@latest', 'plugin', ...args], { env: { ...env, CLAUDE_CONFIG_DIR: cfg } });
  claude('marketplace', 'add', ROOT);
  claude('install', 'answer-me-with-html@answer-me-with-html');
  claude('install', 'answer-me-with-html-always@answer-me-with-html');
  const cache = join(cfg, 'plugins', 'cache', 'answer-me-with-html');
  const pluginAm = find(join(cache, 'answer-me-with-html'), 'am.mjs');
  if (!pluginAm) throw new Error('am.mjs not found after plugin install');
  const out2 = sh(process.execPath, [pluginAm, 'render', '-', '--no-open'], { input: '## A 标题\n文字\n' });
  if (!/^✓ /m.test(out2)) throw new Error(`the plugin's am.mjs cannot render a page:\n${out2}`);
  const hook = find(join(cache, 'answer-me-with-html-always'), 'remind.mjs');
  if (!hook) throw new Error('hook script not found after installing the always-on plugin');
  const reminder = JSON.parse(sh(process.execPath, [hook], { input: '{}' }));
  if (!/answer-me-with-html always-on/.test(reminder.hookSpecificOutput?.additionalContext ?? '')) {
    throw new Error(`unexpected hook output from the always-on plugin: ${JSON.stringify(reminder)}`);
  }
  process.stdout.write('✓ both plugins install; the plugin\'s am.mjs renders a page and the hook prints the reminder\n');

  step('claude plugin validate');
  for (const target of [ROOT, join(ROOT, 'plugins/answer-me-with-html-always')]) {
    // On a validation failure claude exits non-zero and execFileSync throws; output wording is no longer matched.
    sh('npx', ['-y', '@anthropic-ai/claude-code@latest', 'plugin', 'validate', target]);
  }
  process.stdout.write('✓ marketplace and plugin manifests pass validation\n');
} catch (e) {
  process.stderr.write(`✗ ${e.stderr ? strip(String(e.stderr)) : ''}${e.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
