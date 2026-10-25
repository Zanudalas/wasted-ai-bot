import { SlashCommandBuilder, version as discordVersion } from 'discord.js';
import { BRAND_COLOR, config, models } from '../config.js';
import { checkProvider, keyName, providerName } from '../providers/index.js';
import { formatBytes, formatUptime } from '../utils/format.js';

function providerLine(provider) {
  if (provider.state === 'ok') return `\`${provider.message}\` ✅`;
  if (provider.state === 'no-key') return `\`${keyName()} не задан\` ❌`;
  if (provider.state === 'no-balance') return `\`${provider.message}\` ❌`;
  return `\`${provider.message}\` ⚠️`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Статус бота: пинг, аптайм, память, доступные модели'),

  async execute(interaction) {
    await interaction.deferReply();

    const client = interaction.client;
    const memory = process.memoryUsage();
    const wsPing = Math.round(client.ws.ping);
    const provider = await checkProvider();

    await interaction.editReply({
      embeds: [
        {
          color: BRAND_COLOR,
          title: '📊 Статус WASTED AI',
          fields: [
            { name: 'Пинг', value: wsPing >= 0 ? `\`${wsPing} мс\`` : '`—`', inline: true },
            { name: 'Аптайм', value: `\`${formatUptime(client.uptime ?? 0)}\``, inline: true },
            { name: 'Серверов', value: `\`${client.guilds.cache.size}\``, inline: true },
            {
              name: 'Память (RSS / heap)',
              value: `\`${formatBytes(memory.rss)} / ${formatBytes(memory.heapUsed)}\``,
              inline: true,
            },
            { name: 'Node.js', value: `\`${process.version}\``, inline: true },
            { name: 'discord.js', value: `\`v${discordVersion}\``, inline: true },
            {
              name: `Провайдер видео (${providerName()})`,
              value: providerLine(provider),
              inline: false,
            },
            {
              name: 'Модели',
              value: [
                `• **${models.seedance.label}** — \`/generate_seedance\``,
                `• **${models.omni.label}** — \`/generate_omni\``,
              ].join('\n'),
              inline: false,
            },
            {
              name: 'Лимиты',
              value: `Кулдаун: \`${config.cooldownSeconds} с\` · Вложение: до \`${config.maxUploadMb} МБ\` (зависит от буст-уровня сервера)`,
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  },
};
