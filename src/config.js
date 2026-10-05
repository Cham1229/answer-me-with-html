// User config: ~/.answer-me-with-html/config.json (AM_HOME moves it).
// Only keys the user set explicitly are saved; reads merge with defaults, and a bad file / invalid value falls back to the default, so config problems never block rendering.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { CHOICES, VOICES } from './parse.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const CONFIG_KEYS = Object.freeze({
  open: { type: 'bool', default: true, label: 'Open the page in the browser after it is made' },
  always: { type: 'bool', default: true, label: 'Always-on mode: add a page to every conclusion (needs the answer-me-with-html-always plugin)' },
  theme: { type: 'enum', choices: CHOICES.theme, default: 'blueprint', label: 'Default theme' },
  mode: { type: 'enum', choices: CHOICES.mode, default: 'auto', label: 'Default light/dark mode' },
  style: { type: 'enum', choices: CHOICES.style, default: '80', label: 'STE writing-check strictness' },
  update_check: { type: 'bool', default: true, label: 'Check for a new version once a week in the background and tell you (never updates by itself)' },
  voice: { type: 'enum', choices: VOICES, default: 'auto', label: 'Video narration voice-over (auto: ElevenLabs if ELEVENLABS_API_KEY is set, otherwise system TTS; local: the local service at AM_TTS_URL)' },
});

const TRUE = new Set(['on', 'true', 'yes', '1', '开', '开启', '打开']); // lang-ok: accepted Chinese input aliases
const FALSE = new Set(['off', 'false', 'no', '0', '关', '关闭']); // lang-ok: accepted Chinese input aliases

export function amHome(env = process.env) {
  return env.AM_HOME || join(homedir(), '.answer-me-with-html');
}

export function configPath(env = process.env) {
  return join(amHome(env), 'config.json');
}

const defaults = () => Object.fromEntries(Object.entries(CONFIG_KEYS).map(([k, s]) => [k, s.default]));

function coerce(key, raw) {
  const spec = CONFIG_KEYS[key];
  if (!spec) throw new ConfigError(`No setting named "${key}". Available: ${Object.keys(CONFIG_KEYS).join(' | ')}`);
  if (spec.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const v = String(raw).trim().toLowerCase();
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    throw new ConfigError(`${key} accepts only on / off`);
  }
  const v = String(raw).trim();
  if (!spec.choices.includes(v)) throw new ConfigError(`Invalid ${key} value "${v}". Choose one of: ${spec.choices.join(' | ')}`);
  return v;
}

function readStored(env) {
  const file = configPath(env);
  if (!existsSync(file)) return { stored: {} };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { stored: data && typeof data === 'object' && !Array.isArray(data) ? data : {} };
  } catch (e) {
    return { stored: {}, warning: `Cannot parse ${file}; using the default settings (${e.message})` };
  }
}

export function readConfig(env = process.env) {
  const { stored, warning } = readStored(env);
  const values = defaults();
  for (const [k, v] of Object.entries(stored)) {
    if (!CONFIG_KEYS[k]) continue;
    try {
      values[k] = coerce(k, v);
    } catch {
      // Invalid values keep the default.
    }
  }
  return { values, stored, warning, path: configPath(env) };
}

function writeStored(stored, env) {
  const file = configPath(env);
  if (!Object.keys(stored).length) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
}

export function setConfig(key, raw, env = process.env) {
  const value = coerce(key, raw);
  const { stored } = readStored(env);
  writeStored({ ...stored, [key]: value }, env);
  return value;
}

export function resetConfig(key, env = process.env) {
  if (key !== undefined && !CONFIG_KEYS[key]) coerce(key, '');
  const { stored } = readStored(env);
  const next = key === undefined ? {} : Object.fromEntries(Object.entries(stored).filter(([k]) => k !== key));
  writeStored(next, env);
}
