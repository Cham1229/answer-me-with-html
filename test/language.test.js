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
};

// The single scope list: every file that must be English, and which part of it is checked.
const SCOPE = [
  { files: () => ['package.json'], part: 'whole' },
  { files: () => ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'], part: 'whole' },
  { files: () => ['plugins/answer-me-with-html-always/.claude-plugin/plugin.json'], part: 'whole' },
  { files: commandFiles, part: 'frontmatter' },
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
