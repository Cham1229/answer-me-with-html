// 数据目录维护：用量统计、am clean、清理提示；渲染后汇总清理与更新两类提示。
// 提示只打印给 Agent 看（以 "! " 开头的一行），由 Agent 询问用户要不要处理；CLI 从不自动删除。
import { readdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DAY, readState, writeState } from './state.js';
import { updateEnabled, updateHint, shouldCheckUpdate, spawnUpdateCheck } from './update.js';

export const CLEAN = Object.freeze({
  days: 30,                 // am clean 默认删除 30 天前的页面和视频
  bigBytes: 200 * 2 ** 20,  // 超过 200 MB 立即提示
  staleDays: 30,            // 距上次清理超过 30 天……
  staleBytes: 20 * 2 ** 20, // ……且超过 20 MB 时提示
  hintEveryDays: 7,         // 同一提示最多每 7 天出现一次
});
const DIRS = ['pages', 'videos', 'cache'];

// 列出目录下的普通文件。软链接、读不了的条目直接跳过，统计不因个别文件出错而失败。
function walk(dir) {
  let entries;
  try {
    // 根入口也可能是软链接；lstat 不跟随链接，避免清理目标目录里的外部文件。
    if (!lstatSync(dir).isDirectory()) return [];
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    try {
      const s = lstatSync(p);
      return s.isFile() ? [{ path: p, bytes: s.size, mtime: s.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
}

const sum = (files) => files.reduce((n, f) => n + f.bytes, 0);

export function usage(home) {
  const parts = Object.fromEntries(DIRS.map((d) => {
    const files = walk(join(home, d));
    return [d, { count: files.length, bytes: sum(files) }];
  }));
  return { ...parts, total: DIRS.reduce((n, d) => n + parts[d].bytes, 0) };
}

// 删除 days 天前的页面与视频，以及全部配音缓存（可重新生成）。all：全部删除（配置保留）。
export function clean(home, { days = CLEAN.days, all = false, dryRun = false, now = Date.now() } = {}) {
  const cutoff = now - days * DAY;
  const victims = [
    ...['pages', 'videos'].flatMap((d) => walk(join(home, d)).filter((f) => all || f.mtime < cutoff)),
    ...walk(join(home, 'cache')),
  ];
  if (!dryRun) {
    for (const f of victims) rmSync(f.path, { force: true });
    writeState(home, { lastClean: now, lastCleanHint: null });
  }
  return { files: victims.length, bytes: sum(victims) };
}

export const mb = (bytes) => (bytes < 2 ** 20 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 2 ** 20).toFixed(bytes < 10 * 2 ** 20 ? 1 : 0)} MB`);

// 需要提示清理时返回提示文本，否则返回 null。
export function cleanHint(state, use, now = Date.now()) {
  if (state.lastCleanHint && now - state.lastCleanHint < CLEAN.hintEveryDays * DAY) return null;
  const since = state.lastClean ?? state.firstSeen ?? now;
  const days = Math.floor((now - since) / DAY);
  const big = use.total >= CLEAN.bigBytes;
  const stale = days >= CLEAN.staleDays && use.total >= CLEAN.staleBytes;
  if (!big && !stale) return null;
  const pages = `${use.pages.count} page${use.pages.count === 1 ? '' : 's'}`;
  const parts = `${pages} ${mb(use.pages.bytes)}, videos ${mb(use.videos.bytes)}, voice-over cache ${mb(use.cache.bytes)}`;
  const when = state.lastClean ? `last cleaned ${days} days ago` : 'never cleaned';
  return `! Cleanup hint: the data directory uses ${mb(use.total)} (${parts}), ${when}. Ask the user whether to run am clean (deletes pages and videos older than ${CLEAN.days} days and empties the voice-over cache; am clean --all deletes everything).`;
}

// 每次渲染后调用：记录首次使用时间，返回要打印的提示，并按需安排后台版本检查。
export function afterRender({ home, env, config, current, scriptPath, background, now = Date.now() }) {
  let state = readState(home);
  if (!state.firstSeen) state = writeState(home, { firstSeen: now });
  const hints = [];
  const c = cleanHint(state, usage(home), now);
  if (c) {
    hints.push(c);
    state = writeState(home, { lastCleanHint: now });
  }
  const u = updateEnabled(env, config) ? updateHint(state, current, scriptPath, now) : null;
  if (u) {
    hints.push(u);
    writeState(home, { lastUpdateHint: now });
  }
  if (background && scriptPath && shouldCheckUpdate(state, env, config, now)) spawnUpdateCheck(home, scriptPath);
  return hints;
}
