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
        GatewayIntentBits.GuildMembers, // Ensure this is enabled in Dev Portal
        GatewayIntentBits.MessageContent // Ensure this is enabled in Dev Portal
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

const snipes = new Map(); 
const BOT_COLOR = "#f6b9bc"; 
const PREFIX = ".";

const BANNER_URL = "https://cdn.discordapp.com/attachments/1472295068231532808/1473557629749039155/ocbvKoC.jpg?ex=6996a4fc&is=6995537c&hm=e38629356f5050e338cf33bed692c2caed54a6970a54da2ae1a0a75396cb932f&";

const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

const app = express();
app.get('/', (req, res) => res.send('Alaska Apex Sentinel is live.'));
app.listen(process.env.PORT || 3000);

// -------------------- Commands --------------------

const commands = {
    help: {
        async execute(message) {
            const helpEmbed = new EmbedBuilder()
                .setTitle('🏛️ System Command Directory')
                .setDescription('List of administrative and utility commands.')
                .addFields(
                    { name: '`.setup`', value: 'Deploy support panel. \n*Usage: .setup @General @IA @Management #logs*' },
                    { name: '`.lockdown`', value: 'Lock current channel.' },
                    { name: '`.unlock`', value: 'Unlock current channel.' },
                    { name: '`.snipe`', value: 'View last deleted message.' }
                )
                .setColor(BOT_COLOR);
            await message.reply({ embeds: [helpEmbed] });
        }
    },

    setup: {
        async execute(message, args) {
            // Permission Check
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply("❌ **Access Denied:** You need Administrator permissions to run this.");
            }

            // Enhanced Detection
            const genRole = message.mentions.roles.at(0);
            const iaRole = message.mentions.roles.at(1);
            const mgRole = message.mentions.roles.at(2);
            const logCh = message.mentions.channels.first();

            if (!genRole || !iaRole || !mgRole || !logCh) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle("⚠️ Setup Error")
                        .setDescription("Please mention all roles and the log channel in order.")
                        .addFields({ name: "Required Order", value: "`.setup @General @InternalAffairs @Management #logs`" })
                        .setColor("#ff4757")]
                });
            }

            config = { generalRole: genRole.id, staffRole: iaRole.id, mgmtRole: mgRole.id, logChannel: logCh.id };
            saveData('./config.json', config);

            const mainEmbed = new EmbedBuilder()
                .setTitle('🏛️ Support & Relations')
                .setDescription('Please select a department below to open an inquiry.')
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
                    { label: 'Severe Matters', value: 'Severe Matters', emoji: '⚠️' }
                ])),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_mgmt').setPlaceholder('Management').addOptions([
                    { label: 'Claiming Perks', value: 'Claiming Perks', emoji: '💎' },
                    { label: 'Appealing Punishments', value: 'Appealing Punishments', emoji: '🔨' }
                ]))
            ];

            await message.channel.send({ embeds: [mainEmbed], components: menus });
            await message.reply("✅ **Infrastructure successfully deployed.**");
        }
    },

    lockdown: {
        async execute(message) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
            await message.reply("🔒 **Channel locked.**");
        }
    },

    unlock: {
        async execute(message) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null });
            await message.reply("🔓 **Channel unlocked.**");
        }
    },

    snipe: {
        async execute(message) {
            const msg = snipes.get(message.channel.id);
            if (!msg) return message.reply("No message to snipe.");
            const snipeEmbed = new EmbedBuilder()
                .setAuthor({ name: msg.author, iconURL: msg.avatar })
                .setDescription(msg.content)
                .setFooter({ text: `Sent at ${msg.time}` })
                .setColor(BOT_COLOR);
            await message.reply({ embeds: [snipeEmbed] });
        }
    }
};

// -------------------- Events --------------------

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commands[commandName]) {
        try {
            await commands[commandName].execute(message, args);
        } catch (error) {
            console.error(error);
            message.reply("There was an error trying to execute that command.");
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_')) {
        const cat = interaction.values[0];
        let roleId, dept;

        if (interaction.customId === 'ticket_general') { roleId = config.generalRole; dept = "General Support"; }
        else if (interaction.customId === 'ticket_ia') { roleId = config.staffRole; dept = "Internal Affairs"; }
        else { roleId = config.mgmtRole; dept = "Management"; }

        const channel = await interaction.guild.channels.create({
            name: `${cat.replace(/\s+/g, '-')}-${interaction.user.username}`.toLowerCase(),
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_tkt').setLabel('Resolve').setStyle(ButtonStyle.Danger));
        await channel.send({ content: `<@&${roleId}>`, embeds: [new EmbedBuilder().setTitle(`Support: ${cat}`).setDescription(`Inquiry opened by <@${interaction.user.id}>.`).setColor(BOT_COLOR)], components: [row] });
        await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_tkt') {
        const modal = new ModalBuilder().setCustomId('reason_mdl').setTitle('Close Ticket');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason_in').setLabel("Resolution Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'reason_mdl') {
        const reason = interaction.fields.getTextInputValue('reason_in');
        const log = interaction.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle("Ticket Closed").addFields({ name: "By", value: interaction.user.tag }, { name: "Reason", value: reason }).setColor("#ff4757")] });
        await interaction.reply("Closing...");
        setTimeout(() => interaction.channel.delete(), 2000);
    }
});

client.on('messageDelete', m => {
    if (!m.author?.bot && m.content) {
        snipes.set(m.channel.id, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL(), time: m.createdAt.toLocaleString() });
    }
});

client.once('ready', () => console.log(`✅ Sentinel Online | Prefix: ${PREFIX}`));
client.login(process.env.TOKEN);
