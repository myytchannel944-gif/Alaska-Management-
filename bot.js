require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
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
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

// Web server
const app = express();
app.get('/', (req, res) => res.send('Alaska Apex is Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- APEX SETUP (Triple Role Routing) --------------------

client.commands.set('setup', {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy the Ultimate Support Infrastructure')
        .addRoleOption(opt => opt.setName('general_role').setDescription('Role for General Support tickets').setRequired(true))
        .addRoleOption(opt => opt.setName('staff_role').setDescription('Role for Internal Affairs tickets').setRequired(true))
        .addRoleOption(opt => opt.setName('mgmt_role').setDescription('Role for Management tickets').setRequired(true))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for formal Ticket Logs').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: 'Restricted to Administrators.', ephemeral: true });

        config.generalRole = interaction.options.getRole('general_role').id;
        config.staffRole = interaction.options.getRole('staff_role').id;
        config.mgmtRole = interaction.options.getRole('mgmt_role').id;
        config.logChannel = interaction.options.getChannel('log_channel').id;
        saveData('./config.json', config);

        const mainEmbed = new EmbedBuilder()
            .setTitle('🏛️ Alaska Support & Relations')
            .setDescription('Select the appropriate department below. Each selection notifies a specific high-level team.')
            .setImage('https://output.googleusercontent.com/static/s/8f8b8/image_generation_content/0.png')
            .setColor(BOT_COLOR)
            .setFooter({ text: 'Alaska Apex Management System' });

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
                { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' }
            ])
        );

        await interaction.channel.send({ embeds: [mainEmbed], components: [generalMenu, iaMenu, mgmtMenu] });
        await interaction.reply({ content: '✅ Apex Infrastructure Deployed with Triple-Role Routing.', ephemeral: true });
    }
});

// -------------------- INTERACTION ENGINE --------------------

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
    }

    // TICKET CREATION LOGIC
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const category = interaction.values[0];
        
        // Triple Routing Logic
        let pingRole;
        if (interaction.customId === 'ticket_general') pingRole = config.generalRole;
        else if (interaction.customId === 'ticket_ia') pingRole = config.staffRole;
        else if (interaction.customId === 'ticket_mgmt') pingRole = config.mgmtRole;

        const channel = await interaction.guild.channels.create({
            name: `${category.replace(/\s+/g, '-')}-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: pingRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Support Session: ${category}`)
            .setDescription(`Greetings <@${interaction.user.id}>. A member of <@&${pingRole}> will assist you shortly.`)
            .setColor(BOT_COLOR)
            .addFields({ name: 'Department', value: interaction.customId.replace('ticket_', '').toUpperCase(), inline: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_modal').setLabel('Resolve & Close').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@&${pingRole}>`, embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
    }

    // CLOSE MODAL TRIGGER
    if (interaction.isButton() && interaction.customId === 'close_modal') {
        const modal = new ModalBuilder().setCustomId('close_reason_modal').setTitle('Close Ticket');
        const reasonInput = new TextInputBuilder()
            .setCustomId('close_reason')
            .setLabel("Reason for closing this ticket?")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Resolved the issue regarding perks...')
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }

    // MODAL SUBMISSION (LOGGING)
    if (interaction.isModalSubmit() && interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        const logChan = interaction.guild.channels.cache.get(config.logChannel);

        if (logChan) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Resolved')
                .addFields(
                    { name: 'Channel', value: interaction.channel.name, inline: true },
                    { name: 'Closed By', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason }
                )
                .setColor('#ff4757')
                .setTimestamp();
            await logChan.send({ embeds: [logEmbed] });
        }

        await interaction.reply('🔒 Archiving channel and logging reason...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ ALASKA APEX EDITION READY.`);
});

client.login(process.env.TOKEN);
