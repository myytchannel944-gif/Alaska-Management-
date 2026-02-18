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
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.GuildMember]
});

client.commands = new Collection();
const BOT_COLOR = "#de8ef4";

// --- Utility: Log Fetcher ---
async function getLogChannel(guild) {
    return guild.channels.cache.find(c => c.name === 'alaska-logs') || 
           await guild.channels.create({ name: 'alaska-logs', type: ChannelType.GuildText, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
}

// -------------------- COMMANDS --------------------

// 1. SETUP COMMAND
client.commands.set('setup', {
    data: new SlashCommandBuilder().setName('setup').setDescription('Deploy Verification & Ticket panels'),
    async execute(interaction) {
        const vEmbed = new EmbedBuilder().setTitle('✅ Verification').setDescription('Click below to access the server.').setColor(BOT_COLOR);
        const vRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify').setStyle(ButtonStyle.Success));
        const tEmbed = new EmbedBuilder().setTitle('🎫 Support').setDescription('Open a ticket for staff assistance.').setColor(BOT_COLOR);
        const tRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary));
        
        await interaction.channel.send({ embeds: [vEmbed], components: [vRow] });
        await interaction.channel.send({ embeds: [tEmbed], components: [tRow] });
        await interaction.reply({ content: 'Panels deployed.', ephemeral: true });
    }
});

// 2. MODERATION: BAN
client.commands.set('ban', {
    data: new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
        .addUserOption(opt => opt.setName('target').setDescription('The user to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for ban')),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const user = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        await interaction.guild.members.ban(user, { reason });
        await interaction.reply(`🔨 **${user.tag}** has been banned | ${reason}`);
    }
});

// 3. MODERATION: PURGE
client.commands.set('purge', {
    data: new SlashCommandBuilder().setName('purge').setDescription('Delete messages')
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount (1-100)').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        await interaction.channel.bulkDelete(amount, true);
        await interaction.reply({ content: `🧹 Deleted ${amount} messages.`, ephemeral: true });
    }
});

// 4. UTILITY: USERINFO
client.commands.set('userinfo', {
    data: new SlashCommandBuilder().setName('userinfo').setDescription('Shows info about a user')
        .addUserOption(opt => opt.setName('target').setDescription('The user')),
    async execute(interaction) {
        const user = interaction.options.getUser('target') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id);
        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Info`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Roles', value: member.roles.cache.map(r => r).join(' ').replace('@everyone', '') || 'None' }
            ).setColor(BOT_COLOR);
        await interaction.reply({ embeds: [embed] });
    }
});

// -------------------- EVENTS --------------------

// JOIN LOGGER
client.on('guildMemberAdd', async member => {
    const logs = await getLogChannel(member.guild);
    logs.send(`📥 **Join:** ${member.user.tag} joined the server.`);
});

// LEAVE LOGGER
client.on('guildMemberRemove', async member => {
    const logs = await getLogChannel(member.guild);
    logs.send(`📤 **Leave:** ${member.user.tag} left the server.`);
});

// INTERACTION HANDLER
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    if (interaction.isButton()) {
        const logs = await getLogChannel(interaction.guild);
        
        if (interaction.customId === 'verify_user') {
            const role = interaction.guild.roles.cache.find(r => r.name === "Verified");
            if (!role) return interaction.reply({ content: 'Create a "Verified" role!', ephemeral: true });
            await interaction.member.roles.add(role);
            return interaction.reply({ content: 'Verified!', ephemeral: true });
        }

        if (interaction.customId === 'open_ticket') {
            const ch = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
            await ch.send({ content: `Staff will help you soon, <@${interaction.user.id}>.`, components: [btn] });
            return interaction.reply({ content: `Ticket: ${ch}`, ephemeral: true });
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply('Closing...');
            setTimeout(() => interaction.channel.delete(), 5000);
        }
    }
});

// READY
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Alaska Ultra Online');
});

client.login(process.env.TOKEN);
const app = express(); app.get('/', (req, res) => res.send('Online')); app.listen(process.env.PORT || 3000);
