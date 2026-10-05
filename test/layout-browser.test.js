// Browser seam for the photo-wall layout (spec #50, ticket #52): render sheet pages with the CLI, open them in headless Chrome
// and check what a reader sees. Slow and needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) and skips without Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser layout tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DESKTOP = 1440;
const TABLET = 1000;
const PHONE = 390;
const BUDGET_MS = 1000; // generous: a laid-out page takes well under 300 ms on a developer laptop

const filler = (id, n) => `## ${id} 说明${n}\n这一段是普通文字，用来和其他面板排成一行，长度适中，换行后大约占四五行。这一段是普通文字，用来和其他面板排成一行。\n`;
const fillerEn = (id, n) => `## ${id} Note ${n}\nThis panel is plain text. It sits in a row with other panels and wraps to a few lines. It is here to give the planner something to balance.\n`;

const STRESS = {
  'wide-table.zh': `---
title: 宽表压力测试
cols: 3
---
## A 方案对比
| 方案 | 做法 | 适用场景 |
|---|---|---|
| 先拆分再合并 | 把大任务拆成多个小任务，各自完成之后再统一合并回主分支 | 团队人数较多，任务之间依赖较少，需要并行推进的项目 |
| 持续集成 | 每次提交都自动构建并运行全部测试，失败时立即通知提交者 | 代码变动频繁，需要尽早发现问题的项目 |
| 功能开关 | 新功能默认关闭，上线后逐步对部分用户开启，出问题时一键关闭 | 风险较高、需要灰度发布的功能 |

${filler('B', 1)}
${filler('C', 2)}
${filler('D', 3)}`,
  'wide-table.en': `---
title: Wide table stress test
cols: 3
lang: en
---
## A Options
| Option | How it works | When to use it |
|---|---|---|
| Split, then merge | Cut a large task into small tasks, finish each one, and merge them back into the main branch together | Large teams, tasks with few dependencies, work that must run in parallel |
| Continuous integration | Every commit builds and runs the whole test suite, and a failure tells the author at once | Code that changes often and must be checked early |
| Feature flags | A new feature starts switched off, opens for a few users after release, and one switch turns it off again | Risky features that need a staged release |

${fillerEn('B', 1)}
${fillerEn('C', 2)}
${fillerEn('D', 3)}`,
  'narrow-diagrams.zh': `---
title: 窄图压力测试
cols: 3
---
## A 握手
\`\`\`flow
客户端 -> 服务器: 请求
服务器 -> 客户端: 应答
\`\`\`

## B 挥手
\`\`\`flow
主动方 -> 被动方: 关闭
被动方 -> 主动方: 确认
\`\`\`

${filler('C', 1)}
${filler('D', 2)}
${filler('E', 3)}`,
  'narrow-diagrams.en': `---
title: Narrow diagram stress test
cols: 3
lang: en
---
## A Open
\`\`\`flow
Client -> Server: request
Server -> Client: reply
\`\`\`

## B Close
\`\`\`flow
Sender -> Receiver: close
Receiver -> Sender: confirm
\`\`\`

${fillerEn('C', 1)}
${fillerEn('D', 2)}
${fillerEn('E', 3)}`,
};

// Everything the checks need, read in the page in one call. A "row" is the set of grid children with the same top edge.
const MEASURE = `(() => {
  const grid = document.querySelector('.am-grid');
  const box = (e) => e.getBoundingClientRect();
  const rows = [];
  for (const el of grid.children) {
    const r = box(el);
    let row = rows.find((x) => Math.abs(x.top - r.top) <= 1);
    if (!row) rows.push((row = { top: r.top, items: [] }));
    row.items.push({ width: r.width, bottom: r.bottom });
  }
  const clipped = [];
  for (const p of grid.querySelectorAll('.am-panel')) {
    if (p.scrollWidth > p.clientWidth + 1) clipped.push(p.id + ' (panel, wide)');
    if (p.scrollHeight > p.clientHeight + 1) clipped.push(p.id + ' (panel, tall)');
    for (const e of p.querySelectorAll('.am-table-wrap, .am-diagram, pre')) {
      if (e.scrollWidth > e.clientWidth + 1) clipped.push(p.id + ' (' + e.className + ' scrolls sideways)');
    }
  }
  const panels = [...grid.querySelectorAll('.am-panel')];
  const gridBox = box(grid);
  return {
    display: getComputedStyle(grid).display,
    gap: parseFloat(getComputedStyle(grid).columnGap) || 0,
    width: grid.clientWidth,
    rows,
    clipped,
    order: panels.map((p) => p.id),
    wrappers: [...grid.children].filter((e) => !e.classList.contains('am-panel')).length,
    panelWidths: panels.map((p) => box(p).width),
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    gridLeft: gridBox.left,
    layouts: performance.getEntriesByName('am-layout').map((m) => m.duration),
  };
})()`;

let tmp;
let chrome;
let cdp;
let session;
const pages = [];

