import { SlashCommandBuilder } from 'discord.js';
import { models } from '../config.js';
import { runGeneration } from './generation.js';

const model = models.seedance;

export default {
  data: new SlashCommandBuilder()
    .setName('generate_seedance')
    .setDescription('Сгенерировать видео через Seedance 2.5 (ByteDance)')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Описание видео: сцена, движение камеры, свет, звук')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(2000),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Длительность ролика')
        .addChoices(
          { name: 'auto (выберет модель)', value: 'auto' },
          { name: '4 секунды', value: '4' },
          { name: '5 секунд', value: '5' },
          { name: '6 секунд', value: '6' },
          { name: '8 секунд', value: '8' },
          { name: '10 секунд', value: '10' },
          { name: '12 секунд', value: '12' },
          { name: '15 секунд', value: '15' },
          { name: '20 секунд', value: '20' },
          { name: '25 секунд', value: '25' },
          { name: '30 секунд', value: '30' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('aspect_ratio')
        .setDescription('Соотношение сторон')
        .addChoices(
          { name: 'auto', value: 'auto' },
          { name: '16:9 (горизонтальное)', value: '16:9' },
          { name: '9:16 (вертикальное)', value: '9:16' },
          { name: '1:1 (квадрат)', value: '1:1' },
          { name: '4:3', value: '4:3' },
          { name: '3:4', value: '3:4' },
          { name: '21:9 (кино)', value: '21:9' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('resolution')
        .setDescription('Разрешение (1080p генерируется дольше и стоит дороже)')
        .addChoices(
          { name: '480p (быстро)', value: '480p' },
          { name: '720p (баланс)', value: '720p' },
          { name: '1080p (качество)', value: '1080p' },
        ),
    )
    .addBooleanOption((option) =>
      option.setName('audio').setDescription('Генерировать звук (по умолчанию да)'),
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt', true).trim();
    const duration = interaction.options.getString('duration') ?? 'auto';
    const aspectRatio = interaction.options.getString('aspect_ratio') ?? 'auto';
    const resolution = interaction.options.getString('resolution') ?? '720p';
    const audio = interaction.options.getBoolean('audio') ?? true;

    await runGeneration(interaction, {
      model,
      prompt,
      params: {
        prompt,
        duration,
        aspectRatio,
        resolution,
        audio,
      },
    });
  },
};
