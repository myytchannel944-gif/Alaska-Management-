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

// ─── Configuration ────────────────────────────────────────────────
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
        console.log('Config loaded successfully');
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Config load error:', err);
        config = { ...DEFAULT_CONFIG };
    }
}

async function saveConfig() {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        console.log('Config saved');
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

// ─── Constants & Assets ───────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────
function getPingRoleId(department) {
    if (department === 'internal-affairs') return config.iaRole;
    if (department === 'management') return config.mgmtRole;
    return config.staffRole;
}

function createTicketEmbed(department) {
    return new EmbedBuilder()
        .setTitle(`🏛️ ${department.toUpperCase()} Support`)
        .setColor(COLORS.PRIMARY)
        .setImage(ASSETS.SUPPORT_BANNER);
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

// ─── Interaction Handler ──────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.guild || interaction.user.bot) return;

    console.log(
        `[INTERACTION] ${interaction.type} | ` +
        `ID: ${interaction.customId || interaction.commandName || 'n/a'} | ` +
        `User: ${interaction.user.tag} | Guild: ${interaction.guild.name}`
    );

    try {
        // Slash Commands
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'dashboard') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "Admin only.", ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: "ALASKA STATE ROLEPLAY • OFFICIAL DIRECTORY", iconURL: ASSETS.DASHBOARD_ICON })
                    .setTitle("Dashboard")
                    .setDescription(
                        "**Welcome to Alaska State RolePlay!**\n\n" +
                        "The best ER:LC roleplay community.\n\n" +
                        "Read the rules and understand the application process.\n" +
                        "Use the menu below."
                    )
                    .setColor(COLORS.PRIMARY)
                    .setImage(ASSETS.DASHBOARD_ICON)
                    .setTimestamp();

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('asrp_dashboard')
                    .setPlaceholder('Select an option...')
                    .addOptions([
                        { label: 'Staff Applications', value: 'staff_apps', emoji: '📝' },
                        { label: 'In-Game Rules',      value: 'ig_rules',   emoji: '🎮' },
                        { label: 'Discord Rules',      value: 'dc_rules',   emoji: '📜' },
                    ]);

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                });

                return interaction.reply({ content: "Dashboard deployed.", ephemeral: true });
            }

            if (interaction.commandName === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "Admin only.", ephemeral: true });
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
                    .setImage(ASSETS.SUPPORT_BANNER);

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                });

                return interaction.reply({ content: "Ticket panel deployed.", ephemeral: true });
            }
        }

        // String Select Menus
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'asrp_dashboard') {
                const pages = {
                    staff_apps: {
                        title: "📝 Applications + Forms",
                        content: "• **Staff Application**\nApplications are **OPEN**\n\n🔗 [Apply here](https://your-link.com)",
                    },
                    ig_rules: {
                        title: "🎮 In-Game Rules",
                        content:
                            "• Be respectful — no toxicity\n" +
                            "• No exploits / cheats / mods\n" +
                            "• No RDM / VDM\n" +
                            "• No failed RP / powergaming\n" +
                            "• Serious RP only",
                    },
                    dc_rules: {
                        title: "📜 Discord Rules",
                        content: "Respect others. No toxicity, spam, advertising, or harassment.",
                    },
                };

                const selected = interaction.values[0];
                const page = pages[selected];

                if (!page) return interaction.reply({ content: "Invalid option.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle(page.title)
                    .setDescription(page.content)
                    .setColor(COLORS.PRIMARY)
                    .setThumbnail(ASSETS.DASHBOARD_ICON);

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (interaction.customId === 'ticket_type') {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                try {
                    if (!config.staffRole) {
                        return interaction.editReply("Bot not configured. Run `/setup` first.");
                    }

                    const department = interaction.values[0];
                    const pingRoleId = getPingRoleId(department);
                    if (!pingRoleId) {
                        return interaction.editReply("Missing role configuration for this department.");
                    }

                    await interaction.member.roles.add(TICKET_ROLE_ID).catch(() => {});

                    const name = `${department}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);

                    const ticketChannel = await interaction.guild.channels.create({
                        name,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: interaction.user.id,   allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: pingRoleId,            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ],
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

                    await interaction.editReply(`Ticket created → ${ticketChannel}`);

                } catch (err) {
                    console.error('Ticket creation failed:', err);
                    await interaction.editReply("Failed to create ticket — check bot permissions.").catch(() => {});
                }
            }
        }

        // Buttons
        if (interaction.isButton()) {
            const data = ticketData.get(interaction.channel?.id);
            if (!data) {
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: "Ticket data no longer exists.", ephemeral: true }).catch(() => {});
                }
                return;
            }

            await interaction.deferUpdate().catch(() => {});

            try {
                if (interaction.customId === 'claim_ticket') {
                    if (data.claimedBy) {
                        return interaction.editReply({ content: "Already claimed." }).catch(() => {});
                    }

                    data.claimedBy = interaction.user.id;

                    await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(COLORS.SUCCESS)
                            .setDescription(`Claimed by ${interaction.user}`)],
                        components: [createControlButtons(true)],
                    });
                }

                if (interaction.customId === 'close_ticket') {
                    await interaction.editReply("Closing ticket...").catch(() => {});

                    const member = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                    if (member) await member.roles.remove(TICKET_ROLE_ID).catch(() => {});

                    if (config.logChannel) {
                        const logChannel = interaction.guild.channels.cache.get(config.logChannel);
                        if (logChannel?.isTextBased()) {
                            const duration = Math.floor((Date.now() - data.startTime) / 60000);
                            const logEmbed = new EmbedBuilder()
                                .setTitle("Ticket Closed")
                                .setColor(COLORS.DANGER)
                                .addFields(
                                    { name: "Opener",     value: `<@${data.openerId}>`, inline: true },
                                    { name: "Closed by",  value: `${interaction.user}`, inline: true },
                                    { name: "Duration",   value: `${duration} min`,     inline: true },
                                )
                                .setTimestamp();

                            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }

                    ticketData.delete(interaction.channel.id);
                    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
                }
            } catch (err) {
                console.error('Button handler error:', err);
                await interaction.editReply({ content: "Error processing action." }).catch(() => {});
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Internal error occurred.", ephemeral: true }).catch(() => {});
        }
    }
});

// ─── Startup ──────────────────────────────────────────────────────
client.once('ready', async () => {
    await loadConfig();

    const commands = [
        new SlashCommandBuilder()
            .setName('dashboard')
            .setDescription('Deploy dashboard panel'),

        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Setup ticket system')
            .addChannelOption(o => o.setName('logs').setDescription('Log channel').setRequired(true))
            .addRoleOption(o => o.setName('staff').setDescription('Staff role').setRequired(true))
            .addRoleOption(o => o.setName('ia_role').setDescription('IA role').setRequired(true))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role').setRequired(true)),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log(`Refreshing ${commands.length} commands...`);

        // Guild-specific registration → commands appear quickly in this server
        const TEST_GUILD_ID = '1472277307002589216';
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, TEST_GUILD_ID),
            { body: commands },
        );
        console.log(`Guild commands registered in server ${TEST_GUILD_ID}`);

        // If you later want global commands (slower to appear), uncomment this instead:
        // await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        // console.log('Global commands registered');

    } catch (err) {
        console.error('Command registration failed:', err);
        if (err.code) console.log(`Error code: ${err.code} - ${err.message}`);
    }

    console.log(`✅ ${client.user.tag} is online`);
});

client.login(process.env.TOKEN);
