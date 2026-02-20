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
    StringSelectMenuBuilder,
    ChannelType,
    PermissionsBitField,
    REST,
    Routes,
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
    ],
});

// ────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────

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

// ────────────────────────────────────────────────
// Constants & Assets
// ────────────────────────────────────────────────

const COLORS = {
    PRIMARY: 0x2b6cb0,
    SUCCESS: 0x43b581,
    DANGER:  0xff4757,
};

const ASSETS = {
    SUPPORT_BANNER: "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg",
    DASHBOARD_ICON: "https://image2url.com/r2/default/images/1771563774401-5dd69719-a2a9-42d7-a76e-c9028c62fe2f.jpg",
};

const TICKET_ROLE_ID = "1474234032677060795";
const ticketData = new Map();

// ────────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────────

function getPingRoleId(department) {
    if (department === 'internal-affairs') return config.iaRole;
    if (department === 'management') return config.mgmtRole;
    return config.staffRole;
}

function createTicketEmbed(department) {
    return new EmbedBuilder()
        .setTitle(`🏛️ ${department.toUpperCase()} Support`)
        .setColor(COLORS.PRIMARY)
        .setImage(ASSETS.SUPPORT_BANNER)
        .setFooter({ text: "Alaska State RolePlay Support" });
}

function createControlButtons(claimed = false) {
    const row = new ActionRowBuilder();

    if (!claimed) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success),
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger),
    );

    return row;
}

