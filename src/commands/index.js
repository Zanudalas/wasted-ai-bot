import ping from './ping.js';
import status from './status.js';
import seedance from './seedance.js';
import omni from './omni.js';

export const commands = new Map(
  [ping, status, seedance, omni].map((command) => [command.data.name, command]),
);

export const commandPayload = [...commands.values()].map((command) => command.data.toJSON());
