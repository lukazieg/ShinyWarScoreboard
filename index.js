const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const fs = require("fs");
require("dotenv").config();

const express = require('express');
const app = express();

// Health check configuration
const HEALTH_PORT = process.env.HEALTH_PORT || 3000;
const HEALTH_HOST = process.env.HEALTH_HOST || '127.0.0.1';
let lastHealthCheck = new Date().toISOString();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), lastHealthCheck });
});

function healthCheck() {
  lastHealthCheck = new Date().toISOString();
  console.log(`[health] ${lastHealthCheck} - status: OK`);
}

// Log an initial health check immediately, then every 4 minutes
healthCheck();
setInterval(healthCheck, 4 * 60 * 1000);

app.listen(HEALTH_PORT, HEALTH_HOST, () => {
  console.log(`Health endpoint available at http://${HEALTH_HOST}:${HEALTH_PORT}/health`);
});

let scoreboard = JSON.parse(
  fs.readFileSync("./scoreboard.json", "utf8")
);

// Migrate legacy keys (teamA/teamB) to new team keys (nyancat/bocchi)
if (typeof scoreboard.teamA !== 'undefined' || typeof scoreboard.teamB !== 'undefined') {
  scoreboard.nyancat = scoreboard.nyancat ?? scoreboard.teamA ?? 0;
  scoreboard.bocchi = scoreboard.bocchi ?? scoreboard.teamB ?? 0;
  delete scoreboard.teamA;
  delete scoreboard.teamB;
  fs.writeFileSync("./scoreboard.json", JSON.stringify(scoreboard, null, 2));
} 

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// temporary per-user storage for confirmation dialog
const pendingSelections = new Map();

