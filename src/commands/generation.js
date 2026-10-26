import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import fs from 'node:fs/promises';
import { BRAND_COLOR, ERROR_COLOR, OK_COLOR, config } from '../config.js';
import { ProviderError, generate, hasKey, keyName, providerName } from '../providers/index.js';
import { downloadVideo, removeFile } from '../utils/files.js';
import { formatBytes, formatElapsed, truncate } from '../utils/format.js';
import { applyWatermark, watermarkReady } from '../utils/watermark.js';

const cooldowns = new Map();

/** Discord upload limits by boost tier: 0 → 20 МБ, 1 → 25 МБ, 2 → 50 МБ, 3 → 100 МБ. */
const GUILD_UPLOAD_LIMIT_MB = { 0: 20, 1: 25, 2: 50, 3: 100 };

function uploadLimitMb(interaction) {
  const tier = interaction.guild?.premiumTier ?? 0;
  return Math.min(config.maxUploadMb, GUILD_UPLOAD_LIMIT_MB[tier] ?? 20);
}

function cooldownLeft(interaction) {
  const canBypass = interaction.memberPermissions?.has('ManageGuild');
  if (canBypass) return 0;

  const lastAt = cooldowns.get(interaction.user.id) ?? 0;
  const leftMs = config.cooldownSeconds * 1000 - (Date.now() - lastAt);
  return leftMs > 0 ? Math.ceil(leftMs / 1000) : 0;
}

function startCooldown(interaction) {
  if (!interaction.memberPermissions?.has('ManageGuild')) {
    cooldowns.set(interaction.user.id, Date.now());
  }
}

function progressEmbed({ model, prompt, status, queuePosition, elapsedMs }) {
  const lines = [];
  if (status === 'IN_QUEUE') {
    lines.push(`🕐 Запрос в очереди ${providerName()}.`);
    if (Number.isFinite(queuePosition)) lines.push(`Позиция в очереди: **${queuePosition}**`);
  } else {
    lines.push('🎬 Модель генерирует видео со звуком. Это может занять пару минут.');
  }
  lines.push('', `Прошло: **${formatElapsed(elapsedMs)}**`);

  return {
    color: BRAND_COLOR,
    title: `Генерация видео — ${model.label}`,
    description: lines.join('\n'),
    fields: [{ name: 'Промпт', value: truncate(prompt, 1000) }],
    footer: { text: 'Результат появится в этом же сообщении' },
    timestamp: new Date().toISOString(),
  };
}

function resultEmbed({ model, prompt, elapsedMs, videoUrl, note }) {
  const fields = [
    { name: 'Модель', value: `${model.label} (${model.vendor})`, inline: true },
    { name: 'Время генерации', value: formatElapsed(elapsedMs), inline: true },
    { name: 'Промпт', value: truncate(prompt, 1000) },
  ];

  const embed = {
    color: OK_COLOR,
    title: '✅ Видео готово',
    description: note ?? null,
    fields,
    timestamp: new Date().toISOString(),
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Открыть видео').setURL(videoUrl),
  );

  return { embed, row };
}

function errorEmbed(message, detail) {
  return {
    color: ERROR_COLOR,
    title: '❌ Не удалось сгенерировать видео',
    description: message,
    fields: detail ? [{ name: 'Детали', value: truncate(detail, 1000) }] : [],
  };
}

/**
 * Shared flow for every generation command.
 * `params` are semantic ({ prompt, duration, aspectRatio, resolution, audio })
 * and get translated into the payload of the active provider.
 */
