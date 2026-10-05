// Language rule (issue #39): the repository speaks English; the product speaks the reader's language.
// This test fails on Chinese text in the files listed in SCOPE, outside the ALLOWED spans.
// Later tickets widen the rule by adding entries to SCOPE (and, if needed, to ALLOWED).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const commandFiles = () => readdirSync(join(ROOT, 'commands')).filter((f) => f.endsWith('.md')).map((f) => join('commands', f));

// What part of a file the check reads.
const PARTS = {
  whole: (text) => text,
  frontmatter: (text) => text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '',
  strings: stringLiterals,
  // The whole skill except its description: the description quotes Chinese trigger phrases users type.
  skill: (text) => text.replace(/^description:.*\n(?:[ \t]+.*\n)*/m, (m) => m.replace(/[^\n]/g, ' ')),
  // Writing-check warning text: the literal parts of every `message:` / `suggestion:` value, one per line.
  // Interpolations and "quoted" spans are dropped: they hold the flagged Chinese text, which is the subject.
  lintMessages: (text) =>
    [...text.matchAll(/\b(?:message|suggestion):\s*(`[^`]*`|'[^']*')/g)].map((m) => m[1].slice(1, -1).replace(/\$\{[^}]*\}|"[^"]*"/g, '')).join('\n'),
  // Test files: test names and comments only; fixtures, expected output and other code are blanked (line breaks kept).
  // Tokens: a test name (first string argument of test/it/describe), a comment, a string, template or regex
  // literal (blanked whole, so `//` inside one is not a comment), or any other character.
  // A template-literal name gets quotes instead of backticks, so it is not mistaken for an inline code span.
  testText: (text) =>
    text.replace(
      /(\b(?:test|it|describe)(?:\.\w+)?\(\s*(?:'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`))|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*`|\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[a-z]*|[\s\S]/g,
      (m, name, comment) => (name ? m.replace(/\(\s*`([\s\S]*)`$/, '("$1"') : comment ? m : m.replace(/[^\n]/g, ' ')),
    ),
  comments: commentText,
};

// JavaScript string and template-literal text only; comments, regex literals and code are blanked
// (line breaks kept, so line numbers still match). A line ending in `// lang-ok: <reason>` is skipped:
// it marks Chinese that is input or viewer-facing, not text the CLI prints.
function stringLiterals(src) {
  const text = src.replace(/^.*\/\/ lang-ok:.*$/gm, '');
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const stack = [{ tpl: false, depth: 0 }];
  let out = '';
  let last = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (top.tpl) {
      if (c === '\\') { out += text.slice(i, i + 2); i++; } else if (c === '`') { stack.pop(); out += ' '; last = '`'; } else if (c === '$' && text[i + 1] === '{') { stack.push({ tpl: false, depth: 0 }); out += '  '; i++; } else out += c;
      continue;
    }
    const end = (re) => { re.lastIndex = i; re.exec(text); return re.lastIndex || text.length; };
    if (c === '/' && text[i + 1] === '/') { const j = text.indexOf('\n', i); const k = j === -1 ? text.length : j; out += blank(text.slice(i, k)); i = k - 1; continue; }
    if (c === '/' && text[i + 1] === '*') { const k = text.indexOf('*/', i + 2) + 2; out += blank(text.slice(i, k)); i = k - 1; continue; }
    if (c === '/' && (!last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof)\s*$/.test(text.slice(Math.max(0, i - 12), i)))) {
      const k = end(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/y); out += blank(text.slice(i, k)); i = k - 1; last = ')'; continue;
    }
    if (c === '"' || c === "'") { const k = end(c === '"' ? /"(?:\\.|[^"\\\n])*"/y : /'(?:\\.|[^'\\\n])*'/y); out += ` ${text.slice(i + 1, k - 1)} `; i = k - 1; last = c; continue; }
    if (c === '`') { stack.push({ tpl: true }); out += ' '; continue; }
    if (c === '{') top.depth++;
    if (c === '}') { if (top.depth === 0 && stack.length > 1) { stack.pop(); out += ' '; last = '}'; continue; } top.depth--; }
    out += c === '\n' ? '\n' : ' ';
    if (!/\s/.test(c)) last = c;
  }
  return out;
}

// Comment text only (JavaScript and CSS): strings, template literals, regex literals and code are blanked
// (line breaks kept, so line numbers still match).
function commentText(src) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const stack = [{ tpl: false, depth: 0 }];
  let out = '';
  let last = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top.tpl) {
      if (c === '\\') { out += blank(src.slice(i, i + 2)); i++; } else if (c === '`') { stack.pop(); out += ' '; last = '`'; } else if (c === '$' && src[i + 1] === '{') { stack.push({ tpl: false, depth: 0 }); out += '  '; i++; } else out += blank(c);
      continue;
    }
    const end = (re) => { re.lastIndex = i; re.exec(src); return re.lastIndex || src.length; };
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const k = j === -1 ? src.length : j; out += src.slice(i, k); i = k - 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const k = src.indexOf('*/', i + 2) + 2; out += src.slice(i, k); i = k - 1; continue; }
    if (c === '/' && (!last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof)\s*$/.test(src.slice(Math.max(0, i - 12), i)))) {
      const k = end(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/y); out += blank(src.slice(i, k)); i = k - 1; last = ')'; continue;
    }
    if (c === '"' || c === "'") { const k = end(c === '"' ? /"(?:\\.|[^"\\\n])*"/y : /'(?:\\.|[^'\\\n])*'/y); out += blank(src.slice(i, k)); i = k - 1; last = c; continue; }
    if (c === '`') { stack.push({ tpl: true }); out += ' '; continue; }
    if (c === '{') top.depth++;
    if (c === '}') { if (top.depth === 0 && stack.length > 1) { stack.pop(); out += ' '; last = '}'; continue; } top.depth--; }
    out += c === '\n' ? '\n' : ' ';
    if (!/\s/.test(c)) last = c;
  }
  return out;
}

