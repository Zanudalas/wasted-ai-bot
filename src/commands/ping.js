import { SlashCommandBuilder } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR, OK_COLOR } from '../config.js';
import { formatUptime } from '../utils/format.js';

function pingColor(value) {
  if (!Number.isFinite(value) || value < 0) return BRAND_COLOR;
  if (value < 150) return OK_COLOR;
  if (value < 400) return 0xf59e0b;
  return ERROR_COLOR;
}

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Проверить пинг бота и задержку Discord API'),

  async execute(interaction) {
    const startedAt = Date.now();
    await interaction.reply({
      embeds: [{ color: BRAND_COLOR, title: '🏓 Пинг…', description: 'Замеряю задержку…' }],
    });
    const roundtrip = Date.now() - startedAt;

    const wsPing = Math.round(interaction.client.ws.ping);
    const editStartedAt = Date.now();
    await interaction.editReply({
      embeds: [
        {
          color: pingColor(Math.max(wsPing, roundtrip)),
          title: '🏓 Понг!',
          fields: [
            {
              name: 'WebSocket (heartbeat)',
              value: wsPing >= 0 ? `\`${wsPing} мс\`` : '`измеряется…`',
              inline: true,
            },
            { name: 'Ответ на команду', value: `\`${roundtrip} мс\``, inline: true },
            {
              name: 'Правка сообщения',
              value: `\`${Date.now() - editStartedAt} мс\``,
              inline: true,
            },
            { name: 'Shard', value: `\`#${interaction.client.ws.shards.first()?.id ?? 0}\``, inline: true },
            { name: 'Аптайм', value: `\`${formatUptime(interaction.client.uptime ?? 0)}\``, inline: true },
          ],
          footer: { text: 'WebSocket — задержка heartbeat до Discord, остальное — время ответа API' },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  },
};
