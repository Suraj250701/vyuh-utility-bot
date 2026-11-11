require("dotenv").config();

const {
  ActionRowBuilder,
  ActivityType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const categories = require("./categories");
const welcomeConfig = require("./config");
const customCommands = require("./custom-commands");

const {
  DISCORD_TOKEN,
  GUILD_ID,
  CLIENT_ID,
  WELCOME_CHANNEL_ID,
  SUPPORT_ROLE_ID,
  TICKET_LOG_CHANNEL_ID,
  TICKET_CATEGORY_ID
} = process.env;

console.log("DISCORD_TOKEN loaded:", Boolean(DISCORD_TOKEN));

const BRAND_NAME = process.env.BRAND_NAME || "VYUH ESPORTS";
const PANEL_COLOR = parseInt(process.env.PANEL_COLOR || "F5C842", 16);
const TICKET_COLOR = parseInt(process.env.TICKET_COLOR || "2F3136", 16);

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

if (!GUILD_ID || !CLIENT_ID) {
  console.error("Missing GUILD_ID or CLIENT_ID in .env. Both are required to register the unified slash commands.");
  process.exit(1);
}

if (!SUPPORT_ROLE_ID || !TICKET_LOG_CHANNEL_ID) {
  console.warn("Ticket settings are incomplete. Welcome commands can work, but ticket features need SUPPORT_ROLE_ID and TICKET_LOG_CHANNEL_ID in .env.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function welcomeBannerPath() {
  return path.resolve(__dirname, "..", welcomeConfig.welcomeBanner || "./assets/vyuh-welcome-banner.png");
}

function buildWelcomeEmbed() {
  let description = `${welcomeConfig.intro || ""}\n\n${welcomeConfig.intro2 || ""}\n\n`;

  for (let i = 0; i < (welcomeConfig.sections || []).length; i++) {
    const section = welcomeConfig.sections[i];
    description += `**${section.heading}**\n${section.items.map(item => `${item}`).join("\n")}`;

    if (i < welcomeConfig.sections.length - 1) {
      description += "\n\n";
    }
  }

  const embed = new EmbedBuilder()
    .setColor(welcomeConfig.embedColor || 0xD4A72C)
    .setTitle(`◈ ${welcomeConfig.title || "WELCOME TO VYUH ESPORTS"} ◈`)
    .setDescription(description)
    .setFooter({ text: welcomeConfig.footer || "TEAM VYUH ESPORTS" });

  if (fs.existsSync(welcomeBannerPath())) {
    embed.setImage("attachment://vyuh-welcome-banner.png");
  }

  return embed;
}

async function sendWelcome(member) {
  if (!WELCOME_CHANNEL_ID) {
    console.warn("WELCOME_CHANNEL_ID is not configured; skipping automatic welcome message.");
    return;
  }

  const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.error(`Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not text-based.`);
    return;
  }

  const botMember = member.guild.members.me;
  const effective = botMember ? channel.permissionsFor(botMember) : null;

  const required = {
    ViewChannel: PermissionFlagsBits.ViewChannel,
    SendMessages: PermissionFlagsBits.SendMessages,
    EmbedLinks: PermissionFlagsBits.EmbedLinks,
    AttachFiles: PermissionFlagsBits.AttachFiles,
    ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory
  };

  const permissionReport = Object.entries(required).map(([name, bit]) => ({
    name,
    allowed: Boolean(effective?.has(bit))
  }));

  console.log(
    `[Welcome] Channel ${channel.id} effective permissions:`,
    permissionReport.map(p => `${p.name}=${p.allowed}`).join(", ")
  );

  if (
    !effective?.has(PermissionFlagsBits.ViewChannel) ||
    !effective?.has(PermissionFlagsBits.SendMessages)
  ) {
    console.error(
      `[Welcome] Cannot send to #${channel.name}: View Channel or Send Messages is denied by the channel's effective permissions.`
    );
    return;
  }

  const hasBanner = fs.existsSync(welcomeBannerPath());

  const files = hasBanner
    ? [new AttachmentBuilder(welcomeBannerPath(), { name: "vyuh-welcome-banner.png" })]
    : [];

  try {
    await channel.send({
      content: `Hi ${member}!`,
      embeds: [buildWelcomeEmbed()],
      files
    });

    console.log(`[Welcome] Full welcome sent to #${channel.name}.`);
    return;
  } catch (fullError) {
    console.error("[Welcome] Full embed/banner send failed:", {
      code: fullError.code,
      message: fullError.message,
      effectivePermissions: permissionReport
    });

    if (fullError.code !== 50013) throw fullError;
  }

  try {
    if (effective.has(PermissionFlagsBits.EmbedLinks)) {
      await channel.send({
        content: `Hi ${member}!`,
        embeds: [buildWelcomeEmbed()]
      });

      console.warn(
        `[Welcome] Sent embed without banner to #${channel.name}; attachment permissions may be the issue.`
      );
      return;
    }
  } catch (embedError) {
    console.error("[Welcome] Embed-only fallback failed:", {
      code: embedError.code,
      message: embedError.message
    });

    if (embedError.code !== 50013) throw embedError;
  }

  await channel.send({
    content: `Welcome to ${BRAND_NAME}, ${member}!`
  });

  console.warn(
    `[Welcome] Sent plain-text fallback to #${channel.name}; embed/attachment permissions need checking.`
  );
}

function unifiedCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("Post the Vyuh Esports ticket panel in this channel."),
    new SlashCommandBuilder()
      .setName("ticket-controls")
      .setDescription("Open private staff controls for the ticket in this channel."),
    new SlashCommandBuilder()
      .setName("welcome")
      .setDescription("Preview the Vyuh Esports welcome message."),
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check whether the Vyuh Esports bot is online."),
    ...customCommands.commands
  ].map(command => command.toJSON());
}

async function registerUnifiedCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  const commands = unifiedCommands();
  // Keep commands guild-scoped only. The previous global + guild registration
  // created two command scopes and caused duplicate-looking entries.
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`Registered ${commands.length} guild-scoped Vyuh Esports slash commands in server ${GUILD_ID}; global duplicates cleared.`);
}

function roleForCategory(guild, category) {
  if (!guild || !category) return null;

  // Check the category's primary role variable and any explicitly configured
  // aliases. This supports existing deployments using older variable names.
  const roleEnvNames = [
    category.roleEnv,
    ...(category.roleEnvAliases || [])
  ].filter(Boolean);

  for (const envName of roleEnvNames) {
    const roleId = (process.env[envName] || "").trim();
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (role) return role;

    console.warn(
      `[Tickets] ${envName} is set, but its role ID was not found in this server.`
    );
  }

  // Category-specific roles are optional; use the general support role
  // when no valid category-specific role is configured.
  const fallbackId = (SUPPORT_ROLE_ID || "").trim();
  if (fallbackId) {
    const fallbackRole = guild.roles.cache.get(fallbackId);
    if (fallbackRole) return fallbackRole;

    console.warn(
      "[Tickets] SUPPORT_ROLE_ID is set, but its role ID was not found in this server."
    );
  }

  return null;
}

function categoryByKey(key) {
  return categories.find(category => category.key === key);
}

function safeChannelPart(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18) || "member";
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(`♛ ${BRAND_NAME} SUPPORT`)
    .setDescription(
      "**Need Assistance, Clashers ?**\n" +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      "Open a ticket using the menu below and select the category that best fits your request.\n\n" +
      categories.map(category =>
        `${category.emoji} **${category.label}**\n${category.description}`
      ).join("\n\n") +
      "\n\n━━━━━━━━━━━━━━━━━━━━\n*Our support team will respond as soon as possible.*"
    )
    .setFooter({ text: `TEAM ${BRAND_NAME}` });
}

function panelComponents() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket:create")
    .setPlaceholder("Select Ticket Type...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      categories.map(category =>
        new StringSelectMenuOptionBuilder()
          .setLabel(category.label)
          .setDescription(category.description.slice(0, 100))
          .setValue(category.key)
          .setEmoji(category.emoji)
      )
    );

  return [new ActionRowBuilder().addComponents(menu)];
}

function staffTicketControls(ticket) {
  const buttons = [];

  if (ticket.status === "open") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ticket:staff:claim:${ticket.id}`)
        .setLabel(ticket.claimed_by ? "Claimed" : "Claim")
        .setEmoji("🙋")
        .setStyle(ticket.claimed_by ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(Boolean(ticket.claimed_by)),

      new ButtonBuilder()
        .setCustomId(`ticket:staff:close:${ticket.id}`)
        .setLabel("Close")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ticket:staff:open:${ticket.id}`)
        .setLabel("Open")
        .setEmoji("🔓")
        .setStyle(ButtonStyle.Success)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`ticket:staff:transcript:${ticket.id}`)
      .setLabel("Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`ticket:staff:delete:${ticket.id}`)
      .setLabel("Delete")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger)
  );

  return [new ActionRowBuilder().addComponents(...buttons)];
}

