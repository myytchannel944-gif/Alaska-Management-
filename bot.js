require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
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
const BOT_COLOR = 0x2b6cb0;
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const DASHBOARD_ICON = "https://image2url.com/r2/default/images/1771563774401-5dd69719-a2a9-42d7-a76e-c9028c62fe2f.jpg";
const TICKET_ROLE_ID = "1474234032677060795";

const ticketData = new Map(); // channelId → { openerId, startTime, claimedBy? }

function getPingRole(department) {
    if (department === 'internal-affairs') return config.iaRole;
    if (department === 'management' || department === 'partnership') return config.mgmtRole;
    return config.staffRole;
}

// ─── Helpers ──────────────────────────────────────────────
async function saveTranscript(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const lines = messages.reverse().map(m => {
            const time = m.createdAt.toISOString().slice(0, 19).replace('T', ' ');
            const author = m.author.tag;
            let content = m.content || '';

            if (m.embeds.length > 0) {
                content += ' [Embed]';
            }
            if (m.attachments.size > 0) {
                content += ' [Attachment(s)]';
            }

            return `[${time}] ${author}: ${content}`;
        });

        const filename = `transcript-${channel.name}-${Date.now()}.txt`;
        const filepath = path.join(__dirname, 'transcripts', filename);

        await fs.mkdir(path.join(__dirname, 'transcripts'), { recursive: true });
        await fs.writeFile(filepath, lines.join('\n'), 'utf-8');

        return { filename, filepath };
    } catch (err) {
        console.error('Transcript save failed:', err);
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
            { name: 'Opener', value: opener ? `${opener.user.tag} (${opener})` : 'Unknown', inline: true },
            { name: 'Claimed by', value: claimedBy, inline: true },
            { name: 'Closed by', value: `${interaction.user.tag} (${interaction.user})`, inline: true },
            { name: 'Duration', value: `${Math.round((Date.now() - data.startTime) / 60000)} minutes`, inline: true }
        )
        .setTimestamp();

    const files = transcriptInfo ? [{ attachment: transcriptInfo.filepath, name: transcriptInfo.filename }] : [];

    await logChannel.send({ embeds: [embed], files }).catch(console.error);
}

