require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType 
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
const BANNER_URL = "https://cdn.discordapp.com/attachments/1472295068231532808/1473557629749039155/ocbvKoC.jpg?ex=6996a4fc&is=6995537c&hm=e38629356f5050e338cf33bed692c2caed54a6970a54da2ae1a0a75396cb932f&";

// Data Management
const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

const app = express();
app.get('/', (req, res) => res.send('System Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- Command Logic --------------------

const commands = {
    help: {
        async execute(message) {
            const help = new EmbedBuilder()
                .setTitle('🏛️ System Directory')
                .setDescription('The following keywords are active (no prefix required):')
                .addFields(
                    { name: '`setup`', value: 'Deploy the support panel. Mention 3 roles and 1 channel.' },
                    { name: '`embed`', value: 'Executive Embed Builder (Under Maintenance).' },
                    { name: '`lockdown` / `unlock`', value: 'Manage channel permissions.' },
                    { name: '`snipe`', value: 'Recover the last deleted message.' }
                )
                .setColor(BOT_COLOR);
            await message.reply({ embeds: [help] });
        }
    },

    embed: {
        async execute(message) {
            // Maintenance Message as requested
            const maintenanceEmbed = new EmbedBuilder()
                .setTitle('⚠️ System Notice')
                .setDescription('Sorry, the bot did not respond. Please contact the owner.')
                .setColor('#f1c40f')
                .setFooter({ text: 'Alaska Executive Services' });
            
            await message.reply({ embeds: [maintenanceEmbed] });
        }
    },

    setup: {
        async execute(message) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

            const roles = message.mentions.roles;
            const channel = message.mentions.channels.first();

            if (roles.size < 3 || !channel) {
                return message.reply("⚠️ **Setup Error:** Mention 3 roles and 1 channel.\nExample: `setup @General @IA @Mgmt #logs` ");
            }

            config = { generalRole: roles.at(0).id, staffRole: roles.at(1).id, mgmtRole: roles.at(2).id, logChannel: channel.id };
            saveData('./config.json', config);

            const panel = new EmbedBuilder()
                .setTitle('🏛️ Support & Relations')
                .setDescription('Please select a department below to begin an inquiry.')
                .setImage(BANNER_URL)
                .setColor(BOT_COLOR);

            const menus = [
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('t_gen').setPlaceholder('General Support').addOptions([{ label: 'General Inquiry', value: 'gen', emoji: '❓' }])),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('t_ia').setPlaceholder('Internal Affairs').addOptions([{ label: 'Staff Report', value: 'ia', emoji: '👮' }])),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('t_mgmt').setPlaceholder('Management').addOptions([{ label: 'Executive Matter', value: 'mgmt', emoji: '💎' }]))
            ];

            await message.channel.send({ embeds: [panel], components: menus });
            await message.reply("✅ Infrastructure deployed successfully.");
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
            if (!msg) return message.reply("Nothing to snipe.");
            const snipeEmbed = new EmbedBuilder().setAuthor({ name: msg.author }).setDescription(msg.content).setColor(BOT_COLOR);
            await message.reply({ embeds: [snipeEmbed] });
        }
    }
};

// -------------------- Event Handling --------------------

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (commands[cmd]) {
        try {
            await commands[cmd].execute(message, args);
        } catch (err) {
            console.error(err);
        }
    }
});

client.on('interactionCreate', async (int) => {
    if (int.isStringSelectMenu() && int.customId.startsWith('t_')) {
        let rId = int.customId === 't_gen' ? config.generalRole : (int.customId === 't_ia' ? config.staffRole : config.mgmtRole);
        
        const c = await int.guild.channels.create({
            name: `ticket-${int.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: rId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_tkt').setLabel('Resolve').setStyle(ButtonStyle.Danger));
        await c.send({ content: `<@&${rId}>`, embeds: [new EmbedBuilder().setTitle("Support Requested").setDescription(`User: <@${int.user.id}>`).setColor(BOT_COLOR)], components: [row] });
        await int.reply({ content: `✅ Created: ${c}`, ephemeral: true });
    }

    if (int.isButton() && int.customId === 'close_tkt') {
        const modal = new ModalBuilder().setCustomId('rsn_mdl').setTitle('Close Ticket');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rsn_in').setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await int.showModal(modal);
    }

    if (int.isModalSubmit() && int.customId === 'rsn_mdl') {
        const reason = int.fields.getTextInputValue('rsn_in');
        const log = int.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle("Resolved").addFields({ name: "Reason", value: reason }).setColor("#ff4757")] });
        await int.reply("Archiving...");
        setTimeout(() => int.channel.delete().catch(() => {}), 2000);
    }
});

client.on('messageDelete', m => {
    if (!m.author?.bot && m.content) snipes.set(m.channel.id, { content: m.content, author: m.author.tag });
});

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} Online | No Prefix Mode`);
    client.user.setActivity('Alaska Support', { type: ActivityType.Watching });
});

client.login(process.env.TOKEN);
