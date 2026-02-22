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
const FOUNDERSHIP_ROLE_ID = '1472278188469125355';
const BLOCKED_ROLE_IDS = ['1472280032574570616', '1472280229794943282'];
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

// ─── Priority Utilities ───────────────────────────────────
const PRIORITY_EMOJIS = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' };
const PRIORITY_COLORS = { low: 0x00FF00, medium: 0xFFFF00, high: 0xFFA500, urgent: 0xFF0000 };

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
                    { label: 'Vehicle Livery Dashboard', value: 'vehicle_livery', description: 'View current ASRP fleet status', emoji: '🚓' },
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
                    '━━━━━━━━━━━━━━━━━━\n**Departments Dashboard**\n━━━━━━━━━━━━━━━━━━\n\n' +
                    'Select a department from the dropdown to get your invite and instructions.\n\n' +
                    '🚨 Professionalism is required\n📋 Follow all server rules\n⚠️ Abuse of roles will result in removal'
                )
                .setColor(5793266)
                .addFields(
                    { name: '🚓 Alaska State Troopers', value: '🟢 **OPEN**\nStatewide law enforcement. Handles highways, rural patrol, and major incidents.', inline: false },
                    { name: '🚧 Alaska Department of Transportation', value: '🟢 **OPEN**\nHandles traffic control, road work, and scene support.', inline: false },
                    { name: '🚔 Alaska Police Department', value: '🔴 **CLOSED**\nCurrently in development.', inline: false },
                    { name: '🚒 Alaska Fire Department', value: '🔴 **CLOSED**\nCurrently in development.', inline: false },
                    { name: '🕵️‍♂️ FBI', value: '🟢 **OPEN**\nFederal investigations, special operations, high-priority cases.', inline: false }
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
                    { label: 'Alaska Fire Department', value: 'afd', description: 'Currently in development', emoji: '🚒', disabled: true },
                    { label: 'FBI', value: 'fbi', description: 'Join FBI server', emoji: '🕵️‍♂️' }
                );

            const dashboardRow = new ActionRowBuilder().addComponents(departmentDropdown);

            await interaction.channel.send({ embeds: [dashboardEmbed], components: [dashboardRow] });

            return interaction.reply({ content: "✅ Departments dashboard deployed.", flags: MessageFlags.Ephemeral });
        }

        // 3. DEPARTMENT DROPDOWN HANDLER
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_department') {
            const value = interaction.values[0];

            let replyText = 'Unknown department selected.';

            switch (value) {
                case 'ast':
                    replyText = '✅ **Alaska State Troopers** is **OPEN**!\nJoin here: https://discord.gg/WhP5Xk85Yw';
                    break;
                case 'dot':
                    replyText = '✅ **Alaska Department of Transportation** is **OPEN**!\nJoin here: https://discord.gg/JCPDApbKmH';
                    break;
                case 'apd':
                    replyText = '🔴 **Alaska Police Department** is currently **CLOSED** / in development.';
                    break;
                case 'afd':
                    replyText = '🔴 **Alaska Fire Department** is currently **CLOSED** / in development.';
                    break;
                case 'fbi':
                    replyText = '✅ **FBI** is **OPEN**!\nJoin here: https://discord.gg/fQC227yJZT';
                    break;
            }

            return interaction.reply({ content: replyText, flags: MessageFlags.Ephemeral });
        }

        // 4. TICKET CREATION – Department selection
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

            // Ask for priority
            const priorityMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_priority_${dept}`)
                .setPlaceholder('Select ticket priority...')
                .addOptions([
                    { label: 'Low', value: 'low', emoji: '🟢', description: 'General inquiry / non-urgent' },
                    { label: 'Medium', value: 'medium', emoji: '🟡', description: 'Standard support request' },
                    { label: 'High', value: 'high', emoji: '🟠', description: 'Time-sensitive issue' },
                    { label: 'Urgent', value: 'urgent', emoji: '🔴', description: 'Critical / emergency' },
                ]);

            const row = new ActionRowBuilder().addComponents(priorityMenu);

            await interaction.editReply({
                content: `Ticket for **${dept.toUpperCase()}** – please select priority:`,
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

        // 5. Priority selection → create ticket
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_priority_')) {
            await interaction.deferUpdate();

            const dept = interaction.customId.split('_')[2];
            const priority = interaction.values[0];

            const pingRoleId = getPingRole(dept);

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
                    name: `ticket-${dept}-${priority}-${safeUsername}`,
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
                priority: priority
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
                        .setTitle(`${PRIORITY_EMOJIS[priority] || '❓'} ${dept.toUpperCase()} Ticket – Priority: ${priority.toUpperCase()}`)
                        .setColor(PRIORITY_COLORS[priority] || BOT_COLOR)
                        .setImage(SUPPORT_BANNER)
                        .setDescription(
                            `**Priority:** ${PRIORITY_EMOJIS[priority] || ''} **${priority.toUpperCase()}**\n\n` +
                            "Please describe your issue clearly. A staff member will assist you soon.\n" +
                            "Higher priority tickets are handled first."
                        )
                ],
                components: [buttons],
            });

            await interaction.editReply({ content: `✅ Ticket created → ${channel} (Priority: ${priority.toUpperCase()})`, flags: MessageFlags.Ephemeral });
        }

        // 6. TICKET STATS (professional version)
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketstats') {
            try {
                const openTickets = Array.from(ticketData.values());

                const byPriority = openTickets.reduce((acc, ticket) => {
                    const pri = ticket.priority ? ticket.priority.toUpperCase() : 'UNKNOWN';
                    acc[pri] = (acc[pri] || 0) + 1;
                    return acc;
                }, {});

                const totalOpen = openTickets.length;
                const claimedCount = openTickets.filter(t => t.claimedBy).length;
                const unclaimedCount = totalOpen - claimedCount;

                const priorityOrder = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
                const priorityFields = priorityOrder
                    .filter(p => byPriority[p] !== undefined)
                    .map(p => ({
                        name: `${PRIORITY_EMOJIS[p.toLowerCase()] || '❓'} ${p}`,
                        value: `**${byPriority[p]}** tickets`,
                        inline: true
                    }));

                const embed = new EmbedBuilder()
                    .setColor(0x1E90FF)
                    .setTitle('Alaska State Roleplay • Ticket Overview')
                    .setDescription('Current status of the support ticket system')
                    .setThumbnail(DASHBOARD_ICON)
                    .addFields(
                        { name: '📊 Total Open Tickets', value: `**${totalOpen}**`, inline: true },
                        { name: '✅ Claimed', value: `**${claimedCount}**`, inline: true },
                        { name: '⏳ Unclaimed', value: `**${unclaimedCount}**`, inline: true },
                        ...priorityFields
                    )
                    .setFooter({ 
                        text: `Last updated • ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
                        iconURL: DASHBOARD_ICON 
                    })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } catch (statsErr) {
                console.error('Ticketstats command failed:', statsErr);
                return interaction.reply({
                    content: "❌ Failed to load ticket statistics. Please try again later.",
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // 7. TICKET CLOSE BY ID
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketclose') {
            const ticketId = interaction.options.getString('ticket_id', true);

            const data = ticketData.get(ticketId);
            if (!data || !interaction.guild.channels.cache.has(ticketId)) {
                return interaction.reply({
                    content: "❌ Invalid or closed ticket ID.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const channel = interaction.guild.channels.cache.get(ticketId);
            if (!channel) {
                ticketData.delete(ticketId);
                await saveTicketState();
                return interaction.reply({
                    content: "❌ That ticket channel no longer exists.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`close_by_id_modal_${ticketId}`)
                .setTitle('Close Ticket by ID - Reason Required');

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

        // 8. CLOSE BY ID MODAL HANDLER
        if (interaction.isModalSubmit() && interaction.customId.startsWith('close_by_id_modal_')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const ticketId = interaction.customId.split('_')[3];
            const data = ticketData.get(ticketId);

            if (!data) {
                return interaction.editReply({ content: "❌ Ticket no longer exists.", flags: MessageFlags.Ephemeral });
            }

            const closeReason = interaction.fields.getTextInputValue('close_reason').trim() || 'No reason provided';

            const channel = interaction.guild.channels.cache.get(ticketId);
            if (!channel) {
                ticketData.delete(ticketId);
                await saveTicketState();
                return interaction.editReply({ content: "Channel already gone.", flags: MessageFlags.Ephemeral });
            }

            const transcript = await saveTranscript(channel);
            await logTicketClose(interaction, data, transcript, closeReason);

            const openerMember = await interaction.guild.members.fetch(data.openerId).catch(() => null);
            if (openerMember) await openerMember.roles.remove(TICKET_ROLE_ID).catch(() => {});

            await channel.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xff5555)
                    .setDescription(`Ticket closed by ${interaction.user} (via /ticketclose).\n**Reason:** ${closeReason}`)]
            });

            ticketData.delete(ticketId);
            await saveTicketState();

            await interaction.editReply({ content: "Closing ticket...", flags: MessageFlags.Ephemeral });

            setTimeout(() => channel.delete().catch(console.error), 6000);
            return;
        }

        // 9. TICKET PRIORITY CHANGE COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpriority') {
            const ticketId = interaction.options.getString('ticket_id', true);
            const newPriority = interaction.options.getString('priority', true).toLowerCase();

            if (!['low', 'medium', 'high', 'urgent'].includes(newPriority)) {
                return interaction.reply({ content: "Invalid priority. Use: low, medium, high, urgent", flags: MessageFlags.Ephemeral });
            }

            const data = ticketData.get(ticketId);
            if (!data || !interaction.guild.channels.cache.has(ticketId)) {
                return interaction.reply({ content: "❌ Invalid or closed ticket ID.", flags: MessageFlags.Ephemeral });
            }

            const channel = interaction.guild.channels.cache.get(ticketId);
            const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
            const isFoundership = interaction.member.roles.cache.has(FOUNDERSHIP_ROLE_ID);

            if (!isClaimer && !isFoundership) {
                return interaction.reply({ content: "Only the claimer or Foundership can change ticket priority.", flags: MessageFlags.Ephemeral });
            }

            // Update data
            data.priority = newPriority;
            ticketData.set(ticketId, data);
            await saveTicketState();

            // Try to rename channel
            const oldName = channel.name;
            const nameParts = oldName.split('-');
            const baseName = nameParts.slice(0, -1).join('-');
            const newName = `${baseName}-${newPriority}-${nameParts[nameParts.length - 1] || 'user'}`.slice(0, 100);

            await channel.setName(newName).catch(() => {});

            // Edit original ticket message
            const messages = await channel.messages.fetch({ limit: 10 });
            const ticketMessage = messages.find(m => m.embeds.length && m.embeds[0].title.includes('Ticket'));
            if (ticketMessage) {
                const updatedEmbed = EmbedBuilder.from(ticketMessage.embeds[0])
                    .setTitle(`${PRIORITY_EMOJIS[newPriority]} ${data.department.toUpperCase()} Ticket – Priority: ${newPriority.toUpperCase()}`)
                    .setColor(PRIORITY_COLORS[newPriority])
                    .setDescription(
                        ticketMessage.embeds[0].description.split('\n\n')[0] + '\n\n' +
                        `**Priority updated to:** ${PRIORITY_EMOJIS[newPriority]} **${newPriority.toUpperCase()}** by ${interaction.user}`
                    );

                await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
            }

            // Confirmation in channel
            await channel.send({
                embeds: [new EmbedBuilder()
                    .setColor(PRIORITY_COLORS[newPriority])
                    .setDescription(`**Priority changed to ${newPriority.toUpperCase()}** ${PRIORITY_EMOJIS[newPriority]} by ${interaction.user}`)]
            });

            return interaction.reply({ content: `Priority updated to **${newPriority.toUpperCase()}** for ticket <#${ticketId}>`, flags: MessageFlags.Ephemeral });
        }

        // ... (keep all your other handlers: ticket creation with priority, buttons, claim, close modal, ticketperson add/remove, etc.) ...

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
            .setName('ticketclose')
            .setDescription('Close any ticket by its channel ID (Foundership only)')
            .addStringOption(option =>
                option.setName('ticket_id')
                      .setDescription('The ID of the ticket channel to close')
                      .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('ticketpriority')
            .setDescription('Change the priority of any ticket (claimer or Foundership only)')
            .addStringOption(option =>
                option.setName('ticket_id')
                      .setDescription('The ID of the ticket channel')
                      .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('priority')
                      .setDescription('New priority level')
                      .setRequired(true)
                      .addChoices(
                          { name: 'Low', value: 'low' },
                          { name: 'Medium', value: 'medium' },
                          { name: 'High', value: 'high' },
                          { name: 'Urgent', value: 'urgent' }
                      )
            ),
        // ... your other commands (ownerpanel, say, embedbuilder, setup, ticketpersonadd, ticketpersonremove) ...
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