client.on("interactionCreate", async interaction => {
  // Slash command
  if (interaction.isChatInputCommand()) {
    if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "Only server administrators can use this command.", ephemeral: true });
    }

    if (interaction.commandName === "add") {

      const teamSelect = new StringSelectMenuBuilder()
        .setCustomId("selectTeam")
        .setPlaceholder("Select a team")
        .addOptions([
          { label: "NyanCat", value: "nyancat" },
          { label: "Bocchi", value: "bocchi" }
        ]);

      await interaction.reply({
        content: "Choose a team to add points to:",
        components: [new ActionRowBuilder().addComponents(teamSelect)],
        ephemeral: true
      });

    } else if (interaction.commandName === "remove") {
      // show a team select for removal
      const teamSelect = new StringSelectMenuBuilder()
        .setCustomId("selectTeamRemove")
        .setPlaceholder("Select a team to remove points from")
        .addOptions([
          { label: "NyanCat", value: "nyancat" },
          { label: "Bocchi", value: "bocchi" }
        ]);

      await interaction.reply({
        content: "Choose a team to remove points from:",
        components: [new ActionRowBuilder().addComponents(teamSelect)],
        ephemeral: true
      });
    }
  }

  // Team select menu chosen → show points select menu or process points selection
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "selectTeam") {
      const teamValue = interaction.values[0];
      const label = teamValue === "nyancat" ? "NyanCat" : "Bocchi";

      const pointsSelect = new StringSelectMenuBuilder()
        .setCustomId(`selectPoints|${teamValue}`)
        .setPlaceholder("Select points option")
        .addOptions([
          { label: "5x Horde", value: "horde5", description: "counts as 1 point" },
          { label: "3x Horde", value: "horde3", description: "counts as 2 points" },
          { label: "Single", value: "single", description: "counts as 6 points" },
          { label: "Fishing", value: "fishing", description: "counts as 4 points" },
          { label: "Feebas", value: "feebas", description: "counts as 5 points" },
          { label: "Safari Failed", value: "safari failed", description: "counts as 1 points" },
          { label: "Safari Caught", value: "safari caught", description: "counts as 7 points" },
          { label: "Honey Tree", value: "honey tree", description: "counts as 8 points" },
          { label: "Fossil", value: "fossil", description: "counts as 10 points" },
          { label: "Egg", value: "egg", description: "counts as 12 points" },
          { label: "Egg Alpha", value: "egg alpha", description: "counts as 20 points" },
          { label: "Wild Alpha", value: "wild alpha", description: "counts as 35 points" },
          { label: "Legendary", value: "legendary", description: "counts as 45 points" }
        
        ]);

      await interaction.update({
        content: `Selected **${label}** — choose points:`,
        components: [new ActionRowBuilder().addComponents(pointsSelect)]
      });

    } else if (interaction.customId === "selectTeamRemove") {
      // user chose a team for removal — show a modal to enter points to remove
      const teamValue = interaction.values[0];
      const label = teamValue === "nyancat" ? "NyanCat" : "Bocchi";

      const modal = new ModalBuilder()
        .setCustomId(`modalRemove|${teamValue}`)
        .setTitle(`Remove points from ${label}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('pointsToRemove')
              .setLabel('Points to remove')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a positive integer')
              .setRequired(true)
          )
        );

      await interaction.showModal(modal);

    } else if (interaction.customId && interaction.customId.startsWith("selectPoints|")) {
      // Instead of applying immediately, show a flags dialog and allow confirmation
      const teamValue = interaction.customId.split("|")[1];
      const label = teamValue === "nyancat" ? "NyanCat" : "Bocchi";
      const option = interaction.values[0];

      const map = { horde5: 1, horde3: 2, single: 6, fishing: 4, feebas: 5, "safari failed": 1, "safari caught": 7, "honey tree": 8, "fossil": 10, "egg": 12, "egg alpha": 20, "wild alpha": 35, "legendary": 45 };
      const readable = { horde5: "5x Horde", horde3: "3x Horde", single: "Single", fishing: "Fishing", feebas: "Feebas", "safari failed": "Safari Failed", "safari caught": "Safari Caught", "honey tree": "Honey Tree", "fossil": "Fossil", "egg": "Egg", "egg alpha": "Egg Alpha", "wild alpha": "Wild Alpha", "legendary": "Legendary" };

      const base = map[option] ?? 0;

      // store pending selection with base and option
      const existing = pendingSelections.get(interaction.user.id) || {};
      pendingSelections.set(interaction.user.id, { team: teamValue, flags: existing.flags || [], base, option: readable[option] });

      // Toggle buttons simulate checkboxes — show selected state using style/emoji
      const secretBtn = new ButtonBuilder()
        .setCustomId(`toggleFlag|secret|${teamValue}`)
        .setLabel(existing.flags && existing.flags.includes('secret') ? '✅ Secret Shiny (+3)' : 'Secret Shiny (+3)')
        .setStyle(existing.flags && existing.flags.includes('secret') ? ButtonStyle.Success : ButtonStyle.Secondary);
      const lureBtn = new ButtonBuilder()
        .setCustomId(`toggleFlag|lure|${teamValue}`)
        .setLabel(existing.flags && existing.flags.includes('lure') ? '✅ Lure Exclusive (+1)' : 'Lure Exclusive (+1)')
        .setStyle(existing.flags && existing.flags.includes('lure') ? ButtonStyle.Success : ButtonStyle.Secondary);

      const confirmButton = new ButtonBuilder().setCustomId(`confirmAdd|${teamValue}`).setLabel('Confirm Add').setStyle(ButtonStyle.Success);
      const cancelButton = new ButtonBuilder().setCustomId(`cancelAdd|${teamValue}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);

      const existingFlags = (existing.flags && existing.flags.length) ? existing.flags.map(f => (f === 'secret' ? 'Secret Shiny' : 'Lure Exclusive')).join(', ') : 'none';

      await interaction.update({
        content: `You selected **${label} - ${readable[option]}** (base ${base}). Toggle optional flags then press Confirm or Cancel. Current flags: **${existingFlags}**`,
        components: [
          new ActionRowBuilder().addComponents(secretBtn, lureBtn),
          new ActionRowBuilder().addComponents(confirmButton, cancelButton)
        ]
      });
    }
  }

  // Button handlers (toggle flags, confirm, cancel)
  if (interaction.isButton()) {
    if (interaction.customId && interaction.customId.startsWith("toggleFlag|")) {
      const [, flag, teamValue] = interaction.customId.split("|");
      const existing = pendingSelections.get(interaction.user.id) || {};
      existing.flags = existing.flags || [];
      if (existing.flags.includes(flag)) {
        existing.flags = existing.flags.filter(f => f !== flag);
      } else {
        existing.flags.push(flag);
      }
      pendingSelections.set(interaction.user.id, existing);

      const secretBtn = new ButtonBuilder().setCustomId(`toggleFlag|secret|${teamValue}`).setLabel(existing.flags.includes('secret') ? '✅ Secret Shiny (+3)' : 'Secret Shiny (+3)').setStyle(existing.flags.includes('secret') ? ButtonStyle.Success : ButtonStyle.Secondary);
      const lureBtn = new ButtonBuilder().setCustomId(`toggleFlag|lure|${teamValue}`).setLabel(existing.flags.includes('lure') ? '✅ Lure Exclusive (+1)' : 'Lure Exclusive (+1)').setStyle(existing.flags.includes('lure') ? ButtonStyle.Success : ButtonStyle.Secondary);
      const confirmBtn = new ButtonBuilder().setCustomId(`confirmAdd|${teamValue}`).setLabel('Confirm Add').setStyle(ButtonStyle.Success);
      const cancelBtn = new ButtonBuilder().setCustomId(`cancelAdd|${teamValue}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);

      const flagsText = (existing.flags && existing.flags.length) ? existing.flags.map(f => (f === 'secret' ? 'Secret Shiny (+3)' : 'Lure Exclusive (+1)')).join(', ') : 'none';
      await interaction.update({
        content: `Flags selected: **${flagsText}** — press Confirm to apply or Cancel to abort.`,
        components: [new ActionRowBuilder().addComponents(secretBtn, lureBtn), new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)]
      });
      return;
    }

    if (interaction.customId && interaction.customId.startsWith("confirmAdd|")) {
      const teamValue = interaction.customId.split("|")[1];
      const label = teamValue === "nyancat" ? "NyanCat" : "Bocchi";
      const existing = pendingSelections.get(interaction.user.id);
      if (!existing || existing.team !== teamValue) {
        return interaction.update({ content: "No pending selection to confirm.", components: [] });
      }
      const base = existing.base || 0;
      const flags = existing.flags || [];
      let bonus = 0;
      if (flags.includes('secret')) bonus += 3;
      if (flags.includes('lure')) bonus += 1;
      const total = base + bonus;
      scoreboard[teamValue] = (scoreboard[teamValue] || 0) + total;
      fs.writeFileSync("./scoreboard.json", JSON.stringify(scoreboard, null, 2));

      try {
        const channel = await client.channels.fetch(process.env.SCOREBOARD_CHANNEL_ID);
        await updateScoreboardMessage(channel);
      } catch (err) {
        console.error("Failed to update scoreboard after confirm:", err);
        return interaction.update({ content: "Failed to update scoreboard message (see logs).", components: [] });
      }

      pendingSelections.delete(interaction.user.id);
      const flagDesc = (flags && flags.length) ? flags.map(f => (f === 'secret' ? 'Secret Shiny' : 'Lure Exclusive')).join(', ') : 'none';
      return interaction.update({ content: `Added **${total}** points to **${label}** (base ${base}, flags: ${flagDesc}).`, components: [] });
    } else if (interaction.customId && interaction.customId.startsWith("cancelAdd|")) {
      pendingSelections.delete(interaction.user.id);
      return interaction.update({ content: `Canceled pending addition.`, components: [] });
    }
  }

  // Modal submit handlers (remove)
  if (interaction.isModalSubmit()) {
    if (interaction.customId && interaction.customId.startsWith("modalRemove|")) {
      const teamValue = interaction.customId.split("|")[1];
      const label = teamValue === "nyancat" ? "NyanCat" : "Bocchi";
      const valueStr = (interaction.fields.getTextInputValue('pointsToRemove') || '').trim();
      const requested = parseInt(valueStr, 10);
      if (isNaN(requested) || requested <= 0) {
        return interaction.reply({ content: "Please enter a valid positive integer.", ephemeral: true });
      }
      const current = scoreboard[teamValue] || 0;
      const actualRemoved = Math.min(requested, current);
      scoreboard[teamValue] = Math.max(0, current - requested);
      fs.writeFileSync("./scoreboard.json", JSON.stringify(scoreboard, null, 2));

      try {
        const channel = await client.channels.fetch(process.env.SCOREBOARD_CHANNEL_ID);
        await updateScoreboardMessage(channel);
      } catch (err) {
        console.error("Failed to update scoreboard after removal:", err);
        return interaction.reply({ content: "Failed to update scoreboard message (see logs).", ephemeral: true });
      }

      return interaction.reply({ content: `Removed **${actualRemoved}** points from **${label}**. New total: **${scoreboard[teamValue]}**.`, ephemeral: true });
    }
  }

});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(process.env.SCOREBOARD_CHANNEL_ID);
  try {
    await updateScoreboardMessage(channel);
    console.log("Scoreboard message ensured");
  } catch (err) {
    console.error("Failed to ensure scoreboard message on ready:", err);
  }
});

async function updateScoreboardMessage(channel) {
  try {
    if (!scoreboard.messageId) {
      const msg = await channel.send({ embeds: [createScoreboardEmbed()] });
      scoreboard.messageId = msg.id;
      fs.writeFileSync("./scoreboard.json", JSON.stringify(scoreboard, null, 2));
      return;
    }

    try {
      const msg = await channel.messages.fetch(scoreboard.messageId);
      await msg.edit({ embeds: [createScoreboardEmbed()] });
    } catch (err) {
      // message not found, recreate
      const msg = await channel.send({ embeds: [createScoreboardEmbed()] });
      scoreboard.messageId = msg.id;
      fs.writeFileSync("./scoreboard.json", JSON.stringify(scoreboard, null, 2));
    }
  } catch (err) {
    console.error("Failed to update scoreboard message:", err);
    throw err;
  }
}

function createScoreboardEmbed() {
  const ny = scoreboard.nyancat || 0;
  const bo = scoreboard.bocchi || 0;
  const total = Math.max(1, ny + bo);

  // Render digits using normal ASCII digits (no Unicode) and sanitize input
  function fullWidth(num) {
    // Normalize: remove whitespace and common zero-width characters, and strip any non-digits (except '-')
    return String(num).replace(/[\s\u200B\uFEFF\u2060]/g, '').replace(/[^\d\-]/g, '');
  }

  // Simple wide progress bar (uses block characters)
  function progressBar(value, len = 20) {
    const filled = Math.round((value / total) * len);
    return '█'.repeat(filled) + '░'.repeat(Math.max(0, len - filled));
  }

  const nyValue = `**${fullWidth(ny)}**\n${progressBar(ny, 24)}\n(${Math.round((ny / total) * 100)}%)`;
  const boValue = `**${fullWidth(bo)}**\n${progressBar(bo, 24)}\n(${Math.round((bo / total) * 100)}%)`;

  return new EmbedBuilder()
    .setTitle('🏆 SCOREBOARD')
    .setDescription(`**Current Standings**\n\n\n\n`)
    .addFields(
      { name: "😼 NyanCats", value: nyValue, inline: true },
      { name: "🎩 The Butler Cafe", value: boValue, inline: true }
    )
    .setColor(0x2f3136)
    .setFooter({ text: `Big view — updated ${new Date().toLocaleString()}` })
    .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);
