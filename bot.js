require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

const snipes = new Map(); 
const BOT_COLOR = "#f6b9bc"; 
const PREFIX = ".";

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

// -------------------- Command Logic --------------------

const commands = {
    help: {
        async execute(message) {
            const helpEmbed = new EmbedBuilder()
                .setTitle('🏛️ System Command Directory')
                .setDescription('Below is a list of administrative and utility commands available for the Apex Sentinel system.')
                .addFields(
                    { name: '`.setup`', value: 'Deploys the support panel. \n*Usage: .setup @General @IA @Management #logs*' },
                    { name: '`.lockdown`', value: 'Restricts messaging in the current channel.' },
                    { name: '`.unlock`', value: 'Restores messaging in the current channel.' },
                    { name: '`.snipe`', value: 'Recovers the most recently deleted message.' },
                    { name: '`.embedbuilder`', value: 'Opens the executive embed creation tool.' }
                )
                .setColor(BOT_COLOR)
                .setFooter({ text: 'Alaska Executive Operations' });
            
            await message.reply({ embeds: [helpEmbed] });
        }
    },

    embedbuilder: {
        async execute(message) {
            const warningEmbed = new EmbedBuilder()
                .setTitle('⚠️ Maintenance')
                .setDescription('The **Executive Embed Builder** is currently undergoing maintenance and is unavailable at the moment.')
                .setColor('#f1c40f')
                .setFooter({ text: 'Alaska System Services' });
            
            await message.reply({ embeds: [warningEmbed] });
        }
    },

    lockdown: {
        async execute(message) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
            await message.channel.send({ 
                embeds: [new EmbedBuilder().setTitle('🔒 Lockdown').setDescription('This channel has been restricted by Management.').setColor('#ff4757')] 
            });
        }
    },

    unlock: {
        async execute(message) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null });
            await message.channel.send({ 
                embeds: [new EmbedBuilder().setTitle('🔓 Unlocked').setDescription('Standard communication has been resumed.').setColor('#2ecc71')] 
            });
        }
    },

    snipe: {
        async execute(message) {
            const msg = snipes.get(message.channel.id);
            if (!msg) return message.reply('No recently deleted messages found in this channel.');
            await message.channel.send({ 
                embeds: [new EmbedBuilder()
                    .setAuthor({ name: msg.author, iconURL: msg.avatar })
                    .setDescription(msg.content || "[No content]")
                    .setColor(BOT_COLOR)
                    .setFooter({ text: `Detected at: ${msg.time}` })]
            });
        }
    },

    setup: {
        async execute(message, args) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

            const generalRole = message.mentions.roles.at(0) || message.guild.roles.cache.get(args[0]);
            const iaRole      = message.mentions.roles.at(1) || message.guild.roles.cache.get(args[1]);
            const mgmtRole    = message.mentions.roles.at(2) || message.guild.roles.cache.get(args[2]);
            const logChannel  = message.mentions.channels.first() || message.guild.channels.cache.get(args[3]);

            if (!generalRole || !iaRole || !mgmtRole || !logChannel) {
                return message.reply('**Invalid Setup.** Usage: `.setup @General @InternalAffairs @Management #logs`');
            }

            config = { generalRole: generalRole.id, staffRole: iaRole.id, mgmtRole: mgmtRole.id, logChannel: logChannel.id };
            saveData('./config.json', config);

            const mainEmbed = new EmbedBuilder()
                .setTitle('🏛️ Support & Relations')
                .setDescription('Please select the appropriate department below to open an inquiry. Our executive team will be with you shortly.')
                .setImage(BANNER_URL)
                .setColor(BOT_COLOR);

            const menus = [
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_general').setPlaceholder('General Support').addOptions([
                    { label: 'General Questions', value: 'General Questions', emoji: '❓' },
                    { label: 'Member Reports', value: 'Member Reports', emoji: '👥' },
                    { label: 'Server Bugs', value: 'Server Bugs', emoji: '🐛' },
                    { label: 'Partnerships', value: 'Partnerships', emoji: '🤝' }
                ])),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_ia').setPlaceholder('Internal Affairs').addOptions([
                    { label: 'Staff Reports', value: 'Staff Reports', emoji: '👮' },
                    { label: 'Staff Appeals', value: 'Staff Appeals', emoji: '⚖️' },
                    { label: 'Severe Matters', value: 'Severe Matters', emoji: '⚠️' },
                    { label: 'Staff Misconduct', value: 'Staff Misconduct', emoji: '🛑' }
                ])),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('Management').addOptions([
                    { label: 'Claiming Perks', value: 'Claiming Perks', emoji: '💎' },
                    { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' }
                ]))
            ];

            await message.channel.send({ embeds: [mainEmbed], components: menus });
            await message.reply('✅ Infrastructure successfully deployed with your custom banner.');
        }
    }
};

// -------------------- Event Handlers --------------------

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const cmdName = args.shift().toLowerCase();
    if (commands[cmdName]) await commands[cmdName].execute(message, args);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const cat = interaction.values[0];
        let roleId, deptName;
        
        if (interaction.customId === 'ticket_general') { roleId = config.generalRole; deptName = "General Support"; }
        else if (interaction.customId === 'ticket_ia') { roleId = config.staffRole; deptName = "Internal Affairs"; }
        else { roleId = config.mgmtRole; deptName = "Management"; }

        if (!roleId) return interaction.reply({ content: "Error: Roles not configured. Please run .setup again.", ephemeral: true });

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
        if (log) {
            log.send({ embeds: [new EmbedBuilder().setTitle('🔒 Session Resolved').addFields({ name: 'Executor', value: interaction.user.tag }, { name: 'Resolution Reason', value: reason }, { name: 'Channel', value: interaction.channel.name }).setColor('#ff4757').setTimestamp()] });
        }
        await interaction.reply('🔒 Resolving session and archiving channel...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
    }
});

client.on('messageDelete', m => {
    if (!m.author?.bot && m.content) {
        snipes.set(m.channel.id, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL(), time: m.createdAt.toLocaleString() });
    }
});

client.once('ready', () => console.log(`✅ Alaska Apex Sentinel is online. Prefix: ${PREFIX}`));
client.login(process.env.TOKEN);