// Every JavaScript and CSS file under a directory; their comments must be English.
const sourceFiles = (dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .filter((f) => /\.(m?js|css)$/.test(f))
    .map((f) => join(dir, f));

// Files whose string literals are text the CLI prints: output, errors, help and notices.
const cliTextFiles = () => [
  'bin/am.js',
  ...['cli.js', 'config.js', 'housekeeping.js', 'update.js', 'patch.js', 'parse.js'].map((f) => join('src', f)),
  ...['tts.js', 'export.js', 'script.js'].map((f) => join('src', 'video', f)),
  ...readdirSync(join(ROOT, 'src', 'components')).filter((f) => f.endsWith('.js')).map((f) => join('src', 'components', f)),
];

// The single scope list: every file that must be English, and which part of it is checked.
const SCOPE = [
  { files: () => ['package.json'], part: 'whole' },
  { files: () => ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'], part: 'whole' },
  { files: () => ['plugins/answer-me-with-html-always/.claude-plugin/plugin.json'], part: 'whole' },
  { files: commandFiles, part: 'frontmatter' },
  { files: cliTextFiles, part: 'strings' },
  { files: () => ['src/lint/ste.js'], part: 'lintMessages' },
  { files: () => ['skills/answer-me-with-html/SKILL.md'], part: 'skill' },
  { files: () => ['CONTRIBUTING.md', ...commandFiles()], part: 'whole' },
  { files: () => ['src', 'bin', 'scripts'].flatMap(sourceFiles), part: 'comments' },
  { files: () => readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => join('test', f)), part: 'testText' },
];

// Spans where Chinese is the subject, not the medium. They are removed before the check.
const ALLOWED = [
  /^(```|~~~)[\s\S]*?^\1/gm, // fenced code blocks
  /`[^`\n]+`/g, // inline code spans
];

const CHINESE = /[\p{Script=Han}　-〿＀-￯]/u; // Han, CJK punctuation, fullwidth forms

function chineseLines(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const stripped = ALLOWED.reduce((acc, re) => acc.replace(re, blank), text).split('\n');
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter(({ line }) => CHINESE.test(stripped[line - 1]));
}

test('language: Chinese prose outside allowed spans is reported with its line number', () => {
  const text = 'Use the `进行优化` check.\n```\n中文示例\n```\n说明：这是中文。\nEnglish only.';
  assert.deepEqual(chineseLines(text), [{ line: 5, text: '说明：这是中文。' }]);
});

test('language: fullwidth punctuation alone counts as Chinese', () => {
  assert.equal(chineseLines('value，next').length, 1);
});

test('language: every file in scope is English outside allowed spans', () => {
  const files = SCOPE.flatMap(({ files, part }) => files().map((file) => ({ file, part })));
  assert.ok(files.length >= 6);
  const offenders = files.flatMap(({ file, part }) =>
    chineseLines(PARTS[part](readFileSync(join(ROOT, file), 'utf8'))).map(({ line, text }) => `${file} (${part}) line ${line}: ${text.trim()}`),
  );
  assert.deepEqual(offenders, []);
});
