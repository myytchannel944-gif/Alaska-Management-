require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, StringSelectMenuBuilder
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

client.commands = new Collection();
const snipes = new Map(); 
const BOT_COLOR = "#f6b9bc"; 

// --- Database Simulation ---
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

let config = loadData('./config.json', { ticketRole: null, logChannel: null });

// Web server for Railway
const app = express();
app.get('/', (req, res) => res.send('Alaska System is Live.'));
app.listen(process.env.PORT || 3000);

// -------------------- PROFESSIONAL COMMANDS --------------------

// 1. STATUS COMMAND
client.commands.set('status', {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('View the bot\'s current performance and uptime'),
    async execute(interaction) {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        const statusEmbed = new EmbedBuilder()
            .setTitle('📈 System Status')
            .addFields(
                { name: 'Ping', value: `\`${client.ws.ping}ms\``, inline: true },
                { name: 'Uptime', value: `\`${hours}h ${minutes}m\``, inline: true },
                { name: 'Version', value: '`2.4.0-Infinite`', inline: true },
                { name: 'Memory Usage', value: `\`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\``, inline: true }
            )
            .setColor(BOT_COLOR)
            .setFooter({ text: 'Alaska Operational Systems' });

        await interaction.reply({ embeds: [statusEmbed] });
    }
});

// 2. SETUP COMMAND (Enhanced)
client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy Professional Management Panels')
        .addRoleOption(option => option.setName('staff_role').setDescription('Role for ticket access').setRequired(true))
        .addChannelOption(option => option.setName('log_channel').setDescription('Channel for system logs').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: 'Insufficient Permissions.', ephemeral: true });

        const staffRole = interaction.options.getRole('staff_role');
        const logs = interaction.options.getChannel('log_channel');
        
        config.ticketRole = staffRole.id;
        config.logChannel = logs.id;
        saveData('./config.json', config);

        const vEmbed = new EmbedBuilder()
            .setTitle('🛡️ Identity Verification')
            .setDescription('To ensure server security, verify your account below to unlock community channels.')
            .setColor(BOT_COLOR);

        const vRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_user').setLabel('Verify Account').setStyle(ButtonStyle.Secondary)
        );

        const tEmbed = new EmbedBuilder()
            .setTitle('📩 Support & Inquiries')
            .setDescription('Select a category to open a private communication channel.')
            .setImage('https://output.googleusercontent.com/static/s/8f8b8/image_generation_content/0.png')
            .setColor(BOT_COLOR);

        const tRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket_select')
                .setPlaceholder('Select category...')
                .addOptions([
                    { label: 'General Support', value: 'general', emoji: '🛠️' },
                    { label: 'Player Reporting', value: 'report', emoji: '🚫' }
                ])
        );

        await interaction.channel.send({ embeds: [vEmbed], components: [vRow] });
        await interaction.channel.send({ embeds: [tEmbed], components: [tRow] });
        await interaction.reply({ content: '✅ Panels deployed. System logs linked to ' + logs.toString(), ephemeral: true });
    }
});

// -------------------- EVENT ENGINE --------------------

// JOIN LOGGER
client.on('guildMemberAdd', async member => {
    if (!config.logChannel) return;
    const logChan = member.guild.channels.cache.get(config.logChannel);
    if (logChan) {
        const joinEmbed = new EmbedBuilder()
            .setAuthor({ name: 'User Joined', iconURL: member.user.displayAvatarURL() })
            .setDescription(`${member.user} has joined the server.`)
            .addFields({ name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
            .setColor('#2ecc71')
            .setTimestamp();
        logChan.send({ embeds: [joinEmbed] });
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'verify_user') {
            const role = interaction.guild.roles.cache.find(r => r.name === "Verified");
            if (role) await interaction.member.roles.add(role);
            return interaction.reply({ content: '✅ Identity Verified.', ephemeral: true });
        }
        if (interaction.customId === 'close_ticket') {
            await interaction.reply('🔒 Archiving channel...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
        const staffId = config.ticketRole;
        const channel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: staffId, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
        });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
        );
        await channel.send({ content: `<@&${staffId}> | Support needed.`, components: [row] });
        await interaction.reply({ content: `✅ Ticket: ${channel}`, ephemeral: true });
    }
});

// SNIPE TRACKER
client.on('messageDelete', m => {
    if (m.partial || m.author?.bot) return;
    snipes.set(m.channel.id, { content: m.content, author: m.author.tag, time: m.createdAt });
});

// -------------------- REGISTRATION --------------------

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    // Adding snipe to registration
    commands.push(new SlashCommandBuilder().setName('snipe').setDescription('Recover last deleted message').toJSON());
    
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    
    // Set professional presence
    client.user.setPresence({
        activities: [{ name: 'Alaska Management', type: 3 }], // Watching
        status: 'online',
    });
    console.log(`✅ System Online.`);
});

client.login(process.env.TOKEN);
