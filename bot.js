// alaska-bot all-in-one with auto slash command registration
const { Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
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

// -------------------- /embedbuilder command --------------------
client.commands.set('embedbuilder', {
    data: new SlashCommandBuilder().setName('embedbuilder').setDescription('Build a fully interactive embed/dashboard'),
    async execute(interaction) {
        let embed = new EmbedBuilder()
            .setColor(BOT_COLOR)
            .setTitle('New Embed')
            .setDescription('Use the buttons or dropdowns below to customize me!')
            .setFooter({ text: 'Alaska Management' });

        const buttonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('set_title').setLabel('Set Title').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('set_desc').setLabel('Set Description').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('set_color').setLabel('Set Color').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('add_field').setLabel('Add Field').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('finish_embed').setLabel('Finish').setStyle(ButtonStyle.Danger)
        );

        const dropdownRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('embed_options')
                .setPlaceholder('Advanced options')
                .addOptions([
                    { label: 'Set Footer', value: 'set_footer' },
                    { label: 'Set Thumbnail', value: 'set_thumb' },
                    { label: 'Set Image', value: 'set_image' }
                ])
        );

        const msg = await interaction.reply({ embeds: [embed], components: [buttonsRow, dropdownRow], fetchReply: true, ephemeral: true });

        const askInput = async (prompt) => {
            await interaction.followUp({ content: prompt, ephemeral: true });
            const filter = m => m.author.id === interaction.user.id;
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000 });
            return collected.first().content;
        };

        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 900000 });
        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user can edit this embed.', ephemeral: true });

            if (i.customId === 'set_title') {
                const title = await askInput('Enter the embed title:');
                embed.setTitle(title);
            } else if (i.customId === 'set_desc') {
                const desc = await askInput('Enter the embed description:');
                embed.setDescription(desc);
            } else if (i.customId === 'set_color') {
                const color = await askInput('Enter a hex color (e.g., #de8ef4):');
                embed.setColor(color);
            } else if (i.customId === 'add_field') {
                const fieldInput = await askInput('Enter field as: `name | value | inline(true/false)`');
                const [name, value, inline] = fieldInput.split('|').map(x => x.trim());
                embed.addFields({ name, value, inline: inline === 'true' });
            } else if (i.customId === 'finish_embed') {
                collector.stop();
                await i.update({ content: 'Embed finished!', embeds: [embed], components: [] });
                interaction.channel.send({ embeds: [embed] });
            }

            await i.editReply({ embeds: [embed] });
        });

        const dropdownCollector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 900000 });
        dropdownCollector.on('collect', async sel => {
            if (sel.user.id !== interaction.user.id) return sel.reply({ content: 'Only the command user can edit this embed.', ephemeral: true });

            if (sel.values[0] === 'set_footer') {
                const footer = await askInput('Enter the footer text:');
                embed.setFooter({ text: footer });
            } else if (sel.values[0] === 'set_thumb') {
                const thumb = await askInput('Enter the thumbnail URL:');
                embed.setThumbnail(thumb);
            } else if (sel.values[0] === 'set_image') {
                const img = await askInput('Enter the image URL:');
                embed.setImage(img);
            }

            await sel.update({ embeds: [embed] });
        });

        collector.on('end', async () => await msg.edit({ components: [] }).catch(() => {}));
        dropdownCollector.on('end', async () => await msg.edit({ components: [] }).catch(() => {}));
    }
});

// -------------------- Interaction handler for tickets --------------------
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

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Commands registered globally!');
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
