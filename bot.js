require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, StringSelectMenuBuilder
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

client.commands = new Collection();
const BOT_COLOR = "#f6b9bc"; 

// --- Persistent Config ---
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { ticketRole: null, logChannel: null });

// Web server
const app = express();
app.get('/', (req, res) => res.send('Alaska Executive is Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- COMMANDS --------------------

// 1. STATUS & ANALYTICS
client.commands.set('status', {
    data: new SlashCommandBuilder().setName('status').setDescription('System health and ticket analytics'),
    async execute(interaction) {
        // Count active tickets based on channel name prefix
        const ticketCount = interaction.guild.channels.cache.filter(c => 
            c.name.includes('questions') || c.name.includes('reports') || 
            c.name.includes('appeals') || c.name.includes('matters')
        ).size;

        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        const statusEmbed = new EmbedBuilder()
            .setTitle('📈 Alaska System Analytics')
            .addFields(
                { name: 'Active Inquiries', value: `\`${ticketCount}\``, inline: true },
                { name: 'API Latency', value: `\`${client.ws.ping}ms\``, inline: true },
                { name: 'Uptime', value: `\`${hours}h ${minutes}m\``, inline: true },
                { name: 'System Load', value: `\`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\``, inline: true }
            )
            .setColor(BOT_COLOR)
            .setFooter({ text: 'Executive Management Dashboard' });

        await interaction.reply({ embeds: [statusEmbed] });
    }
});

// 2. EXECUTIVE SETUP (Categories)
client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy Professional Support Infrastructure')
        .addRoleOption(opt => opt.setName('staff_role').setDescription('Main Staff Role').setRequired(true))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for system logs').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: 'Restricted to Administrators.', ephemeral: true });

        config.ticketRole = interaction.options.getRole('staff_role').id;
        config.logChannel = interaction.options.getChannel('log_channel').id;
        saveData('./config.json', config);

        const mainEmbed = new EmbedBuilder()
            .setTitle('🏛️ Alaska Support & Relations')
            .setDescription('Please select the appropriate department below to open a formal inquiry.')
            .setImage('https://output.googleusercontent.com/static/s/8f8b8/image_generation_content/0.png')
            .setColor(BOT_COLOR);

        const generalMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('ticket_general').setPlaceholder('General Support').addOptions([
                { label: 'General Questions', value: 'General Questions', emoji: '❓' },
                { label: 'Member Reports', value: 'Member Reports', emoji: '👥' },
                { label: 'Server Bugs', value: 'Server Bugs', emoji: '🐛' },
                { label: 'Partnerships', value: 'Partnerships', emoji: '🤝' }
            ])
        );

        const iaMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('ticket_ia').setPlaceholder('Internal Affairs').addOptions([
                { label: 'Staff Reports', value: 'Staff Reports', emoji: '👮' },
                { label: 'Staff Appeals', value: 'Staff Appeals', emoji: '⚖️' },
                { label: 'Severe Matters', value: 'Severe Matters', emoji: '⚠️' },
                { label: 'Staff Misconduct', value: 'Staff Misconduct', emoji: '🛑' }
            ])
        );

        const mgmtMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('Management').addOptions([
                { label: 'Claiming Perks', value: 'Claiming Perks', emoji: '💎' },
                { label: 'Claiming Purchases', value: 'Claiming Purchases', emoji: '💰' },
                { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' },
                { label: 'Donation Issues', value: 'Donation Issues', emoji: '💸' }
            ])
        );

        const deptMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('ticket_dept').setPlaceholder('Department Support').addOptions([
                { label: 'Department Questions', value: 'Dept Questions', emoji: '🏢' },
                { label: 'Department Reports', value: 'Dept Reports', emoji: '📝' },
                { label: 'Issues with Command', value: 'Command Issues', emoji: '🎖️' }
            ])
        );

        await interaction.channel.send({ embeds: [mainEmbed], components: [generalMenu, iaMenu, mgmtMenu, deptMenu] });
        await interaction.reply({ content: '✅ Infrastructure Deployed.', ephemeral: true });
    }
});

// -------------------- INTERACTION ENGINE --------------------

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const category = interaction.values[0];
        const staffId = config.ticketRole;

        const channel = await interaction.guild.channels.create({
            name: `${category.replace(/\s+/g, '-')}-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: staffId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        // AUDIT LOG
        const logChan = interaction.guild.channels.cache.get(config.logChannel);
        if (logChan) logChan.send(`📥 **Inquiry Opened:** ${interaction.user.tag} opened a ticket for **${category}** (${channel.name})`);

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Support Session: ${category}`)
            .setDescription(`Greetings <@${interaction.user.id}>. A member of our staff team will be with you shortly.\n\n**Confidentiality Notice:** This channel is private and monitored by management.`)
            .setColor(BOT_COLOR);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Resolve & Close').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@&${staffId}>`, embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: `✅ Inquiry created: ${channel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        const logChan = interaction.guild.channels.cache.get(config.logChannel);
        if (logChan) logChan.send(`🔒 **Inquiry Closed:** ${interaction.channel.name} was marked as resolved by ${interaction.user.tag}.`);
        
        await interaction.reply('🔒 Archiving channel...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ Alaska Executive Ready.`);
});

client.login(process.env.TOKEN);
