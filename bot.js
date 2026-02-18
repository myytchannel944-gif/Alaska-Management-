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

const loadData = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
let config = loadData('./config.json', { generalRole: null, staffRole: null, mgmtRole: null, logChannel: null });

const app = express();
app.get('/', (req, res) => res.send('System Online.'));
app.listen(process.env.PORT || 3000);

// -------------------- All Slash Commands --------------------

const slashCommands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Deploy the professional support panel')
        .addRoleOption(o => o.setName('general').setDescription('General Support Role').setRequired(true))
        .addRoleOption(o => o.setName('ia').setDescription('Internal Affairs Role').setRequired(true))
        .addRoleOption(o => o.setName('management').setDescription('Management Role').setRequired(true))
        .addChannelOption(o => o.setName('logs').setDescription('Log Channel').setRequired(true)),
    new SlashCommandBuilder().setName('embed').setDescription('Executive Embed Creator tool'),
    new SlashCommandBuilder().setName('help').setDescription('View a private list of all commands'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Restrict access to the current channel'),
    new SlashCommandBuilder().setName('unlock').setDescription('Restore access to the current channel'),
    new SlashCommandBuilder().setName('snipe').setDescription('Recover the last deleted message')
].map(c => c.toJSON());

// -------------------- Interaction Logic --------------------

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;

    if (int.isChatInputCommand()) {
        const { commandName } = int;

        // PRIVATE HELP
        if (commandName === 'help') {
            const help = new EmbedBuilder()
                .setTitle('🏛️ Executive Command Directory')
                .addFields(
                    { name: '`/setup`', value: 'Deploys the dashboard.' },
                    { name: '`/embed`', value: 'Access embed tool (Maintenance).' },
                    { name: '`/snipe`', value: 'Recovers last deleted message.' },
                    { name: '`/lockdown`', value: 'Restricts channel (requires confirmation).' },
                    { name: '`/unlock`', value: 'Restores channel (requires confirmation).' }
                ).setColor(BOT_COLOR);
            return int.reply({ embeds: [help], ephemeral: true });
        }

        // EMBED (Your Requested Message)
        if (commandName === 'embed') {
            return int.reply({ 
                embeds: [new EmbedBuilder().setTitle('⚠️ System Notice').setDescription('Sorry, the bot did not respond. Please contact the owner.').setColor('#f1c40f')],
                ephemeral: true 
            });
        }

        // LOCKDOWN & UNLOCK WITH CONFIRMATION
        if (commandName === 'lockdown' || commandName === 'unlock') {
            const action = commandName === 'lockdown' ? 'lock' : 'unlock';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`confirm_${action}`).setLabel(`Confirm ${action}`).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('cancel_action').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );
            return int.reply({ content: `⚠️ Are you sure you want to **${action}** this channel?`, components: [row], ephemeral: true });
        }

        // SNIPE
        if (commandName === 'snipe') {
            const msg = snipes.get(int.channelId);
            if (!msg) return int.reply({ content: "Nothing to snipe.", ephemeral: true });
            return int.reply({ embeds: [new EmbedBuilder().setAuthor({ name: msg.author }).setDescription(msg.content).setColor(BOT_COLOR)] });
        }

        // SETUP
        if (commandName === 'setup') {
            if (!int.member.permissions.has(PermissionsBitField.Flags.Administrator)) return int.reply({ content: "❌ Unauthorized.", ephemeral: true });
            config = { generalRole: int.options.getRole('general').id, staffRole: int.options.getRole('ia').id, mgmtRole: int.options.getRole('management').id, logChannel: int.options.getChannel('logs').id };
            saveData('./config.json', config);

            const panel = new EmbedBuilder()
                .setTitle('🏛️ Alaska Support & Relations')
                .setDescription('Select a category below to initiate a private session.')
                .addFields(
                    { name: '🔹 General Support', value: 'Server help and partnerships.' },
                    { name: '🔹 Internal Affairs', value: 'Staff misconduct reports.' },
                    { name: '🔹 Management', value: 'Executive appeals and perk claims.' }
                ).setImage(BANNER_URL).setColor(BOT_COLOR);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('Select Department...').addOptions([
                    { label: 'General Support', value: 'gen', emoji: '❓' },
                    { label: 'Internal Affairs', value: 'ia', emoji: '👮' },
                    { label: 'Management', value: 'mgmt', emoji: '💎' }
                ])
            );
            await int.channel.send({ embeds: [panel], components: [row] });
            return int.reply({ content: "✅ Deployed.", ephemeral: true });
        }
    }

    // BUTTON & TICKET HANDLING
    if (int.isButton()) {
        // Confirmation buttons
        if (int.customId === 'confirm_lock') {
            await int.channel.permissionOverwrites.edit(int.guild.id, { SendMessages: false });
            return int.update({ content: "🔒 **Channel Locked.**", components: [] });
        }
        if (int.customId === 'confirm_unlock') {
            await int.channel.permissionOverwrites.edit(int.guild.id, { SendMessages: null });
            return int.update({ content: "🔓 **Channel Unlocked.**", components: [] });
        }
        if (int.customId === 'cancel_action') return int.update({ content: "❌ Action cancelled.", components: [] });

        // Ticket buttons (Staff roles check)
        const staffRoles = [config.generalRole, config.staffRole, config.mgmtRole];
        if (!int.member.roles.cache.some(r => staffRoles.includes(r.id))) return int.reply({ content: "❌ Staff only.", ephemeral: true });

        if (int.customId === 'claim_btn') {
            const embed = EmbedBuilder.from(int.message.embeds[0]).setDescription(`Claimed by: **${int.user.tag}**`).setColor("#2ecc71");
            await int.update({ embeds: [embed] });
        }
        if (int.customId === 'close_btn') {
            const modal = new ModalBuilder().setCustomId('close_modal').setTitle('Resolve');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Outcome").setStyle(TextInputStyle.Paragraph).setRequired(true)));
            await int.showModal(modal);
        }
    }

    // TICKET CREATION
    if (int.isStringSelectMenu() && int.customId === 'ticket_select') {
        const val = int.values[0];
        const rId = val === 'gen' ? config.generalRole : (val === 'ia' ? config.staffRole : config.mgmtRole);
        const ch = await int.guild.channels.create({
            name: `${val}-${int.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: rId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('claim_btn').setLabel('Claim').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('close_btn').setLabel('Close').setStyle(ButtonStyle.Danger)
        );
        await ch.send({ content: `<@&${rId}>`, embeds: [new EmbedBuilder().setTitle("Inquiry Opened").setColor(BOT_COLOR)], components: [btns] });
        return int.reply({ content: `✅ Ticket: ${ch}`, ephemeral: true });
    }

    // MODAL SUBMIT
    if (int.isModalSubmit() && int.customId === 'close_modal') {
        const reason = int.fields.getTextInputValue('reason');
        const log = int.guild.channels.cache.get(config.logChannel);
        if (log) log.send({ embeds: [new EmbedBuilder().setTitle('Closed').addFields({ name: 'Staff', value: int.user.tag }, { name: 'Outcome', value: reason }).setColor("#e74c3c")] });
        await int.reply("🔒 Closing...");
        setTimeout(() => int.channel.delete().catch(() => {}), 2000);
    }
});

// -------------------- Launch --------------------

client.on('messageDelete', m => { 
    if (!m.author?.bot && m.content) snipes.set(m.channelId, { content: m.content, author: m.author.tag }); 
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log('✅ Commands Synced.');
    } catch (e) { console.error(e); }
    client.user.setActivity('Alaska Operations', { type: ActivityType.Watching });
});

client.login(process.env.TOKEN);
