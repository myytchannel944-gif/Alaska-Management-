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
const BOT_OWNER_ID = '1205738144323080214'; // ← Your Discord ID

const BOT_COLOR = 0x2b6cb0;
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const DASHBOARD_ICON = "https://image2url.com/r2/default/images/1771563774401-5dd69719-a2a9-42d7-a76e-c9028c62fe2f.jpg";
const TICKET_ROLE_ID = "1474234032677060795"; // consider moving to .env or config
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

// ─── Helper Functions ─────────────────────────────────────
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
        } else {
            return channelId;
        }
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
        // 1. DASHBOARD COMMAND (admin only)
        if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }
            // ... (rest unchanged - dashboard embed + menu + buttons)
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
                    { label: 'Departments', value: 'departments', description: 'ASRP teams & support flow', emoji: '🏢' },
                    { label: 'Quick Links', value: 'quick_links', description: 'Useful ER:LC resources', emoji: '🔗' },
                ]);

            const linksRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Play ER:LC').setStyle(ButtonStyle.Link).setURL(ERLC_GAME_LINK),
                new ButtonBuilder().setLabel('Apply to Staff').setStyle(ButtonStyle.Link).setURL(ASRP_APPLICATION_LINK)
            );

            const menuRow = new ActionRowBuilder().addComponents(menu);

            await interaction.channel.send({
                embeds: [embed],
                components: [menuRow, linksRow],
            });

            return interaction.reply({ content: "✅ Dashboard deployed.", ephemeral: true });
        }

        // 2. TICKET STATS (admin only)
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketstats') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }
            // ... (rest unchanged)
            const openTickets = Array.from(ticketData.values());
            const byDepartment = openTickets.reduce((acc, t) => {
                const dept = t.department || 'unknown';
                acc[dept] = (acc[dept] || 0) + 1;
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
                    { name: 'Open Tickets', value: String(openTickets.length), inline: true },
                    { name: 'Claimed', value: String(claimedCount), inline: true },
                    { name: 'Unclaimed', value: String(openTickets.length - claimedCount), inline: true },
                    { name: 'By Department', value: deptLines, inline: false }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // 3. OWNER PANEL → now protected by your ID + code
        if (interaction.isChatInputCommand() && interaction.commandName === 'ownerpanel') {
            if (!isBotOwner(interaction)) {
                return interaction.reply({ content: "🚫 Owner-only command.", ephemeral: true });
            }

            const code = interaction.options.getString('code', true);
            if (code !== OWNER_PANEL_CODE) {
                return interaction.reply({ content: "🚫 Invalid owner code.", ephemeral: true });
            }

            const messageId = interaction.options.getString('message_id', true);
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

            await message.edit({ content: newContent });
            return interaction.reply({ content: `✅ Message updated → ${message.url}`, ephemeral: true });
        }

        // 4. SAY COMMAND → now also owner-only
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
            return interaction.reply({ content: `✅ Message sent in ${targetChannel}.`, ephemeral: true });
        }

        // 5. SETUP COMMAND + panel deployment (admin only)
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
                    "👤 **General Support** • General Inquiries • Reports • Concerns\n" +
                    "🤝 **Partnership Support** • Partnership & affiliation requests\n" +
                    "🛡️ **Internal Affairs Support** • Staff reports • Appeals • Role requests\n" +
                    "🛠️ **Management Support** • Giveaways • High-rank inquiries • Purchases"
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

            return interaction.reply({ content: "✅ Assistance panel & setup updated.", embeds: [setupEmbed], ephemeral: true });
        }

        // 6. Dashboard menu responses
        if (interaction.isStringSelectMenu() && interaction.customId === 'asrp_dashboard') {
            const responses = {
                staff_apps: { title: "📝 Staff Applications", desc: `**Status: OPEN**\nApply here:\n${ASRP_APPLICATION_LINK}` },
                ig_rules: { title: "🎮 In-Game Rules", desc: "Serious RP only • No RDM/VDM • NLR 15 min • No power/metagaming • No exploits • Realistic interactions" },
                departments: { title: "🏢 Departments", desc: "👤 General • 🤝 Partnerships • 🛡️ Internal Affairs • 🛠️ Management" },
                quick_links: { title: "🔗 Quick Links", desc: `🎮 ER:LC ${ERLC_GAME_LINK}\n📝 Apps ${ASRP_APPLICATION_LINK}` },
                dc_rules: { title: "📜 Discord Rules", desc: "Respect • No NSFW • No spam • No ads • No staff abuse • No drama • Follow ToS" }
            };

            const res = responses[interaction.values[0]];
            if (!res) return interaction.reply({ content: "Invalid option.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(res.title)
                .setDescription(res.desc)
                .setColor(BOT_COLOR)
                .setThumbnail(DASHBOARD_ICON)
                .setFooter({ text: "Alaska State RolePlay" });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // 7. Ticket creation
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
            await interaction.deferReply({ ephemeral: true });

            if (!config.staffRole || !config.iaRole || !config.mgmtRole) {
                return interaction.editReply("⚠️ Run `/setup` first to configure roles.");
            }

            const dept = interaction.values[0];
            const pingRoleId = getPingRole(dept);
            if (!pingRoleId) return interaction.editReply("⚠️ Department role not configured.");

            const existing = findExistingTicket(interaction.guild, interaction.user.id);
            if (existing) return interaction.editReply(`⚠️ You already have a ticket: <#${existing}>`);

            const last = userLastTicketOpen.get(interaction.user.id) || 0;
            const cooldownLeft = TICKET_COOLDOWN_MS - (Date.now() - last);
            if (cooldownLeft > 0) {
                return interaction.editReply(`⏳ Wait ${Math.ceil(cooldownLeft / 1000)} seconds.`);
            }

            await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

            const safeUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || interaction.user.id;
            const channelName = `ticket-${dept}-${safeUsername}`;

            let channel;
            try {
                channel = await interaction.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: pingRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    ],
                });
            } catch (err) {
                console.error('Failed to create ticket channel:', err);
                return interaction.editReply("❌ Failed to create ticket channel (permissions?).");
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
                        .setDescription("Please describe your issue. A staff member will be with you shortly.")
                ],
                components: [buttons],
            });

            return interaction.editReply(`✅ Ticket created → ${channel}`);
        }

        // 8. Ticket buttons (claim / close)
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

                const openerMember = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                if (openerMember) await openerMember.roles.remove(TICKET_ROLE_ID).catch(() => {});

                await interaction.followUp({
                    content: transcript
                        ? "📑 Closing ticket... (transcript saved & logged)"
                        : "📑 Closing ticket... (transcript save failed)",
                    ephemeral: true
                });

                ticketData.delete(interaction.channel.id);
                await saveTicketState();

                setTimeout(() => interaction.channel.delete().catch(console.error), 6000);
            }
        }
    } catch (err) {
        console.error('Interaction handling error:', err);
        if (!interaction.deferred && !interaction.replied) {
            interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
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
    console.log(`Logging in as ${client.user.tag}...`);

    await loadConfig();
    await loadTicketState();
    await pruneMissingTicketChannels();

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('dashboard').setDescription('Deploy main dashboard (admin)'),
        new SlashCommandBuilder().setName('ticketstats').setDescription('Show live ticket statistics (admin)'),
        new SlashCommandBuilder()
            .setName('ownerpanel')
            .setDescription('Edit bot messages (owner only)')
            .addStringOption(o => o.setName('code').setDescription('Owner code').setRequired(true))
            .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
            .addStringOption(o => o.setName('new_content').setDescription('New content').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Target channel (optional)')),
        new SlashCommandBuilder()
            .setName('say')
            .setDescription('Send message as bot (owner only)')
            .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Target channel (optional)')),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configure ticket system & deploy panel (admin)')
            .addChannelOption(o => o.setName('logs').setDescription('Ticket log channel'))
            .addRoleOption(o => o.setName('staff').setDescription('General staff role'))
            .addRoleOption(o => o.setName('ia_role').setDescription('Internal Affairs role'))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role')),
    ];

    try {
        const guildId = process.env.GUILD_ID;
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
            console.log(`Guild-specific commands registered for ${guildId}`);
        } else {
            await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log('Global commands registered');
        }
    } catch (err) {
        console.error('Slash command registration failed:', err);
    }

    console.log(`✅ ${client.user.tag} is ready • Owner: ${BOT_OWNER_ID}`);
});

if (!TOKEN) {
    throw new Error('TOKEN environment variable is missing.');
}

client.login(TOKEN);

app.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
});
