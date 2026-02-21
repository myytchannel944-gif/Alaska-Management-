require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const {
    Client,
    GatewayIntentBits,
    Partials,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionsBitField,
    REST,
    Routes,
    StringSelectMenuBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message],
});

// ─── Configuration ────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const TICKET_STATE_PATH = path.join(__dirname, 'ticket-state.json');

const DEFAULT_CONFIG = {
    logChannel: null,
    staffRole: null,
    iaRole: null,
    mgmtRole: null,
};

let config = { ...DEFAULT_CONFIG };

async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf-8');
        config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Config load error:', err);
    }
}

async function saveConfig() {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

// ─── Constants ────────────────────────────────────────────
const BOT_OWNER_ID = '1205738144323080214';

// Foundership role: ONLY this role can use slash commands
const FOUNDERSHIP_ROLE_ID = '1472278188469125355';

// Blocked roles (cannot see tickets)
const BLOCKED_ROLE_IDS = [
    '1472280032574570616',
    '1472280229794943282'
];

const BOT_COLOR = 0x2b6cb0;
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const DASHBOARD_ICON = "https://image2url.com/r2/default/images/1771563774401-5dd69719-a2a9-42d7-a76e-c9028c62fe2f.jpg";
const TICKET_ROLE_ID = "1474234032677060795";
const TICKET_COOLDOWN_MS = 2 * 60 * 1000;
const TOKEN = process.env.TOKEN;
const PORT = Number(process.env.PORT) || 3000;

const ticketData = new Map();
const userLastTicketOpen = new Map();

const app = express();
app.get('/', (_, res) => res.status(200).send('ASRP bot is running'));
app.get('/health', (_, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        ready: client.isReady(),
    });
});

// ─── Helpers ──────────────────────────────────────────────
function isBotOwner(interaction) {
    return interaction.user.id === BOT_OWNER_ID;
}

function isFoundership(member) {
    return member.roles.cache.has(FOUNDERSHIP_ROLE_ID);
}

function getPingRole(department) {
    if (department === 'internal-affairs') return config.iaRole;
    if (department === 'management' || department === 'partnership') return config.mgmtRole;
    return config.staffRole;
}

