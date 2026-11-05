const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  Role,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const db = require("./db");

db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    player_tag TEXT,
    team_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tournament_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    team_a TEXT NOT NULL,
    team_b TEXT NOT NULL,
    scheduled_at TEXT,
    result_a INTEGER,
    result_b INTEGER,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS giveaway_message_counts (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    prize TEXT NOT NULL,
    winners INTEGER NOT NULL DEFAULT 1,
    ends_at INTEGER NOT NULL,
    host_id TEXT NOT NULL,
    required_role_id TEXT,
    winners_role_id TEXT,
    required_role_config TEXT NOT NULL DEFAULT 'all',
    bonus_roles TEXT NOT NULL DEFAULT '{}',
    messages_required INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    participants TEXT NOT NULL DEFAULT '[]',
    winners_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS moderation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate giveaway tables created by earlier versions.
const giveawayColumns = db.prepare("PRAGMA table_info(giveaways)").all().map(column => column.name);
for (const [column, definition] of [
  ["required_role_id", "TEXT"],
  ["winners_role_id", "TEXT"],
  ["required_role_config", "TEXT NOT NULL DEFAULT 'all'"],
  ["bonus_roles", "TEXT NOT NULL DEFAULT '{}'"],
  ["messages_required", "INTEGER NOT NULL DEFAULT 0"]
]) {
  if (!giveawayColumns.includes(column)) db.exec(`ALTER TABLE giveaways ADD COLUMN ${column} ${definition}`);
}

const opt = {
  str: (cmd, name, description, required = true) =>
    cmd.addStringOption(o => o.setName(name).setDescription(description).setRequired(required)),
  user: (cmd, name, description, required = true) =>
    cmd.addUserOption(o => o.setName(name).setDescription(description).setRequired(required)),
  int: (cmd, name, description, required = true, min = 0, max = 1000000) =>
    cmd.addIntegerOption(o => o.setName(name).setDescription(description).setRequired(required).setMinValue(min).setMaxValue(max))
};

const commands = [
  new SlashCommandBuilder().setName("giveaway").setDescription("Manage server giveaways.")
    .addSubcommand(sc => sc.setName("create").setDescription("Create a giveaway.")
      .addStringOption(o => o.setName("prize").setDescription("Giveaway prize").setRequired(true).setMaxLength(150))
      .addStringOption(o => o.setName("duration").setDescription("Duration, e.g. 30m, 12h, 3d").setRequired(true).setMaxLength(20))
      .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setRequired(true).setMinValue(1).setMaxValue(20))
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post the giveaway in").setRequired(true))
      .addIntegerOption(o => o.setName("messages_required").setDescription("Minimum messages required (not tracked yet; leave unset)").setRequired(false).setMinValue(1).setMaxValue(100000))
      .addRoleOption(o => o.setName("roles_required").setDescription("Role required to enter").setRequired(false))
      .addRoleOption(o => o.setName("winners_roles").setDescription("Role to give selected winners").setRequired(false))
      .addStringOption(o => o.setName("roles_required_config").setDescription("How role requirements should be checked").setRequired(false).addChoices({name:"All roles",value:"all"},{name:"Any role",value:"any"}))
      .addStringOption(o => o.setName("roles_bonus_entries").setDescription("Optional roleID:entries pairs, comma-separated").setRequired(false).setMaxLength(300)))
    .addSubcommand(sc => sc.setName("end").setDescription("End a giveaway now.")
      .addIntegerOption(o => o.setName("id").setDescription("Giveaway ID").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc.setName("delete").setDescription("Delete a giveaway post.")
      .addIntegerOption(o => o.setName("id").setDescription("Giveaway ID").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc.setName("list").setDescription("List active giveaways."))
    .addSubcommand(sc => sc.setName("reroll").setDescription("Choose new winner(s).")
      .addIntegerOption(o => o.setName("id").setDescription("Giveaway ID").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc.setName("scheduled").setDescription("List scheduled/active giveaways."))
    .addSubcommand(sc => sc.setName("templates").setDescription("Show giveaway command examples.")),
  new SlashCommandBuilder().setName("help").setDescription("Show Vyuh Esports bot commands."),
  new SlashCommandBuilder().setName("userinfo").setDescription("Show information about a server member.")
    .addUserOption(o => o.setName("member").setDescription("Member to inspect").setRequired(false)),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Show information about this server."),
  new SlashCommandBuilder().setName("avatar").setDescription("Show a member's avatar.")
    .addUserOption(o => o.setName("member").setDescription("Member whose avatar to show").setRequired(false)),
  new SlashCommandBuilder().setName("announce").setDescription("Post an announcement with inline user, role, @everyone, and @here mentions.")
    .addChannelOption(o => o.setName("channel").setDescription("Announcement channel").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Announcement text").setRequired(true).setMaxLength(1900))
    .addAttachmentOption(o => o.setName("image").setDescription("Optional image displayed below the message").setRequired(false))
    .addAttachmentOption(o => o.setName("attachment").setDescription("Optional additional file").setRequired(false))
    .addStringOption(o => o.setName("notify").setDescription("Who should be notified").setRequired(false)
      .addChoices({name:"No notification",value:"none"},{name:"@everyone",value:"everyone"},{name:"@here",value:"here"}))
    .addMentionableOption(o => o.setName("mention").setDescription("Optionally notify one role or member").setRequired(false)),
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member and log the action.")
    .addUserOption(o => o.setName("member").setDescription("Member to warn").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .addUserOption(o => o.setName("member").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes (1–40320)").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member from the server.")
    .addUserOption(o => o.setName("member").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member from the server.")
    .addUserOption(o => o.setName("member").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder().setName("purge").setDescription("Delete recent messages in this channel.")
    .addIntegerOption(o => o.setName("amount").setDescription("Number of messages (1–100)").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("stafflog").setDescription("Show recent moderation actions.")
    .addIntegerOption(o => o.setName("limit").setDescription("Number of entries (1–10)").setRequired(false).setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder().setName("tournament").setDescription("Create or view a tournament announcement.")
    .addStringOption(o => o.setName("name").setDescription("Tournament name").setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName("details").setDescription("Format, dates, prize, or rules").setRequired(false).setMaxLength(1500)),
  new SlashCommandBuilder().setName("register").setDescription("Register your player name and in-game tag.")
    .addStringOption(o => o.setName("player").setDescription("Player name").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("tag").setDescription("In-game tag").setRequired(false).setMaxLength(40))
    .addStringOption(o => o.setName("team").setDescription("Team or clan name").setRequired(false).setMaxLength(80)),
  new SlashCommandBuilder().setName("roster").setDescription("View or update a team's roster.")
    .addStringOption(o => o.setName("team").setDescription("Team or clan name").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("action").setDescription("Choose an action").setRequired(false).addChoices({name:"View",value:"view"},{name:"Add me",value:"add"},{name:"Remove me",value:"remove"})),
  new SlashCommandBuilder().setName("match").setDescription("Create a tournament match entry.")
    .addStringOption(o => o.setName("team_a").setDescription("First team").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("team_b").setDescription("Second team").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("when").setDescription("Schedule text, e.g. 2026-11-02 20:00 IST").setRequired(false).setMaxLength(100))
    .addStringOption(o => o.setName("notes").setDescription("Stage or match notes").setRequired(false).setMaxLength(300)),
  new SlashCommandBuilder().setName("result").setDescription("Record a match result (staff only).")
    .addIntegerOption(o => o.setName("match_id").setDescription("Match ID from /standings").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("score_a").setDescription("First team's score/stars").setRequired(true).setMinValue(0).setMaxValue(1000))
    .addIntegerOption(o => o.setName("score_b").setDescription("Second team's score/stars").setRequired(true).setMinValue(0).setMaxValue(1000)),
  new SlashCommandBuilder().setName("standings").setDescription("List matches and recorded results."),
  new SlashCommandBuilder().setName("schedule").setDescription("Show scheduled tournament matches."),
  new SlashCommandBuilder().setName("player").setDescription("Look up a registered player.")
    .addUserOption(o => o.setName("member").setDescription("Member to look up").setRequired(false)),
  new SlashCommandBuilder().setName("clan").setDescription("Look up a clan/team roster.")
    .addStringOption(o => o.setName("name").setDescription("Clan or team name").setRequired(true).setMaxLength(80)),
  new SlashCommandBuilder().setName("team").setDescription("Show your registered team or a team's roster.")
    .addStringOption(o => o.setName("name").setDescription("Team name (optional)").setRequired(false).setMaxLength(80)),
  new SlashCommandBuilder().setName("profile").setDescription("Show your player profile.")
    .addUserOption(o => o.setName("member").setDescription("Member to view").setRequired(false)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Show registered players and their teams."),
  new SlashCommandBuilder().setName("verify").setDescription("Show verification instructions for tournament players."),
  new SlashCommandBuilder().setName("ticket").setDescription("Show ticket controls and support instructions."),
  new SlashCommandBuilder().setName("close").setDescription("Close the current ticket using the ticket controls."),
  new SlashCommandBuilder().setName("transcript").setDescription("Generate a ticket transcript using the ticket controls."),
  new SlashCommandBuilder().setName("adduser").setDescription("Show instructions for adding a member to a ticket.")
    .addUserOption(o => o.setName("member").setDescription("Member to add").setRequired(true)),
  new SlashCommandBuilder().setName("removeuser").setDescription("Show instructions for removing a member from a ticket.")
    .addUserOption(o => o.setName("member").setDescription("Member to remove").setRequired(true))
];

function hasPermission(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}
function logModeration(guildId, targetId, moderatorId, action, reason) {
  db.prepare("INSERT INTO moderation_logs (guild_id,target_id,moderator_id,action,reason) VALUES (?,?,?,?,?)")
    .run(guildId, targetId, moderatorId, action, reason || "No reason provided");
}
function getRegistered(guildId, userId) {
  return db.prepare("SELECT * FROM tournament_registrations WHERE guild_id=? AND user_id=?").get(guildId, userId);
}
function embed(color = 0xD4A72C) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}
async function reply(interaction, payload) {
  const response = { ...payload };
  delete response.ephemeral;

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response);
  }

  return interaction.reply({
    ...response,
    flags: MessageFlags.Ephemeral
  });
}

async function publishGiveawayResults(client, giveaway, winners) {
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const participantCount = new Set(JSON.parse(giveaway.participants || "[]")).size;
  const winnerText = winners.length
    ? `🏆 Winner${winners.length === 1 ? "" : "s"}: ${winners.map(id => `<@${id}>`).join(", ")}`
    : "No eligible entries were recorded.";
  const resultMessage = await channel.send({ content: `🎉 **${giveaway.prize} — Giveaway Results**\n${winnerText}` }).catch(error => {
    console.error("Could not publish giveaway results:", error.message);
    return null;
  });
  if (giveaway.message_id) {
    const original = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (original) {
      const endedAt = Math.floor(Date.now() / 1000);
      const statusLine = resultMessage?.url
        ? `This giveaway has now ended; the list of winners can be found [here](${resultMessage.url}).`
        : "This giveaway has now ended.";
      const description = [
        `• Hosted by <@${giveaway.host_id}>`,
        `• Ended at: <t:${endedAt}:f> (<t:${endedAt}:R>)`,
        `• Winners: ${winners.length}`,
        "",
        `• Participants: **${participantCount}**`,
        "",
        statusLine
      ].join("\n");
      const endedEmbed = embed(0xD4A72C).setTitle(`🎉 ${giveaway.prize}! 🎉`).setDescription(description).setTimestamp();
      await original.edit({ embeds: [endedEmbed], components: [] }).catch(error => {
        console.error("Could not update ended giveaway post:", error.message);
      });
    }
  }
  return resultMessage;
}
function parseBonusRoles(value) {
  const result = {};
  if (!value) return result;
  for (const part of value.split(",")) {
    const [roleId, entries] = part.trim().split(":");
    if (/^\d{17,20}$/.test(roleId || "") && Number.isInteger(Number(entries)) && Number(entries) > 0 && Number(entries) <= 20) {
      result[roleId] = Number(entries);
    }
  }
  return result;
}

async function handleCustomCommand(interaction) {
  const name = interaction.commandName;

  // Only acknowledge commands owned by this module. Acknowledge immediately
  // before any database, Discord API, or attachment work can exceed 3 seconds.
  const isOwnedCommand = commands.some(command => command.name === name);
  if (!isOwnedCommand) return false;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId;
  const subcommand = name === "giveaway" ? interaction.options.getSubcommand(false) : null;
  const publicGiveawayCommands = name === "giveaway" && ["list", "scheduled", "templates"].includes(subcommand);
  const roleRestrictedCommands = name === "announce" ||
    (name === "giveaway" && ["create", "end", "delete", "reroll"].includes(subcommand));
  const staffOnly = ["warn","timeout","kick","ban","purge","stafflog","tournament","match","result"].includes(name);
  const staffRoleId = process.env.ESPORTS_STAFF_ROLE_ID;
  const hasStaffRole = Boolean(staffRoleId && /^\d{17,20}$/.test(staffRoleId) &&
    interaction.member?.roles && (Array.isArray(interaction.member.roles)
      ? interaction.member.roles.includes(staffRoleId)
      : interaction.member.roles.cache?.has(staffRoleId)));
  const isAdmin = hasPermission(interaction, PermissionFlagsBits.Administrator);
  const canManageGuild = hasPermission(interaction, PermissionFlagsBits.ManageGuild);

  if (roleRestrictedCommands && !isAdmin && !hasStaffRole) {
    const roleMessage = staffRoleId && /^\d{17,20}$/.test(staffRoleId)
      ? `You need the configured **Esports Staff** role or Administrator permission to use this command.`
      : `This command is restricted. Configure \`ESPORTS_STAFF_ROLE_ID\` in your \`.env\` with your staff role ID, or use an Administrator account.`;
    return reply(interaction, { content: roleMessage });
  }

  if (staffOnly && !canManageGuild && !isAdmin) {
    return reply(interaction, { content: "You need **Manage Server** permission to use this command." });
  }

  switch (name) {
    case "help": {
      const e = embed().setTitle("♛ VYUH ESPORTS — COMMANDS").setDescription([
        "**General:** `/help`, `/ping`, `/welcome`, `/userinfo`, `/serverinfo`, `/avatar`",
        "**Tournament:** `/tournament`, `/register`, `/roster`, `/match`, `/result`, `/standings`, `/schedule`",
        "**Players:** `/player`, `/clan`, `/team`, `/profile`, `/leaderboard`, `/verify`",
        "**Moderation:** `/announce`, `/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/stafflog`",
        "**Tickets:** `/ticket-panel`, `/ticket-controls`, `/ticket`, `/close`, `/transcript`, `/adduser`, `/removeuser`"
      ].join("\n")).setFooter({text:"TEAM VYUH ESPORTS"});
      return reply(interaction, { embeds:[e] });
    }
    case "userinfo": {
      const user = interaction.options.getUser("member") || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
      const e = embed().setTitle("Member Information").setThumbnail(user.displayAvatarURL({size:256}))
        .addFields(
          {name:"User",value:`${user.tag} (${user.id})`},
          {name:"Account Created",value:`<t:${Math.floor(user.createdTimestamp/1000)}:F>`,inline:true},
          {name:"Joined Server",value:member?.joinedTimestamp?`<t:${Math.floor(member.joinedTimestamp/1000)}:F>`:"Not available",inline:true},
          {name:"Roles",value:member?.roles.cache.filter(r=>r.id!==guildId).map(r=>r.toString()).slice(0,15).join(", ")||"None"}
        );
      return reply(interaction,{embeds:[e]});
    }
    case "serverinfo": {
      const g=interaction.guild;
      const e=embed().setTitle(g.name).setThumbnail(g.iconURL({size:256}))
        .addFields(
          {name:"Server ID",value:g.id,inline:true},
          {name:"Members",value:String(g.memberCount),inline:true},
          {name:"Created",value:`<t:${Math.floor(g.createdTimestamp/1000)}:D>`,inline:true},
          {name:"Text Channels",value:String(g.channels.cache.filter(c=>c.isTextBased()).size),inline:true},
          {name:"Roles",value:String(g.roles.cache.size),inline:true}
        );
      return reply(interaction,{embeds:[e]});
    }
    case "avatar": {
      const user=interaction.options.getUser("member")||interaction.user;
      return reply(interaction,{embeds:[embed().setTitle(`${user.username}'s Avatar`).setImage(user.displayAvatarURL({size:1024,extension:"png"}))]});
    }
    case "announce": {
      const channel = interaction.options.getChannel("channel");
      if (!channel?.isTextBased() || !channel.send) {
        return reply(interaction, { content: "Choose a text channel." });
      }

      const image = interaction.options.getAttachment("image");
      const attachment = interaction.options.getAttachment("attachment");
      const notify = interaction.options.getString("notify") || "none";
      const mention = interaction.options.getMentionable("mention");
      const message = interaction.options.getString("message");

      if (image && !/^image\/(png|jpe?g|gif|webp)$/i.test(image.contentType || "")) {
        return reply(interaction, { content: "The image option must be a PNG, JPG, GIF, or WEBP image." });
      }

      // Keep mention tokens exactly where the organizer typed them in the
      // message. Discord only sends notifications for mentions explicitly
      // included in allowedMentions, so extract the IDs from inline syntax.
      // Supported: <@USER_ID>, <@!USER_ID>, <@&ROLE_ID>, @everyone, @here.
      const allowedMentions = { users: [], roles: [], parse: [], repliedUser: false };
      const inlineUserIds = [...message.matchAll(/<@!?(\d{17,20})>/g)].map(m => m[1]);
      const inlineRoleIds = [...message.matchAll(/<@&(\d{17,20})>/g)].map(m => m[1]);
      allowedMentions.users.push(...new Set(inlineUserIds));
      allowedMentions.roles.push(...new Set(inlineRoleIds));

      if (/@(?:everyone|here)\b/.test(message)) {
        allowedMentions.parse.push("everyone");
      }

      // Keep the existing optional selectors for users who prefer them.
      // Do not prepend a duplicate if the same mention is already in the text.
      const extraMentions = [];
      if (notify === "everyone" && !/@everyone\b/.test(message)) {
        extraMentions.push("@everyone");
        allowedMentions.parse.push("everyone");
      } else if (notify === "here" && !/@here\b/.test(message)) {
        extraMentions.push("@here");
        allowedMentions.parse.push("everyone");
      }

      if (mention) {
        if (mention instanceof Role) {
          if (!inlineRoleIds.includes(mention.id)) {
            extraMentions.push(`<@&${mention.id}>`);
            allowedMentions.roles.push(mention.id);
          }
        } else {
          const userId = mention.user?.id || mention.id;
          if (!inlineUserIds.includes(userId)) {
            extraMentions.push(`<@${userId}>`);
            allowedMentions.users.push(userId);
          }
        }
      }

      allowedMentions.users = [...new Set(allowedMentions.users)];
      allowedMentions.roles = [...new Set(allowedMentions.roles)];
      allowedMentions.parse = [...new Set(allowedMentions.parse)];
      const content = `${extraMentions.length ? `${extraMentions.join(" ")}\n\n` : ""}${message}`;
      const files = [];

      // Re-upload command attachments as message files so images render as
      // standard attachment previews rather than inside a narrow embed card.
      for (const file of [image, attachment].filter(Boolean)) {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`Could not download announcement attachment (${response.status}).`);
        const buffer = Buffer.from(await response.arrayBuffer());
        files.push(new AttachmentBuilder(buffer, { name: file.name || "announcement-file" }));
      }

      await channel.send({ content, files, allowedMentions });
      const hasMentions = extraMentions.length > 0
        || inlineUserIds.length > 0
        || inlineRoleIds.length > 0
        || /@(?:everyone|here)\\b/.test(message);

      return reply(interaction, {
        content: `Announcement posted in ${channel}${hasMentions ? " with notification mention(s)" : ""}${image ? " with image" : ""}${attachment ? " and attachment" : ""}.`
      });
    }
    case "giveaway": {
      const sub = interaction.options.getSubcommand();
      const parseDuration = value => {
        const m = /^([1-9]\d*)(m|h|d|w)$/i.exec(value.trim());
        if (!m) return null;
        const units = {m: 60000, h: 3600000, d: 86400000, w: 604800000};
        const ms = Number(m[1]) * units[m[2].toLowerCase()];
        return ms <= 30 * 86400000 ? ms : null;
      };
      const pickWinners = (ids, count) => {
        const pool = [...new Set(ids)];
        const picked = [];
        while (pool.length && picked.length < count) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        return picked;
      };
      const getGiveaway = id => db.prepare("SELECT * FROM giveaways WHERE id=? AND guild_id=?").get(id, guildId);
      if (sub === "create") {
        const prize = interaction.options.getString("prize");
        const durationText = interaction.options.getString("duration");
        const duration = parseDuration(durationText);
        if (!duration) return reply(interaction, { content: "Invalid duration. Use 10m, 2h, 3d, or 1w (maximum 30 days)." });
        const channel = interaction.options.getChannel("channel");
        if (!channel?.isTextBased() || !channel.send) return reply(interaction, { content: "Choose a text channel." });
        const messagesRequired = interaction.options.getInteger("messages_required") || 0;
        const requiredRole = interaction.options.getRole("roles_required");
        const winnersRole = interaction.options.getRole("winners_roles");
        const endsAt = Date.now() + duration;
        const result = db.prepare("INSERT INTO giveaways (guild_id,channel_id,prize,winners,ends_at,host_id,required_role_id,winners_role_id,required_role_config,bonus_roles,messages_required) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(guildId, channel.id, prize, interaction.options.getInteger("winners"), endsAt, interaction.user.id, requiredRole?.id || null, winnersRole?.id || null, interaction.options.getString("roles_required_config") || "all", JSON.stringify(parseBonusRoles(interaction.options.getString("roles_bonus_entries"))), messagesRequired);
        const id = Number(result.lastInsertRowid);
        const gEmbed = embed().setTitle("🎉 GIVEAWAY")
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${interaction.options.getInteger("winners")}\n**Participants:** 0\n**Hosted by:** <@${interaction.user.id}>\n**Ends:** <t:${Math.floor(endsAt/1000)}:R>\n**Giveaway ID:** ${id}${requiredRole ? `\n**Required role:** <@&${requiredRole.id}>` : ""}`)
          .setFooter({text:"Click Enter Giveaway to participate."});
        const giveawayButtons = [
          new ButtonBuilder()
            .setCustomId(`giveaway:enter:${id}`)
            .setLabel("Entry")
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`giveaway:participants:${id}`)
            .setLabel("Participants")
            .setEmoji("👥")
            .setStyle(ButtonStyle.Secondary)
        ];
        const bonusEntryUrl = process.env.GIVEAWAY_BONUS_ENTRY_URL;
        if (bonusEntryUrl && /^https?:\/\//i.test(bonusEntryUrl)) {
          giveawayButtons.push(
            new ButtonBuilder()
              .setLabel("Vote for 1 Extra Entry")
              .setEmoji("🔗")
              .setStyle(ButtonStyle.Link)
              .setURL(bonusEntryUrl)
          );
        }
        const row = new ActionRowBuilder().addComponents(...giveawayButtons);
        const msg = await channel.send({embeds:[gEmbed],components:[row]});
        db.prepare("UPDATE giveaways SET message_id=? WHERE id=?").run(msg.id,id);
        return reply(interaction,{content:`Giveaway #${id} created in ${channel}. Ends <t:${Math.floor(endsAt/1000)}:R>.${winnersRole ? ` Winners will receive <@&${winnersRole.id}> manually.` : ""}`});
      }
      if (sub === "templates") return reply(interaction,{content:"**Create:** `/giveaway create prize:Prize duration:24h winners:1 channel:#giveaways`\n**End:** `/giveaway end id:1`\n**Reroll:** `/giveaway reroll id:1`\n**List:** `/giveaway list`"});
      if (sub === "list" || sub === "scheduled") {
        const rows = db.prepare("SELECT * FROM giveaways WHERE guild_id=? AND status='active' ORDER BY ends_at ASC LIMIT 20").all(guildId);
        return reply(interaction,{content: rows.length ? rows.map(g=>`**#${g.id} — ${g.prize}** in <#${g.channel_id}> • ends <t:${Math.floor(g.ends_at/1000)}:R> • <#${g.channel_id}>`).join("\\n") : "There are no active giveaways."});
      }
      const id = interaction.options.getInteger("id");
      const g = getGiveaway(id);
      if (!g) return reply(interaction,{content:`Giveaway #${id} was not found in this server.`});
      if (sub === "delete") {
        const ch = await interaction.guild.channels.fetch(g.channel_id).catch(()=>null);
        if (ch && g.message_id) await ch.messages.delete(g.message_id).catch(()=>{});
        db.prepare("UPDATE giveaways SET status='deleted' WHERE id=?").run(id);
        return reply(interaction,{content:`Giveaway #${id} deleted.`});
      }
      const participants = JSON.parse(g.participants || "[]");
      const winners = pickWinners(participants, g.winners);
      if (sub === "end" && g.status !== "active") return reply(interaction,{content:"This giveaway is already ended."});
      if (sub === "end" || sub === "reroll") {
        if (!winners.length && sub === "reroll") return reply(interaction,{content:"No eligible entries are recorded for this giveaway."});
        if (sub === "end") db.prepare("UPDATE giveaways SET status='ended', winners_json=? WHERE id=?").run(JSON.stringify(winners),id);
        else db.prepare("UPDATE giveaways SET winners_json=? WHERE id=?").run(JSON.stringify(winners),id);
        if (sub === "end") {
          await publishGiveawayResults(interaction.client, g, winners);
        } else {
          const ch = await interaction.guild.channels.fetch(g.channel_id).catch(()=>null);
          if (ch?.isTextBased()) await ch.send(`🎉 **Giveaway rerolled — ${g.prize}**\nWinner(s): ${winners.map(uid=>`<@${uid}>`).join(", ")}`).catch(()=>{});
        }
        return reply(interaction,{content:`Winner(s): ${winners.map(uid=>`<@${uid}>`).join(", ")}`});
      }
      return false;
    }
    case "warn": {
      const user=interaction.options.getUser("member"), reason=interaction.options.getString("reason");
      logModeration(guildId,user.id,interaction.user.id,"WARN",reason);
      const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
      if(member) await user.send(`You have been warned in **${interaction.guild.name}**. Reason: ${reason}`).catch(()=>{});
      return reply(interaction,{content:`⚠️ Warned ${user.tag}. Reason: ${reason}`});
    }
    case "timeout": case "kick": case "ban": {
      const user=interaction.options.getUser("member");
      const reason=interaction.options.getString("reason")||"No reason provided";
      const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
      if(!member) return reply(interaction,{content:"That member is not currently in this server."});
      if(member.id===interaction.user.id || member.id===interaction.client.user.id) return reply(interaction,{content:"You cannot apply this action to yourself or the bot."});
      if(name==="timeout") {
        if(!member.moderatable) return reply(interaction,{content:"I cannot timeout this member. Check role hierarchy and permissions."});
        const minutes=interaction.options.getInteger("minutes");
        await member.timeout(minutes*60*1000,reason);
        logModeration(guildId,user.id,interaction.user.id,"TIMEOUT",`${minutes}m — ${reason}`);
        return reply(interaction,{content:`Timed out ${user.tag} for ${minutes} minute(s). Reason: ${reason}`});
      }
      if(name==="kick") {
        if(!member.kickable) return reply(interaction,{content:"I cannot kick this member. Check role hierarchy and permissions."});
        await member.kick(reason);
        logModeration(guildId,user.id,interaction.user.id,"KICK",reason);
        return reply(interaction,{content:`Kicked ${user.tag}. Reason: ${reason}`});
      }
      if(!member.bannable) return reply(interaction,{content:"I cannot ban this member. Check role hierarchy and permissions."});
      await member.ban({reason});
      logModeration(guildId,user.id,interaction.user.id,"BAN",reason);
      return reply(interaction,{content:`Banned ${user.tag}. Reason: ${reason}`});
    }
    case "purge": {
      if(!interaction.channel?.bulkDelete) return reply(interaction,{content:"This command must be used in a text channel."});
      const amount=interaction.options.getInteger("amount");
      const deleted=await interaction.channel.bulkDelete(amount,true);
      return reply(interaction,{content:`Deleted ${deleted.size} recent message(s). Discord does not bulk-delete messages older than 14 days.`});
    }
    case "stafflog": {
      const limit=interaction.options.getInteger("limit")||5;
      const rows=db.prepare("SELECT * FROM moderation_logs WHERE guild_id=? ORDER BY id DESC LIMIT ?").all(guildId,limit);
      return reply(interaction,{embeds:[embed().setTitle("Recent Moderation Log").setDescription(rows.length?rows.map(r=>`**#${r.id} ${r.action}** — <@${r.target_id}> by <@${r.moderator_id}>\n${r.reason||"No reason"} · ${r.created_at}`).join("\n\n"):"No moderation entries yet.")]});
    }
    case "tournament": {
      const title=interaction.options.getString("name"), details=interaction.options.getString("details")||"Details will be announced soon.";
      const channel=interaction.channel;
      await channel.send({embeds:[embed().setTitle(`🏆 ${title}`).setDescription(details).setFooter({text:"VYUH ESPORTS • Tournament Information"})]});
      return reply(interaction,{content:`Tournament announcement posted: **${title}**`});
    }
    case "register": {
      const player=interaction.options.getString("player"), tag=interaction.options.getString("tag"), team=interaction.options.getString("team");
      db.prepare(`INSERT INTO tournament_registrations(guild_id,user_id,player_name,player_tag,team_name) VALUES(?,?,?,?,?)
        ON CONFLICT(guild_id,user_id) DO UPDATE SET player_name=excluded.player_name,player_tag=excluded.player_tag,team_name=excluded.team_name`)
        .run(guildId,interaction.user.id,player,tag,team);
      return reply(interaction,{content:`Registration saved for **${player}**${tag?` (${tag})`:""}${team?` — Team: ${team}`:""}.`});
    }
    case "roster": {
      const team=interaction.options.getString("team"), action=interaction.options.getString("action")||"view";
      if(action==="add") {
        db.prepare(`INSERT INTO tournament_registrations(guild_id,user_id,player_name,team_name) VALUES(?,?,?,?)
          ON CONFLICT(guild_id,user_id) DO UPDATE SET team_name=excluded.team_name`).run(guildId,interaction.user.id,interaction.user.username,team);
        return reply(interaction,{content:`You have been added to the **${team}** roster. Register your in-game tag with \`/register\` if needed.`});
      }
      if(action==="remove") {
        const r=db.prepare("UPDATE tournament_registrations SET team_name=NULL WHERE guild_id=? AND user_id=? AND lower(team_name)=lower(?)").run(guildId,interaction.user.id,team);
        return reply(interaction,{content:r.changes?`You have been removed from **${team}**.`:"You are not listed on that team roster."});
      }
      const rows=db.prepare("SELECT * FROM tournament_registrations WHERE guild_id=? AND lower(team_name)=lower(?) ORDER BY player_name").all(guildId,team);
      return reply(interaction,{embeds:[embed().setTitle(`${team} — Roster`).setDescription(rows.length?rows.map((r,i)=>`${i+1}. **${r.player_name}**${r.player_tag?` — ${r.player_tag}`:""} (<@${r.user_id}>)`).join("\n"):"No registered players found for this team.")]});
    }
    case "match": {
      const a=interaction.options.getString("team_a"), b=interaction.options.getString("team_b"), when=interaction.options.getString("when"), notes=interaction.options.getString("notes");
      const result=db.prepare("INSERT INTO tournament_matches(guild_id,team_a,team_b,scheduled_at,notes,created_by) VALUES(?,?,?,?,?,?)").run(guildId,a,b,when,notes,interaction.user.id);
      return reply(interaction,{content:`Created match **#${result.lastInsertRowid}**: **${a} vs ${b}**${when?` — ${when}`:""}.`});
    }
    case "result": {
      const id=interaction.options.getInteger("match_id"), a=interaction.options.getInteger("score_a"), b=interaction.options.getInteger("score_b");
      const match=db.prepare("SELECT * FROM tournament_matches WHERE guild_id=? AND id=?").get(guildId,id);
      if(!match) return reply(interaction,{content:"Match ID not found in this server. Check `/standings`."});
      db.prepare("UPDATE tournament_matches SET result_a=?,result_b=? WHERE id=? AND guild_id=?").run(a,b,id,guildId);
      return reply(interaction,{content:`Recorded result for match #${id}: **${match.team_a} ${a} – ${b} ${match.team_b}**.`});
    }
    case "standings": {
      const rows=db.prepare("SELECT * FROM tournament_matches WHERE guild_id=? ORDER BY id DESC LIMIT 25").all(guildId);
      return reply(interaction,{embeds:[embed().setTitle("Tournament Matches & Results").setDescription(rows.length?rows.map(m=>`**#${m.id} ${m.team_a} vs ${m.team_b}**${m.scheduled_at?`\n🗓️ ${m.scheduled_at}`:""}\n${m.result_a===null?"⏳ Pending":`⭐ ${m.result_a} – ${m.result_b}`}${m.notes?`\n_${m.notes}_`:""}`).join("\n\n"):"No matches have been created. Use `/match`.")]});
    }
    case "schedule": {
      const rows=db.prepare("SELECT * FROM tournament_matches WHERE guild_id=? ORDER BY CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END, scheduled_at ASC LIMIT 25").all(guildId);
      return reply(interaction,{embeds:[embed().setTitle("Tournament Schedule").setDescription(rows.length?rows.map(m=>`**#${m.id} ${m.team_a} vs ${m.team_b}** — ${m.scheduled_at||"Time TBD"}`).join("\n"):"No scheduled matches yet.")]});
    }
    case "player": case "profile": {
      const user=interaction.options.getUser("member")||interaction.user, row=getRegistered(guildId,user.id);
      if(!row) return reply(interaction,{content:`No player registration found for ${user.tag}. They can use \`/register\`.`});
      return reply(interaction,{embeds:[embed().setTitle(`${row.player_name} — Player Profile`).setThumbnail(user.displayAvatarURL({size:256})).addFields(
        {name:"Discord",value:`${user.tag} (<@${user.id}>)`},
        {name:"In-game Tag",value:row.player_tag||"Not provided",inline:true},
        {name:"Team",value:row.team_name||"Not assigned",inline:true},
        {name:"Registered",value:row.created_at,inline:true}
      )]});
    }
    case "clan": case "team": {
      const name=interaction.options.getString("name");
      if(!name) {
        const row=getRegistered(guildId,interaction.user.id);
        return reply(interaction,{content:row?.team_name?`Your team is **${row.team_name}**. Use \`/roster team:${row.team_name}\` to view its roster.`:"You do not have a team assigned. Use `/register` or `/roster`."});
      }
      const rows=db.prepare("SELECT * FROM tournament_registrations WHERE guild_id=? AND lower(team_name)=lower(?) ORDER BY player_name").all(guildId,name);
      return reply(interaction,{embeds:[embed().setTitle(`${name} — Team Profile`).setDescription(rows.length?rows.map(r=>`• **${r.player_name}**${r.player_tag?` (${r.player_tag})`:""} — <@${r.user_id}>`).join("\n"):"No registered players found for that team.")]});
    }
    case "leaderboard": {
      const rows=db.prepare("SELECT * FROM tournament_registrations WHERE guild_id=? ORDER BY player_name LIMIT 25").all(guildId);
      return reply(interaction,{embeds:[embed().setTitle("Registered Players").setDescription(rows.length?rows.map((r,i)=>`${i+1}. **${r.player_name}**${r.team_name?` — ${r.team_name}`:""} (<@${r.user_id}>)`).join("\n"):"No players have registered yet.")]});
    }
    case "verify": {
      return reply(interaction,{content:"**Tournament verification**\n1. Run `/register` with your in-game name and tag.\n2. Ensure your Discord account is linked to the correct player.\n3. Follow the tournament staff's instructions in the registration channel.\n\nThis command records player details; it does not automatically verify in-game ownership."});
    }
    case "ticket-controls": case "ticket": case "close": case "transcript": case "adduser": case "removeuser": {
      const extra= name==="adduser"||name==="removeuser" ? ` Requested member: ${interaction.options.getUser("member")}.` : "";
      if (name === "ticket-controls") {
        return reply(interaction,{content:"Open this command inside the ticket channel. The existing ticket buttons are the supported staff controls; if you do not see them, use `/ticket-panel` in the support channel or ask an administrator to restore the controls."});
      }
      return reply(interaction,{content:`Use the ticket's staff control buttons to claim, close, export a transcript, or delete it. Transcript export is handled by the existing ticket system and is uploaded to the configured transcript log channel.${extra}`});
    }
    default:
      return false;
  }
}

async function processExpiredGiveaways(client) {
  const due = db.prepare("SELECT * FROM giveaways WHERE status='active' AND ends_at<=?").all(Date.now());
  for (const g of due) {
    const participants = JSON.parse(g.participants || "[]");
    const pool = [...new Set(participants)];
    const winners = [];
    while (pool.length && winners.length < g.winners) winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    db.prepare("UPDATE giveaways SET status='ended', winners_json=? WHERE id=? AND status='active'").run(JSON.stringify(winners), g.id);
    if (g.winners_role_id) {
      for (const uid of winners) {
        const guild = client.guilds.cache.get(g.guild_id);
        const member = guild ? await guild.members.fetch(uid).catch(() => null) : null;
        if (member) await member.roles.add(g.winners_role_id, `Winner of giveaway #${g.id}`).catch(() => {});
      }
    }
    await publishGiveawayResults(client, g, winners);
  }
}

async function handleGiveawayButton(interaction) {
  const enterMatch = /^giveaway:enter:(\d+)$/.exec(interaction.customId || "");
  const participantsMatch = /^giveaway:participants:(\d+)$/.exec(interaction.customId || "");
  if (!enterMatch && !participantsMatch) return false;

  const id = Number((enterMatch || participantsMatch)[1]);
  const g = db.prepare("SELECT * FROM giveaways WHERE id=? AND guild_id=?").get(id, interaction.guildId);

  if (participantsMatch) {
    if (!g) {
      return interaction.reply({ content: "This giveaway could not be found.", flags: MessageFlags.Ephemeral });
    }
    const entries = [...new Set(JSON.parse(g.participants || "[]"))];
    if (!entries.length) {
      return interaction.reply({ content: "No one has entered this giveaway yet.", flags: MessageFlags.Ephemeral });
    }
    const lines = entries.slice(0, 40).map((userId, index) => `${index + 1}. <@${userId}>`);
    const suffix = entries.length > 40 ? `\n…and ${entries.length - 40} more participant(s).` : "";
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xD4A72C)
          .setTitle("👥 Giveaway Participants")
          .setDescription(`**${entries.length}** unique participant(s)\n\n${lines.join("\n")}${suffix}`)
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  // Acknowledge the button immediately so Discord does not time out the interaction.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!g || g.status !== "active" || g.ends_at <= Date.now()) {
    return interaction.editReply({ content: "This giveaway has ended or is no longer active." });
  }

  const entries = JSON.parse(g.participants || "[]");
  const memberRoles = interaction.member?.roles?.cache;
  if (g.required_role_id && !memberRoles?.has(g.required_role_id)) {
    return interaction.editReply({ content: `You need <@&${g.required_role_id}> to enter this giveaway.` });
  }

  if (g.messages_required > 0) {
    const count = db.prepare("SELECT message_count FROM giveaway_message_counts WHERE guild_id=? AND user_id=?").get(interaction.guildId, interaction.user.id)?.message_count || 0;
    if (count < g.messages_required) {
      return interaction.editReply({
        content: `You need at least ${g.messages_required} messages to enter. Your tracked count is ${count}. Counts started when this bot's message tracking was enabled.`
      });
    }
  }

  // Entries may contain repeated IDs for bonus entries, so test unique participation.
  if (entries.includes(interaction.user.id)) {
    return interaction.editReply({ content: "You are already entered in this giveaway." });
  }

  const bonus = JSON.parse(g.bonus_roles || "{}");
  const bonusCount = Object.entries(bonus).reduce(
    (total, [roleId, count]) => total + (memberRoles?.has(roleId) ? Number(count) : 0),
    0
  );

  entries.push(interaction.user.id);
  for (let i = 0; i < bonusCount; i++) entries.push(interaction.user.id);
  db.prepare("UPDATE giveaways SET participants=? WHERE id=?").run(JSON.stringify(entries), id);

  const participantCount = new Set(entries).size;
  const sourceEmbed = interaction.message?.embeds?.[0];
  if (sourceEmbed) {
    const updatedEmbed = EmbedBuilder.from(sourceEmbed.toJSON());
    const currentDescription = sourceEmbed.description || "";
    const countLine = `**Participants:** ${participantCount}`;
    const nextDescription = /\*\*Participants:\*\* \d+/.test(currentDescription)
      ? currentDescription.replace(/\*\*Participants:\*\* \d+/, countLine)
      : `${currentDescription}\n${countLine}`;
    updatedEmbed.setDescription(nextDescription);
    await interaction.message.edit({ embeds: [updatedEmbed] }).catch(error => {
      console.error("Could not update giveaway participant count:", error.message);
    });
  }

  return interaction.editReply({
    content: `🎉 You have successfully entered giveaway #${id}: **${g.prize}**. Participants: ${participantCount}.`
  });
}
module.exports = { commands, handleCustomCommand, handleGiveawayButton, processExpiredGiveaways };
