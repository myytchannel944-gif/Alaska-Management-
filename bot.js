// alaska-bot all-in-one with auto slash command registration
const { Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});

const BOT_COLOR = "#de8ef4"; // Purple embed color
client.commands = new Collection();

// -------------------- Utility: Create transcript --------------------
async function createTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    let content = '';
    messages.reverse().forEach(msg => content += `${msg.author.tag}: ${msg.content}\n`);
    const fileName = `transcript-${channel.id}.txt`;
    fs.writeFileSync(fileName, content);
    return fileName;
}

// -------------------- Ensure Category & Log Channel --------------------
async function ensureCategoryAndLog(guild) {
    let category = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });

    let logChannel = guild.channels.cache.find(c => c.name === 'ticket-logs' && c.type === ChannelType.GuildText);
    if (!logChannel) logChannel = await guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText });

    let staffRole = guild.roles.cache.find(r => r.permissions.has(PermissionsBitField.Flags.ManageChannels));
    if (!staffRole) staffRole = await guild.roles.create({ name: 'Staff', permissions: [PermissionsBitField.Flags.ManageChannels] });

    return { category, logChannel, staffRole };
}

// -------------------- /panel command --------------------
client.commands.set('panel', {
    data: new SlashCommandBuilder().setName('panel').setDescription('Send ticket panel'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Alaska Management Support')
            .setDescription('Select a category below to open a ticket')
            .setColor(BOT_COLOR)
            .setFooter({ text: 'Alaska Management' })
            .setTimestamp();

        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_menu')
            .setPlaceholder('Select ticket type')
            .addOptions([
                { label: 'Support', value: 'support' },
                { label: 'Report', value: 'report' },
                { label: 'Application', value: 'apply' }
            ]);

        const row = new ActionRowBuilder().addComponents(menu);
        interaction.reply({ embeds: [embed], components: [row] });
    }
});

// -------------------- Interaction handler --------------------
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) await command.execute(interaction);
    }

    // Ticket dropdown
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
        const type = interaction.values[0];
        const { category, logChannel, staffRole } = await ensureCategoryAndLog(interaction.guild);

        const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`);
        if (existing) return interaction.reply({ content: 'You already have a ticket open!', ephemeral: true });

        const channel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `Welcome <@${interaction.user.id}> | Ticket type: **${type}**`, components: [row] });
        interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
    }

    // Close ticket button
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        const { logChannel } = await ensureCategoryAndLog(interaction.guild);
        await interaction.reply({ content: 'Closing ticket...', ephemeral: true });
        const transcript = await createTranscript(interaction.channel);
        logChannel.send({ content: `Ticket closed: ${interaction.channel.name}`, files: [transcript] });
        setTimeout(() => interaction.channel.delete(), 3000);
    }
});

// -------------------- Ready --------------------
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // -------------------- Register slash command --------------------
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = [client.commands.get('panel').data.toJSON()];

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ /panel command registered globally!');
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
    }
});

// -------------------- Login --------------------
if (!process.env.TOKEN) {
    console.error("❌ TOKEN not found! Add it in Render Environment Variables as TOKEN");
    process.exit(1);
}
client.login(process.env.TOKEN);