function deleteConfirmationControls(ticketId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:staff:delete-confirm:${ticketId}`)
        .setLabel("Permanently Delete")
        .setEmoji("⛔")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`ticket:staff:delete-cancel:${ticketId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function logEvent(ticketId, eventType, actorId, details = "") {
  db.prepare(`
    INSERT INTO ticket_events (ticket_id, event_type, actor_id, details)
    VALUES (?, ?, ?, ?)
  `).run(ticketId, eventType, actorId, details);
}

function getTicketByChannel(channelId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
}

async function getTicketChannel(guild, ticket) {
  return guild.channels.fetch(ticket.channel_id).catch(() => null);
}

function configuredTicketControlRoleIds() {
  return (process.env.TICKET_CONTROL_ROLE_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
}

function memberRoleIds(member) {
  if (!member) return [];
  if (Array.isArray(member.roles)) return member.roles;
  if (member.roles?.cache) return [...member.roles.cache.keys()];
  return [];
}

function isStaff(member, category) {
  const roleIds = memberRoleIds(member);
  const allowedRoleIds = new Set(configuredTicketControlRoleIds());

  if (SUPPORT_ROLE_ID) allowedRoleIds.add(SUPPORT_ROLE_ID);

  const categoryRole = roleForCategory(member?.guild, category);
  if (categoryRole?.id) allowedRoleIds.add(categoryRole.id);

  return roleIds.some(roleId => allowedRoleIds.has(roleId));
}

async function refreshStaffControlPanel(interaction, ticketId) {
  if (!interaction.message || !interaction.message.editable) return;

  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
  if (!ticket) return;

  try {
    await interaction.message.edit({
      components: staffTicketControls(ticket)
    });
  } catch (error) {
    console.error(
      `Could not refresh staff control panel for Ticket #${ticketId}:`,
      error.message
    );
  }
}

async function syncControlsToExistingTicketMessages(guild) {
  if (!guild) {
    console.error(`Could not sync existing ticket controls: server ${GUILD_ID} is not cached.`);
    return;
  }

  const tickets = db.prepare(
    "SELECT * FROM tickets WHERE status IN ('open', 'closed')"
  ).all();

  for (const ticket of tickets) {
    try {
      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const category = categoryByKey(ticket.category_key);
      if (!category) continue;

      const messages = await channel.messages.fetch({ limit: 50 });

      const openingMessage = [...messages.values()]
        .filter(message =>
          message.author.id === client.user.id && message.embeds.length
        )
        .find(message =>
          message.embeds.some(
            embed => embed.title === `${category.emoji} ${ticket.category_label}`
          )
        );

      if (openingMessage) {
        await openingMessage.edit({
          components: staffTicketControls(ticket)
        });
      }
    } catch (error) {
      console.error(
        `Could not attach staff controls to existing ticket #${ticket.id}:`,
        error.message
      );
    }
  }
}

async function fetchLogChannel(guild) {
  const channel = await guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) return null;

  return channel;
}

/*
 * Generate a transcript entirely in memory.
 * No .txt file is written to the bot's directory.
 */
async function writeTranscript(channel, ticket, closedBy) {
  const lines = [
    `${BRAND_NAME} — TICKET TRANSCRIPT`,
    `Ticket: #${ticket.id}`,
    `Channel: #${channel.name} (${channel.id})`,
    `Owner: ${ticket.owner_id}`,
    `Category: ${ticket.category_label}`,
    `Created: ${ticket.created_at}`,
    `Closed by: ${closedBy}`,
    `Exported: ${new Date().toISOString()}`,
    "=".repeat(72),
    ""
  ];

  let before;
  let collected = 0;

  // Fetch up to 1,000 messages, in batches of at most 100.
  while (collected < 1000) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, 1000 - collected),
      ...(before ? { before } : {})
    });

    if (batch.size === 0) break;

    const ordered = [...batch.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    for (const message of ordered) {
      const timestamp = new Date(message.createdTimestamp).toISOString();

      const attachmentText = [...message.attachments.values()]
        .map(attachment => attachment.url)
        .join(" ");

      const embedText = message.embeds
        .map(embed => `[Embed: ${embed.title || "untitled"}]`)
        .join(" ");

      lines.push(
        `[${timestamp}] ${message.author.tag} (${message.author.id}): ` +
        `${message.content || ""}` +
        `${attachmentText ? ` [Attachments: ${attachmentText}]` : ""}` +
        `${embedText ? ` ${embedText}` : ""}`
      );
    }

    collected += batch.size;
    before = ordered[0]?.id;

    if (batch.size < 100 || !before) break;
  }

  return {
    filename: `ticket-${ticket.id}.txt`,
    content: lines.join("\n"),
    count: collected
  };
}

/*
 * Upload the transcript directly to Discord using an in-memory Buffer.
 * If delivery fails, throw an error so the deletion flow can stop safely.
 */
async function createTranscriptAndDeliver(guild, channel, ticket, actorTag) {
  const transcript = await writeTranscript(channel, ticket, actorTag);
  const logChannel = await fetchLogChannel(guild);

  if (!logChannel) {
    throw new Error(
      `Ticket transcript channel ${TICKET_LOG_CHANNEL_ID} is inaccessible.`
    );
  }

  const embed = new EmbedBuilder()
    .setColor(ticket.status === "closed" ? 0xD94F4F : PANEL_COLOR)
    .setTitle(`Ticket #${ticket.id} Transcript`)
    .addFields(
      { name: "Category", value: ticket.category_label, inline: true },
      { name: "Owner", value: `<@${ticket.owner_id}>`, inline: true },
      { name: "Generated by", value: actorTag, inline: true },
      { name: "Transcript", value: transcript.filename, inline: false },
      { name: "Messages", value: String(transcript.count), inline: true }
    )
    .setTimestamp();

  await logChannel.send({
    embeds: [embed],
    files: [
      new AttachmentBuilder(
        Buffer.from(transcript.content, "utf8"),
        { name: transcript.filename }
      )
    ]
  });

  logEvent(
    ticket.id,
    "transcript",
    actorTag,
    `${transcript.count} messages uploaded to transcript channel`
  );

  return {
    filename: transcript.filename,
    count: transcript.count,
    delivered: true
  };
}

async function requireStaffForTicket(interaction, ticket) {
  const category = categoryByKey(ticket.category_key);

  if (!isStaff(interaction.member, category || { roleEnv: "" })) {
    await interaction.reply({
      content: "These ticket controls are available to authorized staff and administrators only.",
      flags: MessageFlags.Ephemeral
    });

    return false;
  }

  return true;
}

async function closeTicketForStaff(interaction, ticket) {
  const channel = await getTicketChannel(interaction.guild, ticket);

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  if (!channel) {
    return interaction.editReply("The original ticket channel could not be found.");
  }

  const botPermissions = channel.permissionsFor(interaction.guild.members.me);

  if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply(
      "I cannot close this ticket because the bot lacks **Manage Channels** in this server/channel. Grant the bot role Manage Channels and ensure the ticket category does not deny it, then try again."
    );
  }

  try {
    await channel.permissionOverwrites.edit(ticket.owner_id, {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true,
      AttachFiles: false,
      EmbedLinks: false
    });
  } catch (error) {
    console.error(`Could not lock ticket #${ticket.id}:`, error);

    return interaction.editReply(
      "I couldn't close this ticket because Discord rejected the permission change. Check the bot's Manage Channels permission and role hierarchy. The ticket remains open."
    );
  }

  db.prepare(`
    UPDATE tickets
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
    WHERE id = ? AND status = 'open'
  `).run(interaction.user.id, ticket.id);

  logEvent(
    ticket.id,
    "closed",
    interaction.user.id,
    "Closed by staff; channel retained for staff controls"
  );

  await refreshStaffControlPanel(interaction, ticket.id);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xD94F4F)
        .setTitle("🔒 Ticket Closed")
        .setDescription(
          `This ticket was closed by <@${interaction.user.id}>. Authorized staff can use the buttons on the original ticket message to reopen it, generate a transcript, or permanently delete it.`
        )
        .setTimestamp()
    ]
  }).catch(error => console.error("Could not post ticket-closed notice:", error));

  return interaction.editReply(
    `Ticket #${ticket.id} is closed. The channel remains available to staff. Use the buttons on the original ticket message for Transcript, Open, or Delete.`
  );
}

