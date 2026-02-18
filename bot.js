// -------------------- Bot Dependencies --------------------
require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, 
    ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle, REST, 
    Routes, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message]
});

const BOT_COLOR = "#de8ef4"; 
client.commands = new Collection();

// -------------------- Express server for Hosting --------------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Alaska Management Bot is online.'));
app.listen(PORT, () => console.log(`🚀 Web server on port ${PORT}`));

// -------------------- Utility Functions --------------------
async function createTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    let content = `Transcript for #${channel.name}\n${'='.repeat(30)}\n`;
    messages.reverse().forEach(msg => {
        content += `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content}\n`;
    });
    const fileName = `transcript-${channel.id}.txt`;
    fs.writeFileSync(fileName, content);
    return fileName;
}

async function ensureCategoryAndLog(guild) {
    let category = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
    let logChannel = guild.channels.cache.find(c => c.name === 'ticket-logs' && c.type === ChannelType.GuildText);
    if (!logChannel) logChannel = await guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText });
    let staffRole = guild.roles.cache.find(r => r.name === 'Staff' || r.permissions.has(PermissionsBitField.Flags.ManageChannels));
    return { category, logChannel, staffRole };
}

// -------------------- Commands --------------------

// 1. Ticket Panel
client.commands.set('panel', {
    data: new SlashCommandBuilder().setName('panel').setDescription('Send ticket panel'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Alaska Management Support')
            .setDescription('Select a category below to open a ticket.')
            .setColor(BOT_COLOR);
        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_menu')
            .setPlaceholder('Select ticket type...')
            .addOptions([
                { label: 'Support', value: 'support', emoji: '🛠️' },
                { label: 'Report', value: 'report', emoji: '🚩' },
                { label: 'Application', value: 'apply', emoji: '📝' }
            ]);
        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    }
});

// 2. Interactive (New!)
client.commands.set('interactive', {
    data: new SlashCommandBuilder().setName('interactive').setDescription('Send embed with private buttons and dropdowns'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Alaska Management | Private Menu')
            .setDescription('Click a button or select an option to see a message only you can see.')
            .setColor(BOT_COLOR);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_private').setLabel('Secret Message').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_info').setLabel('Bot Info').setStyle(ButtonStyle.Secondary)
        );

        const dropdown = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('private_dropdown')
                .setPlaceholder('Pick a hidden category...')
                .addOptions([
                    { label: 'Rules', value: 'opt_rules', description: 'View server rules privately' },
                    { label: 'Staff', value: 'opt_staff', description: 'View staff info privately' }
                ])
        );

        await interaction.reply({ embeds: [embed], components: [buttons, dropdown] });
    }
});

// 3. Embed Builder
client.commands.set('embedbuilder', {
    data: new SlashCommandBuilder().setName('embedbuilder').setDescription('Create a custom embed'),
    async execute(interaction) {
        const embed = new EmbedBuilder().setTitle('New Embed').setDescription('Editing...').setColor(BOT_COLOR);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_embed_main').setLabel('Edit Content').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('finish_embed').setLabel('Post to Channel').setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ content: 'Use the buttons below.', embeds: [embed], components: [row], ephemeral: true });
    }
});

// -------------------- Combined Interaction Handler --------------------
client.on('interactionCreate', async interaction => {
    // Handling Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) await command.execute(interaction).catch(console.error);
    }

    // Handling Buttons
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_private') {
            return await interaction.reply({ content: '🤫 This is a private message! No one else can see this.', ephemeral: true });
        }
        if (interaction.customId === 'btn_info') {
            return await interaction.reply({ content: '🤖 Alaska Management Bot v2.0 - Running on Railway.', ephemeral: true });
        }

        // Ticket & Embed Builder Logic
        if (interaction.customId === 'close_ticket') {
            const { logChannel } = await ensureCategoryAndLog(interaction.guild);
            await interaction.reply('Closing in 5 seconds... Generating transcript.');
            const file = await createTranscript(interaction.channel);
            await logChannel.send({ content: `Ticket closed by ${interaction.user.tag}`, files: [file] });
            setTimeout(() => { interaction.channel.delete().catch(() => {}); }, 5000);
        }

        if (interaction.customId === 'edit_embed_main') {
            const modal = new ModalBuilder().setCustomId('embed_modal').setTitle('Embed Designer');
            const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short);
            const descInput = new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(descInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'finish_embed') {
            const receivedEmbed = interaction.message.embeds[0];
            await interaction.channel.send({ embeds: [EmbedBuilder.from(receivedEmbed)] });
            await interaction.update({ content: '✅ Embed Posted!', components: [], embeds: [] });
        }
    }

    // Handling Dropdowns
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'private_dropdown') {
            const val = interaction.values[0];
            let response = 'You selected an option!';
            if (val === 'opt_rules') response = '📜 **Rules:** 1. No spam. 2. Be respectful. 3. Follow Discord ToS.';
            if (val === 'opt_staff') response = '👥 **Staff:** Contact an Admin or Moderator for assistance.';
            return await interaction.reply({ content: response, ephemeral: true });
        }

        // Ticket Logic
        if (interaction.customId === 'ticket_menu') {
            const { category, staffRole } = await ensureCategoryAndLog(interaction.guild);
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                parent: category.id,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: staffRole?.id || interaction.guild.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const closeBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `Hey <@${interaction.user.id}>, help is on the way!`, components: [closeBtn] });
            await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
        }
    }

    // Handling Modals
    if (interaction.isModalSubmit() && interaction.customId === 'embed_modal') {
        const title = interaction.fields.getTextInputValue('title');
        const desc = interaction.fields.getTextInputValue('desc');
        const newEmbed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(BOT_COLOR);
        await interaction.update({ embeds: [newEmbed] });
    }
});

// -------------------- Ready & Registration --------------------
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        const commands = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash Commands Synchronized');
    } catch (err) { console.error(err); }
});

client.login(process.env.TOKEN);
