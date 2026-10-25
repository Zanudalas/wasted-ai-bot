import { SlashCommandBuilder } from 'discord.js';
import { models } from '../config.js';
import { runGeneration } from './generation.js';

const model = models.omni;

export default {
  data: new SlashCommandBuilder()
    .setName('generate_omni')
    .setDescription('Сгенерировать видео через Gemini Omni Flash (Google)')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Описание видео: сцена, движение камеры, свет, звук')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(2000),
    )
    .addIntegerOption((option) =>
      option
        .setName('duration')
        .setDescription('Длительность в секундах (3–10, по умолчанию 8)')
        .setMinValue(3)
        .setMaxValue(10),
    )
    .addStringOption((option) =>
      option
        .setName('aspect_ratio')
        .setDescription('Соотношение сторон')
        .addChoices(
          { name: '16:9 (горизонтальное)', value: '16:9' },
          { name: '9:16 (вертикальное)', value: '9:16' },
        ),
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt', true).trim();
    const duration = interaction.options.getInteger('duration') ?? 8;
    const aspectRatio = interaction.options.getString('aspect_ratio') ?? '16:9';

    await runGeneration(interaction, {
      model,
      prompt,
      params: {
        prompt,
        duration,
        aspectRatio,
      },
    });
  },
};
