require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_APP_CHANNEL_ID = process.env.STAFF_APP_CHANNEL_ID;

const db = new sqlite3.Database('./data.db', (err) => {
    if (err) console.error('SQLite error:', err);
});

db.run(`CREATE TABLE IF NOT EXISTS bot_data (
    key TEXT PRIMARY KEY,
    value TEXT
)`);

function saveMessageId(id) {
    db.run(`INSERT OR REPLACE INTO bot_data(key, value) VALUES(?, ?)`, ['staffAppMessageId', id]);
}

function loadMessageId(callback) {
    db.get(`SELECT value FROM bot_data WHERE key = ?`, ['staffAppMessageId'], (err, row) => {
        if (err) console.error(err);
        callback(row ? row.value : null);
    });
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

let staffAppMessageId = null;
loadMessageId((id) => { staffAppMessageId = id; });

function getStaffEmbed(isOpen) {
    if (isOpen) {
        return {
            title: "📝 Staff Application",
            description: "🟢 **Staff Applications are Open**",
            color: 0x57F287,
            fields: [{ name: "⚠️ Agreement", value: "- Do **not ping anyone**.\n- Applications **will be reviewed within 24 hours**.\n- Ignoring this rule may delay or deny your application." }],
            footer: { text: "Alaska Management – Fill out the form carefully." }
        };
    } else {
        return {
            title: "📝 Staff Application",
            description: "🔴 **Staff Applications are Closed**",
            color: 0xE74C3C,
            fields: [{ name: "Notice", value: "Staff applications are currently closed. Check back later." }],
            footer: { text: "Alaska Management – Thank you for your interest." }
        };
    }
}

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    const commands = [
        { name: 'staffopen', description: 'Open staff applications' },
        { name: 'staffclose', description: 'Close staff applications' }
    ];

    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('Slash commands registered!');
    } catch (err) {
        console.error('Failed to register commands:', err);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const channel = interaction.guild.channels.cache.get(STAFF_APP_CHANNEL_ID);
    if (!channel) return interaction.reply({ content: "Staff application channel not found.", ephemeral: true });

    try {
        if (interaction.commandName === 'staffopen') {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setLabel("Submit Application").setStyle(ButtonStyle.Link)
                        .setURL("https://melon.ly/form/7429303261795979264")
                );

            if (staffAppMessageId) {
                const message = await channel.messages.fetch(staffAppMessageId).catch(() => null);
                if (message) { await message.edit({ embeds: [getStaffEmbed(true)], components: [row] }); return interaction.reply({ content: "Staff Application is now open! ✅", ephemeral: true }); }
            }

            const sentMessage = await channel.send({ embeds: [getStaffEmbed(true)], components: [row] });
            staffAppMessageId = sentMessage.id;
            saveMessageId(staffAppMessageId);
            return interaction.reply({ content: "Staff Application is now open! ✅", ephemeral: true });
        }

        if (interaction.commandName === 'staffclose') {
            if (!staffAppMessageId) return interaction.reply({ content: "No staff application message found to close.", ephemeral: true });

            const message = await channel.messages.fetch(staffAppMessageId).catch(() => null);
            if (message) { await message.edit({ embeds: [getStaffEmbed(false)], components: [] }); return interaction.reply({ content: "Staff Application is now closed. 🔴", ephemeral: true }); }
            return interaction.reply({ content: "Could not find the message to close.", ephemeral: true });
        }
    } catch (err) { console.error(err); }
});

client.login(BOT_TOKEN).catch(err => console.error('Login failed:', err));
