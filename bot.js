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
const BOT_COLOR = "#f6b9bc"; 
const PROMO_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg";
const INFRACTION_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341585148008435753/4bae16d5-a785-45f7-a5f3-103560ef0003.jpg";

const CONFIG_PATH = './config.json';
const loadConfig = () => fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH)) : { logChannel: null, staffRole: null };
const saveConfig = (data) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
let config = loadConfig();

const createAlaskaEmbed = (title) => new EmbedBuilder().setTitle(title).setColor(BOT_COLOR).setTimestamp();

// ─── Interaction Handler ─────────────────────────────────────────
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;

    try {
        // 1. TICKET SELECTION (LEAVE IT - AS REQUESTED)
        if (int.isStringSelectMenu() && int.customId === 'ticket_type') {
            const department = int.values[0];
            await int.deferReply({ ephemeral: true });

            const ch = await int.guild.channels.create({
                name: `${department}-${int.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: config.staffRole || int.guild.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger));

            await ch.send({ 
                content: `${int.user} | <@&${config.staffRole}>`,
                embeds: [createAlaskaEmbed(`🏛️ ${department.toUpperCase()} Session`).setDescription(`Please explain your situation. Our team will assist you shortly.`)], 
                components: [row] 
            });

            return int.editReply({ content: `✅ Ticket opened: ${ch}` });
        }

        // 2. SLASH COMMANDS
        if (int.isChatInputCommand()) {
            const { commandName, options } = int;

            // EMBED BUILDER (Service Down Mode)
            if (commandName === 'embed') {
                const maintenanceEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🚫 Access Denied')
                    .setDescription('This service is Down right now contact the owner for further details.')
                    .setTimestamp();
                return int.reply({ embeds: [maintenanceEmbed], ephemeral: true });
            }

            // EDIT ANY EMBED
            if (commandName === 'edit') {
                const messageId = options.getString('message_id');
                const newContent = options.getString('content');
                const targetMsg = await int.channel.messages.fetch(messageId);

                if (!targetMsg || targetMsg.author.id !== client.user.id) {
                    return int.reply({ content: "❌ I can only edit my own messages.", ephemeral: true });
                }

                const editedEmbed = EmbedBuilder.from(targetMsg.embeds[0]).setDescription(newContent);
                await targetMsg.edit({ embeds: [editedEmbed] });
                return int.reply({ content: "✅ Embed updated successfully.", ephemeral: true });
            }

            // SETUP
            if (commandName === 'setup') {
                config.logChannel = options.getChannel('logs').id;
                config.staffRole = options.getRole('staff').id;
                saveConfig(config);

                const selectMenu = new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('Select a category...')
                    .addOptions([
                        { label: 'General Support', value: 'general' },
                        { label: 'Management', value: 'management' },
                        { label: 'Internal Affairs', value: 'ia' },
                        { label: 'Human Resources', value: 'hr' }
                    ]);

                const setupEmbed = createAlaskaEmbed('🏛️ Alaska Support & Relations')
                    .setDescription('Select a category below to ensure your request reaches the correct team.')
                    .addFields(
                        { name: '📝 General Support', value: 'General questions and basic assistance.' },
                        { name: '👑 Management', value: 'High-level issues and partnerships.' },
                        { name: '⚖️ Internal Affairs', value: 'Staff misconduct and player reports.' },
                        { name: '👥 Human Resources', value: 'Rank inquiries and applications.' }
                    ).setImage(PROMO_BANNER);

                await int.channel.send({ embeds: [setupEmbed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
                return int.reply({ content: "✅ System Deployed.", ephemeral: true });
            }

            // PROMOTE & INFRACTION
            if (commandName === 'promote') {
                const user = options.getUser('user');
                const embed = createAlaskaEmbed('🔔 Alaska State Staff Promotion')
                    .setDescription(`Congratulations, ${user}! Your dedication has earned you a promotion!`)
                    .addFields({ name: 'Rank', value: options.getString('rank'), inline: true }, { name: 'Reason', value: options.getString('reason'), inline: true })
                    .setImage(PROMO_BANNER);
                return int.reply({ content: `${user}`, embeds: [embed] });
            }

            if (commandName === 'infraction') {
                const user = options.getUser('user');
                const embed = createAlaskaEmbed('⚖️ Formal Infraction Issued')
                    .addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Type', value: options.getString('type'), inline: true }, { name: 'Reason', value: options.getString('reason') })
                    .setImage(INFRACTION_BANNER).setColor("#e74c3c");
                return int.reply({ embeds: [embed] });
            }
        }
    } catch (e) { console.error(e); }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('setup').setDescription('Setup logs and ticket panel').addChannelOption(o => o.setName('logs').setRequired(true)).addRoleOption(o => o.setName('staff').setRequired(true)),
        new SlashCommandBuilder().setName('promote').setDescription('Promote staff').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('rank').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true)),
        new SlashCommandBuilder().setName('infraction').setDescription('Log infraction').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('type').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true)),
        new SlashCommandBuilder().setName('embed').setDescription('Build a custom embed'),
        new SlashCommandBuilder().setName('edit').setDescription('Edit an existing bot embed').addStringOption(o => o.setName('message_id').setRequired(true).setDescription('The ID of the message to edit')).addStringOption(o => o.setName('content').setRequired(true).setDescription('The new description content'))
    ];
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
    console.log('✅ Alaska Final Build Online.');
});

client.login(process.env.TOKEN);