function isSupportStaff(member) {
    if (!member) return false;
    const supportRoles = [config.staffRole, config.iaRole, config.mgmtRole].filter(Boolean);
    return supportRoles.some(roleId => member.roles.cache.has(roleId)) ||
           member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function findExistingTicket(guild, openerId) {
    for (const [channelId, data] of ticketData.entries()) {
        if (data.openerId !== openerId) continue;
        if (!guild.channels.cache.has(channelId)) {
            ticketData.delete(channelId);
            saveTicketState().catch(console.error);
            continue;
        }
        return channelId;
    }
    return null;
}

function formatSetupValue(value, type = 'id') {
    if (!value) return 'Not set';
    if (type === 'channel') return `<#${value}>`;
    if (type === 'role') return `<@&${value}>`;
    return value;
}

async function loadTicketState() {
    try {
        const raw = await fs.readFile(TICKET_STATE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        ticketData.clear();
        userLastTicketOpen.clear();

        for (const [channelId, data] of Object.entries(parsed.openTickets || {})) {
            if (data?.openerId && data?.startTime) ticketData.set(channelId, data);
        }
        for (const [userId, lastOpenedAt] of Object.entries(parsed.userLastTicketOpen || {})) {
            if (lastOpenedAt) userLastTicketOpen.set(userId, Number(lastOpenedAt));
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Ticket state load error:', err);
    }
}

async function saveTicketState() {
    try {
        const payload = {
            openTickets: Object.fromEntries(ticketData.entries()),
            userLastTicketOpen: Object.fromEntries(userLastTicketOpen.entries()),
        };
        await fs.writeFile(TICKET_STATE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.error('Ticket state save error:', err);
    }
}

async function pruneMissingTicketChannels() {
    let mutated = false;
    for (const channelId of ticketData.keys()) {
        if (!client.guilds.cache.some(g => g.channels.cache.has(channelId))) {
            ticketData.delete(channelId);
            mutated = true;
        }
    }
    if (mutated) await saveTicketState();
}

async function saveTranscript(channel) {
    try {
        const allMessages = [];
        let before;

        while (true) {
            const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => new Map());
            if (batch.size === 0) break;
            allMessages.push(...batch.values());
            before = batch.last()?.id;
        }

        const sorted = allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const limited = sorted.slice(-5000);

        const lines = limited.map(m => {
            const time = m.createdAt.toISOString().slice(0, 19).replace('T', ' ');
            const author = `${m.author.tag} (${m.author.id})`;
            let line = `[${time}] ${author}: ${m.content || '[No text]'}`;
            if (m.embeds.length) line += ` | Embeds: ${m.embeds.map(e => e.type || 'rich').join(', ')}`;
            if (m.attachments.size) line += ` | Attachments: ${[...m.attachments.values()].map(a => a.url).join(', ')}`;
            return line;
        });

        const safeName = channel.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const filename = `transcript-${safeName}-${Date.now()}.txt`;
        const filepath = path.join(__dirname, 'transcripts', filename);

        await fs.mkdir(path.join(__dirname, 'transcripts'), { recursive: true });
        await fs.writeFile(filepath, lines.join('\n') + '\n', 'utf-8');

        return { filename, filepath };
    } catch (err) {
        console.error('Transcript error:', err);
        return null;
    }
}

async function logTicketClose(interaction, data, transcriptInfo, closeReason = 'No reason provided') {
    if (!config.logChannel) return;
    const logChannel = interaction.guild.channels.cache.get(config.logChannel);
    if (!logChannel) return;

    const opener = await interaction.guild.members.fetch(data.openerId).catch(() => null);
    const claimedBy = data.claimedBy ? `<@${data.claimedBy}>` : 'Not claimed';
    const closer = interaction.user;

    const embed = new EmbedBuilder()
        .setTitle(`Ticket Closed: ${interaction.channel.name}`)
        .setColor(0xff5555)
        .addFields(
            { name: 'Opener', value: opener ? `${opener.user.tag} (${opener.id})` : data.openerId, inline: true },
            { name: 'Claimed by', value: claimedBy, inline: true },
            { name: 'Closed by', value: `${closer.tag} (${closer.id})`, inline: true },
            { name: 'Reason', value: closeReason, inline: false },
            { name: 'Department', value: data.department || '—', inline: true },
            { name: 'Created', value: `<t:${Math.floor(data.startTime / 1000)}:f>`, inline: true },
        )
        .setTimestamp();

    const files = transcriptInfo ? [{ attachment: transcriptInfo.filepath, name: transcriptInfo.filename }] : [];

    await logChannel.send({ embeds: [embed], files }).catch(console.error);
}

// ─── Interaction Handler ──────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    // Global restriction: ONLY Foundership role can use slash commands
    if (interaction.isChatInputCommand()) {
        if (!interaction.member.roles.cache.has(FOUNDERSHIP_ROLE_ID)) {
            return interaction.reply({
                content: "🚫 This bot is restricted to Foundership members only.",
                flags: MessageFlags.Ephemeral
            });
        }
    }

    try {
        // 1. DASHBOARD COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
            const embed = new EmbedBuilder()
                .setAuthor({ name: "ALASKA STATE ROLEPLAY • OFFICIAL DIRECTORY", iconURL: DASHBOARD_ICON })
                .setTitle("Dashboard")
                .setDescription(
                    "**Welcome to Alaska State RolePlay!**\n\n" +
                    "Welcome to the best ER:LC roleplay community. Here you will find all of the information needed to get started.\n\n" +
                    "Before participating, make sure you've read and understand our rules and application process.\n" +
                    "Use the menu below to navigate."
                )
                .setColor(BOT_COLOR)
                .setImage(DASHBOARD_ICON)
                .setTimestamp();

            const menu = new StringSelectMenuBuilder()
                .setCustomId('asrp_dashboard')
                .setPlaceholder('Select an option...')
                .addOptions([
                    { label: 'Staff Applications', value: 'staff_apps', description: 'Join the ASRP team', emoji: '📝' },
                    { label: 'In-Game Rules', value: 'ig_rules', description: 'ER:LC Penal Code', emoji: '🎮' },
                    { label: 'Discord Rules', value: 'dc_rules', description: 'Community Guidelines', emoji: '📜' },
                ]);

            const menuRow = new ActionRowBuilder().addComponents(menu);

            await interaction.channel.send({ embeds: [embed], components: [menuRow] });

            return interaction.reply({ content: "✅ Dashboard deployed.", flags: MessageFlags.Ephemeral });
        }

        // 2. DEPT DASHBOARD COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'deptdashboard') {
            const dashboardEmbed = new EmbedBuilder()
                .setTitle('🏔️ Alaska State Roleplay')
                .setDescription(
                    '━━━━━━━━━━━━━━━━━━\n**Departments Dashboard**\n━━━━━━━━━━━━━━━━━━\n\nSelect a department from the dropdown to get your invite and instructions.\n\n🚨 Professionalism is required\n📋 Follow all server rules\n⚠️ Abuse of roles will result in removal'
                )
                .setColor(5793266)
                .addFields(
                    { name: '🚓 Alaska State Troopers', value: '🟢 **OPEN**\nStatewide law enforcement. Handles highways, rural patrol, and major incidents.', inline: false },
                    { name: '🚧 Alaska Department of Transportation', value: '🟢 **OPEN**\nHandles traffic control, road work, and scene support.', inline: false },
                    { name: '🚔 Alaska Police Department', value: '🔴 **CLOSED**\nCurrently in development.', inline: false },
                    { name: '🚒 Alaska Fire Department', value: '🔴 **CLOSED**\nCurrently in development.', inline: false }
                )
                .setFooter({ text: 'Alaska State Roleplay • Departments System' })
                .setTimestamp();

            const departmentDropdown = new StringSelectMenuBuilder()
                .setCustomId('select_department')
                .setPlaceholder('Select a department...')
                .addOptions(
                    { label: 'Alaska State Troopers', value: 'ast', description: 'Join AST server', emoji: '🚓' },
                    { label: 'Alaska Department of Transportation', value: 'dot', description: 'Join DOT server', emoji: '🚧' },
                    { label: 'Alaska Police Department', value: 'apd', description: 'Currently in development', emoji: '🚔', disabled: true },
                    { label: 'Alaska Fire Department', value: 'afd', description: 'Currently in development', emoji: '🚒', disabled: true }
                );

            const dashboardRow = new ActionRowBuilder().addComponents(departmentDropdown);

            await interaction.channel.send({ embeds: [dashboardEmbed], components: [dashboardRow] });

            return interaction.reply({ content: "✅ Departments dashboard deployed.", flags: MessageFlags.Ephemeral });
        }

        // 3. DEPARTMENT DROPDOWN HANDLER (prevents "interaction failed")
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_department') {
            const value = interaction.values[0];

            let replyText = 'Unknown department selected.';

            switch (value) {
                case 'ast':
                    replyText = '✅ **Alaska State Troopers** is **OPEN**!\nJoin here: https://discord.gg/your-ast-invite-link';
                    break;
                case 'dot':
                    replyText = '✅ **Alaska Department of Transportation** is **OPEN**!\nJoin here: https://discord.gg/your-dot-invite-link';
                    break;
                case 'apd':
                    replyText = '🔴 **Alaska Police Department** is currently **CLOSED** / in development.';
                    break;
                case 'afd':
                    replyText = '🔴 **Alaska Fire Department** is currently **CLOSED** / in development.';
                    break;
            }

            return interaction.reply({ content: replyText, flags: MessageFlags.Ephemeral });
        }

        // 4. TICKET STATS
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketstats') {
            try {
                const openTickets = Array.from(ticketData.values());

                const byDepartment = openTickets.reduce((acc, ticket) => {
                    const dept = ticket.department || 'unknown';
                    acc[dept] = (acc[dept] || 0) + 1;
                    return acc;
                }, {});

                const deptLines = Object.entries(byDepartment)
                    .map(([dept, count]) => `• ${dept}: **${count}**`)
                    .join('\n') || '• none';

                const claimedCount = openTickets.filter(t => t.claimedBy).length;
                const unclaimedCount = openTickets.length - claimedCount;

                const embed = new EmbedBuilder()
                    .setColor(BOT_COLOR)
                    .setTitle('📊 Live Ticket Stats')
                    .setDescription('Current ticket queue and response status.')
                    .addFields(
                        { name: 'Open Tickets', value: `${openTickets.length}`, inline: true },
                        { name: 'Claimed', value: `${claimedCount}`, inline: true },
                        { name: 'Unclaimed', value: `${unclaimedCount}`, inline: true },
                        { name: 'By Department', value: deptLines, inline: false }
                    )
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } catch (statsErr) {
                console.error('Ticketstats command failed:', statsErr);
                return interaction.reply({ 
                    content: "❌ Failed to load ticket stats. Check bot logs for details.", 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }

        // 5. OWNER PANEL
        if (interaction.isChatInputCommand() && interaction.commandName === 'ownerpanel') {
            const code = interaction.options.getString('code', true);
            if (code !== OWNER_PANEL_CODE) {
                return interaction.reply({ content: "🚫 Invalid owner code.", flags: MessageFlags.Ephemeral });
            }

            const messageId = interaction.options.getString('message_id', true);
            const editType = interaction.options.getString('edit_type', true);
            const newContent = interaction.options.getString('new_content', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: "⚠️ Must be a text channel.", flags: MessageFlags.Ephemeral });
            }

            const message = await targetChannel.messages.fetch(messageId).catch(() => null);
            if (!message) return interaction.reply({ content: "⚠️ Message not found.", flags: MessageFlags.Ephemeral });
            if (message.author.id !== client.user.id) {
                return interaction.reply({ content: "⚠️ Can only edit bot messages.", flags: MessageFlags.Ephemeral });
            }

            try {
                if (editType === 'text') {
                    await message.edit({ content: newContent, embeds: [] });
                    return interaction.reply({ content: `✅ Text updated → ${message.url}`, flags: MessageFlags.Ephemeral });
                }

                if (editType === 'embed') {
                    let embedData;
                    try {
                        embedData = JSON.parse(newContent);
                    } catch {
                        return interaction.reply({
                            content: "❌ Invalid embed JSON.\nExample:\n```json\n{\"title\":\"Title\",\"description\":\"Desc\",\"color\":3447003}\n```",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    const newEmbed = new EmbedBuilder(embedData);
                    await message.edit({ content: null, embeds: [newEmbed] });
                    return interaction.reply({ content: `✅ Embed updated → ${message.url}`, flags: MessageFlags.Ephemeral });
                }
            } catch (err) {
                console.error('Edit failed:', err);
                return interaction.reply({ content: "❌ Edit failed (check JSON / permissions).", flags: MessageFlags.Ephemeral });
            }
        }

        // 6. SAY COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'say') {
            const message = interaction.options.getString('message', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: "⚠️ Must be a text channel.", flags: MessageFlags.Ephemeral });
            }

            await targetChannel.send({ content: message });
            return interaction.reply({ content: `✅ Sent in ${targetChannel}.`, flags: MessageFlags.Ephemeral });
        }

        // 7. EMBED BUILDER
        if (interaction.isChatInputCommand() && interaction.commandName === 'embedbuilder') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const jsonInput = interaction.options.getString('json', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel.type !== ChannelType.GuildText) {
                return interaction.editReply({ content: "⚠️ Target must be a text channel.", flags: MessageFlags.Ephemeral });
            }

            let embedData;
            try {
                embedData = JSON.parse(jsonInput);
            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                return interaction.editReply({
                    content: "❌ Invalid JSON format.\n\n**Example valid embed JSON:**\n```json\n" +
                             "{\n" +
                             "  \"title\": \"Test Title\",\n" +
                             "  \"description\": \"This is the main text\",\n" +
                             "  \"color\": 3447003,\n" +
                             "  \"fields\": [\n" +
                             "    { \"name\": \"Field 1\", \"value\": \"Value here\", \"inline\": true }\n" +
                             "  ],\n" +
                             "  \"footer\": { \"text\": \"Footer text\" },\n" +
                             "  \"thumbnail\": { \"url\": \"https://example.com/thumb.png\" },\n" +
                             "  \"image\": { \"url\": \"https://example.com/image.png\" }\n" +
                             "}\n```",
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                const embed = new EmbedBuilder(embedData);
                await targetChannel.send({ embeds: [embed] });
                return interaction.editReply({ content: `✅ Embed sent to ${targetChannel}`, flags: MessageFlags.Ephemeral });
            } catch (buildError) {
                console.error('Embed build/send error:', buildError);
                return interaction.editReply({
                    content: "❌ Failed to build/send embed.\nPossible issues: missing description, invalid color/URL, too many fields, etc.",
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // 8. SETUP COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            const logs = interaction.options.getChannel('logs');
            const staff = interaction.options.getRole('staff');
            const ia = interaction.options.getRole('ia_role');
            const mgmt = interaction.options.getRole('management_role');

            if (logs) config.logChannel = logs.id;
            if (staff) config.staffRole = staff.id;
            if (ia) config.iaRole = ia.id;
            if (mgmt) config.mgmtRole = mgmt.id;

            await saveConfig();

            const setupEmbed = new EmbedBuilder()
                .setColor(BOT_COLOR)
                .setTitle('Setup Updated')
                .addFields(
                    { name: 'Logs Channel', value: formatSetupValue(config.logChannel, 'channel'), inline: true },
                    { name: 'Staff Role',   value: formatSetupValue(config.staffRole, 'role'), inline: true },
                    { name: 'IA Role',      value: formatSetupValue(config.iaRole, 'role'), inline: true },
                    { name: 'Management Role', value: formatSetupValue(config.mgmtRole, 'role'), inline: true },
                )
                .setFooter({ text: `Ticket cooldown: ${Math.round(TICKET_COOLDOWN_MS / 1000)}s` });

            return interaction.reply({ embeds: [setupEmbed], flags: MessageFlags.Ephemeral });
        }

        // 9. TICKET PERSON ADD
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpersonadd') {
            const channel = interaction.channel;
            const data = ticketData.get(channel.id);

            if (!data) return interaction.reply({ content: "This is not a ticket channel.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;
            const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
            const isFoundership = member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!isClaimer && !isFoundership) {
                return interaction.reply({ content: "Only the claimer or Foundership can add users to this ticket.", flags: MessageFlags.Ephemeral });
            }

            const user = interaction.options.getUser('user', true);

            try {
                await channel.permissionOverwrites.edit(user.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                return interaction.reply({ content: `Added ${user} to this ticket.`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                console.error('Failed to add user:', err);
                return interaction.reply({ content: "Failed to add user. Check bot permissions.", flags: MessageFlags.Ephemeral });
            }
        }

        // 10. TICKET PERSON REMOVE
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpersonremove') {
            const channel = interaction.channel;
            const data = ticketData.get(channel.id);

            if (!data) return interaction.reply({ content: "This is not a ticket channel.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;
            const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
            const isFoundership = member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!isClaimer && !isFoundership) {
                return interaction.reply({ content: "Only the claimer or Foundership can remove users from this ticket.", flags: MessageFlags.Ephemeral });
            }

            const user = interaction.options.getUser('user', true);

            try {
                await channel.permissionOverwrites.delete(user.id);
                return interaction.reply({ content: `Removed ${user} from this ticket.`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                console.error('Failed to remove user:', err);
                return interaction.reply({ content: "Failed to remove user. Check bot permissions.", flags: MessageFlags.Ephemeral });
            }
        }

        // 11. DASHBOARD MENU RESPONSES
        if (interaction.isStringSelectMenu() && interaction.customId === 'asrp_dashboard') {
            const responses = {
                staff_apps: {
                    title: "📝 Staff Applications",
                    desc: "**Staff Team Applications**\n\n" +
                          "**🟢 Status: OPENED 🟢**\n\n" +
                          "We are currently accepting applications for:\n" +
                          "• Staff Team (Moderators, Helpers, Administrators)\n\n" +
                          "All applications are reviewed by management. Make sure you meet the requirements listed in #「🌸」·applications before applying.\n\n" +
                          "🔗 **Apply here:** " + ASRP_APPLICATION_LINK + "\n\n" +
                          "We look forward to potentially welcoming you to the team!"
                },
                ig_rules: {
                    title: "🎮 In-Game Rules (ER:LC RP Standards)",
                    desc: "**Alaska State RolePlay • In-Game Rules**\n\n" +
                          "These rules are in place to maintain serious, high-quality roleplay in Emergency Response: Liberty County.\n\n" +
                          "1. **Serious Roleplay Only**\n • No trolling, meme RP, fail RP, or unrealistic behavior.\n • All actions must be believable in a real-world emergency/civilian context.\n\n" +
                          "2. **Fear & New Life Rule (NLR)**\n • Value your life realistically — do not act fearless when weapons are drawn.\n • After death, you forget previous events for **15 minutes** and cannot return to the scene or seek revenge.\n\n" +
                          "3. **No RDM / VDM**\n • Random Deathmatch (killing without valid RP reason) = severe punishment.\n • Vehicle Deathmatch (running people over without RP) = same.\n\n" +
                          "4. **No Powergaming / Metagaming**\n • No forcing actions on others without consent.\n • No using out-of-character (OOC) information in-character.\n\n" +
                          "5. **No Exploits, Hacks, or Glitches**\n • Any form of cheating, bug abuse, or unfair advantage = permanent ban.\n\n" +
                          "6. **Realistic Interactions & Pursuits**\n • Proper use of radios, handcuffs, sirens, etc.\n • No cop baiting, excessive reckless driving without RP reason.\n • Criminals must commit crimes with buildup — no random mass chaos.\n\n" +
                          "7. **Department & Job Guidelines**\n • Follow chain of command and department protocols.\n • EMS must prioritize life-saving over arrests.\n • Police must have probable cause before searches/arrests.\n\n" +
                          "Violations → Warning → Kick → Temporary Ban → Permanent Ban (depending on severity).\nStaff decisions are final."
                },
                dc_rules: {
                    title: "📜 Discord Server Rules",
                    desc: "**Alaska State RolePlay • Discord Rules**\n\n" +
                          "Breaking any rule may result in warnings, mutes, kicks, or bans depending on severity.\n\n" +
                          "1. **Respect & No Toxicity**\n • No harassment, slurs, hate speech, bullying, or targeted attacks.\n • Zero tolerance for discrimination (race, gender, sexuality, religion, etc.).\n\n" +
                          "2. **No NSFW / Explicit Content**\n • No pornography, gore, suggestive images/text, or links.\n • Keep the server family-friendly (Roblox community).\n\n" +
                          "3. **No Spam / Flooding**\n • No excessive emojis, copypasta, caps spam, mention spam, or zalgo.\n • Use channels for their intended purpose.\n\n" +
                          "4. **No Advertising / Self-Promotion**\n • No unsolicited server invites, YouTube/TikTok/Instagram promo, or DM advertising.\n • Partnerships only through official management.\n\n" +
                          "5. **No Unnecessary Pings / Staff Abuse**\n • Do not ping @Staff, @here, @everyone without valid emergency.\n • False ticket opens or pings = punishment.\n\n" +
                          "6. **No Drama / Public Callouts**\n • Keep personal conflicts private — no public stirring or callouts.\n • Report issues to staff privately via tickets.\n\n" +
                          "7. **No Impersonation**\n • Do not pretend to be staff, fake ranks, or use misleading nicknames.\n\n" +
                          "8. **Follow Roblox & Discord ToS**\n • No ban evasion, doxxing, threats, illegal content, or sharing personal information.\n\n" +
                          "9. **English in Public Channels**\n • Main language is English — other languages allowed in appropriate or private channels.\n\n" +
                          "10. **Staff Instructions**\n • Follow directions from staff members.\n • Arguing with staff punishments may lead to further action.\n\n" +
                          "Use #appeals or open a ticket if you believe a punishment was unfair."
                }
            };

            const res = responses[interaction.values[0]];
            if (!res) return interaction.reply({ content: "Invalid option.", flags: MessageFlags.Ephemeral });

            const embed = new EmbedBuilder()
                .setTitle(res.title)
                .setDescription(res.desc)
                .setColor(BOT_COLOR)
                .setThumbnail(DASHBOARD_ICON)
                .setFooter({ text: "Alaska State RolePlay • Follow the rules!" });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // 12. TICKET CREATION
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!config.staffRole || !config.iaRole || !config.mgmtRole) {
                return interaction.editReply({ content: "⚠️ Run `/setup` first to configure roles.", flags: MessageFlags.Ephemeral });
            }

            const dept = interaction.values[0];
            const pingRoleId = getPingRole(dept);
            if (!pingRoleId) return interaction.editReply({ content: "⚠️ Department role not set.", flags: MessageFlags.Ephemeral });

            const existing = findExistingTicket(interaction.guild, interaction.user.id);
            if (existing) return interaction.editReply({ content: `⚠️ You already have a ticket: <#${existing}>`, flags: MessageFlags.Ephemeral });

            const lastOpen = userLastTicketOpen.get(interaction.user.id) || 0;
            const cooldownLeft = TICKET_COOLDOWN_MS - (Date.now() - lastOpen);
            if (cooldownLeft > 0) {
                return interaction.editReply({ content: `⏳ Wait ${Math.ceil(cooldownLeft / 1000)}s.`, flags: MessageFlags.Ephemeral });
            }

            await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

            const safeUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || interaction.user.id;

            let channel;
            try {
                const overwrites = [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: pingRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: FOUNDERSHIP_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ];

                BLOCKED_ROLE_IDS.forEach(roleId => {
                    overwrites.push({ id: roleId, deny: [PermissionsBitField.Flags.ViewChannel] });
                });

                channel = await interaction.guild.channels.create({
                    name: `ticket-${dept}-${safeUsername}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: overwrites,
                });
            } catch (err) {
                console.error('Channel creation failed:', err);
                return interaction.editReply({ content: "❌ Failed to create ticket channel.", flags: MessageFlags.Ephemeral });
            }

            ticketData.set(channel.id, {
                openerId: interaction.user.id,
                startTime: Date.now(),
                claimedBy: null,
                department: dept,
            });

            userLastTicketOpen.set(interaction.user.id, Date.now());
            await saveTicketState();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger),
            );

            await channel.send({
                content: `${interaction.user} | <@&${pingRoleId}>`,
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🏛️ ${dept.toUpperCase().replace('-', ' ')} Ticket`)
                        .setColor(BOT_COLOR)
                        .setImage(SUPPORT_BANNER)
                        .setDescription("Please describe your issue. A staff member will assist you soon.")
                ],
                components: [buttons],
            });

            return interaction.editReply({ content: `✅ Ticket created → ${channel}`, flags: MessageFlags.Ephemeral });
        }

        // 13. TICKET BUTTONS
        if (interaction.isButton()) {
            const channel = interaction.channel;
            const data = ticketData.get(channel.id);
            if (!data) return interaction.reply({ content: "Ticket no longer exists.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;

            const canManage = isSupportStaff(member) ||
                              member.roles.cache.has(FOUNDERSHIP_ROLE_ID) ||
                              (data.claimedBy && data.claimedBy === interaction.user.id);

            if (!canManage) {
                return interaction.reply({ content: "🚫 You don't have permission to manage this ticket.", flags: MessageFlags.Ephemeral });
            }

            await interaction.deferUpdate();

            if (interaction.customId === 'claim_ticket') {
                if (data.claimedBy) {
                    return interaction.followUp({ content: `Already claimed by <@${data.claimedBy}>.`, flags: MessageFlags.Ephemeral });
                }

                ticketData.set(channel.id, { ...data, claimedBy: interaction.user.id });
                await saveTicketState();

                const overwrites = [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: data.openerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: FOUNDERSHIP_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ];

                BLOCKED_ROLE_IDS.forEach(roleId => {
                    overwrites.push({ id: roleId, deny: [PermissionsBitField.Flags.ViewChannel] });
                });

                await channel.permissionOverwrites.set(overwrites);

                await interaction.message.edit({
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                    )]
                });

                await channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x43b581)
                        .setDescription(`✅ Claimed by ${interaction.user}`)]
                });
                return;
            }

            if (interaction.customId === 'close_ticket') {
                const canClose = (data.claimedBy && data.claimedBy === interaction.user.id) ||
                                 member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

                if (!canClose) {
                    return interaction.followUp({ content: "🚫 Only the claimer or Foundership can close this ticket.", flags: MessageFlags.Ephemeral });
                }

                const modal = new ModalBuilder()
                    .setCustomId('close_ticket_modal')
                    .setTitle('Close Ticket - Reason Required');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Why is this ticket being closed?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Enter reason here... (will be logged)');

                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

                await interaction.showModal(modal);
                return;
            }
        }

        // Handle modal submission for close reason
        if (interaction.isModalSubmit() && interaction.customId === 'close_ticket_modal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const channel = interaction.channel;
            const data = ticketData.get(channel.id);
            if (!data) return interaction.editReply({ content: "Ticket no longer exists.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;
            const canClose = (data.claimedBy && data.claimedBy === interaction.user.id) ||
                             member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!canClose) {
                return interaction.editReply({ content: "🚫 Permission lost. You can no longer close this ticket.", flags: MessageFlags.Ephemeral });
            }

            const closeReason = interaction.fields.getTextInputValue('close_reason').trim() || 'No reason provided';

            const transcript = await saveTranscript(channel);
            await logTicketClose(interaction, data, transcript, closeReason);

            const openerMember = await interaction.guild.members.fetch(data.openerId).catch(() => null);
            if (openerMember) await openerMember.roles.remove(TICKET_ROLE_ID).catch(() => {});

            await channel.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xff5555)
                    .setDescription(`Ticket being closed by ${interaction.user}.\n**Reason:** ${closeReason}`)]
            });

            ticketData.delete(channel.id);
            await saveTicketState();

            await interaction.editReply({ content: "Closing ticket...", flags: MessageFlags.Ephemeral });

            setTimeout(() => channel.delete().catch(console.error), 6000);
        }

        // /ticketpersonadd (only claimer or Foundership)
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpersonadd') {
            const channel = interaction.channel;
            const data = ticketData.get(channel.id);

            if (!data) return interaction.reply({ content: "This is not a ticket channel.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;
            const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
            const isFoundership = member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!isClaimer && !isFoundership) {
                return interaction.reply({ content: "Only the claimer or Foundership can add users to this ticket.", flags: MessageFlags.Ephemeral });
            }

            const user = interaction.options.getUser('user', true);

            try {
                await channel.permissionOverwrites.edit(user.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                return interaction.reply({ content: `Added ${user} to this ticket.`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                console.error('Failed to add user:', err);
                return interaction.reply({ content: "Failed to add user. Check bot permissions.", flags: MessageFlags.Ephemeral });
            }
        }

        // /ticketpersonremove (only claimer or Foundership)
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpersonremove') {
            const channel = interaction.channel;
            const data = ticketData.get(channel.id);

            if (!data) return interaction.reply({ content: "This is not a ticket channel.", flags: MessageFlags.Ephemeral });

            const member = interaction.member;
            const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
            const isFoundership = member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!isClaimer && !isFoundership) {
                return interaction.reply({ content: "Only the claimer or Foundership can remove users from this ticket.", flags: MessageFlags.Ephemeral });
            }

            const user = interaction.options.getUser('user', true);

            try {
                await channel.permissionOverwrites.delete(user.id);
                return interaction.reply({ content: `Removed ${user} from this ticket.`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                console.error('Failed to remove user:', err);
                return interaction.reply({ content: "Failed to remove user. Check bot permissions.", flags: MessageFlags.Ephemeral });
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.deferred && !interaction.replied) {
            interaction.reply({ content: "An error occurred.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

// ─── Events ───────────────────────────────────────────────
client.on('channelDelete', async (channel) => {
    if (ticketData.has(channel.id)) {
        ticketData.delete(channel.id);
        await saveTicketState();
    }
});

client.once('clientReady', async () => {
    await loadConfig();
    await loadTicketState();
    await pruneMissingTicketChannels();

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('dashboard').setDescription('Deploy main dashboard panel'),
        new SlashCommandBuilder().setName('deptdashboard').setDescription('Deploy departments dashboard (Foundership only)'),
        new SlashCommandBuilder().setName('ticketstats').setDescription('View ticket stats (admin)'),
        new SlashCommandBuilder()
            .setName('ownerpanel')
            .setDescription('Edit bot messages (owner)')
            .addStringOption(o => o.setName('code').setDescription('Owner code').setRequired(true))
            .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
            .addStringOption(o => o.setName('edit_type').setDescription('text or embed').setRequired(true)
                .addChoices(
                    { name: 'Plain Text', value: 'text' },
                    { name: 'Embed (JSON)', value: 'embed' }
                ))
            .addStringOption(o => o.setName('new_content').setDescription('New content or JSON').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel (optional)')),
        new SlashCommandBuilder()
            .setName('say')
            .setDescription('Send message as bot (owner)')
            .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel (optional)')),
        new SlashCommandBuilder()
            .setName('embedbuilder')
            .setDescription('Build and send custom embed from JSON (owner only)')
            .addStringOption(o => o.setName('json').setDescription('Full embed JSON').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel to send to (optional)')),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configure ticket system')
            .addChannelOption(o => o.setName('logs').setDescription('Log channel').setRequired(false))
            .addRoleOption(o => o.setName('staff').setDescription('Staff role').setRequired(false))
            .addRoleOption(o => o.setName('ia_role').setDescription('IA role').setRequired(false))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role').setRequired(false)),
        new SlashCommandBuilder()
            .setName('ticketpersonadd')
            .setDescription('Add a user to this ticket (claimer or Foundership only)')
            .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
        new SlashCommandBuilder()
            .setName('ticketpersonremove')
            .setDescription('Remove a user from this ticket (claimer or Foundership only)')
            .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),
    ];

    try {
        const guildId = process.env.GUILD_ID;
        if (!guildId) {
            console.log("⚠️ GUILD_ID not set in .env — skipping command registration");
        } else {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            console.log(`✅ Registered ${commands.length} guild-specific commands in ${guildId}`);
        }
    } catch (err) {
        console.error('Command registration failed:', err);
    }

    console.log(`✅ ${client.user.tag} online`);
});

if (!TOKEN) throw new Error('Missing TOKEN');

client.login(TOKEN);

app.listen(PORT, () => console.log(`Health check on port ${PORT}`));
