require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, ActivityType, 
    AttachmentBuilder, StringSelectMenuBuilder 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ─── Constants & Banners ────────────────────────────────────────
const BOT_COLOR = "#2f3136"; 
const PROMO_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg";
const INFRACTION_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341585148008435753/4bae16d5-a785-45f7-a5f3-103560ef0003.jpg";

const CONFIG_PATH = './config.json';
const loadConfig = () => {
    try {
        return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH)) : {};
    } catch (e) { return {}; }
};
const saveConfig = (data) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
let config = loadConfig();

// ─── Interaction Handler ─────────────────────────────────────────
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;

    try {
        if (int.isStringSelectMenu() && int.customId === 'ticket_type') {
            await int.deferReply({ ephemeral: true });
            const department = int.values[0];

            let pingRole = config.staffRole; 
            if (department === 'internal-affairs') pingRole = config.iaRole;
            if (department === 'management') pingRole = config.mgmtRole;

            const ch = await int.guild.channels.create({
                name: `${department}-${int.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: pingRole || int.guild.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            }).catch(() => null);

            if (!ch) return int.editReply("❌ Failed to create channel. Check permissions.");

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger));

            await ch.send({ 
                content: `${int.user} | ${pingRole ? `<@&${pingRole}>` : "@staff"}`,
                embeds: [new EmbedBuilder()
                    .setTitle(`🏛️ ${department.replace('-', ' ').toUpperCase()} Session`)
                    .setColor(BOT_COLOR)
                    .setDescription(`Welcome. A member of the team will be with you shortly.`)
                    .setTimestamp()], 
                components: [row] 
            });

            return int.editReply({ content: `✅ Ticket opened: ${ch}` });
        }

        if (int.isChatInputCommand()) {
            const { commandName, options } = int;

            if (commandName === 'embed') {
                return int.reply({ 
                    embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('🚫 Access Denied').setDescription('This service is Down right now contact the owner for further details.')], 
                    ephemeral: true 
                });
            }

            if (commandName === 'edit') {
                const messageId = options.getString('message_id');
                const newContent = options.getString('content');
                const targetMsg = await int.channel.messages.fetch(messageId).catch(() => null);
                
                if (!targetMsg || targetMsg.author.id !== client.user.id) {
                    return int.reply({ content: "❌ Error: I can only edit my own messages. Contact the owner for further details.", ephemeral: true });
                }

                const editedEmbed = EmbedBuilder.from(targetMsg.embeds[0]).setDescription(newContent);
                await targetMsg.edit({ embeds: [editedEmbed] });
                return int.reply({ content: "✅ Embed updated. Contact the owner for further details.", ephemeral: true });
            }

            if (commandName === 'setup') {
                config.logChannel = options.getChannel('logs').id;
                config.staffRole = options.getRole('staff').id;
                config.iaRole = options.getRole('ia_role').id;
                config.mgmtRole = options.getRole('management_role').id;
                saveConfig(config);

                const selectMenu = new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('Select Department...')
                    .addOptions([
                        { label: 'General Support', value: 'general', emoji: '❓' },
                        { label: 'Internal Affairs', value: 'internal-affairs', emoji: '👮' },
                        { label: 'Management', value: 'management', emoji: '💎' }
                    ]);

                const setupEmbed = new EmbedBuilder()
                    .setTitle('🏛️ Alaska Support & Relations')
                    .setColor(BOT_COLOR)
                    .setDescription('Select a category below to initiate a private session.\n\n🔹 **General Support**\nServer help and partnerships.\n\n🔹 **Internal Affairs**\nStaff misconduct reports.\n\n🔹 **Management**\nExecutive appeals and perk claims.')
                    .setImage(PROMO_BANNER);

                await int.channel.send({ embeds: [setupEmbed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
                return int.reply({ content: "✅ Ticket Panel Deployed.", ephemeral: true });
            }

            if (commandName === 'promote') {
                const user = options.getUser('user');
                const embed = new EmbedBuilder().setTitle('🔔 Alaska State Staff Promotion').setColor(BOT_COLOR)
                    .setDescription(`Congratulations, ${user}! Your dedication has earned you a promotion!`)
                    .addFields({ name: 'Rank', value: options.getString('rank'), inline: true }, { name: 'Reason', value: options.getString('reason'), inline: true })
                    .setImage(PROMO_BANNER).setTimestamp();
                return int.reply({ content: `${user}`, embeds: [embed] });
            }

            if (commandName === 'infraction') {
                const user = options.getUser('user');
                const embed = new EmbedBuilder().setTitle('⚖️ Formal Infraction Issued').setColor('#e74c3c')
                    .addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Type', value: options.getString('type'), inline: true }, { name: 'Reason', value: options.getString('reason') })
                    .setImage(INFRACTION_BANNER).setTimestamp();
                return int.reply({ embeds: [embed] });
            }
        }

        if (int.isButton() && int.customId === 'close_ticket') {
            await int.reply("📑 **Black Box: Archiving...**");
            setTimeout(() => int.channel.delete().catch(() => {}), 3000);
        }
    } catch (e) { console.error(e); }
});

// FIXED COMMAND REGISTRATION (Removed SlashBuilder typo & added all descriptions)
client.once('clientReady', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('setup').setDescription('Deploy ticket panel')
                .addChannelOption(o => o.setName('logs').setDescription('Logs channel').setRequired(true))
                .addRoleOption(o => o.setName('staff').setDescription('General Staff').setRequired(true))
                .addRoleOption(o => o.setName('ia_role').setDescription('IA Role').setRequired(true))
                .addRoleOption(o => o.setName('management_role').setDescription('Management Role').setRequired(true)),
            new SlashCommandBuilder().setName('promote').setDescription('Promote staff')
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
                .addStringOption(o => o.setName('rank').setDescription('New rank').setRequired(true))
                .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
            new SlashCommandBuilder().setName('infraction').setDescription('Log infraction')
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
                .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true))
                .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
            new SlashCommandBuilder().setName('embed').setDescription('Build a custom embed (Disabled)'),
            new SlashCommandBuilder().setName('edit').setDescription('Edit a bot embed')
                .addStringOption(o => o.setName('message_id').setDescription('The Message ID').setRequired(true))
                .addStringOption(o => o.setName('content').setDescription('New Description').setRequired(true))
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
        console.log('✅ Alaska Build Online & Validated.');
    } catch (error) { console.error(error); }
});

process.on('unhandledRejection', e => console.error(e));
process.on('uncaughtException', e => console.error(e));

client.login(process.env.TOKEN);