const page = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const setWidth = (width) => page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
const waitFor = async (condition, what, timeout = 4000) => {
  const t0 = Date.now();
  for (;;) {
    const value = await evaluate(condition);
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const open = async (file, width) => {
  await setWidth(width);
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => true)');
};
const measure = () => evaluate(MEASURE);

before(() => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-layout-'));
  const render = (src, name) => {
    const out = join(tmp, `${name}.html`);
    execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', src, '-o', out, '--no-open'], {
      env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
    });
    const html = readFileSync(out, 'utf8');
    return { name, file: out, ids: [...html.matchAll(/<section class="am-panel[^"]*" id="(panel-[^"]+)"/g)].map((m) => m[1]) };
  };
  const examples = readdirSync(join(ROOT, 'examples'))
    .filter((f) => f.endsWith('.md') && !f.startsWith('video-') && !/^template: doc/m.test(readFileSync(join(ROOT, 'examples', f), 'utf8')))
    .map((f) => render(join(ROOT, 'examples', f), f.replace(/\.md$/, '')));
  mkdirSync(join(tmp, 'drafts'));
  const stress = Object.entries(STRESS).map(([name, text]) => {
    const src = join(tmp, 'drafts', `${name}.md`);
    writeFileSync(src, text);
    return render(src, name);
  });
  pages.push(...examples, ...stress);
});

const launch = async () => {
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', `--window-size=${DESKTOP},900`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable');
};

after(async () => {
  cdp?.close();
  if (chrome) {
    await new Promise((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

// The laid-out page, as a reader sees it, must keep these invariants at any width above the single-column breakpoint.
function assertJustified(name, width, m, ids) {
  const where = `${name} @${width}px`;
  assert.equal(m.layouts.length >= 1, true, `${where}: the page script laid the page out`);
  assert.equal(m.display, 'flex', `${where}: the grid is a flex container`);
  assert.deepEqual(m.order, ids, `${where}: panel order is unchanged`);
  assert.ok(m.rows.length >= 1);
  m.rows.forEach((row, i) => {
    const sum = row.items.reduce((s, it) => s + it.width, 0) + m.gap * (row.items.length - 1);
    assert.ok(Math.abs(sum - m.width) <= 1, `${where}: row ${i + 1} widths add up to ${m.width}px, got ${sum}px`);
    const bottoms = row.items.map((it) => it.bottom);
    assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 1, `${where}: row ${i + 1} shares a bottom edge, got ${bottoms.join(', ')}`);
  });
  assert.deepEqual(m.clipped, [], `${where}: nothing overflows or is clipped`);
  assert.ok(m.pageOverflow <= 0, `${where}: the page does not scroll sideways`);
}

test('e2e: sheet pages lay out as justified rows at 1440 px, and the layout finishes within budget', { skip: SKIP, timeout: 180000 }, async () => {
  await launch();
  assert.ok(pages.length >= 6, 'examples and stress drafts rendered');
  for (const p of pages) {
    await open(p.file, DESKTOP);
    await waitFor('performance.getEntriesByName("am-layout").length > 0', `${p.name} to lay out`).catch(() => {});
    const m = await measure();
    assertJustified(p.name, DESKTOP, m, p.ids);
    const slowest = Math.max(...m.layouts);
    assert.ok(slowest < BUDGET_MS, `${p.name}: layout took ${Math.round(slowest)} ms (budget ${BUDGET_MS} ms)`);
    console.log(`  layout ${p.name}: ${Math.round(slowest)} ms, ${m.rows.length} rows, ${m.order.length} panels`);
  }
});

test('e2e: resizing re-lays out the page, and a phone width restores one column', { skip: SKIP, timeout: 120000 }, async () => {
  if (!cdp) await launch();
  for (const name of ['tcp', 'wide-table.zh', 'narrow-diagrams.en']) {
    const p = pages.find((x) => x.name === name);
    assert.ok(p, `${name} page`);
    await open(p.file, DESKTOP);
    await waitFor('performance.getEntriesByName("am-layout").length > 0', `${name} to lay out`).catch(() => {});
    const wide = await measure();
    assertJustified(name, DESKTOP, wide, p.ids);

    await setWidth(TABLET);
    await waitFor(`document.querySelector('.am-grid').clientWidth !== ${wide.width} && document.querySelector('.am-grid').style.display === 'flex' && performance.getEntriesByName('am-layout').length > ${wide.layouts.length}`, `${name} to re-lay out at ${TABLET}px`);
    const tablet = await measure();
    assertJustified(name, TABLET, tablet, p.ids);

    await setWidth(PHONE);
    await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid'", `${name} to restore the grid at ${PHONE}px`);
    const phone = await measure();
    assert.equal(phone.wrappers, 0, `${name}: no column wrappers on a phone`);
    assert.deepEqual(phone.order, p.ids);
    assert.ok(phone.panelWidths.every((w) => Math.abs(w - phone.width) <= 1), `${name}: one column on a phone, widths ${phone.panelWidths.join(', ')} in ${phone.width}px`);
    assert.ok(phone.rows.every((r) => r.items.length === 1), `${name}: one panel per row on a phone`);
    assert.ok(phone.pageOverflow <= 0, `${name}: the phone page does not scroll sideways`);

    await setWidth(DESKTOP);
    await waitFor("document.querySelector('.am-grid').style.display === 'flex'", `${name} to lay out again at ${DESKTOP}px`);
    assertJustified(name, DESKTOP, await measure(), p.ids);
  }
});

test('e2e: doc pages have no sheet grid and stay untouched', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const src = join(tmp, 'drafts', 'doc.md');
  writeFileSync(src, '---\ntemplate: doc\ntitle: Doc\n---\n## A One\nText.\n\n## B Two\nMore text.\n');
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', src, '-o', join(tmp, 'doc.html'), '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
  });
  await open(join(tmp, 'doc.html'), DESKTOP);
  assert.equal(await evaluate('performance.getEntriesByName("am-layout").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".am-panel[style*=width]").length'), 0);
});