// ────────────────────────────────────────────────
// Interaction Handler
// ────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
    if (!interaction.isDiscord() || interaction.user.bot) return;

    try {
        // ── Slash Commands ────────────────────────────────
        if (interaction.isChatInputCommand()) {
            // Dashboard
            if (interaction.commandName === 'dashboard') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "Only administrators can deploy the dashboard.", ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: "ALASKA STATE ROLEPLAY • OFFICIAL DIRECTORY", iconURL: ASSETS.DASHBOARD_ICON })
                    .setTitle("Welcome to the ASRP Dashboard")
                    .setDescription(
                        "**This is your central hub for everything Alaska State RolePlay!**\n\n" +

                        "Whether you're a new member, a returning player, or just checking things out — " +
                        "this dashboard gives you quick access to the most important community information.\n\n" +

                        "Use the dropdown menu below to explore:\n" +
                        "• **Staff Applications** — Want to join the team? Check requirements & apply here\n" +
                        "• **In-Game Rules** — Essential guidelines for serious roleplay on the server\n" +
                        "• **Discord Rules** — Our community standards & expectations on this server\n\n" +

                        "We recommend **every member** reads through these sections at least once.\n" +
                        "Following the rules helps keep our community respectful, fun, and drama-free.\n\n" +

                        "Ready to dive in? Select an option below ↓"
                    )
                    .setColor(COLORS.PRIMARY)
                    .setImage(ASSETS.DASHBOARD_ICON)
                    .setFooter({ text: "Alaska State RolePlay • Serious ER:LC Roleplay Community" })
                    .setTimestamp();

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('asrp_dashboard')
                    .setPlaceholder('Select an option...')
                    .addOptions([
                        { label: 'Staff Applications', value: 'staff_apps', emoji: '📋' },
                        { label: 'In-Game Rules',      value: 'ig_rules',   emoji: '🎮' },
                        { label: 'Discord Rules',      value: 'dc_rules',   emoji: '📜' },
                    ]);

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                });

                return interaction.reply({ content: "Dashboard panel deployed successfully.", ephemeral: true });
            }

            // Setup
            if (interaction.commandName === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "Only administrators can run setup.", ephemeral: true });
                }

                config.logChannel    = interaction.options.getChannel('logs')?.id ?? null;
                config.staffRole     = interaction.options.getRole('staff')?.id ?? null;
                config.iaRole        = interaction.options.getRole('ia_role')?.id ?? null;
                config.mgmtRole      = interaction.options.getRole('management_role')?.id ?? null;

                await saveConfig();

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_type')
                    .setPlaceholder('Select Department...')
                    .addOptions([
                        { label: 'General Support',   value: 'general',         emoji: '❓' },
                        { label: 'Internal Affairs',  value: 'internal-affairs', emoji: '👮' },
                        { label: 'Management',        value: 'management',      emoji: '💎' },
                    ]);

                const embed = new EmbedBuilder()
                    .setTitle('🏛️ Alaska Support')
                    .setColor(COLORS.PRIMARY)
                    .setImage(ASSETS.SUPPORT_BANNER)
                    .setFooter({ text: "Create a ticket by selecting a department" });

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                });

                return interaction.reply({ content: "Ticket panel deployed successfully.", ephemeral: true });
            }
        }

        // ── Select Menus ──────────────────────────────────
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'asrp_dashboard') {
                const pages = {
                    staff_apps: {
                        title: "📋 Staff Applications",
                        content:
                            "**Join the Alaska State RolePlay Staff Team**\n\n" +
                            "**Staff Applications are OPEN** 🟢\n\n" +

                            "We are currently accepting applications for motivated and reliable members.\n\n" +

                            "📌 **What we’re looking for**\n" +
                            "• Maturity & professionalism\n" +
                            "• Strong understanding of roleplay rules\n" +
                            "• Active participation in the community\n" +
                            "• Good communication skills\n" +
                            "• Ability to stay calm in difficult situations\n\n" +

                            "🔗 **Apply Here**\n" +
                            "[Staff Application Form](https://melonly.xyz/forms/7429303261795979264)\n\n" +

                            "📩 **Next steps**\n" +
                            "→ You’ll receive a confirmation DM after submitting\n" +
                            "→ Decisions & updates posted in #📋┃application-results\n" +
                            "→ Typical response time: within 24 hours\n\n" +

                            "⚠️ **Please note**\n" +
                            "Only apply if you are serious and can commit time. Duplicate or low-effort applications will be denied.",
                    },
                    ig_rules: {
                        title: "🎮 In-Game Rules",
                        content:
                            "┃ **Be Respectful.** No bullying, hate speech, or toxic behavior.\n\n" +
                            "┃ **Exploits or Hacks.** Using cheats, glitches, or mods is an instant ban.\n\n" +
                            "┃ **Serious RP Only.** No trolling, clown RP, or unrealistic scenarios.\n\n" +
                            "┃ **Failed RP** Don’t do things that would be impossible in real life (e.g. superhuman strength)\n\n" +
                            "┃ **RDM** Killing without valid roleplay reason is not allowed.\n\n" +
                            "┃ **VDM** Don’t run people over unless part of an approved RP.",
                    },
                    dc_rules: {
                        title: "📜 Discord Rules",
                        content:
                            "┃ **Discord Nicknames must match your Roblox Username.** Your nickname must match your Roblox Username without having any special characters and nothing in front or behind, a callsign is allowed.\n\n" +
                            "┃ **Respect all members.** Discriminative or racial slurs are prohibited. We don’t ask you to love somebody but be kind particularly.\n\n" +
                            "┃ **Message content.** Spamming or flooding chat is prohibited. NSFW, pornography, nudity, etc. are prohibited. “Bad words” are allowed.\n\n" +
                            "┃ **Alternative Accounts are prohibited.** Alternative accounts, a.k.a. “Alt Accounts” are prohibited.\n\n" +
                            "┃ **Advertising** Don’t advertise your server in DM’s or conversations.\n\n" +
                            "┃ **Do not send any suspicious links.** Link shorteners, IP grabbers, and other potentially questionable content fall under this category.\n\n" +
                            "┃ **Use channels for their intended purpose** Make sure your text and audio chats are appropriate for the right channels.\n\n" +
                            "┃ **English only** You are required to only use English so Moderators can deal with mod scenes accordingly.\n\n" +
                            "┃ **Contributing** Any contributions including liveries, uniforms, and anything else are property of Alaska State Roleplay.\n\n" +
                            "┃ **Terms of use** You must abide by the Discord Community Guidelines and the Discord Terms of Service. Not following both will result in strict moderation action.",
                    },
                };

                const selected = interaction.values[0];
                const page = pages[selected];

                if (!page) {
                    return interaction.reply({ content: "Invalid selection.", ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle(page.title)
                    .setDescription(page.content)
                    .setColor(COLORS.PRIMARY)
                    .setThumbnail(ASSETS.DASHBOARD_ICON)
                    .setFooter({ text: "Alaska State RolePlay • Rules & Information" });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (interaction.customId === 'ticket_type') {
                await interaction.deferReply({ ephemeral: true });

                if (!config.staffRole) {
                    return interaction.editReply("⚠️  Bot not fully configured. Please run `/setup` first.");
                }

                const department = interaction.values[0];
                const pingRoleId = getPingRoleId(department);

                if (!pingRoleId) {
                    return interaction.editReply("⚠️  Missing role configuration for this department.");
                }

                await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

                const name = `${department}-${interaction.user.username}`
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '')
                    .slice(0, 100);

                const ticketChannel = await interaction.guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id,               deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id,                 allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: pingRoleId,                          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    ],
                }).catch(err => {
                    console.error('Channel creation failed:', err);
                    throw err;
                });

                ticketData.set(ticketChannel.id, {
                    openerId: interaction.user.id,
                    startTime: Date.now(),
                    claimedBy: null,
                    department,
                });

                await ticketChannel.send({
                    content: `${interaction.user} | <@&${pingRoleId}>`,
                    embeds: [createTicketEmbed(department)],
                    components: [createControlButtons()],
                });

                await interaction.editReply(`✅ Ticket created: ${ticketChannel}`);
            }
        }

        // ── Buttons ───────────────────────────────────────
        if (interaction.isButton()) {
            const data = ticketData.get(interaction.channel?.id);
            if (!data) return;

            await interaction.deferUpdate().catch(() => {});

            if (interaction.customId === 'claim_ticket') {
                if (data.claimedBy) {
                    return interaction.editReply({ content: "This ticket is already claimed." }).catch(() => {});
                }

                data.claimedBy = interaction.user.id;

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(COLORS.SUCCESS)
                        .setDescription(`✅ Ticket claimed by ${interaction.user}`)],
                    components: [createControlButtons(true)],
                });
            }

            if (interaction.customId === 'close_ticket') {
                await interaction.editReply("📑 Closing ticket...").catch(() => {});

                const member = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                if (member) await member.roles.remove(TICKET_ROLE_ID).catch(() => {});

                if (config.logChannel) {
                    const logChannel = interaction.guild.channels.cache.get(config.logChannel);
                    if (logChannel?.isTextBased()) {
                        const duration = Math.floor((Date.now() - data.startTime) / 60000);
                        const logEmbed = new EmbedBuilder()
                            .setTitle("📁 Ticket Closed")
                            .setColor(COLORS.DANGER)
                            .addFields(
                                { name: "Opener",     value: `<@${data.openerId}>`, inline: true },
                                { name: "Closed by",  value: `${interaction.user}`, inline: true },
                                { name: "Duration",   value: `${duration} min`,     inline: true },
                            )
                            .setTimestamp()
                            .setFooter({ text: "Alaska State RolePlay • Ticket System" });

                        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }

                ticketData.delete(interaction.channel.id);
                setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "An error occurred while processing your request.", ephemeral: true }).catch(() => {});
        }
    }
});

// ────────────────────────────────────────────────
// Bot Startup
// ────────────────────────────────────────────────

client.once('ready', async () => {
    await loadConfig();

    const commands = [
        new SlashCommandBuilder()
            .setName('dashboard')
            .setDescription('Deploy the main community dashboard'),

        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configure the ticket system and deploy panel')
            .addChannelOption(o => o.setName('logs').setDescription('Ticket log channel').setRequired(true))
            .addRoleOption(o => o.setName('staff').setDescription('General staff role').setRequired(true))
            .addRoleOption(o => o.setName('ia_role').setDescription('Internal Affairs role').setRequired(true))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role').setRequired(true)),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log(`Registering ${commands.length} guild commands...`);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, '1472277307002589216'),
            { body: commands },
        );
        console.log('Guild commands registered successfully');
    } catch (err) {
        console.error('Command registration failed:', err);
    }

    console.log(`✅ ${client.user.tag} is online and ready`);
});

client.login(process.env.TOKEN);
