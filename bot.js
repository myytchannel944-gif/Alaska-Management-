require('dotenv').config();
const fs = require('fs');
const {
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, PermissionsBitField, REST, Routes, ActivityType,
    AttachmentBuilder, StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ─── Constants & Banners ────────────────────────────────────────
const BOT_COLOR = "#2f3136";
const PROMO_BANNER    = "https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg";
const INFRACTION_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341585148008435753/4bae16d5-a785-45f7-a5f3-103560ef0003.jpg";
const SUPPORT_BANNER  = "https://assets.grok.com/users/44b33018-b8a5-43c6-ad8e-6d2518173db5/d36fb406-0d2a-47d2-8f3b-4db824f37de5/preview-image"; // ← added here

const CONFIG_PATH = './config.json';

let config = (() => {
    try {
        return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : {};
    } catch {
        return {};
    }
})();

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Allowed roles for ALL slash commands
const ALLOWED_ROLE_IDS = new Set([
    '1472278188469125355',
    '1472278915136360691',
    '1472279252274647112'
]);

function hasCommandPermission(member) {
    if (!member) return false;
    return member.roles.cache.some(role => ALLOWED_ROLE_IDS.has(role.id));
}

const ticketCooldowns = new Map(); // userId → timestamp

// ─── Helpers ────────────────────────────────────────────────────
function alaskaEmbed(title, color = BOT_COLOR) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setTimestamp();
}

// ─── Global error protection ────────────────────────────────────
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));

// ─── Interaction Handler ────────────────────────────────────────
client.on('interactionCreate', async int => {
    if (!int.guild || int.user.bot) return;

    try {
        // ─── Ticket category selection ─────────────────────────────
        if (int.isStringSelectMenu() && int.customId === 'ticket_type') {
            if (ticketCooldowns.has(int.user.id)) {
                const remaining = 30000 - (Date.now() - ticketCooldowns.get(int.user.id));
                if (remaining > 0) {
                    return int.reply({
                        content: `⏳ Please wait ${Math.ceil(remaining / 1000)} seconds before opening another ticket.`,
                        ephemeral: true
                    });
                }
            }

            ticketCooldowns.set(int.user.id, Date.now());
            setTimeout(() => ticketCooldowns.delete(int.user.id), 30000);

            await int.deferReply({ ephemeral: true });

            if (!config.staffRole) {
                return int.editReply({ content: '⚠️ Staff role not configured. Run /setup first.' });
            }

            const department = int.values[0];
            let pingRole;

            if (department === 'internal-affairs') pingRole = config.iaRole;
            else if (department === 'management') pingRole = config.mgmtRole;
            else pingRole = config.staffRole;

            if (!pingRole) {
                return int.editReply({ content: '⚠️ Required role for this department not set.' });
            }

            const channel = await int.guild.channels.create({
                name: `${department}-${int.user.username}`.slice(0, 99),
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks] },
                    { id: pingRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            }).catch(err => {
                console.error('Channel creation failed:', err);
                return null;
            });

            if (!channel) {
                return int.editReply({ content: '❌ Failed to create channel — check bot permissions.' });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
            );

            await channel.send({
                content: `${int.user} | <@&${pingRole}>`,
                embeds: [alaskaEmbed(`🏛️ ${department.replace('-', ' ').toUpperCase()} Session`)
                    .setDescription('Welcome. A member of the team will be with you shortly.\nPlease explain your situation in detail.')
                    .setImage(SUPPORT_BANNER)  // ← Support banner added here
                ],
                components: [row]
            }).catch(console.error);

            return int.editReply({ content: `✅ Ticket created: ${channel}` });
        }

        // ─── Close ticket button ───────────────────────────────────
        if (int.isButton() && int.customId === 'close_ticket') {
            await int.deferUpdate().catch(() => {});

            await int.channel.send('🗑️ Closing ticket in 5 seconds...').catch(() => {});
            setTimeout(() => int.channel.delete().catch(() => {}), 5000);
            return;
        }

        // ─── Slash commands ────────────────────────────────────────
        if (int.isChatInputCommand()) {
            const { commandName } = int;

            // Permission check for ALL slash commands
            if (!hasCommandPermission(int.member)) {
                return int.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ff5555')
                            .setTitle('Access Denied')
                            .setDescription('This command is restricted to authorized personnel only.')
                    ],
                    ephemeral: true
                });
            }

            // ── embed ───────────────────────────────────────────────
            if (commandName === 'embed') {
                return int.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ff0000')
                            .setTitle('🚫 Access Denied')
                            .setDescription('This service is Down right now contact the owner for further details.')
                    ],
                    ephemeral: true
                });
            }

            // ── edit ────────────────────────────────────────────────
            if (commandName === 'edit') {
                const messageId = int.options.getString('message_id');
                const newContent = int.options.getString('content');

                const targetMsg = await int.channel.messages.fetch(messageId).catch(() => null);

                if (!targetMsg || targetMsg.author.id !== client.user.id) {
                    return int.reply({
                        content: "❌ I can only edit my own messages.",
                        ephemeral: true
                    });
                }

                const editedEmbed = EmbedBuilder.from(targetMsg.embeds[0] || {}).setDescription(newContent);
                await targetMsg.edit({ embeds: [editedEmbed] }).catch(console.error);

                return int.reply({ content: "✅ Embed updated.", ephemeral: true });
            }

            // ── setup ───────────────────────────────────────────────
            if (commandName === 'setup') {
                if (!int.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return int.reply({ content: 'Only administrators can run setup.', ephemeral: true });
                }

                config.logChannel = int.options.getChannel('logs')?.id ?? null;
                config.staffRole = int.options.getRole('staff')?.id ?? null;
                config.iaRole = int.options.getRole('ia_role')?.id ?? null;
                config.mgmtRole = int.options.getRole('management_role')?.id ?? null;
                saveConfig();

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_type')
                    .setPlaceholder('Select Department...')
                    .addOptions([
                        { label: 'General Support', value: 'general', emoji: '❓' },
                        { label: 'Internal Affairs', value: 'internal-affairs', emoji: '👮' },
                        { label: 'Management', value: 'management', emoji: '💎' }
                    ]);

                const embed = new EmbedBuilder()
                    .setTitle('🏛️ Alaska Support & Relations')
                    .setColor(BOT_COLOR)
                    .setDescription('Select a category below to initiate a private session.')
                    .addFields(
                        { name: '❓ General Support', value: 'Server help, questions, partnerships' },
                        { name: '👮 Internal Affairs', value: 'Staff misconduct, player reports' },
                        { name: '💎 Management', value: 'Executive appeals, perk claims' }
                    )
                    .setImage(PROMO_BANNER);

                await int.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });

                return int.reply({ content: '✅ Ticket panel deployed.', ephemeral: true });
            }

            // ── promote ─────────────────────────────────────────────
            if (commandName === 'promote') {
                const user = int.options.getUser('user');
                const embed = new EmbedBuilder()
                    .setTitle('🔔 Alaska State Staff Promotion')
                    .setColor(BOT_COLOR)
                    .setDescription(`Congratulations, ${user}! Your dedication has earned you a promotion!`)
                    .addFields(
                        { name: 'Rank', value: int.options.getString('rank'), inline: true },
                        { name: 'Reason', value: int.options.getString('reason'), inline: true }
                    )
                    .setImage(PROMO_BANNER)
                    .setTimestamp();

                return int.reply({ content: `${user}`, embeds: [embed] });
            }

            // ── infraction ──────────────────────────────────────────
            if (commandName === 'infraction') {
                const user = int.options.getUser('user');
                const embed = new EmbedBuilder()
                    .setTitle('⚖️ Formal Infraction Issued')
                    .setColor('#e74c3c')
                    .addFields(
                        { name: 'User', value: `${user}`, inline: true },
                        { name: 'Type', value: int.options.getString('type'), inline: true },
                        { name: 'Reason', value: int.options.getString('reason') }
                    )
                    .setImage(INFRACTION_BANNER)
                    .setTimestamp();

                return int.reply({ embeds: [embed] });
            }
        }

    } catch (err) {
        console.error('Interaction error:', err);
        const msg = '⚠️ An error occurred. Try again or contact staff.';
        try {
            if (!int.replied && !int.deferred) {
                await int.reply({ content: msg, ephemeral: true }).catch(() => {});
            } else if (int.deferred) {
                await int.editReply({ content: msg }).catch(() => {});
            } else {
                await int.followUp({ content: msg, ephemeral: true }).catch(() => {});
            }
        } catch {}
    }
});