// ─── Interaction Handler ──────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild || interaction.user.bot) return;

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
                    { label: 'In-Game Rules',      value: 'ig_rules',   description: 'ER:LC Penal Code',     emoji: '🎮' },
                    { label: 'Discord Rules',      value: 'dc_rules',   description: 'Community Guidelines', emoji: '📜' },
                ]);

            await interaction.channel.send({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(menu)],
            });

            return interaction.reply({ content: "✅ Dashboard deployed.", ephemeral: true });
        }

        // 2. SETUP COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
            }

            config.logChannel   = interaction.options.getChannel('logs')?.id ?? config.logChannel;
            config.staffRole    = interaction.options.getRole('staff')?.id ?? config.staffRole;
            config.iaRole       = interaction.options.getRole('ia_role')?.id ?? config.iaRole;
            config.mgmtRole     = interaction.options.getRole('management_role')?.id ?? config.mgmtRole;

            await saveConfig();

            const embed = new EmbedBuilder()
                .setTitle("Assistance")
                .setDescription(
                    "Welcome to the **Assistance Dashboard**!\n" +
                    "Here you can easily open a ticket for various types of support.\n\n" +
                    "**Trolling or abuse of the ticket system may result in punishment.**\n\n" +
                    "👤 **General Support** • 👤 General Inquiries • Reports • Concerns\n\n" +
                    "🤝 **Partnership Support** • 🤝 Partnership & affiliation requests\n\n" +
                    "🛡️ **Internal Affairs** • 🛡️ Staff reports • Appeals • Role requests\n\n" +
                    "🛠️ **Management Support** • 🛠️ Giveaways • High-rank • Purchases"
                )
                .setColor(BOT_COLOR)
                .setImage(SUPPORT_BANNER);

            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_type')
                .setPlaceholder('Request Assistance...')
                .addOptions([
                    { label: 'General Support',     value: 'general',         emoji: '👤' },
                    { label: 'Partnership Support', value: 'partnership',     emoji: '🤝' },
                    { label: 'Internal Affairs',    value: 'internal-affairs', emoji: '🛡️' },
                    { label: 'Management Support',  value: 'management',      emoji: '🛠️' },
                ]);

            await interaction.channel.send({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(menu)],
            });

            return interaction.reply({ content: "✅ Assistance panel deployed.", ephemeral: true });
        }

        // 3. DASHBOARD MENU RESPONSES
        if (interaction.isStringSelectMenu() && interaction.customId === 'asrp_dashboard') {
            const responses = {
                staff_apps: { title: "📝 Applications + Forms", desc: "• Application Information\n┃ #「🌸」·applications\n• Status\n┃ Staff → OPEN\n┃ Media → OPEN\n\n🔗 [Staff Application](https://your-link.com)" },
                ig_rules: { title: "🎮 In-Game Rules", desc: "**Rules**\nBe Respectful • No Exploits • Serious RP • No RDM/VDM" },
                dc_rules: { title: "📜 Discord Rules", desc: "**Rules**\nRespect • No Advertising • No unnecessary pings • No NSFW • Keep drama private" }
            };

            const res = responses[interaction.values[0]];
            if (!res) return interaction.reply({ content: "Invalid option.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(res.title)
                .setDescription(res.desc)
                .setColor(BOT_COLOR)
                .setThumbnail(DASHBOARD_ICON);

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // 4. TICKET CREATION
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
            await interaction.deferReply({ ephemeral: true });

            if (!config.staffRole || !config.iaRole || !config.mgmtRole) {
                return interaction.editReply("⚠️ Run `/setup` first to configure roles.");
            }

            const dept = interaction.values[0];
            const pingRoleId = getPingRole(dept);

            if (!pingRoleId) return interaction.editReply("⚠️ Department role not set.");

            await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

            const channel = await interaction.guild.channels.create({
                name: `ticket-${dept}-${interaction.user.username.toLowerCase()}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: pingRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                ],
            });

            ticketData.set(channel.id, {
                openerId: interaction.user.id,
                startTime: Date.now(),
                claimedBy: null,
            });

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

        // 5. TICKET BUTTONS
        if (interaction.isButton()) {
            const data = ticketData.get(interaction.channel.id);
            if (!data) return interaction.reply({ content: "Ticket no longer exists.", ephemeral: true });

            // CLAIM
            if (interaction.customId === 'claim_ticket') {
                await interaction.deferUpdate();

                if (data.claimedBy) {
                    return interaction.followUp({ content: `Already claimed by <@${data.claimedBy}>.`, ephemeral: true });
                }

                ticketData.set(interaction.channel.id, { ...data, claimedBy: interaction.user.id });

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

            // CLOSE
            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ ephemeral: true });

                const isClaimer = data.claimedBy && data.claimedBy === interaction.user.id;
                const isUnclaimed = !data.claimedBy;

                if (!isUnclaimed && !isClaimer) {
                    return interaction.editReply({ content: "🚫 Only the claiming staff member can close this ticket." });
                }

                const transcriptInfo = await saveTranscript(interaction.channel);

                // Log to configured channel + attach transcript
                await logTicketClose(interaction, data, transcriptInfo);

                const member = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                if (member) await member.roles.remove(TICKET_ROLE_ID).catch(() => {});

                await interaction.editReply({
                    content: transcriptInfo
                        ? `📑 Closing... (transcript saved & logged)`
                        : `📑 Closing... (transcript failed)`
                });

                setTimeout(() => interaction.channel.delete().catch(console.error), 6000);
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.deferred && !interaction.replied) {
            interaction.reply({ content: "Error occurred.", ephemeral: true }).catch(() => {});
        }
    }
});

client.once('ready', async () => {
    await loadConfig();

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('dashboard').setDescription('Deploy dashboard panel'),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configure ticket system')
            .addChannelOption(o => o.setName('logs').setDescription('Log channel').setRequired(false))
            .addRoleOption(o => o.setName('staff').setDescription('Staff role').setRequired(false))
            .addRoleOption(o => o.setName('ia_role').setDescription('IA role').setRequired(false))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role').setRequired(false)),
    ];

    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    console.log(`✅ ${client.user.tag} online • Commands registered`);
});

client.login(process.env.TOKEN);
