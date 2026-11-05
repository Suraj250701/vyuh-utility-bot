require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const customCommands = require("./custom-commands");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName("ticket-panel").setDescription("Post the Vyuh Esports ticket panel in this channel."),
  new SlashCommandBuilder().setName("ticket-controls").setDescription("Open private staff controls for the ticket in this channel."),
  new SlashCommandBuilder().setName("welcome").setDescription("Preview the Vyuh Esports welcome message."),
  new SlashCommandBuilder().setName("ping").setDescription("Check whether the Vyuh Esports bot is online."),
  ...customCommands.commands
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    if (!GUILD_ID) {
      throw new Error("Missing GUILD_ID in .env. Guild-scoped registration is required for immediate command updates.");
    }
    // Use one scope only. Clear any previously registered global copies,
    // then replace the complete guild command set (removing stale duplicates).
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Registered ${commands.length} guild-scoped commands; global duplicates cleared.`);
  } catch (error) {
    console.error("Could not register unified commands:", error);
    process.exitCode = 1;
  }
})();
