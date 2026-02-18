require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes 
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.MessageContent // REQUIRED for Snipe
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

client.commands = new Collection();
const snipes = new Map(); // Memory for deleted messages
const BOT_COLOR = "#f6b9bc";

// Web server for Railway
const app = express();
app.get('/', (req, res) => res.send('Alaska Ultra is Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- NEW COMMANDS: SNIPE & MUTE --------------------

// 1. SNIPE COMMAND
client.commands.set('snipe', {
    data: new SlashCommandBuilder().setName('snipe').setDescription('Show the last deleted message in this channel'),
    async execute(interaction) {
        const msg = snipes.get(interaction.channel.id);
        if (!msg) return interaction.reply({ content: "There's nothing to snipe!", ephemeral: true });

        const embed = new EmbedBuilder()
            .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
            .setDescription(msg.content || "[No text content]")
            .setFooter({ text: `Sniped by ${interaction.user.tag}` })
            .setTimestamp(msg.createdAt)
            .setColor(BOT_COLOR);

        if (msg.image) embed.setImage(msg.image);

        await interaction.reply({ embeds: [embed] });
    }
});

// 2. MUTE (TIMEOUT) COMMAND
client.commands.set('mute', {
    data: new SlashCommandBuilder().setName('mute').setDescription('Mute (Timeout) a member')
        .addUserOption(opt => opt.setName('target').setDescription('The user to mute').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for mute')),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) 
            return interaction.reply({ content: 'You need "Moderate Members" permission.', ephemeral: true });

        const user = interaction.options.getMember('target');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!user.manageable) return interaction.reply({ content: "I can't mute this user (higher rank).", ephemeral: true });

        await user.timeout(duration * 60 * 1000, reason);
        await interaction.reply(`🔇 **${user.user.tag}** has been muted for ${duration} minutes. | ${reason}`);
    }
});

// -------------------- EVENT LISTENERS --------------------

// SNIPE TRACKER: Catches deleted messages
client.on('messageDelete', async (message) => {
    if (message.partial || message.author?.bot) return;
    
    snipes.set(message.channel.id, {
        content: message.content,
        author: message.author,
        createdAt: message.createdAt,
        image: message.attachments.first()?.proxyURL || null
    });
});

// SETUP COMMAND (Verification & Tickets)
client.commands.set('setup', {
    data: new SlashCommandBuilder().setName('setup').setDescription('Deploy Panels'),
    async execute(interaction) {
        const tEmbed = new EmbedBuilder()
            .setTitle('🎫 Support & Inquiries')
            .setDescription('Click below to open a private ticket.')
            .setColor(BOT_COLOR)
            .setImage('https://output.googleusercontent.com/static/s/8f8b8/image_generation_content/0.png');

        const tRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Secondary).setEmoji('📩')
        );

        await interaction.channel.send({ embeds: [tEmbed], components: [tRow] });
        await interaction.reply({ content: 'Deployed!', ephemeral: true });
    }
});

// INTERACTION HANDLER
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction).catch(console.error);
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'open_ticket') {
            const ch = await interaction.guild.channels.create({
                name: `support-${interaction.user.username}`,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
            await ch.send({ content: `Staff will assist you shortly, <@${interaction.user.id}>.`, components: [btn] });
            return interaction.reply({ content: `Ticket created: ${ch}`, ephemeral: true });
        }
        if (interaction.customId === 'close_ticket') {
            await interaction.reply('Closing...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }
});

// READY & SYNC
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🚀 Alaska Ultra (Snipe/Mute/Support) is Online!`);
});

client.login(process.env.TOKEN);
