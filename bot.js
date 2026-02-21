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

// ─── Constants & Owner Protection ─────────────────────────
const BOT_OWNER_ID = '1205738144323080214';

const BOT_COLOR = 0x2b6cb0;
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const DASHBOARD_ICON = "https://image2url.com/r2/default/images/1771563774401-5dd69719-a2a9-42d7-a76e-c9028c62fe2f.jpg";
const TICKET_ROLE_ID = "1474234032677060795";
const TICKET_COOLDOWN_MS = 2 * 60 * 1000;
const ERLC_GAME_LINK = 'https://www.roblox.com/games/2534724415/Emergency-Response-Liberty-County';
const ASRP_APPLICATION_LINK = 'https://melonly.xyz/forms/7429303261795979264';
const OWNER_PANEL_CODE = process.env.OWNER_PANEL_CODE || '6118';
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
        let exists = client.guilds.cache.some(g => g.channels.cache.has(channelId));
        if (!exists) {
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

async function logTicketClose(interaction, data, transcriptInfo) {
    if (!config.logChannel) return;
    const logChannel = interaction.guild.channels.cache.get(config.logChannel);
    if (!logChannel) return;

    const opener = await interaction.guild.members.fetch(data.openerId).catch(() => null);
    const claimedBy = data.claimedBy ? `<@${data.claimedBy}>` : 'Not claimed';

    const embed = new EmbedBuilder()
        .setTitle(`Ticket Closed: ${interaction.channel.name}`)
        .setColor(0xff5555)
        .addFields(
            { name: 'Opener', value: opener ? `${opener.user.tag} (${opener.id})` : data.openerId, inline: true },
            { name: 'Claimed by', value: claimedBy, inline: true },
            { name: 'Department', value: data.department || '—', inline: true },
            { name: 'Created', value: `<t:${Math.floor(data.startTime / 1000)}:f>`, inline: true },
        )
        .setTimestamp();

    const files = transcriptInfo ? [{ attachment: transcriptInfo.filepath, name: transcriptInfo.filename }] : [];

    await logChannel.send({ embeds: [embed], files }).catch(console.error);
}

// ─── Interaction Handler ──────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu() && !interaction.isButton()) return;

    try {
        // 1. DASHBOARD COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }

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

            await interaction.channel.send({
                embeds: [embed],
                components: [menuRow],
            });

            return interaction.reply({ content: "✅ Dashboard deployed.", ephemeral: true });
        }

        // 2. TICKET STATS
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketstats') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }

            const openTickets = Array.from(ticketData.values());
            const byDepartment = openTickets.reduce((acc, t) => {
                acc[t.department || 'unknown'] = (acc[t.department || 'unknown'] || 0) + 1;
                return acc;
            }, {});

            const deptLines = Object.entries(byDepartment)
                .map(([d, c]) => `• ${d}: **${c}**`)
                .join('\n') || '• none';

            const claimedCount = openTickets.filter(t => t.claimedBy).length;

            const embed = new EmbedBuilder()
                .setColor(BOT_COLOR)
                .setTitle('📊 Live Ticket Stats')
                .setDescription('Current ticket queue and response status.')
                .addFields(
                    { name: 'Open Tickets', value: openTickets.length, inline: true },
                    { name: 'Claimed', value: claimedCount, inline: true },
                    { name: 'Unclaimed', value: openTickets.length - claimedCount, inline: true },
                    { name: 'By Department', value: deptLines }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // 3. OWNER PANEL (text or embed editing)
        if (interaction.isChatInputCommand() && interaction.commandName === 'ownerpanel') {
            if (!isBotOwner(interaction)) {
                return interaction.reply({ content: "🚫 Owner-only command.", ephemeral: true });
            }

            const code = interaction.options.getString('code', true);
            if (code !== OWNER_PANEL_CODE) {
                return interaction.reply({ content: "🚫 Invalid owner code.", ephemeral: true });
            }

            const messageId = interaction.options.getString('message_id', true);
            const editType = interaction.options.getString('edit_type', true);
            const newContent = interaction.options.getString('new_content', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: "⚠️ Must be a text channel.", ephemeral: true });
            }

            const message = await targetChannel.messages.fetch(messageId).catch(() => null);
            if (!message) return interaction.reply({ content: "⚠️ Message not found.", ephemeral: true });
            if (message.author.id !== client.user.id) {
                return interaction.reply({ content: "⚠️ Can only edit bot messages.", ephemeral: true });
            }

            try {
                if (editType === 'text') {
                    await message.edit({ content: newContent, embeds: [] });
                    return interaction.reply({ content: `✅ Text updated → ${message.url}`, ephemeral: true });
                }

                if (editType === 'embed') {
                    let embedData;
                    try {
                        embedData = JSON.parse(newContent);
                    } catch {
                        return interaction.reply({
                            content: "❌ Invalid embed JSON.\nExample:\n```json\n{\"title\":\"Title\",\"description\":\"Desc\",\"color\":3447003}\n```",
                            ephemeral: true
                        });
                    }
                    const newEmbed = new EmbedBuilder(embedData);
                    await message.edit({ content: null, embeds: [newEmbed] });
                    return interaction.reply({ content: `✅ Embed updated → ${message.url}`, ephemeral: true });
                }
            } catch (err) {
                console.error('Edit failed:', err);
                return interaction.reply({ content: "❌ Edit failed (check JSON / permissions).", ephemeral: true });
            }
        }

        // 4. SAY COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'say') {
            if (!isBotOwner(interaction)) {
                return interaction.reply({ content: "🚫 Owner-only command.", ephemeral: true });
            }

            const message = interaction.options.getString('message', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel?.type !== ChannelType.GuildText) {
                return interaction.reply({ content: "⚠️ Must be a text channel.", ephemeral: true });
            }

            await targetChannel.send({ content: message });
            return interaction.reply({ content: `✅ Sent in ${targetChannel}.`, ephemeral: true });
        }

        // 5. EMBED BUILDER
        if (interaction.isChatInputCommand() && interaction.commandName === 'embedbuilder') {
            if (!isBotOwner(interaction)) {
                return interaction.reply({ content: "🚫 Owner-only command.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const jsonInput = interaction.options.getString('json', true);
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel.type !== ChannelType.GuildText) {
                return interaction.editReply({ content: "⚠️ Target must be a text channel." });
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
                             "}\n```"
                });
            }

            try {
                const embed = new EmbedBuilder(embedData);
                await targetChannel.send({ embeds: [embed] });
                return interaction.editReply({ content: `✅ Embed sent to ${targetChannel}` });
            } catch (buildError) {
                console.error('Embed build/send error:', buildError);
                return interaction.editReply({
                    content: "❌ Failed to build/send embed.\nPossible issues: missing description, invalid color/URL, too many fields, etc."
                });
            }
        }

        // 6. SETUP COMMAND + panel
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }

            config.logChannel = interaction.options.getChannel('logs')?.id ?? config.logChannel;
            config.staffRole   = interaction.options.getRole('staff')?.id ?? config.staffRole;
            config.iaRole      = interaction.options.getRole('ia_role')?.id ?? config.iaRole;
            config.mgmtRole    = interaction.options.getRole('management_role')?.id ?? config.mgmtRole;

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

            const panelEmbed = new EmbedBuilder()
                .setTitle("Assistance")
                .setDescription(
                    "Welcome to the **Assistance Dashboard**!\n" +
                    "Here you can easily open a ticket for various types of support.\n\n" +
                    "**Trolling or abuse of the ticket system may result in punishment.**\n\n" +
                    "👤 **General Support**\n• General Inquiries • Reports • Concerns\n\n" +
                    "🤝 **Partnership Support**\n• Partnership & affiliation requests\n\n" +
                    "🛡️ **Internal Affairs Support**\n• Staff reports • Appeals • Role requests\n\n" +
                    "🛠️ **Management Support**\n• Giveaways • High-rank inquiries • Purchases"
                )
                .setColor(BOT_COLOR)
                .setImage(SUPPORT_BANNER);

            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_type')
                .setPlaceholder('Request Assistance...')
                .addOptions([
                    { label: 'General Support', value: 'general', emoji: '👤' },
                    { label: 'Partnership Support', value: 'partnership', emoji: '🤝' },
                    { label: 'Internal Affairs', value: 'internal-affairs', emoji: '🛡️' },
                    { label: 'Management Support', value: 'management', emoji: '🛠️' },
                ]);

            await interaction.channel.send({
                embeds: [panelEmbed],
                components: [new ActionRowBuilder().addComponents(menu)],
            });

            return interaction.reply({ content: "✅ Assistance panel deployed.", embeds: [setupEmbed], ephemeral: true });
        }

        // 7. DASHBOARD MENU RESPONSES
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
            if (!res) return interaction.reply({ content: "Invalid option.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(res.title)
                .setDescription(res.desc)
                .setColor(BOT_COLOR)
                .setThumbnail(DASHBOARD_ICON)
                .setFooter({ text: "Alaska State RolePlay • Follow the rules!" });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // 8. TICKET CREATION
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
            await interaction.deferReply({ ephemeral: true });

            if (!config.staffRole || !config.iaRole || !config.mgmtRole) {
                return interaction.editReply("⚠️ Run `/setup` first to configure roles.");
            }

            const dept = interaction.values[0];
            const pingRoleId = getPingRole(dept);
            if (!pingRoleId) return interaction.editReply("⚠️ Department role not set.");

            const existing = findExistingTicket(interaction.guild, interaction.user.id);
            if (existing) return interaction.editReply(`⚠️ You already have a ticket: <#${existing}>`);

            const lastOpen = userLastTicketOpen.get(interaction.user.id) || 0;
            const cooldownLeft = TICKET_COOLDOWN_MS - (Date.now() - lastOpen);
            if (cooldownLeft > 0) {
                return interaction.editReply(`⏳ Wait ${Math.ceil(cooldownLeft / 1000)}s.`);
            }

            await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

            const safeUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || interaction.user.id;

            let channel;
            try {
                channel = await interaction.guild.channels.create({
                    name: `ticket-${dept}-${safeUsername}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: pingRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    ],
                });
            } catch (err) {
                console.error('Channel creation failed:', err);
                return interaction.editReply("❌ Failed to create ticket channel.");
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

            return interaction.editReply(`✅ Ticket created → ${channel}`);
        }

        // 9. TICKET BUTTONS
        if (interaction.isButton()) {
            const data = ticketData.get(interaction.channel.id);
            if (!data) return interaction.reply({ content: "Ticket no longer exists.", ephemeral: true });

            if (!isSupportStaff(interaction.member)) {
                return interaction.reply({ content: "🚫 Only support staff can manage tickets.", ephemeral: true });
            }

            await interaction.deferUpdate();

            if (interaction.customId === 'claim_ticket') {
                if (data.claimedBy) {
                    return interaction.followUp({ content: `Already claimed by <@${data.claimedBy}>.`, ephemeral: true });
                }

                ticketData.set(interaction.channel.id, { ...data, claimedBy: interaction.user.id });
                await saveTicketState();

                await interaction.message.edit({
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                    )]
                });

                await interaction.channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x43b581)
                        .setDescription(`✅ Claimed by ${interaction.user}`)]
                });
                return;
            }

            if (interaction.customId === 'close_ticket') {
                if (data.claimedBy && data.claimedBy !== interaction.user.id) {
                    return interaction.followUp({ content: "🚫 Only the claiming staff can close this ticket.", ephemeral: true });
                }

                const transcript = await saveTranscript(interaction.channel);
                await logTicketClose(interaction, data, transcript);

                const member = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                if (member) await member.roles.remove(TICKET_ROLE_ID).catch(() => {});

                await interaction.followUp({
                    content: transcript ? "📑 Closing... (transcript saved)" : "📑 Closing... (transcript failed)",
                    ephemeral: true
                });

                ticketData.delete(interaction.channel.id);
                await saveTicketState();

                setTimeout(() => interaction.channel.delete().catch(console.error), 6000);
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.deferred && !interaction.replied) {
            interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
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

client.once('ready', async () => {
    await loadConfig();
    await loadTicketState();
    await pruneMissingTicketChannels();

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('dashboard').setDescription('Deploy dashboard panel'),
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
            .addChannelOption(o => o.setName('logs').setDescription('Log channel'))
            .addRoleOption(o => o.setName('staff').setDescription('Staff role'))
            .addRoleOption(o => o.setName('ia_role').setDescription('IA role'))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role')),
    ];

    try {
        const guildId = process.env.GUILD_ID;
        if (!guildId) {
            console.log("⚠️ GUILD_ID not set in .env → no commands registered");
            return;
        }

        // Register ONLY in the specified guild (prevents global duplicates)
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: commands }
        );

        console.log(`✅ Registered ${commands.length} guild-specific commands in ${guildId}`);
    } catch (err) {
        console.error('Command registration failed:', err);
    }

    console.log(`✅ ${client.user.tag} online`);
});

if (!TOKEN) throw new Error('Missing TOKEN');

client.login(TOKEN);

app.listen(PORT, () => console.log(`Health check on port ${PORT}`));