async function openTicketForStaff(interaction, ticket) {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  const channel = await getTicketChannel(interaction.guild, ticket);

  if (!channel) {
    return interaction.editReply("The original ticket channel could not be found.");
  }

  try {
    await channel.permissionOverwrites.edit(ticket.owner_id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });
  } catch (error) {
    console.error(`Could not reopen ticket #${ticket.id}:`, error);

    return interaction.editReply(
      "I couldn't reopen this ticket because Discord rejected the permission change. Check Manage Channels and the bot role hierarchy."
    );
  }

  db.prepare(`
    UPDATE tickets
    SET status = 'open', closed_at = NULL, closed_by = NULL
    WHERE id = ? AND status = 'closed'
  `).run(ticket.id);

  logEvent(ticket.id, "reopened", interaction.user.id, "Reopened by staff");

  await refreshStaffControlPanel(interaction, ticket.id);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3BA55D)
        .setTitle("🔓 Ticket Reopened")
        .setDescription(
          `This ticket was reopened by <@${interaction.user.id}>. The ticket creator can send messages again.`
        )
        .setTimestamp()
    ]
  }).catch(error => console.error("Could not post ticket-reopened notice:", error));

  return interaction.editReply(`Ticket #${ticket.id} has been reopened.`);
}

async function sendStaffTranscript(interaction, ticket) {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    const channel = await getTicketChannel(interaction.guild, ticket);

    if (!channel) {
      throw new Error("Original ticket channel not found");
    }

    const transcript = await createTranscriptAndDeliver(
      interaction.guild,
      channel,
      ticket,
      interaction.user.tag
    );

    return interaction.editReply(
      `Transcript **${transcript.filename}** uploaded to the transcript channel (${transcript.count} messages). No local transcript file was created.`
    );
  } catch (error) {
    console.error(
      `Transcript generation/delivery failed for ticket #${ticket.id}:`,
      error
    );

    return interaction.editReply(
      "Transcript upload failed. No local transcript file was saved. Check that the transcript channel is accessible and the bot has View Channel, Send Messages, and Attach Files permissions. The ticket has not been deleted."
    );
  }
}

async function askPermanentDeleteConfirmation(interaction, ticket) {
  return interaction.reply({
    content:
      `Permanently delete **Ticket #${ticket.id}**? ` +
      "The bot will upload a transcript to the transcript channel first. " +
      "If the upload fails, deletion will be cancelled. This action cannot be undone.",
    components: deleteConfirmationControls(ticket.id),
    flags: MessageFlags.Ephemeral
  });
}

