require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, StringSelectMenuBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

client.commands = new Collection();
const snipes = new Map(); 
const BOT_COLOR = "#f6b9bc"; 

// --- Persistent Config ---
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

// Web server for Railway
const app = express();
app.get('/', (req, res) => res.send('Alaska Apex Sentinel is Live.'));
app.listen(process.env.PORT || 3000);

// -------------------- COMMANDS: UTILITY & STATUS --------------------

client.commands.set('status', {
    data: new SlashCommandBuilder().setName('status').setDescription('View system health and active inquiry analytics'),
    async execute(interaction) {
        const ticketCount = interaction.guild.channels.cache.filter(c => 
            c.name.includes('questions') || c.name.includes('reports') || c.name.includes('appeals')
        ).size;
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        const statusEmbed = new EmbedBuilder()
            .setTitle('📈 System Analytics')
            .addFields(
                { name: 'Active Inquiries', value: `\`${ticketCount}\``, inline: true },
                { name: 'Latency', value: `\`${client.ws.ping}ms\``, inline: true },
                { name: 'Uptime', value: `\`${hours}h ${minutes}m\``, inline: true }
            )
            .setColor(BOT_COLOR).setFooter({ text: 'Alaska Executive Operations' });
        await interaction.reply({ embeds: [statusEmbed] });
    }
});

client.commands.set('embedbuilder', {
    data: new SlashCommandBuilder().setName('embedbuilder').setDescription('Open the interactive embed creator'),
    async execute(interaction) {
        await interaction.reply({ 
            embeds: [new EmbedBuilder().setTitle('⚠️ Maintenance').setDescription('The **Executive Embed Builder** is currently unavailable.').setColor('#f1c40f')], 
            ephemeral: true 
        });
    }
});

// -------------------- COMMANDS: MODERATION & LOCKDOWN --------------------

client.commands.set('lockdown', {
    data: new SlashCommandBuilder().setName('lockdown').setDescription('Freeze current channel'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'Restricted.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 Lockdown').setDescription('Channel access restricted by Management.').setColor('#ff4757')] });
    }
});

client.commands.set('unlock', {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Lift lockdown'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'Restricted.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔓 Unlocked').setDescription('Standard communication resumed.').setColor('#2ecc71')] });
    }
});

client.commands.set('snipe', {
    data: new SlashCommandBuilder().setName('snipe').setDescription('Recover deleted message'),
    async execute(interaction) {
        const msg = snipes.get(interaction.channel.id);
        if (!msg) return interaction.reply({ content: 'Nothing to snipe!', ephemeral: true });
        await interaction.reply({ embeds: [new EmbedBuilder().setAuthor({ name: msg.author, iconURL: msg.avatar }).setDescription(msg.content || "[No content]").setColor(BOT_COLOR).setFooter({ text: `Deleted at: ${msg.time}` })] });
    }
});

client.commands.set('mute', {
    data: new SlashCommandBuilder().setName('mute').setDescription('Timeout a member')
        .addUserOption(o => o.setName('target').setDescription('The user').setRequired(true))
        .addIntegerOption(o => o.setName('minutes').setDescription('Duration').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason')),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return interaction.reply({ content: 'No perms.', ephemeral: true });
        const user = interaction.options.getMember('target');
        const mins = interaction.options.getInteger('minutes');
        if (!user.manageable) return interaction.reply({ content: 'Cannot mute.', ephemeral: true });
        await user.timeout(mins * 60 * 1000, interaction.options.getString('reason') || 'No reason');
        await interaction.reply(`🔇 **${user.user.tag}** muted for ${mins}m.`);
    }
});

// -------------------- APEX SETUP (TRIPLE ROLE ROUTING) --------------------

client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy Professional Infrastructure')
        .addRoleOption(opt => opt.setName('general').setDescription('Role for GENERAL').setRequired(true))
        .addRoleOption(opt => opt.setName('internal_affairs').setDescription('Role for INTERNAL AFFAIRS').setRequired(true))
        .addRoleOption(opt => opt.setName('management').setDescription('Role for MANAGEMENT').setRequired(true))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for logs').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: 'Admin only.', ephemeral: true });
        config.generalRole = interaction.options.getRole('general').id;
        config.staffRole = interaction.options.getRole('internal_affairs').id;
        config.mgmtRole = interaction.options.getRole('management').id;
        config.logChannel = interaction.options.getChannel('log_channel').id;
        saveData('./config.json', config);

        const mainEmbed = new EmbedBuilder().setTitle('🏛️ Alaska Support & Relations').setDescription('Select a department below to notify a specific executive team.').setImage('https://output.googleusercontent.com/static/s/8f8b8/image_generation_content/0.png').setColor(BOT_COLOR);
        const gMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_general').setPlaceholder('GENERAL').addOptions([{ label: 'General Questions', value: 'General Questions', emoji: '❓' }, { label: 'Member Reports', value: 'Member Reports', emoji: '👥' }, { label: 'Server Bugs', value: 'Server Bugs', emoji: '🐛' }, { label: 'Partnerships', value: 'Partnerships', emoji: '🤝' }]));
        const iMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_ia').setPlaceholder('INTERNAL AFFAIRS').addOptions([{ label: 'Staff Reports', value: 'Staff Reports', emoji: '👮' }, { label: 'Staff Appeals', value: 'Staff Appeals', emoji: '⚖️' }, { label: 'Severe Matters', value: 'Severe Matters', emoji: '⚠️' }, { label: 'Staff Misconduct', value: 'Staff Misconduct', emoji: '🛑' }]));
        const mMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('MANAGEMENT').addOptions([{ label: 'Claiming Perks', value: 'Claiming Perks', emoji: '💎' }, { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' }]));

        await interaction.channel.send({ embeds: [mainEmbed], components: [gMenu, iMenu, mMenu] });
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
        const cat = interaction.values[0];
        let roleId, deptName;
        if (interaction.customId === 'ticket_general') { roleId = config.generalRole; deptName = "GENERAL"; }
        else if (interaction.customId === 'ticket_ia') { roleId = config.staffRole; deptName = "INTERNAL AFFAIRS"; }
        else { roleId = config.mgmtRole; deptName = "MANAGEMENT"; }

        const ch = await interaction.guild.channels.create({
            name: `${cat.replace(/\s+/g, '-')}-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }, { id: roleId, allow: [PermissionsBitField.Flags.ViewChannel] }]
        });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_modal').setLabel('Resolve & Close').setStyle(ButtonStyle.Danger));
        await ch.send({ content: `**DEPARTMENT:** ${deptName} | <@&${roleId}>`, embeds: [new EmbedBuilder().setTitle(`Session: ${cat}`).setDescription(`Greetings <@${interaction.user.id}>. A member of **${deptName}** will assist you shortly.`).setColor(BOT_COLOR)], components: [row] });
        await interaction.reply({ content: `✅ Ticket: ${ch}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_modal') {
        const modal = new ModalBuilder().setCustomId('close_reason_modal').setTitle('Close Ticket');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close_reason').setLabel("Resolution Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        const log = interaction.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle('🔒 Ticket Resolved').addFields({ name: 'Closed By', value: interaction.user.tag }, { name: 'Reason', value: reason }).setColor('#ff4757').setTimestamp()] });
        await interaction.reply('🔒 Archiving...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('messageDelete', m => { if (!m.author?.bot) snipes.set(m.channel.id, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL(), time: m.createdAt.toLocaleString() }); });

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const cmds = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    console.log(`✅ ALASKA APEX SENTINEL ONLINE.`);
});

client.login(process.env.TOKEN);
