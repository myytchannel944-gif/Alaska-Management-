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

// --- banner configuration ---
const BANNER_URL = "https://assets.grok.com/anon-users/7e76ba75-8c97-4e70-a30c-b1e4123a53d7/generated/2e33484f-bd5c-4c40-8752-95d963b03366/image.jpg";

// --- persistent config ---
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

const app = express();
app.get('/', (req, res) => res.send('alaska apex sentinel is live.'));
app.listen(process.env.PORT || 3000);

// -------------------- commands --------------------

client.commands.set('embedbuilder', {
    data: new SlashCommandBuilder().setName('embedbuilder').setDescription('open embed creator'),
    async execute(interaction) {
        await interaction.reply({ 
            embeds: [new EmbedBuilder().setTitle('⚠️ maintenance').setDescription('the **embed builder** is currently unavailable.').setColor('#f1c40f')], 
            ephemeral: true 
        });
    }
});

client.commands.set('lockdown', {
    data: new SlashCommandBuilder().setName('lockdown').setDescription('freeze channel'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'restricted.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 lockdown').setDescription('channel restricted by management.').setColor('#ff4757')] });
    }
});

client.commands.set('unlock', {
    data: new SlashCommandBuilder().setName('unlock').setDescription('lift lockdown'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: 'restricted.', ephemeral: true });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔓 unlocked').setDescription('standard communication resumed.').setColor('#2ecc71')] });
    }
});

client.commands.set('snipe', {
    data: new SlashCommandBuilder().setName('snipe').setDescription('recover deleted message'),
    async execute(interaction) {
        const msg = snipes.get(interaction.channel.id);
        if (!msg) return interaction.reply({ content: 'nothing to snipe!', ephemeral: true });
        await interaction.reply({ embeds: [new EmbedBuilder().setAuthor({ name: msg.author, iconURL: msg.avatar }).setDescription(msg.content || "[no content]").setColor(BOT_COLOR).setFooter({ text: `deleted at: ${msg.time}` })] });
    }
});

// -------------------- setup (lowercase + banner) --------------------

client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('deploy infrastructure')
        .addRoleOption(opt => opt.setName('general').setDescription('role for general support').setRequired(true))
        .addRoleOption(opt => opt.setName('internal_affairs').setDescription('role for internal affairs').setRequired(true))
        .addRoleOption(opt => opt.setName('management').setDescription('role for management').setRequired(true))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('log channel').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: 'admin only.', ephemeral: true });
        config.generalRole = interaction.options.getRole('general').id;
        config.staffRole = interaction.options.getRole('internal_affairs').id;
        config.mgmtRole = interaction.options.getRole('management').id;
        config.logChannel = interaction.options.getChannel('log_channel').id;
        saveData('./config.json', config);

        const mainEmbed = new EmbedBuilder()
            .setTitle('🏛️ support & relations')
            .setDescription('select a department below to open an inquiry.')
            .setImage(BANNER_URL)
            .setColor(BOT_COLOR);

        const gMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_general').setPlaceholder('general').addOptions([{ label: 'general questions', value: 'general questions', emoji: '❓' }, { label: 'member reports', value: 'member reports', emoji: '👥' }, { label: 'server bugs', value: 'server bugs', emoji: '🐛' }, { label: 'partnerships', value: 'partnerships', emoji: '🤝' }]));
        const iMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_ia').setPlaceholder('internal affairs').addOptions([{ label: 'staff reports', value: 'staff reports', emoji: '👮' }, { label: 'staff appeals', value: 'staff appeals', emoji: '⚖️' }, { label: 'severe matters', value: 'severe matters', emoji: '⚠️' }, { label: 'staff misconduct', value: 'staff misconduct', emoji: '🛑' }]));
        const mMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('management').addOptions([{ label: 'claiming perks', value: 'claiming perks', emoji: '💎' }, { label: 'appealing punishments', value: 'appealing punishments', emoji: '🔨' }]));

        await interaction.channel.send({ embeds: [mainEmbed], components: [gMenu, iMenu, mMenu] });
        await interaction.reply({ content: '✅ infrastructure deployed.', ephemeral: true });
    }
});

// -------------------- interactions --------------------

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const cat = interaction.values[0];
        let roleId, deptName;
        if (interaction.customId === 'ticket_general') { roleId = config.generalRole; deptName = "general"; }
        else if (interaction.customId === 'ticket_ia') { roleId = config.staffRole; deptName = "internal affairs"; }
        else { roleId = config.mgmtRole; deptName = "management"; }

        const ch = await interaction.guild.channels.create({
            name: `${cat.replace(/\s+/g, '-')}-${interaction.user.username}`.toLowerCase(),
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }, { id: roleId, allow: [PermissionsBitField.Flags.ViewChannel] }]
        });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_modal').setLabel('resolve & close').setStyle(ButtonStyle.Danger));
        await ch.send({ content: `**department:** ${deptName} | <@&${roleId}>`, embeds: [new EmbedBuilder().setTitle(`session: ${cat}`).setDescription(`greetings <@${interaction.user.id}>. a member of **${deptName}** will assist you shortly.`).setColor(BOT_COLOR)], components: [row] });
        await interaction.reply({ content: `✅ ticket created: ${ch}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_modal') {
        const modal = new ModalBuilder().setCustomId('close_reason_modal').setTitle('close ticket');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close_reason').setLabel("resolution reason").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        const log = interaction.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle('🔒 ticket resolved').addFields({ name: 'closed by', value: interaction.user.tag }, { name: 'reason', value: reason }).setColor('#ff4757').setTimestamp()] });
        await interaction.reply('🔒 archiving...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('messageDelete', m => { if (!m.author?.bot) snipes.set(m.channel.id, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL(), time: m.createdAt.toLocaleString() }); });

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const cmds = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    console.log(`✅ alaska apex sentinel online.`);
});

client.login(process.env.TOKEN);