async function permanentlyDeleteTicket(interaction, ticket) {
  await interaction.deferUpdate();

  const ticketChannel = await getTicketChannel(interaction.guild, ticket);

  if (!ticketChannel) {
    return interaction.editReply({
      content: "Original ticket channel not found; deletion cancelled.",
      components: []
    });
  }

  let transcript;

  try {
    transcript = await createTranscriptAndDeliver(
      interaction.guild,
      ticketChannel,
      ticket,
      interaction.user.tag
    );
  } catch (error) {
    console.error(
      `Transcript upload failed before deletion for ticket #${ticket.id}:`,
      error
    );

    return interaction.editReply({
      content:
        "Permanent deletion cancelled because the transcript could not be uploaded to the transcript channel. Check the bot's access and Attach Files permission for that channel.",
      components: []
    });
  }

  db.prepare(`
    UPDATE tickets
    SET status = 'deleted',
        closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
        closed_by = ?
    WHERE id = ?
  `).run(interaction.user.id, ticket.id);

  logEvent(
    ticket.id,
    "deleted",
    interaction.user.id,
    `Permanently deleted after transcript upload: ${transcript.filename}; messages=${transcript.count}`
  );

  await interaction.editReply({
    content:
      `Transcript **${transcript.filename}** was uploaded to the transcript channel ` +
      `(${transcript.count} messages). No local transcript file was created. ` +
      "Ticket channel will be permanently deleted in 5 seconds.",
    components: []
  }).catch(() => {});

  setTimeout(async () => {
    try {
      await ticketChannel.delete(
        `Ticket #${ticket.id} permanently deleted by ${interaction.user.tag} after transcript upload`
      );
    } catch (error) {
      console.error(
        `Could not permanently delete ticket channel ${ticketChannel.id}:`,
        error
      );
    }
  }, 5000);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Database ready. Ticket categories: ${categories.length}`);
  customCommands.processExpiredGiveaways(readyClient).catch(console.error);
  setInterval(() => customCommands.processExpiredGiveaways(readyClient).catch(console.error), 30_000);
  readyClient.user.setActivity("Vyuh Esports", { type: ActivityType.Watching });

  try {
    await registerUnifiedCommands();
  } catch (error) {
    console.error("Could not register unified slash commands:", error);
  }

  await syncControlsToExistingTicketMessages(
    readyClient.guilds.cache.get(GUILD_ID)
  ).catch(error => {
    console.error("Could not sync staff controls to existing tickets:", error);
  });
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    db.prepare(`INSERT INTO giveaway_message_counts (guild_id,user_id,message_count) VALUES (?,?,1)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET message_count=message_count+1`)
      .run(message.guild.id, message.author.id);
  } catch (error) {
    console.error("Giveaway message counter failed:", error);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await sendWelcome(member);
  } catch (error) {
    console.error("Welcome message failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: `Pong! ${client.ws.ping}ms`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "welcome") {
        const files = fs.existsSync(welcomeBannerPath())
          ? [
              new AttachmentBuilder(
                welcomeBannerPath(),
                { name: "vyuh-welcome-banner.png" }
              )
            ]
          : [];

        return interaction.reply({
          content: `Hi ${interaction.user}!`,
          embeds: [buildWelcomeEmbed()],
          files,
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "ticket-controls") {
        const ticket = db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ?")
          .get(interaction.channelId, interaction.guildId);
        if (!ticket) {
          return interaction.reply({
            content: "This command must be used inside an existing ticket channel.",
            flags: MessageFlags.Ephemeral
          });
        }
        const category = categoryByKey(ticket.category_key);
        if (!isStaff(interaction.member, category)) {
          return interaction.reply({
            content: "You do not have a configured ticket staff role for these controls.",
            flags: MessageFlags.Ephemeral
          });
        }
        return interaction.reply({
          content: `Private staff controls for ticket #${ticket.id}.`,
          components: staffTicketControls(ticket),
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "ticket-panel") {
        if (!isStaff(interaction.member, null)) {
          return interaction.reply({
            content:
              "You need one of the configured ticket staff roles to post the panel. Set TICKET_CONTROL_ROLE_IDS or SUPPORT_ROLE_ID in .env.",
            flags: MessageFlags.Ephemeral
          });
        }

        try {
          await interaction.channel.send({
            embeds: [panelEmbed()],
            components: panelComponents()
          });
        } catch (error) {
          console.error(
            "Could not post ticket panel. Check View Channel, Send Messages, and Embed Links in this channel:",
            error
          );

          return interaction.reply({
            content:
              "I couldn't post the panel in this channel. Please allow this bot View Channel, Send Messages, and Embed Links in the channel/category, then try again.",
            flags: MessageFlags.Ephemeral
          });
        }

        return interaction.reply({
          content: "Vyuh Esports ticket panel posted.",
          flags: MessageFlags.Ephemeral
        });
      }

      const handled = await customCommands.handleCustomCommand(interaction);
      if (handled !== false) return;
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("giveaway:")) {
      return customCommands.handleGiveawayButton(interaction);
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket:create"
    ) {
      const selected = categoryByKey(interaction.values[0]);

      if (!selected) {
        return interaction.reply({
          content: "That ticket category is not valid.",
          flags: MessageFlags.Ephemeral
        });
      }

      const existing = db.prepare(`
        SELECT * FROM tickets
        WHERE guild_id = ? AND owner_id = ? AND status = 'open'
        LIMIT 1
      `).get(interaction.guildId, interaction.user.id);

      if (existing) {
        const existingChannel = await interaction.guild.channels
          .fetch(existing.channel_id)
          .catch(() => null);

        if (existingChannel) {
          return interaction.reply({
            content: `You already have an open ticket: ${existingChannel}`,
            flags: MessageFlags.Ephemeral
          });
        }

        db.prepare(`
          UPDATE tickets
          SET status = 'closed', closed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(existing.id);
      }

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      // Load the server's roles before building permission overwrites.
      // Optional category-role variables may be blank or may contain an
      // outdated role ID; neither case should prevent ticket creation.
      await interaction.guild.roles.fetch();

      const staffRole = roleForCategory(interaction.guild, selected);

      const nextId = db.prepare(
        "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tickets"
      ).get().next_id;

      const channelName =
        safeChannelPart(interaction.user.username) || `ticket-${nextId}`;

      const configuredStaffRoleIds = [
        ...(staffRole ? [staffRole.id] : []),
        ...configuredTicketControlRoleIds(),
        ...(SUPPORT_ROLE_ID ? [SUPPORT_ROLE_ID] : [])
      ];

      // Discord.js requires role overwrite IDs to resolve to cached guild
      // roles. Ignore blank, deleted, or invalid optional role IDs.
      const staffRoleIds = new Set(
        configuredStaffRoleIds.filter(roleId => {
          const valid = interaction.guild.roles.cache.has(roleId);
          if (!valid) {
            console.warn(`[Tickets] Ignoring unknown/unavailable staff role ID: ${roleId}`);
          }
          return valid;
        })
      );

      const staffAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ];

      const overwrites = [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        ...[...staffRoleIds].map(roleId => ({
          id: roleId,
          allow: staffAllow
        }))
      ];

      const channelOptions = {
        name: channelName,
        type: ChannelType.GuildText,
        topic: `Ticket #${nextId} | ${selected.label} | Owner: ${interaction.user.tag}`,
        permissionOverwrites: overwrites,
        reason: `Ticket created by ${interaction.user.tag} (${selected.label})`
      };

      if (TICKET_CATEGORY_ID) {
        channelOptions.parent = TICKET_CATEGORY_ID;
      }

      const ticketChannel = await interaction.guild.channels.create(channelOptions);

      const result = db.prepare(`
        INSERT INTO tickets (guild_id, channel_id, owner_id, category_key, category_label)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        interaction.guildId,
        ticketChannel.id,
        interaction.user.id,
        selected.key,
        selected.label
      );

      const ticketId = Number(result.lastInsertRowid);

      logEvent(ticketId, "created", interaction.user.id, selected.label);

      const embed = new EmbedBuilder()
        .setColor(TICKET_COLOR)
        .setTitle(`${selected.emoji} ${selected.label}`)
        .setDescription(
          `Welcome <@${interaction.user.id}>. Staff will assist you here.\n\n` +
          "**Please provide the details below:**\n" +
          selected.questions
            .map((question, index) => `**${index + 1}.** ${question}`)
            .join("\n") +
          `\n\n**Ticket:** #${ticketId}`
        )
        .addFields(
          {
            name: "Ticket Creator",
            value: `<@${interaction.user.id}>`,
            inline: true
          },
          {
            name: "Assigned Team",
            value: staffRole ? `<@&${staffRole.id}>` : "Unassigned",
            inline: true
          }
        )
        .setFooter({ text: `${BRAND_NAME} | Support Division` })
        .setTimestamp();

      const createdTicket = db.prepare(
        "SELECT * FROM tickets WHERE id = ?"
      ).get(ticketId);

      await ticketChannel.send({
        content: `<@${interaction.user.id}>${staffRole ? ` <@&${staffRole.id}>` : ""}`,
        embeds: [embed],
        components: staffTicketControls(createdTicket)
      });

      const logChannel = await fetchLogChannel(interaction.guild);

      if (logChannel) {
        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(PANEL_COLOR)
              .setTitle(`Ticket #${ticketId} Created`)
              .addFields(
                {
                  name: "Category",
                  value: selected.label,
                  inline: true
                },
                {
                  name: "Owner",
                  value: `<@${interaction.user.id}>`,
                  inline: true
                },
                {
                  name: "Channel",
                  value: `${ticketChannel}`,
                  inline: true
                }
              )
              .setTimestamp()
          ]
        }).catch(console.error);
      }

      return interaction.editReply(
        `Your ticket has been created: ${ticketChannel}`
      );
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("ticket:staff:")
    ) {
      const match = interaction.customId.match(
        /^ticket:staff:(claim|close|open|transcript|delete|delete-confirm|delete-cancel):(\d+)$/
      );

      if (!match) return;

      const action = match[1];
      const ticketId = Number(match[2]);

      const ticket = db.prepare(
        "SELECT * FROM tickets WHERE id = ?"
      ).get(ticketId);

      if (!ticket || ticket.channel_id !== interaction.channelId) {
        return interaction.reply({
          content:
            "This ticket record does not match the current ticket or staff-control channel.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!await requireStaffForTicket(interaction, ticket)) return;

      if (action === "delete-cancel") {
        return interaction.update({
          content: "Permanent deletion cancelled. The ticket channel was not deleted.",
          components: []
        });
      }

      if (action === "delete") {
        if (ticket.status === "deleted") {
          return interaction.reply({
            content: "This ticket is already marked as deleted.",
            flags: MessageFlags.Ephemeral
          });
        }

        return askPermanentDeleteConfirmation(interaction, ticket);
      }

      if (action === "delete-confirm") {
        if (ticket.status === "deleted") {
          return interaction.update({
            content: "This ticket is already marked as deleted.",
            components: []
          });
        }

        return permanentlyDeleteTicket(interaction, ticket);
      }

      if (action === "transcript") {
        return sendStaffTranscript(interaction, ticket);
      }

      if (action === "close") {
        if (ticket.status !== "open") {
          return interaction.reply({
            content: "This ticket is already closed. Use Open to reopen it.",
            flags: MessageFlags.Ephemeral
          });
        }

        return closeTicketForStaff(interaction, ticket);
      }

      if (action === "open") {
        if (ticket.status !== "closed") {
          return interaction.reply({
            content: "Only a closed ticket can be reopened.",
            flags: MessageFlags.Ephemeral
          });
        }

        return openTicketForStaff(interaction, ticket);
      }

      if (action === "claim") {
        if (ticket.status !== "open") {
          return interaction.reply({
            content: "Only open tickets can be claimed.",
            flags: MessageFlags.Ephemeral
          });
        }

        if (ticket.claimed_by) {
          return interaction.reply({
            content: `This ticket has already been claimed by <@${ticket.claimed_by}>.`,
            flags: MessageFlags.Ephemeral
          });
        }

        db.prepare(`
          UPDATE tickets
          SET claimed_by = ?
          WHERE id = ? AND status = 'open' AND claimed_by IS NULL
        `).run(interaction.user.id, ticket.id);

        logEvent(ticket.id, "claimed", interaction.user.id, "Claimed by staff");

        await refreshStaffControlPanel(interaction, ticket.id);

        const logChannel = await fetchLogChannel(interaction.guild);

        if (logChannel) {
          await logChannel.send(
            `🎫 Ticket #${ticket.id} claimed by <@${interaction.user.id}> (<#${interaction.channelId}>).`
          ).catch(error => console.error("Claim notification failed:", error));
        }

        return interaction.reply({
          content: `You claimed Ticket #${ticket.id}.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message =
      "Something went wrong while handling that action. Check the bot console and configuration.";

    if (interaction.deferred) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

client.login(DISCORD_TOKEN);



// require("dotenv").config();

// const {
//   ActionRowBuilder,
//   AttachmentBuilder,
//   ButtonBuilder,
//   ButtonStyle,
//   ChannelType,
//   Client,
//   EmbedBuilder,
//   Events,
//   GatewayIntentBits,
//   MessageFlags,
//   PermissionFlagsBits,
//   REST,
//   Routes,
//   SlashCommandBuilder,
//   StringSelectMenuBuilder,
//   StringSelectMenuOptionBuilder
// } = require("discord.js");

// const fs = require("node:fs");
// const path = require("node:path");
// const db = require("./db");
// const categories = require("./categories");
// const welcomeConfig = require("./config");


// const {
//   DISCORD_TOKEN,
//   GUILD_ID,
//   CLIENT_ID,
//   WELCOME_CHANNEL_ID,
//   SUPPORT_ROLE_ID,
//   TICKET_LOG_CHANNEL_ID,
//   TICKET_CATEGORY_ID
// } = process.env;

// const BRAND_NAME = process.env.BRAND_NAME || "VYUH ESPORTS";
// const PANEL_COLOR = parseInt(process.env.PANEL_COLOR || "F5C842", 16);
// const TICKET_COLOR = parseInt(process.env.TICKET_COLOR || "2F3136", 16);

// if (!DISCORD_TOKEN) {
//   console.error("Missing DISCORD_TOKEN in .env");
//   process.exit(1);
// }
// if (!GUILD_ID || !CLIENT_ID) {
//   console.error("Missing GUILD_ID or CLIENT_ID in .env. Both are required to register the unified slash commands.");
//   process.exit(1);
// }
// if (!SUPPORT_ROLE_ID || !TICKET_LOG_CHANNEL_ID) {
//   console.warn("Ticket settings are incomplete. Welcome commands can work, but ticket features need SUPPORT_ROLE_ID and TICKET_LOG_CHANNEL_ID in .env.");
// }

// const client = new Client({
//   intents: [
//     GatewayIntentBits.Guilds,
//     GatewayIntentBits.GuildMembers,
//     GatewayIntentBits.GuildMessages,
//     GatewayIntentBits.MessageContent
//   ]
// });

// function welcomeBannerPath() {
//   return path.resolve(__dirname, "..", welcomeConfig.welcomeBanner || "./assets/vyuh-welcome-banner.png");
// }

// function buildWelcomeEmbed() {
//   let description = `${welcomeConfig.intro || ""}\n\n${welcomeConfig.intro2 || ""}\n\n`;
//   for (let i = 0; i < (welcomeConfig.sections || []).length; i++) {
//     const section = welcomeConfig.sections[i];
//     description += `**${section.heading}**\n${section.items.map(item => `› ${item}`).join("\n")}`;
//     if (i < welcomeConfig.sections.length - 1) description += "\n\n";
//   }

//   const embed = new EmbedBuilder()
//     .setColor(welcomeConfig.embedColor || 0xD4A72C)
//     .setTitle(`◈ ${welcomeConfig.title || "WELCOME TO VYUH ESPORTS"} ◈`)
//     .setDescription(description)
//     .setFooter({ text: welcomeConfig.footer || "TEAM VYUH ESPORTS" });

//   if (fs.existsSync(welcomeBannerPath())) embed.setImage("attachment://vyuh-welcome-banner.png");
//   return embed;
// }

// async function sendWelcome(member) {
//   if (!WELCOME_CHANNEL_ID) {
//     console.warn("WELCOME_CHANNEL_ID is not configured; skipping automatic welcome message.");
//     return;
//   }
//   const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
//   if (!channel || !channel.isTextBased()) {
//     console.error(`Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not text-based.`);
//     return;
//   }
//   const botMember = member.guild.members.me;
//   const effective = botMember ? channel.permissionsFor(botMember) : null;
//   const required = {
//     ViewChannel: PermissionFlagsBits.ViewChannel,
//     SendMessages: PermissionFlagsBits.SendMessages,
//     EmbedLinks: PermissionFlagsBits.EmbedLinks,
//     AttachFiles: PermissionFlagsBits.AttachFiles,
//     ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory
//   };
//   const permissionReport = Object.entries(required).map(([name, bit]) => ({
//     name,
//     allowed: Boolean(effective?.has(bit))
//   }));
//   console.log(`[Welcome] Channel ${channel.id} effective permissions:`,
//     permissionReport.map(p => `${p.name}=${p.allowed}`).join(", "));

//   if (!effective?.has(PermissionFlagsBits.ViewChannel) ||
//       !effective?.has(PermissionFlagsBits.SendMessages)) {
//     console.error(`[Welcome] Cannot send to #${channel.name}: View Channel or Send Messages is denied by the channel's effective permissions.`);
//     return;
//   }

//   const hasBanner = fs.existsSync(welcomeBannerPath());
//   const files = hasBanner
//     ? [new AttachmentBuilder(welcomeBannerPath(), { name: "vyuh-welcome-banner.png" })]
//     : [];

//   // Try the full branded message first. If Discord rejects embeds or attachments
//   // with Missing Permissions, fall back to an embed-only message, then plain text.
//   try {
//     await channel.send({ content: `Hi ${member}!`, embeds: [buildWelcomeEmbed()], files });
//     console.log(`[Welcome] Full welcome sent to #${channel.name}.`);
//     return;
//   } catch (fullError) {
//     console.error("[Welcome] Full embed/banner send failed:", {
//       code: fullError.code,
//       message: fullError.message,
//       effectivePermissions: permissionReport
//     });
//     if (fullError.code !== 50013) throw fullError;
//   }

//   try {
//     if (effective.has(PermissionFlagsBits.EmbedLinks)) {
//       await channel.send({ content: `Hi ${member}!`, embeds: [buildWelcomeEmbed()] });
//       console.warn(`[Welcome] Sent embed without banner to #${channel.name}; attachment permissions may be the issue.`);
//       return;
//     }
//   } catch (embedError) {
//     console.error("[Welcome] Embed-only fallback failed:", {
//       code: embedError.code,
//       message: embedError.message
//     });
//     if (embedError.code !== 50013) throw embedError;
//   }

//   await channel.send({ content: `Welcome to ${BRAND_NAME}, ${member}!` });
//   console.warn(`[Welcome] Sent plain-text fallback to #${channel.name}; embed/attachment permissions need checking.`);
// }

// function unifiedCommands() {
//   return [
//     new SlashCommandBuilder()
//       .setName("ticket-panel")
//       .setDescription("Post the Vyuh Esports ticket panel in this channel."),
//     new SlashCommandBuilder()
//       .setName("welcome")
//       .setDescription("Preview the Vyuh Esports welcome message."),
//     new SlashCommandBuilder()
//       .setName("ping")
//       .setDescription("Check whether the Vyuh Esports bot is online.")
//   ].map(command => command.toJSON());
// }

// async function registerUnifiedCommands() {
//   const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
//   await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: unifiedCommands() });
//   console.log(`Registered ${unifiedCommands().length} Vyuh Esports slash commands.`);
// }

// function roleForCategory(guild, category) {
//   if (!guild || !category || !category.roleEnv) return null;
//   const configuredId = process.env[category.roleEnv];
//   const roleId = configuredId || SUPPORT_ROLE_ID;
//   return roleId ? guild.roles.cache.get(roleId) || null : null;
// }

// function categoryByKey(key) {
//   return categories.find((category) => category.key === key);
// }

// function safeChannelPart(value) {
//   return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "member";
// }

// function panelEmbed() {
//   const embed = new EmbedBuilder()
//     .setColor(PANEL_COLOR)
//     .setTitle(`♛ ${BRAND_NAME} SUPPORT`)
//     .setDescription(
//       "**Need Assistance, Clashers ?**\n" +
//       "━━━━━━━━━━━━━━━━━━━━\n\n" +
//       "Open a ticket using the menu below and select the category that best fits your request.\n\n" +
//       categories.map((category) =>
//         `${category.emoji} **${category.label}**\n${category.description}`
//       ).join("\n\n") +
//       "\n\n━━━━━━━━━━━━━━━━━━━━\n*Our support team will respond as soon as possible.*"
//     )
//     .setFooter({ text: `TEAM ${BRAND_NAME}` });

//   return embed;
// }

// function panelComponents() {
//   const menu = new StringSelectMenuBuilder()
//     .setCustomId("ticket:create")
//     .setPlaceholder("Select Ticket Type...")
//     .setMinValues(1)
//     .setMaxValues(1)
//     .addOptions(
//       categories.map((category) =>
//         new StringSelectMenuOptionBuilder()
//           .setLabel(category.label)
//           .setDescription(category.description.slice(0, 100))
//           .setValue(category.key)
//           .setEmoji(category.emoji)
//       )
//     );

//   return [new ActionRowBuilder().addComponents(menu)];
// }

// function staffTicketControls(ticket) {
//   const buttons = [];
//   if (ticket.status === "open") {
//     buttons.push(
//       new ButtonBuilder()
//         .setCustomId(`ticket:staff:claim:${ticket.id}`)
//         .setLabel(ticket.claimed_by ? "Claimed" : "Claim")
//         .setEmoji("🙋")
//         .setStyle(ticket.claimed_by ? ButtonStyle.Secondary : ButtonStyle.Primary)
//         .setDisabled(Boolean(ticket.claimed_by)),
//       new ButtonBuilder()
//         .setCustomId(`ticket:staff:close:${ticket.id}`)
//         .setLabel("Close")
//         .setEmoji("🔒")
//         .setStyle(ButtonStyle.Danger)
//     );
//   } else {
//     buttons.push(
//       new ButtonBuilder()
//         .setCustomId(`ticket:staff:open:${ticket.id}`)
//         .setLabel("Open")
//         .setEmoji("🔓")
//         .setStyle(ButtonStyle.Success)
//     );
//   }

//   buttons.push(
//     new ButtonBuilder()
//       .setCustomId(`ticket:staff:transcript:${ticket.id}`)
//       .setLabel("Transcript")
//       .setEmoji("📄")
//       .setStyle(ButtonStyle.Secondary),
//     new ButtonBuilder()
//       .setCustomId(`ticket:staff:delete:${ticket.id}`)
//       .setLabel("Delete")
//       .setEmoji("⛔")
//       .setStyle(ButtonStyle.Danger)
//   );

//   // Discord allows up to five buttons per row. These controls are returned ephemerally
//   // by /ticket-controls, so ticket owners never see the staff-only buttons.
//   return [new ActionRowBuilder().addComponents(...buttons)];
// }

// function deleteConfirmationControls(ticketId) {
//   return [new ActionRowBuilder().addComponents(
//     new ButtonBuilder()
//       .setCustomId(`ticket:staff:delete-confirm:${ticketId}`)
//       .setLabel("Permanently Delete")
//       .setEmoji("⛔")
//       .setStyle(ButtonStyle.Danger),
//     new ButtonBuilder()
//       .setCustomId(`ticket:staff:delete-cancel:${ticketId}`)
//       .setLabel("Cancel")
//       .setStyle(ButtonStyle.Secondary)
//   )];
// }

// function logEvent(ticketId, eventType, actorId, details = "") {
//   db.prepare(`
//     INSERT INTO ticket_events (ticket_id, event_type, actor_id, details)
//     VALUES (?, ?, ?, ?)
//   `).run(ticketId, eventType, actorId, details);
// }

// function getTicketByChannel(channelId) {
//   return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
// }

// async function getTicketChannel(guild, ticket) {
//   return guild.channels.fetch(ticket.channel_id).catch(() => null);
// }

// function configuredTicketControlRoleIds() {
//   // Comma-separated Discord role IDs configured by the server owner in .env.
//   // This is intentionally independent of Discord's Administrator permission.
//   return (process.env.TICKET_CONTROL_ROLE_IDS || "")
//     .split(",")
//     .map(id => id.trim())
//     .filter(Boolean);
// }

// function memberRoleIds(member) {
//   if (!member) return [];
//   if (Array.isArray(member.roles)) return member.roles;
//   if (member.roles?.cache) return [...member.roles.cache.keys()];
//   return [];
// }

// function isStaff(member, category) {
//   const roleIds = memberRoleIds(member);
//   const allowedRoleIds = new Set(configuredTicketControlRoleIds());

//   // Backward-compatible fallbacks: the existing support role and the
//   // category-specific role are also explicitly configured custom roles.
//   if (SUPPORT_ROLE_ID) allowedRoleIds.add(SUPPORT_ROLE_ID);
//   const categoryRole = roleForCategory(member?.guild, category);
//   if (categoryRole?.id) allowedRoleIds.add(categoryRole.id);

//   // No implicit bypass for Discord's Administrator permission. Access is
//   // controlled only by the configured custom role IDs above.
//   return roleIds.some(roleId => allowedRoleIds.has(roleId));
// }


// async function refreshStaffControlPanel(interaction, ticketId) {
//   if (!interaction.message || !interaction.message.editable) return;
//   const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
//   if (!ticket) return;
//   try {
//     // Controls live on the original ticket-opening message. Preserve its embed;
//     // only update the buttons as the ticket moves between open/closed states.
//     await interaction.message.edit({ components: staffTicketControls(ticket) });
//   } catch (error) {
//     console.error(`Could not refresh staff control panel for Ticket #${ticketId}:`, error.message);
//   }
// }

// async function syncControlsToExistingTicketMessages(guild) {
//   if (!guild) {
//     console.error(`Could not sync existing ticket controls: server ${GUILD_ID} is not cached.`);
//     return;
//   }
//   // Add/update the control row on the original ticket-opening message for tickets
//   // created before this version. No extra channels or slash command are needed.
//   const tickets = db.prepare("SELECT * FROM tickets WHERE status IN ('open', 'closed')").all();
//   for (const ticket of tickets) {
//     try {
//       const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
//       if (!channel?.isTextBased()) continue;
//       const category = categoryByKey(ticket.category_key);
//       if (!category) continue;
//       const messages = await channel.messages.fetch({ limit: 50 });
//       const openingMessage = [...messages.values()]
//         .filter(message => message.author.id === client.user.id && message.embeds.length)
//         .find(message => message.embeds.some(embed => embed.title === `${category.emoji} ${ticket.category_label}`));
//       if (openingMessage) {
//         await openingMessage.edit({ components: staffTicketControls(ticket) });
//       }
//     } catch (error) {
//       console.error(`Could not attach staff controls to existing ticket #${ticket.id}:`, error.message);
//     }
//   }
// }

// async function fetchLogChannel(guild) {
//   const channel = await guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
//   if (!channel || !channel.isTextBased()) return null;
//   return channel;
// }

// async function writeTranscript(channel, ticket, closedBy) {
//   const lines = [
//     `${BRAND_NAME} — TICKET TRANSCRIPT`,
//     `Ticket: #${ticket.id}`,
//     `Channel: #${channel.name} (${channel.id})`,
//     `Owner: ${ticket.owner_id}`,
//     `Category: ${ticket.category_label}`,
//     `Created: ${ticket.created_at}`,
//     `Closed by: ${closedBy}`,
//     `Exported: ${new Date().toISOString()}`,
//     "=".repeat(72),
//     ""
//   ];

//   let before;
//   let collected = 0;
//   // Discord returns up to 100 messages per fetch. Cap at 1,000 to avoid runaway exports.
//   while (collected < 1000) {
//     const batch = await channel.messages.fetch({ limit: Math.min(100, 1000 - collected), ...(before ? { before } : {}) });
//     if (batch.size === 0) break;
//     const ordered = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
//     for (const message of ordered) {
//       const timestamp = new Date(message.createdTimestamp).toISOString();
//       const attachmentText = [...message.attachments.values()].map((a) => a.url).join(" ");
//       const embedText = message.embeds.map((e) => `[Embed: ${e.title || "untitled"}]`).join(" ");
//       lines.push(`[${timestamp}] ${message.author.tag} (${message.author.id}): ${message.content || ""}${attachmentText ? ` [Attachments: ${attachmentText}]` : ""}${embedText ? ` ${embedText}` : ""}`);
//     }
//     collected += batch.size;
//     // `ordered` is ascending, so its first message is the oldest in this batch.
//     before = ordered[0]?.id;
//     if (batch.size < 100 || !before) break;
//   }

//   const transcriptDir = path.resolve("./transcripts");
//   fs.mkdirSync(transcriptDir, { recursive: true });
//   const filename = `ticket-${ticket.id}.txt`;
//   const filepath = path.join(transcriptDir, filename);
//   fs.writeFileSync(filepath, lines.join("\n"), "utf8");
//   return { filename, filepath, count: collected };
// }

// async function createTranscriptAndDeliver(guild, channel, ticket, actorTag) {
//   const transcript = await writeTranscript(channel, ticket, actorTag);
//   let delivered = false;
//   const logChannel = await fetchLogChannel(guild);
//   if (logChannel) {
//     try {
//       const embed = new EmbedBuilder()
//         .setColor(ticket.status === "closed" ? 0xD94F4F : PANEL_COLOR)
//         .setTitle(`Ticket #${ticket.id} Transcript`)
//         .addFields(
//           { name: "Category", value: ticket.category_label, inline: true },
//           { name: "Owner", value: `<@${ticket.owner_id}>`, inline: true },
//           { name: "Generated by", value: actorTag, inline: true },
//           { name: "Transcript", value: transcript.filename, inline: false }
//         )
//         .setTimestamp();
//       await logChannel.send({
//         embeds: [embed],
//         files: [new AttachmentBuilder(transcript.filepath, { name: transcript.filename })]
//       });
//       delivered = true;
//     } catch (error) {
//       console.error(`Could not deliver transcript for ticket #${ticket.id} to log channel:`, error);
//     }
//   } else {
//     console.error(`Ticket log channel ${TICKET_LOG_CHANNEL_ID} is inaccessible. Transcript remains saved at ${transcript.filepath}`);
//   }
//   logEvent(ticket.id, "transcript", actorTag, `${transcript.count} messages saved to ${transcript.filepath}; delivered=${delivered}`);
//   return { ...transcript, delivered };
// }

// async function requireStaffForTicket(interaction, ticket) {
//   const category = categoryByKey(ticket.category_key);
//   if (!isStaff(interaction.member, category || { roleEnv: "" })) {
//     await interaction.reply({
//       content: "These ticket controls are available to authorized staff and administrators only.",
//       flags: MessageFlags.Ephemeral
//     });
//     return false;
//   }
//   return true;
// }

// async function closeTicketForStaff(interaction, ticket) {
//   const channel = await getTicketChannel(interaction.guild, ticket);
//   await interaction.deferReply({ flags: MessageFlags.Ephemeral });
//   if (!channel) return interaction.editReply("The original ticket channel could not be found.");
//   const botPermissions = channel.permissionsFor(interaction.guild.members.me);
//   if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
//     return interaction.editReply("I cannot close this ticket because the bot lacks **Manage Channels** in this server/channel. Grant the bot role Manage Channels and ensure the ticket category does not deny it, then try again.");
//   }
//   try {
//     // Lock only the ticket owner. Staff keep access so they can reopen, export, or delete it.
//     await channel.permissionOverwrites.edit(ticket.owner_id, {
//       ViewChannel: true,
//       SendMessages: false,
//       ReadMessageHistory: true,
//       AttachFiles: false,
//       EmbedLinks: false
//     });
//   } catch (error) {
//     console.error(`Could not lock ticket #${ticket.id}:`, error);
//     return interaction.editReply("I couldn't close this ticket because Discord rejected the permission change. Check the bot's Manage Channels permission and role hierarchy. The ticket remains open.");
//   }

//   db.prepare(`UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ? AND status = 'open'`)
//     .run(interaction.user.id, ticket.id);
//   logEvent(ticket.id, "closed", interaction.user.id, "Closed by staff; channel retained for staff controls");
//   await refreshStaffControlPanel(interaction, ticket.id);

//   await channel.send({
//     embeds: [new EmbedBuilder()
//       .setColor(0xD94F4F)
//       .setTitle("🔒 Ticket Closed")
//       .setDescription(`This ticket was closed by <@${interaction.user.id}>. Authorized staff can use the buttons on the original ticket message to reopen it, generate a transcript, or permanently delete it.`)
//       .setTimestamp()]
//   }).catch(error => console.error("Could not post ticket-closed notice:", error));
//   return interaction.editReply(`Ticket #${ticket.id} is closed. The channel remains available to staff. Use the buttons on the original ticket message for Transcript, Open, or Delete.`);
// }

// async function openTicketForStaff(interaction, ticket) {
//   await interaction.deferReply({ flags: MessageFlags.Ephemeral });
//   const channel = await getTicketChannel(interaction.guild, ticket);
//   if (!channel) return interaction.editReply("The original ticket channel could not be found.");
//   try {
//     await channel.permissionOverwrites.edit(ticket.owner_id, {
//       ViewChannel: true,
//       SendMessages: true,
//       ReadMessageHistory: true,
//       AttachFiles: true,
//       EmbedLinks: true
//     });
//   } catch (error) {
//     console.error(`Could not reopen ticket #${ticket.id}:`, error);
//     return interaction.editReply("I couldn't reopen this ticket because Discord rejected the permission change. Check Manage Channels and the bot role hierarchy.");
//   }
//   db.prepare(`UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ? AND status = 'closed'`).run(ticket.id);
//   logEvent(ticket.id, "reopened", interaction.user.id, "Reopened by staff");
//   await refreshStaffControlPanel(interaction, ticket.id);
//   await channel.send({
//     embeds: [new EmbedBuilder().setColor(0x3BA55D).setTitle("🔓 Ticket Reopened")
//       .setDescription(`This ticket was reopened by <@${interaction.user.id}>. The ticket creator can send messages again.`)
//       .setTimestamp()]
//   }).catch(error => console.error("Could not post ticket-reopened notice:", error));
//   return interaction.editReply(`Ticket #${ticket.id} has been reopened.`);
// }

// async function sendStaffTranscript(interaction, ticket) {
//   await interaction.deferReply({ flags: MessageFlags.Ephemeral });
//   try {
//     const channel = await getTicketChannel(interaction.guild, ticket);
//     if (!channel) throw new Error("Original ticket channel not found");
//     const transcript = await createTranscriptAndDeliver(interaction.guild, channel, ticket, interaction.user.tag);
//     return interaction.editReply(
//       `Transcript saved locally at transcripts/${transcript.filename}. ${transcript.delivered ? "A copy was uploaded to the transcript log channel." : "Discord delivery failed; the local copy is preserved. Check the bot console and log-channel permissions."}`
//     );
//   } catch (error) {
//     console.error(`Transcript generation failed for ticket #${ticket.id}:`, error);
//     return interaction.editReply("Transcript generation failed. The ticket has not been deleted. Check Read Message History and the PowerShell error.");
//   }
// }

// async function askPermanentDeleteConfirmation(interaction, ticket) {
//   return interaction.reply({
//     content: `Permanently delete **Ticket #${ticket.id}**? The bot will save a transcript locally first. This action cannot be undone.`,
//     components: deleteConfirmationControls(ticket.id),
//     flags: MessageFlags.Ephemeral
//   });
// }

// async function permanentlyDeleteTicket(interaction, ticket) {
//   await interaction.deferUpdate();
//   let transcript;
//   const ticketChannel = await getTicketChannel(interaction.guild, ticket);
//   if (!ticketChannel) return interaction.editReply({ content: "Original ticket channel not found; deletion cancelled.", components: [] });
//   try {
//     transcript = await createTranscriptAndDeliver(interaction.guild, ticketChannel, ticket, interaction.user.tag);
//   } catch (error) {
//     console.error(`Transcript generation failed before deletion for ticket #${ticket.id}:`, error);
//     return interaction.editReply({
//       content: "Permanent deletion cancelled because the transcript could not be saved. Check the bot's Read Message History permission and PowerShell output.",
//       components: []
//     });
//   }

//   db.prepare(`UPDATE tickets SET status = 'deleted', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), closed_by = ? WHERE id = ?`).run(interaction.user.id, ticket.id);
//   logEvent(ticket.id, "deleted", interaction.user.id, `Permanently deleted after transcript saved to ${transcript.filepath}; delivered=${transcript.delivered}`);
//   await interaction.editReply({
//     content: `Transcript saved locally at transcripts/${transcript.filename}. ${transcript.delivered ? "A copy was uploaded to the transcript log channel." : "The log upload failed, but the local transcript is preserved."} Ticket channel will be permanently deleted in 5 seconds.`,
//     components: []
//   }).catch(() => {});

//   const channel = ticketChannel;
//   setTimeout(async () => {
//     try {
//       await channel.delete(`Ticket #${ticket.id} permanently deleted by ${interaction.user.tag} after transcript creation`);
//     } catch (error) {
//       console.error(`Could not permanently delete ticket channel ${channel.id}:`, error);
//     }
//   }, 5000);
// }

// client.once(Events.ClientReady, async (readyClient) => {
//   console.log(`Logged in as ${readyClient.user.tag}`);
//   console.log(`Database ready. Ticket categories: ${categories.length}`);
//   try {
//     await registerUnifiedCommands();
//   } catch (error) {
//     console.error("Could not register unified slash commands:", error);
//   }
//   await syncControlsToExistingTicketMessages(readyClient.guilds.cache.get(GUILD_ID)).catch(error => {
//     console.error("Could not sync staff controls to existing tickets:", error);
//   });
// });

// client.on(Events.GuildMemberAdd, async (member) => {
//   try {
//     await sendWelcome(member);
//   } catch (error) {
//     console.error("Welcome message failed:", error);
//   }
// });

// client.on(Events.InteractionCreate, async (interaction) => {
//   try {
//     if (interaction.isChatInputCommand()) {
//       if (interaction.commandName === "ping") {
//         return interaction.reply({ content: `Pong! ${client.ws.ping}ms`, flags: MessageFlags.Ephemeral });
//       }
//       if (interaction.commandName === "welcome") {
//         const files = fs.existsSync(welcomeBannerPath())
//           ? [new AttachmentBuilder(welcomeBannerPath(), { name: "vyuh-welcome-banner.png" })]
//           : [];
//         return interaction.reply({
//           content: `Hi ${interaction.user}!`,
//           embeds: [buildWelcomeEmbed()],
//           files,
//           flags: MessageFlags.Ephemeral
//         });
//       }
//       if (interaction.commandName === "ticket-panel") {
//         if (!isStaff(interaction.member, null)) {
//           return interaction.reply({
//             content: "You need one of the configured ticket staff roles to post the panel. Set TICKET_CONTROL_ROLE_IDS or SUPPORT_ROLE_ID in .env.",
//             flags: MessageFlags.Ephemeral
//           });
//         }
//         try {
//           await interaction.channel.send({ embeds: [panelEmbed()], components: panelComponents() });
//         } catch (error) {
//           console.error("Could not post ticket panel. Check View Channel, Send Messages, and Embed Links in this channel:", error);
//           return interaction.reply({
//             content: "I couldn't post the panel in this channel. Please allow this bot View Channel, Send Messages, and Embed Links in the channel/category, then try again.",
//             flags: MessageFlags.Ephemeral
//           });
//         }
//         return interaction.reply({ content: "Vyuh Esports ticket panel posted.", flags: MessageFlags.Ephemeral });
//       }
//       return;
//     }

//     if (interaction.isStringSelectMenu() && interaction.customId === "ticket:create") {
//       const selected = categoryByKey(interaction.values[0]);
//       if (!selected) {
//         return interaction.reply({ content: "That ticket category is not valid.", flags: MessageFlags.Ephemeral });
//       }

//       const existing = db.prepare(`
//         SELECT * FROM tickets
//         WHERE guild_id = ? AND owner_id = ? AND status = 'open'
//         LIMIT 1
//       `).get(interaction.guildId, interaction.user.id);

//       if (existing) {
//         const existingChannel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
//         if (existingChannel) {
//           return interaction.reply({
//             content: `You already have an open ticket: ${existingChannel}`,
//             flags: MessageFlags.Ephemeral
//           });
//         }
//         db.prepare("UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
//       }

//       const staffRole = roleForCategory(interaction.guild, selected);
//       if (!staffRole) {
//         return interaction.reply({
//           content: `The staff role for **${selected.label}** is not configured correctly. Ask an administrator to check the bot settings.`,
//           flags: MessageFlags.Ephemeral
//         });
//       }

//       await interaction.deferReply({ flags: MessageFlags.Ephemeral });

//       const nextId = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tickets").get().next_id;
//       const channelName = safeChannelPart(interaction.user.username) || `ticket-${nextId}`;

//       const staffRoleIds = new Set([
//         staffRole.id,
//         ...configuredTicketControlRoleIds(),
//         ...(SUPPORT_ROLE_ID ? [SUPPORT_ROLE_ID] : [])
//       ]);
//       const staffAllow = [
//         PermissionFlagsBits.ViewChannel,
//         PermissionFlagsBits.SendMessages,
//         PermissionFlagsBits.ReadMessageHistory,
//         PermissionFlagsBits.AttachFiles,
//         PermissionFlagsBits.EmbedLinks
//       ];
//       const overwrites = [
//         {
//           id: interaction.guild.roles.everyone.id,
//           deny: [PermissionFlagsBits.ViewChannel]
//         },
//         {
//           id: interaction.user.id,
//           allow: [
//             PermissionFlagsBits.ViewChannel,
//             PermissionFlagsBits.SendMessages,
//             PermissionFlagsBits.ReadMessageHistory,
//             PermissionFlagsBits.AttachFiles,
//             PermissionFlagsBits.EmbedLinks
//           ]
//         },
//         {
//           id: interaction.client.user.id,
//           allow: [
//             PermissionFlagsBits.ViewChannel,
//             PermissionFlagsBits.SendMessages,
//             PermissionFlagsBits.ReadMessageHistory,
//             PermissionFlagsBits.ManageChannels,
//             PermissionFlagsBits.AttachFiles,
//             PermissionFlagsBits.EmbedLinks
//           ]
//         },
//         ...[...staffRoleIds].map(roleId => ({ id: roleId, allow: staffAllow }))
//       ];

//       const channelOptions = {
//         name: channelName,
//         type: ChannelType.GuildText,
//         topic: `Ticket #${nextId} | ${selected.label} | Owner: ${interaction.user.id}`,
//         permissionOverwrites: overwrites,
//         reason: `Ticket created by ${interaction.user.tag} (${selected.label})`
//       };
//       if (TICKET_CATEGORY_ID) channelOptions.parent = TICKET_CATEGORY_ID;

//       const ticketChannel = await interaction.guild.channels.create(channelOptions);
//       const result = db.prepare(`
//         INSERT INTO tickets (guild_id, channel_id, owner_id, category_key, category_label)
//         VALUES (?, ?, ?, ?, ?)
//       `).run(interaction.guildId, ticketChannel.id, interaction.user.id, selected.key, selected.label);
//       const ticketId = Number(result.lastInsertRowid);
//       logEvent(ticketId, "created", interaction.user.id, selected.label);

//       const embed = new EmbedBuilder()
//         .setColor(TICKET_COLOR)
//         .setTitle(`${selected.emoji} ${selected.label}`)
//         .setDescription(
//           `Welcome <@${interaction.user.id}>. Staff will assist you here.\n\n` +
//           `**Please provide the details below:**\n` +
//           selected.questions.map((question, index) => `**${index + 1}.** ${question}`).join("\n") +
//           `\n\n**Ticket:** #${ticketId}`
//         )
//         .addFields(
//           { name: "Ticket Creator", value: `<@${interaction.user.id}>`, inline: true },
//           { name: "Assigned Team", value: `<@&${staffRole.id}>`, inline: true }
//         )
//         .setFooter({ text: `${BRAND_NAME} | Support Division` })
//         .setTimestamp();

//       const createdTicket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
//       await ticketChannel.send({
//         content: `<@${interaction.user.id}> <@&${staffRole.id}>`,
//         embeds: [embed],
//         components: staffTicketControls(createdTicket)
//       });

//       // The controls are attached to the ticket's opening message in this same
//       // channel. Discord cannot hide message buttons by role; the handler below
//       // checks configured custom role IDs and rejects unauthorized clicks.

//       const logChannel = await fetchLogChannel(interaction.guild);
//       if (logChannel) {
//         await logChannel.send({
//           embeds: [
//             new EmbedBuilder()
//               .setColor(PANEL_COLOR)
//               .setTitle(`Ticket #${ticketId} Created`)
//               .addFields(
//                 { name: "Category", value: selected.label, inline: true },
//                 { name: "Owner", value: `<@${interaction.user.id}>`, inline: true },
//                 { name: "Channel", value: `${ticketChannel}`, inline: true }
//               )
//               .setTimestamp()
//           ]
//         }).catch(console.error);
//       }

//       return interaction.editReply(`Your ticket has been created: ${ticketChannel}`);
//     }

//     if (interaction.isButton() && interaction.customId.startsWith("ticket:staff:")) {
//       const match = interaction.customId.match(/^ticket:staff:(claim|close|open|transcript|delete|delete-confirm|delete-cancel):(\d+)$/);
//       if (!match) return;
//       const action = match[1];
//       const ticketId = Number(match[2]);
//       const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
//       if (!ticket || ticket.channel_id !== interaction.channelId) {
//         return interaction.reply({ content: "This ticket record does not match the current ticket or staff-control channel.", flags: MessageFlags.Ephemeral });
//       }
//       if (!await requireStaffForTicket(interaction, ticket)) return;

//       if (action === "delete-cancel") {
//         return interaction.update({ content: "Permanent deletion cancelled. The ticket channel was not deleted.", components: [] });
//       }
//       if (action === "delete") {
//         if (ticket.status === "deleted") {
//           return interaction.reply({ content: "This ticket is already marked as deleted.", flags: MessageFlags.Ephemeral });
//         }
//         return askPermanentDeleteConfirmation(interaction, ticket);
//       }
//       if (action === "delete-confirm") {
//         if (ticket.status === "deleted") {
//           return interaction.update({ content: "This ticket is already marked as deleted.", components: [] });
//         }
//         return permanentlyDeleteTicket(interaction, ticket);
//       }
//       if (action === "transcript") return sendStaffTranscript(interaction, ticket);
//       if (action === "close") {
//         if (ticket.status !== "open") {
//           return interaction.reply({ content: "This ticket is already closed. Use Open to reopen it.", flags: MessageFlags.Ephemeral });
//         }
//         return closeTicketForStaff(interaction, ticket);
//       }
//       if (action === "open") {
//         if (ticket.status !== "closed") {
//           return interaction.reply({ content: "Only a closed ticket can be reopened.", flags: MessageFlags.Ephemeral });
//         }
//         return openTicketForStaff(interaction, ticket);
//       }
//       if (action === "claim") {
//         if (ticket.status !== "open") {
//           return interaction.reply({ content: "Only open tickets can be claimed.", flags: MessageFlags.Ephemeral });
//         }
//         if (ticket.claimed_by) {
//           return interaction.reply({ content: `This ticket has already been claimed by <@${ticket.claimed_by}>.`, flags: MessageFlags.Ephemeral });
//         }
//         db.prepare("UPDATE tickets SET claimed_by = ? WHERE id = ? AND status = 'open' AND claimed_by IS NULL").run(interaction.user.id, ticket.id);
//         logEvent(ticket.id, "claimed", interaction.user.id, "Claimed by staff");
//         await refreshStaffControlPanel(interaction, ticket.id);
//         const logChannel = await fetchLogChannel(interaction.guild);
//         if (logChannel) {
//           await logChannel.send(`🎫 Ticket #${ticket.id} claimed by <@${interaction.user.id}> (<#${interaction.channelId}>).`)
//             .catch(error => console.error("Claim notification failed:", error));
//         }
//         return interaction.reply({ content: `You claimed Ticket #${ticket.id}.`, flags: MessageFlags.Ephemeral });
//       }
//     }
//   } catch (error) {
//     console.error("Interaction error:", error);
//     const message = "Something went wrong while handling that action. Check the bot console and configuration.";
//     if (interaction.deferred || interaction.replied) {
//       await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
//     } else {
//       await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
//     }
//   }
// });

// client.on(Events.Error, (error) => console.error("Discord client error:", error));
// process.on("unhandledRejection", (error) => console.error("Unhandled promise rejection:", error));

// client.login(DISCORD_TOKEN);