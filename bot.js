require('dotenv').config();
const fs = require('fs');
const fetch = require('node-fetch');
const {
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, PermissionsBitField, REST, Routes, ActivityType,
    AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ─── Constants & Storage ────────────────────────────────────────
const BOT_COLOR = '#f6b9bc';
// Your updated Alaska State Roleplay Banners
const PROMO_BANNER = 'https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg';
const INFRACTION_BANNER = 'https://cdn.discordapp.com/attachments/1341148810620833894/1341585148008435753/4bae16d5-a785-45f7-a5f3-103560ef0003.jpg';

const FILES = {
    CONFIG: './config.json',
    BOLOS: './bolos.json',
    VERIFY: './verifications.json'
};

// Initialize files
Object.values(FILES).forEach(path => {
    if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(path === FILES.VERIFY ? {} : []));
});

let config = JSON.parse(fs.readFileSync(FILES.CONFIG, 'utf-8'));
const activeShifts = new Map();

// ─── Helpers ─────────────────────────────────────────────────────
const save = (path, data) => fs.writeFileSync(path, JSON.stringify(data, null, 2));
const alaskaEmbed = (title, color = BOT_COLOR) => new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
const isStaff = (member) => config.staffRole && member.roles.cache.has(config.staffRole);

// ─── Interaction Handler ─────────────────────────────────────────
client.on('interactionCreate', async int => {
    if (!int.guild || int.user.bot) return;

    try {
        // --- BUTTONS (Tickets) ---
        if (int.isButton()) {
            if (int.customId === 'open_ticket') {
                const modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Alaska Support Session')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('reason').setLabel('What do you need help with?').setStyle(TextInputStyle.Paragraph).setRequired(true)
                    ));
                return int.showModal(modal);
            }

            if (int.customId === 'close_ticket') {
                await int.reply("📑 **Black Box: Generating Archive...**");
                const messages = await int.channel.messages.fetch({ limit: 100 });
                const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
                
                if (config.logChannel) {
                    const logCh = int.guild.channels.cache.get(config.logChannel);
                    const attach = new AttachmentBuilder(Buffer.from(transcript), { name: `transcript-${int.channel.name}.txt` });
                    await logCh.send({ 
                        embeds: [alaskaEmbed('📂 Session Archived').setDescription(`**Channel:** ${int.channel.name}\n**Closed by:** ${int.user.tag}`)], 
                        files: [attach] 
                    });
                }
                setTimeout(() => int.channel.delete().catch(() => {}), 5000);
            }
        }

        // --- MODALS ---
        if (int.isModalSubmit() && int.customId === 'ticket_modal') {
            const reason = int.fields.getTextInputValue('reason');
            const ch = await int.guild.channels.create({
                name: `session-${int.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Session').setStyle(ButtonStyle.Danger)
            );
            await ch.send({ 
                content: `<@&${config.staffRole}>`, 
                embeds: [alaskaEmbed('🏛️ Support Session').setDescription(`**Opened by:** ${int.user}\n**Reason:** ${reason}`)], 
                components: [row] 
            });
            return int.reply({ content: `Session opened: ${ch}`, ephemeral: true });
        }

        // --- SLASH COMMANDS ---
        if (int.isChatInputCommand()) {
            const { commandName, options } = int;

            if (commandName === 'setup') {
                config.logChannel = options.getChannel('logs').id;
                config.staffRole = options.getRole('staff').id;
                save(FILES.CONFIG, config);
                
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'));
                await int.channel.send({ 
                    embeds: [alaskaEmbed('🏛️ Alaska Support & Relations')
                    .setDescription('Click the button below to open a private support session.')
                    .setImage(PROMO_BANNER)], 
                    components: [row] 
                });
                return int.reply({ content: '✅ System Deployed.', ephemeral: true });
            }

            if (commandName === 'promote') {
                const user = options.getUser('user');
                const rank = options.getString('rank');
                const reason = options.getString('reason');

                const embed = alaskaEmbed('🔔 Alaska State Staff Promotion')
                    .setDescription(`Congratulations, ${user}! Your hard work and dedication have not gone unnoticed. Well deserved and earned!`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Rank', value: rank, inline: true }
                    )
                    .setImage(PROMO_BANNER)
                    .setFooter({ text: `Signed, ${int.user.username}` });

                return int.reply({ content: `${user}`, embeds: [embed] });
            }

            if (commandName === 'infraction') {
                const user = options.getUser('user');
                const embed = alaskaEmbed('⚖️ Formal Infraction Issued', '#e74c3c')
                    .addFields(
                        { name: 'User', value: `${user}`, inline: true },
                        { name: 'Type', value: options.getString('type'), inline: true },
                        { name: 'Reason', value: options.getString('reason'), inline: false }
                    )
                    .setImage(INFRACTION_BANNER)
                    .setFooter({ text: `Issuing Officer: ${int.user.username}` });

                return int.reply({ embeds: [embed] });
            }
        }
    } catch (err) {
        console.error(err);
    }
});

client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder().setName('setup').setDescription('Configure bot').addChannelOption(o => o.setName('logs').setRequired(true).setDescription('Logs')).addRoleOption(o => o.setName('staff').setRequired(true).setDescription('Staff Role')),
        new SlashCommandBuilder().setName('promote').setDescription('Promote staff').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('rank').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true)),
        new SlashCommandBuilder().setName('infraction').setDescription('Log infraction').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('type').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true))
    ];
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
    console.log('✅ Alaska Script Online');
});

client.login(process.env.TOKEN);
