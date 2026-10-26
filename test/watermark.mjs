/**
 * Watermark pipeline test: renders a tiny synthetic clip and overlays the logo.
 * Skips (without failing) when ffmpeg or the logo is not available.
 * Run: node test/watermark.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyWatermark, ffmpegPath, watermarkPath, watermarkReady } from '../src/utils/watermark.js';

const ffmpeg = ffmpegPath();
await fs.access(watermarkPath()).catch(() => null);

if (!ffmpeg || !watermarkReady()) {
  console.log('skip watermark test: ffmpeg or assets/watermark.png is missing');
  process.exit(0);
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-test-'));
const input = path.join(dir, 'input.mp4');

try {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=1',
    '-pix_fmt', 'yuv420p',
    input,
  ]);

  const output = await applyWatermark(input);
  assert.ok(output !== input, 'watermarked file must be a new file');
  assert.match(output, /-wm\.mp4$/);

  const stats = await fs.stat(output);
  assert.ok(stats.size > 0, 'watermarked video must not be empty');
  console.log(`ok  watermark applied (${stats.size} bytes)`);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('\nwatermark test passed');
