import { CronJob, CronTime } from 'cron';
import discord from 'discord.js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface IRant {
  /** Date of the rant. */
  date: string;
  /** Source archive to the rant. */
  source: string;
  /** Type of rant (Code, Personal, Both, Unsure) */
  type: 'C' | 'P' | 'B' | 'U';
  /** The rant text itself. */
  text: string;
}

/**
 * Rant selection strategy.
 *  'random' - Select a random rant.
 *  'today'  - Convert day-in-year into rant index.
 */
type SelectionStrategy = 'random' | 'today';

const TIMEZONE: string = 'Europe/Oslo';
const RANT_FILE: string = resolve(__dirname, 'tlinus-rants.json');
const EMBED_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

/**
 * Discord message prefix which
 * catches Linus's attention.
 */
const MESSAGE_PREFIX: string = '!linus';

/**
 * Initial rant time.
 * 07:00 every day.
 */
let rantTime: string = '0 0 7 * * *';

/**
 * Channels that Linus is allowed to rant in
 * on a daily basis.
 */
let grantedChannels: discord.TextChannel[] = [];

/**
 * Convenience method to check a GuildMember
 * for permissions.
 */
const hasPermissions = (member: discord.GuildMember, permissions: discord.PermissionResolvable[]) => {
  for (const permission of permissions) {
    if (member.hasPermission(permission, false, true, true)) {
      return true;
    }
  }
  return false;
};

/**
 * Rant task to be run.
 * Includes picking a rant from a JSON file
 * based on selected strategy and sending it
 * back to the current channel or (if no channel
 * provided) every channel that is granted.
 */
const RANT_TASK = async (
  strategy: SelectionStrategy = 'today',
  channel?: discord.TextChannel | discord.DMChannel | discord.GroupDMChannel,
): Promise<void> => {
  try {
    if (!client) {
      return;
    }

    // Read rant data
    let rant: IRant;
    const rants: IRant[] = JSON.parse(await readFileSync(RANT_FILE, 'utf-8'));

    /**
     * Select a random rant from available rants.
     */
    if (strategy === 'random') {
      rant = rants[Math.floor(Math.random() * rants.length)];

    /**
     * Get day-in-year and modulo that with
     * number of available rants.
     */
    } else {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = (now.getTime() - start.getTime())
                   + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
      const oneDay = 1000 * 60 * 60 * 24;
      const day = Math.floor(diff / oneDay) - 1;
      rant = rants[day % rants.length];
    }

    /**
     * Construct a Discord rich embed object.
     */
    const embed = new discord.RichEmbed()
      .setThumbnail('https://cdn.arstechnica.net/wp-content/uploads/2012/06/torvaldsnvidia-640x424.jpg')
      .setDescription(rant.text)
      .setFooter(rant.source);

    // Embed color
    const color = EMBED_COLORS[Math.floor(Math.random() * EMBED_COLORS.length)];
    embed.setColor(color);

    // Embed timestamp, if parsable
    const timestamp = Date.parse(rant.date);
    if (!isNaN(timestamp)) {
      embed.setTimestamp(new Date(timestamp));
    }

    // Rant to a specific channel
    if (channel) {
      channel.send({ embed });

    // Rant to granted channels
    } else {
      grantedChannels.forEach((granted) => granted.send({ embed }));
    }
  } catch (e) {
    console.warn('Failed to rant:', e);
  }
};

/**
 * Rant-job instance.
 * 4th parameter set to false so that ranting
 * doesn't start before the bot is ready.
 */
const rantJob: CronJob = new CronJob(rantTime, RANT_TASK, undefined, false, TIMEZONE);

/**
 * Discord client instance.
 */
const client = new discord.Client();

/**
 * Discord 'ready' event.
 * Set bot activity and start ranting.
 */
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    game: {
      name: 'Bouncing Balls 🔴',
      type: 'PLAYING',
    },
    status: 'online',
  });

  // Start ranting
  rantJob.start();
});

/**
 * Discord 'message' event.
 * Parse and check if an applicable
 * command can be found.
 */
client.on('message', async (message: discord.Message) => {
  try {
    // Avoid botception, ensure prefix is used
    if (message.author.bot || message.content.indexOf(MESSAGE_PREFIX) !== 0) {
      return;
    }

    // <prefix> <command> [args...]
    const args: string[] = message.content.slice(MESSAGE_PREFIX.length).trim().split(/ +/g);
    const command: string = (args.shift() || '').toLowerCase();

    switch (command) {

      case 'ping': {
        const m = await message.channel.send('Ping?') as discord.Message;
        const latency = m.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ping);
        m.edit(`Pong! Latency is **${latency}ms**. API Latency is **${apiLatency}ms**.`);
        break;
      }

      case 'rant': {
        const arg = args.shift();
        const strategy: SelectionStrategy = (arg && arg === 'today') ? 'today' : 'random';
        RANT_TASK(strategy, message.channel);
        break;
      }

      case 'grant': {
        const arg = args.shift();

        // List granted channels
        if (arg && arg === 'list') {
          // Filter channels in current guild
          const granted = grantedChannels.filter(({ guild: { id }}) => id === message.guild.id);
          let text: string;

          if (granted.length > 0) {
            const channels = granted.map(({ id }) => `<#${id}>`).join(', ');
            text = `I am granted to rant in the following channels: ${channels}`;
          } else {
            text = 'Ugh, I am not granted to rant in any channels.';
          }
          message.channel.send(text);

        // Grant current channel
        } else {
          if (!hasPermissions(message.member, ['MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS'])) {
            message.reply('I cannot let you do that!');
            return;
          }

          if (message.channel.type !== 'text') {
            message.channel.send('I can only rant on a daily basis in guild text channels!');
            return;
          }

          // Ignore already granted channels
          if (grantedChannels.find(({ id }) => id === message.channel.id)) {
            return;
          }

          grantedChannels.push(message.channel as discord.TextChannel);
          message.channel.send(`Sure, I'll get right to it!`);
        }
        break;
      }

      case 'deny': {
        if (!hasPermissions(message.member, ['MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS'])) {
          message.reply('I cannot let you do that!');
          return;
        }

        grantedChannels = grantedChannels.filter(({ id }) => id !== message.channel.id);
        message.channel.send(`Ugh, f*ck off.`);
        break;
      }

      case 'settime': {
        const arg = args.join(' ');
        rantTime = arg ? arg : rantTime;
        rantJob.setTime(new CronTime(rantTime));
        message.channel.send(`Updated rant time: ${rantTime}`);
        break;
      }

      default: {
        const embed = new discord.RichEmbed()
          .setThumbnail('https://i.imgflip.com/2m5rxm.jpg')
          .setTitle('Available commands:')
          .setFooter(`Daily rant schedule (${TIMEZONE}): ${rantTime}`)
          .addField('rant [today | random]', 'Make Linus rant.')
          .addField('grant [list]', 'Grant Linus ability to rant on a daily basis in the current channel.')
          .addField('deny', 'Deny Linus ability to rant on a daily basis in the current channel.')
          .addField('settime * * * * * *', 'Set rant schedule. Must be a six-field cron expression.')
          .addField('ping', 'Ping bot and API latency.')
          .addBlankField();
        message.channel.send({ embed });
      }
    }
  } catch (e) {
    console.warn('Failed to execute command:', e);
  }
});

// Load .env file into process.env
dotenv.config();

// Make bot go "online"
client.login(process.env.BOT_TOKEN);