// ─── Ready ──────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Deploy ticket panel & configure roles')
            .addChannelOption(o => o.setName('logs').setDescription('Log channel').setRequired(true))
            .addRoleOption(o => o.setName('staff').setDescription('General staff role').setRequired(true))
            .addRoleOption(o => o.setName('ia_role').setDescription('Internal Affairs role').setRequired(true))
            .addRoleOption(o => o.setName('management_role').setDescription('Management role').setRequired(true)),

        new SlashCommandBuilder()
            .setName('promote')
            .setDescription('Announce staff promotion')
            .addUserOption(o => o.setName('user').setRequired(true))
            .addStringOption(o => o.setName('rank').setRequired(true))
            .addStringOption(o => o.setName('reason').setRequired(true)),

        new SlashCommandBuilder()
            .setName('infraction')
            .setDescription('Log formal infraction')
            .addUserOption(o => o.setName('user').setRequired(true))
            .addStringOption(o => o.setName('type').setRequired(true))
            .addStringOption(o => o.setName('reason').setRequired(true)),

        new SlashCommandBuilder()
            .setName('embed')
            .setDescription('Show maintenance message'),

        new SlashCommandBuilder()
            .setName('edit')
            .setDescription('Edit bot message')
            .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
            .addStringOption(o => o.setName('content').setDescription('New description').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
        console.log('Slash commands registered.');
    } catch (err) {
        console.error('Command registration failed:', err);
    }

    client.user.setActivity('Alaska State RP', { type: ActivityType.Watching });
});

client.login(process.env.TOKEN).catch(err => {
    console.error('Login failed — check token:', err.message);
    process.exit(1);
});
