require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, Collection, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, ActivityType 
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
app.get('/', (req, res) => res.send('Apex Sentinel Elite is Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- Slash Command Definitions --------------------

const slashCommands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy the elite support infrastructure')
        .addRoleOption(o => o.setName('general').setDescription('General Support Role').setRequired(true))
        .addRoleOption(o => o.setName('ia').setDescription('Internal Affairs Role').setRequired(true))
        .addRoleOption(o => o.setName('management').setDescription('Management Role').setRequired(true))
        .addChannelOption(o => o.setName('logs').setDescription('Log Channel').setRequired(true)),
    new SlashCommandBuilder().setName('embed').setDescription('Executive Embed Creator tool'),
    new SlashCommandBuilder().setName('help').setDescription('View available executive commands'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Restrict channel access'),
    new SlashCommandBuilder().setName('unlock').setDescription('Restore channel access'),
    new SlashCommandBuilder().setName('snipe').setDescription('Recover the last deleted message')
].map(c => c.toJSON());

// -------------------- Interaction & Command Logic --------------------

client.on('interactionCreate', async (int) => {
    if (int.isChatInputCommand()) {
        const { commandName } = int;

        // EMBED BUILDER (Requested Maintenance Message)
        if (commandName === 'embed') {
            return int.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('⚠️ System Notice')
                    .setDescription('Sorry, the bot did not respond. Please contact the owner.')
                    .setColor('#f1c40f')
                    .setFooter({ text: 'Alaska Executive Services' })
                ] 
            });
        }

        // SETUP SYSTEM
        if (commandName === 'setup') {
            if (!int.member.permissions.has(PermissionsBitField.Flags.Administrator)) return int.reply({ content: "❌ Unauthorized.", ephemeral: true });
            
            config = { 
                generalRole: int.options.getRole('general').id, 
                staffRole: int.options.getRole('ia').id, 
                mgmtRole: int.options.getRole('management').id, 
                logChannel: int.options.getChannel('logs').id 
            };
            saveData('./config.json', config);

            const mainEmbed = new EmbedBuilder()
                .setAuthor({ name: 'Alaska Executive Operations', iconURL: client.user.displayAvatarURL() })
                .setTitle('🏛️ System Support Directory')
                .setDescription('Welcome to the **Apex Sentinel** interface. Select a category below to initiate a private session.')
                .addFields(
                    { name: '🔹 General Support', value: 'Assistance with server navigation, questions, and partnerships.', inline: false },
                    { name: '🔹 Internal Affairs', value: 'Staff misconduct reports and departmental complaints.', inline: false },
                    { name: '🔹 Management', value: 'Perk claims, punishment appeals, and executive matters.', inline: false }
                )
                .setImage(BANNER_URL).setColor(BOT_COLOR).setFooter({ text: 'Secure Encryption Active' });

            const menuRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('Select a Department...').addOptions([
                    { label: 'General Support', value: 'gen', emoji: '❓' },
                    { label: 'Internal Affairs', value: 'ia', emoji: '👮' },
                    { label: 'Management', value: 'mgmt', emoji: '💎' }
                ])
            );

            await int.channel.send({ embeds: [mainEmbed], components: [menuRow] });
            return int.reply({ content: "✅ Elite Infrastructure Deployed.", ephemeral: true });
        }

        // LOCKDOWN & UNLOCK
        if (commandName === 'lockdown') {
            if (!int.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return int.reply("❌ Missing Permissions.");
            await int.channel.permissionOverwrites.edit(int.guild.id, { SendMessages: false });
            return int.reply("🔒 **Channel locked for executive review.**");
        }
        if (commandName === 'unlock') {
            if (!int.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return int.reply("❌ Missing Permissions.");
            await int.channel.permissionOverwrites.edit(int.guild.id, { SendMessages: null });
            return int.reply("🔓 **Channel unlocked. Communication restored.**");
        }

        // SNIPE
        if (commandName === 'snipe') {
            const msg = snipes.get(int.channelId);
            if (!msg) return int.reply("No recently deleted messages found.");
            const snipeEmbed = new EmbedBuilder()
                .setAuthor({ name: msg.author, iconURL: msg.avatar })
                .setDescription(msg.content)
                .setColor(BOT_COLOR).setTimestamp();
            return int.reply({ embeds: [snipeEmbed] });
        }

        // HELP
        if (commandName === 'help') {
            const help = new EmbedBuilder()
                .setTitle('🏛️ System Command Directory')
                .addFields(
                    { name: '`/setup`', value: 'Configure the ticket system.' },
                    { name: '`/embed`', value: 'Access embed builder (Status: Maintenance).' },
                    { name: '`/lockdown` & `/unlock`', value: 'Manage channel access.' },
                    { name: '`/snipe`', value: 'Recover the last deleted message.' }
                ).setColor(BOT_COLOR);
            return int.reply({ embeds: [help] });
        }
    }

    // -------------------- Ticket Operations --------------------

    if (int.isStringSelectMenu() && int.customId === 'ticket_select') {
        const val = int.values[0];
        const rId = val === 'gen' ? config.generalRole : (val === 'ia' ? config.staffRole : config.mgmtRole);
        const dName = val === 'gen' ? "General" : (val === 'ia' ? "Internal Affairs" : "Management");

        const ch = await int.guild.channels.create({
            name: `${val}-${int.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: rId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const header = new EmbedBuilder()
            .setTitle(`🏛️ ${dName} Inquiry`)
            .setDescription(`Greetings <@${int.user.id}>. The **${dName}** team has been notified.\n\nStatus: **Awaiting Staff Claim**`)
            .setColor(BOT_COLOR);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('claim_btn').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🔑'),
            new ButtonBuilder().setCustomId('close_btn').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        await ch.send({ content: `<@&${rId}>`, embeds: [header], components: [row] });
        return int.reply({ content: `✅ Inquiry created: ${ch}`, ephemeral: true });
    }

    if (int.isButton()) {
        const staffRoles = [config.generalRole, config.staffRole, config.mgmtRole];
        const isStaff = int.member.roles.cache.some(r => staffRoles.includes(r.id));

        if (int.customId === 'claim_btn') {
            if (!isStaff) return int.reply({ content: "❌ Authorized staff only.", ephemeral: true });
            const embed = EmbedBuilder.from(int.message.embeds[0]).setDescription(`Greetings <@${int.user.id}>. The team has been notified.\n\nStatus: **Claimed by ${int.user.tag}**`).setColor("#2ecc71");
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unclaim_btn').setLabel('Unclaim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('close_btn').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );
            await int.update({ embeds: [embed], components: [row] });
            return int.channel.send(`💼 **${int.user.tag}** is now assisting you.`);
        }

        if (int.customId === 'unclaim_btn') {
            if (!isStaff) return int.reply({ content: "❌ Authorized staff only.", ephemeral: true });
            const embed = EmbedBuilder.from(int.message.embeds[0]).setDescription(int.message.embeds[0].description.split('\n')[0] + "\n\nStatus: **Awaiting Staff Claim**").setColor(BOT_COLOR);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_btn').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🔑'),
                new ButtonBuilder().setCustomId('close_btn').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );
            await int.update({ embeds: [embed], components: [row] });
            return int.channel.send(`⚖️ Inquiry returned to the queue.`);
        }

        if (int.customId === 'close_btn') {
            if (!isStaff) return int.reply({ content: "❌ Authorized staff only.", ephemeral: true });
            const modal = new ModalBuilder().setCustomId('close_modal').setTitle('Resolve Inquiry');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Outcome").setStyle(TextInputStyle.Paragraph).setRequired(true)));
            await int.showModal(modal);
        }
    }

    if (int.isModalSubmit() && int.customId === 'close_modal') {
        const reason = int.fields.getTextInputValue('reason');
        const log = int.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle('🔒 Resolved').addFields({ name: 'Staff', value: int.user.tag }, { name: 'Outcome', value: reason }).setColor("#e74c3c").setTimestamp()] });
        await int.reply("🔒 Archiving...");
        setTimeout(() => int.channel.delete().catch(() => {}), 2000);
    }
});

// -------------------- Utility Events --------------------

client.on('messageDelete', m => {
    if (!m.author?.bot && m.content) {
        snipes.set(m.channelId, { content: m.content, author: m.author.tag, avatar: m.author.displayAvatarURL() });
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log('✅ Commands Registered.');
    } catch (e) { console.error(e); }
    client.user.setActivity('Alaska Executive Ops', { type: ActivityType.Watching });
    console.log(`✅ ${client.user.tag} Online.`);
});

client.login(process.env.TOKEN);
