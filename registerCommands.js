const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
require("dotenv").config();

const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add points to the scoreboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove points from the scoreboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerGuildCommands(clientId, guildId) {
  if (!clientId || !guildId) throw new Error('CLIENT_ID and GUILD_ID are required');
  return rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}

async function registerGlobalCommands(clientId) {
  if (!clientId) throw new Error('CLIENT_ID is required');
  return rest.put(Routes.applicationCommands(clientId), { body: commands });
}

module.exports = { commands, registerGuildCommands, registerGlobalCommands };

// If executed directly (node registerCommands.js), register for env GUILD_ID
if (require.main === module) {
  (async () => {
    try {
      await registerGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
      console.log("Slash command registered");
    } catch (err) {
      console.error("Failed to register commands:", err);
      process.exit(1);
    }
  })();
}