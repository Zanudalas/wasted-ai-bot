import process from 'node:process';

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  // Discord
  token: (process.env.DISCORD_TOKEN ?? '').trim(),
  guildId: (process.env.GUILD_ID ?? '').trim() || null,

  // Video providers: kie.ai (preferred when its key is set) or fal.ai
  kieKey: (process.env.KIE_API_KEY ?? '').trim(),
  falKey: (process.env.FAL_KEY ?? '').trim(),

  // Behaviour
  cooldownSeconds: num(process.env.COOLDOWN_SECONDS, 60),
  pollIntervalMs: num(process.env.POLL_INTERVAL_MS, 2500),
  generationTimeoutMs: num(process.env.GENERATION_TIMEOUT_MS, 12 * 60 * 1000),
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 50),
  progressUpdateMs: num(process.env.PROGRESS_UPDATE_MS, 6000),
};

/** Video models available to the bot. */
export const models = {
  seedance: {
    key: 'seedance',
    label: 'Seedance 2.5',
    vendor: 'ByteDance',
    falEndpoint: 'bytedance/seedance-2.5/text-to-video',
    kieModel: 'bytedance/seedance-2-5',
    fileName: 'seedance-2.5.mp4',
  },
  omni: {
    key: 'omni',
    label: 'Gemini Omni Flash',
    vendor: 'Google',
    falEndpoint: 'fal-ai/gemini-omni-flash',
    kieModel: 'google/gemini-omni-flash-1-1',
    fileName: 'gemini-omni-flash.mp4',
  },
};

export const BRAND_COLOR = 0x8b5cf6;
export const ERROR_COLOR = 0xef4444;
export const OK_COLOR = 0x22c55e;
