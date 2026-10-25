/**
 * Управление слэш-командами приложения.
 *
 *   node --env-file-if-exists=.env scripts/commands-admin.mjs list
 *   node --env-file-if-exists=.env scripts/commands-admin.mjs clean   # удалить всё, чего нет в src/commands
 *   node --env-file-if-exists=.env scripts/commands-admin.mjs reset   # удалить ВСЁ и зарегистрировать заново
 */
import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { commandPayload } from '../src/commands/index.js';

const action = process.argv[2] ?? 'list';

if (!config.token) {
  console.error('DISCORD_TOKEN не задан в .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(config.token);
const appId = Buffer.from(config.token.split('.')[0], 'base64').toString('utf8');

const keep = new Set(commandPayload.map((command) => command.name));

async function listGlobal() {
  const commands = await rest.get(Routes.applicationCommands(appId));
  return { scope: 'global', commands };
}

async function listGuilds() {
  const guilds = await rest.get(Routes.userGuilds());
  const result = [];
  for (const guild of guilds) {
    const commands = await rest.get(Routes.applicationGuildCommands(appId, guild.id));
    result.push({ scope: `guild:${guild.name} (${guild.id})`, guildId: guild.id, commands });
  }
  return result;
}

function report(bucket) {
  const names = bucket.commands.map((command) => command.name);
  console.log(`\n${bucket.scope}: ${names.length}`);
  for (const name of names) {
    const keepMark = keep.has(name) ? '  (оставляем)' : '  ← лишняя';
    console.log(`  /${name}${keepMark}`);
  }
}

async function cleanBucket(bucket, removeAll = false) {
  if (bucket.guildId) {
    const toDelete = bucket.commands.filter((command) => removeAll || !keep.has(command.name));
    for (const command of toDelete) {
      await rest.delete(Routes.applicationGuildCommand(appId, bucket.guildId, command.id));
      console.log(`  удалена /${command.name} (${bucket.scope})`);
    }
    return toDelete.length;
  }

  const toDelete = bucket.commands.filter((command) => removeAll || !keep.has(command.name));
  for (const command of toDelete) {
    await rest.delete(Routes.applicationCommand(appId, command.id));
    console.log(`  удалена /${command.name} (global)`);
  }
  return toDelete.length;
}

const globalBucket = await listGlobal();
const guildBuckets = await listGuilds();
const buckets = [globalBucket, ...guildBuckets];

if (action === 'list') {
  buckets.forEach(report);
  console.log('\nВсего:', buckets.reduce((sum, bucket) => sum + bucket.commands.length, 0));
  process.exit(0);
}

if (action !== 'clean' && action !== 'reset') {
  console.error(`Неизвестное действие: ${action}. Используй list | clean | reset`);
  process.exit(1);
}

console.log(`Режим: ${action}`);
let removed = 0;
for (const bucket of buckets) {
  removed += await cleanBucket(bucket, action === 'reset');
}
console.log(`\nУдалено команд: ${removed}`);

if (action === 'reset') {
  await rest.put(Routes.applicationCommands(appId), { body: commandPayload });
  for (const bucket of guildBuckets) {
    await rest.put(Routes.applicationGuildCommands(appId, bucket.guildId), { body: commandPayload });
  }
  console.log(`Зарегистрировано команд: ${commandPayload.length} (${commandPayload.map((c) => `/${c.name}`).join(', ')})`);
}