export async function runGeneration(interaction, { model, params, prompt }) {
  if (!hasKey()) {
    const key = keyName();
    const hint =
      key === 'KIE_API_KEY'
        ? 'Ключ выдаётся на https://kie.ai/api-key (новым аккаунтам дают 80 бесплатных кредитов).'
        : 'Ключ выдаётся на https://fal.ai/dashboard/keys';
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        errorEmbed(
          `На сервере не настроен ключ **${key}**, поэтому генерация недоступна.`,
          `Владелец бота должен добавить ${key} в файл .env и перезапустить бота. ${hint}`,
        ),
      ],
    });
    return;
  }

  const left = cooldownLeft(interaction);
  if (left > 0) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [errorEmbed(`Подожди ещё **${left} с** перед следующей генерацией.`)],
    });
    return;
  }

  startCooldown(interaction);
  const startedAt = Date.now();

  await interaction.deferReply();

  let snapshot = { status: 'IN_QUEUE', queuePosition: null, elapsedMs: 0 };
  let updating = false;
  let finished = false;

  await interaction
    .editReply({ embeds: [progressEmbed({ model, prompt, ...snapshot })] })
    .catch(() => {});

  const ticker = setInterval(async () => {
    if (updating || finished) return;
    updating = true;
    try {
      snapshot.elapsedMs = Date.now() - startedAt;
      await interaction.editReply({ embeds: [progressEmbed({ model, prompt, ...snapshot })] });
    } catch {
      /* ignore transient edit failures / rate limits */
    } finally {
      updating = false;
    }
  }, config.progressUpdateMs);
  ticker.unref?.();

  let tempFile = null;

  try {
    const { videoUrl, elapsedMs, requestId } = await generate(model, params, {
      onProgress: (progress) => {
        snapshot = { ...snapshot, ...progress };
      },
    });

    if (!videoUrl) {
      throw new Error('Провайдер вернул ответ без ссылки на видео.');
    }

    clearInterval(ticker);
    finished = true;

    const limitMb = uploadLimitMb(interaction);
    const maxBytes = limitMb * 1024 * 1024;
    const mention = `<@${interaction.user.id}>`;
    let attachment = null;
    let note = null;

    try {
      const downloaded = await downloadVideo(videoUrl, requestId, maxBytes);
      if (downloaded.tooLarge) {
        note = `Видео весит **${formatBytes(downloaded.size)}** — больше лимита загрузки в этот канал (${limitMb} МБ), поэтому прикреплена ссылка.`;
      } else {
        let filePath = downloaded.path;
        tempFile = filePath;

        if (watermarkReady()) {
          try {
            const stamped = await applyWatermark(filePath);
            await removeFile(filePath);
            filePath = stamped;
            tempFile = stamped;
          } catch (watermarkError) {
            console.error('[watermark]', watermarkError);
            note = 'Водяной знак не наложился, видео отправлено без него.';
          }
        }

        const size = (await fs.stat(filePath)).size;
        if (size > maxBytes) {
          note = `Видео весит **${formatBytes(size)}** — больше лимита загрузки в этот канал (${limitMb} МБ), поэтому прикреплена ссылка.`;
          await removeFile(filePath);
          tempFile = null;
        } else {
          attachment = new AttachmentBuilder(filePath, {
            name: model.fileName,
            description: `${model.label} — ${truncate(prompt, 120)}`,
          });
        }
      }
    } catch (downloadError) {
      note = `Не удалось прикрепить файл (${downloadError.message}), но видео доступно по кнопке ниже.`;
    }

    const { embed, row } = resultEmbed({ model, prompt, elapsedMs, videoUrl, note });
    const payload = {
      content: mention,
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [interaction.user.id], repliedUser: false },
    };
    if (attachment) payload.files = [attachment];

    try {
      await interaction.editReply(payload);
    } catch (sendError) {
      // 40005 = "Request entity too large" — fall back to a link-only message.
      if (sendError?.code === 40005 || sendError?.status === 413) {
        await interaction.editReply({
          content: mention,
          embeds: [
            resultEmbed({
              model,
              prompt,
              elapsedMs,
              videoUrl,
              note: `Файл слишком большой для загрузки в Discord (${limitMb} МБ), используй кнопку ниже.`,
            }).embed,
          ],
          components: [row],
          allowedMentions: { users: [interaction.user.id], repliedUser: false },
        });
      } else {
        throw sendError;
      }
    }
  } catch (error) {
    clearInterval(ticker);
    finished = true;
    console.error(`[generate:${model.key}]`, error);

    let message = 'Произошла непредвиденная ошибка. Попробуй ещё раз позже.';
    let detail = error?.detail ?? null;

    if (error instanceof ProviderError) {
      message = error.message;
      detail = error.detail ?? null;
    } else if (error?.name === 'TimeoutError' || error?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      message = 'Сервис генерации не ответил вовремя. Попробуй позже.';
    } else if (error?.message?.includes('Превышено время ожидания')) {
      message = 'Генерация заняла слишком много времени и была прервана.';
    } else if (error?.message) {
      detail = error.message;
    }

    await interaction
      .editReply({ embeds: [errorEmbed(message, detail)], components: [] })
      .catch(() => {});
  } finally {
    clearInterval(ticker);
    await removeFile(tempFile);
  }
}
