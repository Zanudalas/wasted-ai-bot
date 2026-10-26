import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cachedFfmpeg;

/**
 * ffmpeg is optional: without it the bot still generates and posts videos,
 * just without the watermark. Look for the bundled build first, then PATH.
 */
export function ffmpegPath() {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;

  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(ROOT, 'tools', 'ffmpeg', 'ffmpeg.exe'),
  ].filter(Boolean);

  cachedFfmpeg = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) ?? null;

  return cachedFfmpeg;
}

export function watermarkPath() {
  return path.isAbsolute(config.watermarkPath)
    ? config.watermarkPath
    : path.join(ROOT, config.watermarkPath);
}

/** True when the watermark is enabled *and* everything it needs is on disk. */
export function watermarkReady() {
  if (!config.watermarkEnabled) return false;
  if (!ffmpegPath()) return false;
  try {
    return fs.existsSync(watermarkPath());
  } catch {
    return false;
  }
}

/**
 * Burn the PNG logo into the video (bottom-right corner by default).
 * Returns the path of the rendered file.
 */
export function applyWatermark(inputPath, { onProgress } = {}) {
  if (!watermarkReady()) {
    throw new Error('Водяной знак недоступен: нет ffmpeg или файла assets/watermark.png.');
  }

  const outputPath = inputPath.replace(/\.mp4$/i, '') + '-wm.mp4';
  const scale = config.watermarkScale;
  const opacity = config.watermarkOpacity;
  const margin = 0.02;

  const filter = [
    `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[wm]`,
    `[wm][0:v]scale2ref=w=main_w*${scale}:h=ow/mdar[wmS][vid]`,
    `[vid][wmS]overlay=W-w-${margin}*W:H-h-${margin}*H:format=auto,format=yuv420p[out]`,
  ].join(';');

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-i', watermarkPath(),
    '-filter_complex', filter,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg не успел обработать видео.'));
    }, 5 * 60 * 1000);

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        onProgress?.({ stage: 'watermark', done: true });
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr.trim()}`));
      }
    });
  });
}
