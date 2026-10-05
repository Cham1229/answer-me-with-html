// MP4 export failure path: when ffmpeg exits midway, report an ExportError instead of crashing or hanging.
// A fake ffmpeg (exits with code 1 after reading a few input chunks) replaces the one on PATH; needs a local Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportMp4, findChrome, ExportError } from '../src/video/export.js';
import { renderVideo } from '../src/video/render.js';

const chrome = findChrome();
const canRun = Boolean(chrome) && typeof WebSocket !== 'undefined' && process.platform !== 'win32';

test('exportMp4: throws ExportError when ffmpeg exits midway, without crashing or hanging', { skip: !canRun && 'needs Chrome and Node 22+', timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-export-fail-'));
  try {
    const fake = join(dir, 'ffmpeg');
    writeFileSync(fake, '#!/bin/sh\nhead -c 200000 >/dev/null\necho "fake ffmpeg: boom" >&2\nexit 1\n');
    chmodSync(fake, 0o755);
    const { html } = await renderVideo('## 场景\n```flow\nA -> B\n```\n> A 连到 B。\n');
    const page = join(dir, 'v.html');
    writeFileSync(page, html);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    const prevPath = process.env.PATH;
    process.env.PATH = env.PATH; // hasCommand and spawn both look up ffmpeg on PATH
    try {
      await assert.rejects(exportMp4(page, join(dir, 'v.mp4'), { env }), (e) => e instanceof ExportError && /ffmpeg failed \(1\)/.test(e.message));
    } finally {
      process.env.PATH = prevPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
