import { md } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError } from './error.js';

const KINDS = new Set(['info', 'ok', 'warn', 'err']);

export default {
  name: 'callout',
  summary: 'Conclusion / tip / warning bar',
  syntax: `\`\`\`callout <info|ok|warn|err> [title]
Body (Markdown)
\`\`\`
- If the first argument is not a type, the whole argument string is the title and the type is info.`,
  example: '```callout warn Caution\nClose the valve before you remove the pump.\n```',
  render(text, { args }) {
    const [first = '', ...rest] = args.split(/\s+/).filter(Boolean);
    const kind = KINDS.has(first) ? first : 'info';
    const title = (KINDS.has(first) ? rest.join(' ') : args).trim();
    if (!title && !text.trim()) throw new ComponentError('callout needs a title or a body', 1);
    const head = title ? `<div class="am-callout-title">${esc(title)}</div>` : '';
    const body = text.trim() ? `<div class="am-callout-body am-md">${md(text)}</div>` : '';
    return `<div class="am-callout am-callout--${kind}" role="note">${head}${body}</div>`;
  },
};
