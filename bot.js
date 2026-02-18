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

// --- Permanent Banner Configuration ---
const BANNER_URL = "https://cdn.discordapp.com/attachments/1472295068231532808/1473557629749039155/ocbvKoC.jpg?ex=6996a4fc&is=6995537c&hm=e38629356f5050e338cf33bed692c2caed54a6970a54da2ae1a0a75396cb932f&";

// --- Persistent Config ---
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

// Web server for Railway health checks
const app = express();
app.get('/', (req, res) => res.send('Alaska Apex Sentinel is live.'));
app.listen(process.env.PORT || 3000);

// -------------------- Core Professional Commands --------------------

client.commands.set('lockdown', {
    data: new SlashCommandBuilder().setName('lockdown').setDescription('Restrict access to the current channel'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'Access denied: Management permissions required.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 Lockdown').setDescription('This channel has been restricted by Management.').setColor('#ff4757')] });
    }
});

client.commands.set('unlock', {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Restore access to the current channel'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'Access denied: Management permissions required.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔓 Unlocked').setDescription('Standard communication has been resumed.').setColor('#2ecc71')] });
    }
});

client.commands.set('snipe', {
    data: new SlashCommandBuilder().setName('snipe').setDescription('Recover the most recently deleted message'),
    async execute(interaction) {
        const msg = snipes.get(interaction.channel.id);
        if (!msg) return interaction.reply({ content: 'No recently deleted messages found in this channel.', ephemeral: true });
        await interaction.reply({ embeds: [new EmbedBuilder().setAuthor({ name: msg.author, iconURL: msg.avatar }).setDescription(msg.content || "[No content]").setColor(BOT_COLOR).setFooter({ text: `Detected at: ${msg.time}` })] });
    }
});

// -------------------- Support Infrastructure (Setup) --------------------

client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy the professional support panel')
        .addRoleOption(opt => opt.setName('general').setDescription('Role for General Support').setRequired(true))
        .addRoleOption(opt => opt.setName('internal_affairs').setDescription('Role for Internal Affairs').setRequired(true))
        .addRoleOption(opt => opt.setName('management').setDescription('Role for Management Support').setRequired(true))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for administrative logs').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: 'Administrator access is required to deploy infrastructure.', ephemeral: true });
        
        config.generalRole = interaction.options.getRole('general').id;
        config.staffRole = interaction.options.getRole('internal_affairs').id;
        config.mgmtRole = interaction.options.getRole('management').id;
        config.logChannel = interaction.options.getChannel('log_channel').id;
        saveData('./config.json', config);

        const mainEmbed = new EmbedBuilder()
            .setTitle('🏛️ Support & Relations')
            .setDescription('Please select the appropriate department below to open an inquiry. Our executive team will be with you shortly.')
            .setImage(BANNER_URL)
            .setColor(BOT_COLOR);

        const gMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_general').setPlaceholder('General Support').addOptions([
            { label: 'General Questions', value: 'General Questions', emoji: '❓' },
            { label: 'Member Reports', value: 'Member Reports', emoji: '👥' },
            { label: 'Server Bugs', value: 'Server Bugs', emoji: '🐛' },
            { label: 'Partnerships', value: 'Partnerships', emoji: '🤝' }
        ]));

        const iMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_ia').setPlaceholder('Internal Affairs').addOptions([
            { label: 'Staff Reports', value: 'Staff Reports', emoji: '👮' },
            { label: 'Staff Appeals', value: 'Staff Appeals', emoji: '⚖️' },
            { label: 'Severe Matters', value: 'Severe Matters', emoji: '⚠️' },
            { label: 'Staff Misconduct', value: 'Staff Misconduct', emoji: '🛑' }
        ]));

        const mMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('Management').addOptions([
            { label: 'Claiming Perks', value: 'Claiming Perks', emoji: '💎' },
            { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' }
        ]));

        await interaction.channel.send({ embeds: [mainEmbed], components: [gMenu, iMenu, mMenu] });
        await interaction.reply({ content: '✅ Infrastructure successfully deployed with professional grammar and custom banner.', ephemeral: true });
    }
});

// -------------------- Interaction Logic --------------------

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const cat = interaction.values[0];
        let roleId, deptName;
        if (interaction.customId === 'ticket_general') { roleId = config.generalRole; deptName = "General Support"; }
        else if (interaction.customId === 'ticket_ia') { roleId = config.staffRole; deptName = "Internal Affairs"; }
        else { roleId = config.mgmtRole; deptName = "Management"; }

        const ch = await interaction.guild.channels.create({
            name: `${cat.replace(/\s+/g, '-')}-${interaction.user.username}`.toLowerCase(),
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_modal').setLabel('Resolve & Close').setStyle(ButtonStyle.Danger));
        await ch.send({ 
            content: `**Department Alert:** ${deptName} Team <@&${roleId}>`, 
            embeds: [new EmbedBuilder()
                .setTitle(`Support Session: ${cat}`)
                .setDescription(`Greetings <@${interaction.user.id}>. A member of the **${deptName}** team has been notified and will assist you shortly. Please provide any relevant details while you wait.`)
                .setColor(BOT_COLOR)], 
            components: [row] 
        });
        await interaction.reply({ content: `✅ Your inquiry has been created: ${ch}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_modal') {
        const modal = new ModalBuilder().setCustomId('close_reason_modal').setTitle('Resolve Inquiry');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close_reason').setLabel("Resolution Reason").setPlaceholder("Briefly describe how this inquiry was resolved.").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        const log = interaction.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle('🔒 Session Resolved').addFields({ name: 'Executor', value: interaction.user.tag }, { name: 'Resolution Reason', value: reason }, { name: 'Channel', value: interaction.channel.name }).setColor('#ff4757').setTimestamp()] });
        await interaction.reply('🔒 Resolving session and archiving channel...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('messageDelete', m => { if (!m.author?.bot) snipes.set(m.channel.id, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL(), time: m.createdAt.toLocaleString() }); });

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const cmds = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    console.log(`✅ Alaska Apex Sentinel is online.`);
});

client.login(process.env.TOKEN);
