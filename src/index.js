import process from 'node:process';
import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { commandPayload, commands } from './commands/index.js';
import { checkProvider, hasKey, keyName, providerName } from './providers/index.js';

if (!config.token) {
  console.error('[startup] DISCORD_TOKEN is missing. Put it into .env');
  process.exit(1);
}

if (!hasKey()) {
  console.warn(
    `[startup] ${keyName()} is missing — /generate_seedance and /generate_omni will reply with a setup hint.\n` +
      '          kie.ai (80 free credits): https://kie.ai/api-key\n' +
      '          fal.ai: https://fal.ai/dashboard/keys',
  );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  try {
    await client.application.commands.set(commandPayload);
    console.log(`[commands] registered ${commandPayload.length} global commands`);
  } catch (error) {
    console.error('[commands] failed to register global commands:', error.message);
  }

  // Guild commands show up instantly, global ones can take up to an hour.
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commandPayload);
      console.log(`[commands] registered ${commandPayload.length} commands in "${guild.name}"`);
    } catch (error) {
      console.warn(`[commands] cannot register commands in "${guild.name}": ${error.message}`);
    }
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[ready] logged in as ${readyClient.user.tag} (${readyClient.user.id})`);
  console.log(`[ready] guilds: ${readyClient.guilds.cache.size}`);

  if (readyClient.guilds.cache.size === 0) {
    const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=117760&scope=bot%20applications.commands`;
    console.log(`[ready] bot is not on any server yet — invite it: ${invite}`);
  }

  await registerCommands();
  readyClient.user.setActivity('/generate_seedance · /generate_omni', { type: ActivityType.Watching });

  if (hasKey()) {
    const provider = await checkProvider({ ttlMs: 0 });
    if (provider.ok) {
      console.log(`[provider] ${providerName()}: ${provider.message}`);
    } else {
      console.warn(`[provider] ${providerName()} is NOT ready -> ${provider.message}`);
    }
  } else {
    console.warn(`[provider] no API key: add ${keyName()} to .env to enable generation`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[interaction] unknown command: ${interaction.commandName}`);
    return;
  }

  if (!interaction.inGuild()) {
    await interaction
      .reply({ content: 'Команды работают только на сервере.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  try {
    await command.execute(interaction, client);
    console.log(
      `[interaction] /${interaction.commandName} by ${interaction.user.tag} in #${interaction.channel?.name ?? 'unknown'}`,
    );
  } catch (error) {
    console.error(`[interaction] /${interaction.commandName} failed:`, error);

    const payload = {
      content: 'Команда не выполнилась из-за внутренней ошибки. Попробуй ещё раз.',
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      /* nothing else we can do */
    }
  }
});

client.on(Events.Error, (error) => console.error('[client]', error));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (error) => console.error('[uncaughtException]', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`[shutdown] ${signal} received, closing Discord connection…`);
    await client.destroy();
    process.exit(0);
  });
}

client.login(config.token).catch((error) => {
  console.error('[login] failed:', error.message);
  process.exit(1);
});
