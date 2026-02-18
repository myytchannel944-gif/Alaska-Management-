// -------------------- Auto-generate package.json if missing --------------------
const fs = require('fs');
const path = './package.json';

if (!fs.existsSync(path)) {
    const pkg = {
        "name": "alaska-management-bot",
        "version": "1.1.0",
        "description": "All-in-one Discord bot with ticket system and interactive embed builder",
        "main": "bot.js",
        "scripts": { "start": "node bot.js" },
        "dependencies": {
            "discord.js": "^14.15.0",
            "dotenv": "^16.3.1",
            "express": "^4.18.2"
        },
        "engines": { "node": ">=18.x" }
    };
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2));
    console.log("✅ package.json created!");
}

// -------------------- Bot Dependencies --------------------
require('dotenv').config();
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
        GatewayIntentBits.MessageContent, // CRITICAL for transcripts
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message]
});

const BOT_COLOR = "#de8ef4"; 
client.commands = new Collection();

// -------------------- Express server for Render --------------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Alaska Management Bot is online.'));
app.listen(PORT, () => console.log(`🚀 Web server on port ${PORT}`));

// -------------------- Utility: Create & Clean Transcript --------------------
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

// -------------------- Ensure Category & Log Channel --------------------
async function ensureCategoryAndLog(guild) {
    let category = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });

    let logChannel = guild.channels.cache.find(c => c.name === 'ticket-logs' && c.type === ChannelType.GuildText);
    if (!logChannel) logChannel = await guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText });

    let staffRole = guild.roles.cache.find(r => r.name === 'Staff' || r.permissions.has(PermissionsBitField.Flags.ManageChannels));
    
    return { category, logChannel, staffRole };
}

// -------------------- Commands --------------------
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

client.commands.set('embedbuilder', {
    data: new SlashCommandBuilder().setName('embedbuilder').setDescription('Create a custom embed using Modals'),
    async execute(interaction) {
        const embed = new EmbedBuilder().setTitle('New Embed').setDescription('Editing...').setColor(BOT_COLOR);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_embed_main').setLabel('Edit Content').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('finish_embed').setLabel('Post to Channel').setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ 
            content: 'Click "Edit Content" to set the Title and Description.', 
            embeds: [embed], 
            components: [row], 
            ephemeral: true 
        });
    }
});

// -------------------- Interaction Handler --------------------
client.on('interactionCreate', async interaction => {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) try { await command.execute(interaction); } catch (e) { console.error(e); }
    }

    // 2. Ticket Menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
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

        const closeBtn = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `Hey <@${interaction.user.id}>, staff will be with you shortly.`, components: [closeBtn] });
        await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
    }

    // 3. Buttons & Modals
    if (interaction.isButton()) {
        if (interaction.customId === 'close_ticket') {
            const { logChannel } = await ensureCategoryAndLog(interaction.guild);
            await interaction.reply('Closing in 5 seconds... Generating transcript.');
            
            const file = await createTranscript(interaction.channel);
            await logChannel.send({ content: `Ticket closed by ${interaction.user.tag}`, files: [file] });
            
            setTimeout(() => {
                interaction.channel.delete().catch(() => {});
                if (fs.existsSync(file)) fs.unlinkSync(file); // Cleanup disk
            }, 5000);
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
