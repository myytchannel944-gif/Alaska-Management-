require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, ActivityType, AttachmentBuilder 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

const snipes = new Map();
const BOT_COLOR = "#f6b9bc"; 
const PROMO_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg";

// Persistence Logic
const loadData = () => fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json')) : { logChannel: null, staffRole: null };
const saveData = (data) => fs.writeFileSync('./config.json', JSON.stringify(data, null, 2));
let config = loadData();

// -------------------- COMMAND REGISTRY --------------------

const slashCommands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Initialize Log Channel, Staff Role, and the Ticket Dashboard')
        .addChannelOption(o => o.setName('logs').setDescription('Channel for Black Box Transcripts').setRequired(true))
        .addRoleOption(o => o.setName('staff').setDescription('Role that can see and claim tickets').setRequired(true)),

    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Announce a staff promotion')
        .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption(o => o.setName('rank').setDescription('New rank').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('infraction')
        .setDescription('Log a formal infraction')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o => o.setName('type').setDescription('Warning/Strike/Ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

    new SlashCommandBuilder().setName('roleplay-log').setDescription('Log a roleplay session'),
    new SlashCommandBuilder().setName('handbook').setDescription('View staff protocols'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Lock channel'),
    new SlashCommandBuilder().setName('unlock').setDescription('Unlock channel'),
    new SlashCommandBuilder().setName('snipe').setDescription('Recover last deleted message')
].map(c => c.toJSON());

// -------------------- INTERACTION HANDLER --------------------

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;

    // --- CRASH PROTECTION: Global Error Catching ---
    try {
        // BUTTON INTERACTIONS
        if (int.isButton()) {
            if (int.customId === 'open_ticket') {
                const ch = await int.guild.channels.create({
                    name: `ticket-${int.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                );

                await ch.send({ 
                    content: `<@&${config.staffRole}>`, 
                    embeds: [new EmbedBuilder().setTitle('🏛️ Alaska Support Session').setDescription('Staff will be with you shortly.').setColor(BOT_COLOR)], 
                    components: [row] 
                });
                return int.reply({ content: `✅ Ticket created: ${ch}`, ephemeral: true });
            }

            if (int.customId === 'claim_ticket') {
                return int.update({ content: `💼 Ticket claimed by **${int.user.tag}**`, components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('claimed').setLabel('Claimed').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                    )
                ]});
            }

            if (int.customId === 'close_ticket') {
                await int.reply("📑 **Generating Black Box transcript...**");
                const messages = await int.channel.messages.fetch({ limit: 100 });
                const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || "[Attachment]"}`).join('\n');
                
                const logCh = int.guild.channels.cache.get(config.logChannel);
                if (logCh) {
                    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${int.channel.name}.txt` });
                    await logCh.send({ embeds: [new EmbedBuilder().setTitle('📂 Ticket Archived').setDescription(`Channel: ${int.channel.name}\nClosed by: ${int.user.tag}`).setColor(BOT_COLOR)], files: [attachment] });
                }
                return setTimeout(() => int.channel.delete().catch(() => {}), 3000);
            }
        }

        // SLASH COMMANDS
        if (int.isChatInputCommand()) {
            const { commandName, options } = int;

            // 1. SETUP (Combined Logic)
            if (commandName === 'setup') {
                config.logChannel = options.getChannel('logs').id;
                config.staffRole = options.getRole('staff').id;
                saveData(config);

                const setupEmbed = new EmbedBuilder()
                    .setTitle('🏛️ Alaska Support & Relations')
                    .setDescription('Click the button below to open a private support session.')
                    .setImage(PROMO_BANNER)
                    .setColor(BOT_COLOR);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
                );

                await int.channel.send({ embeds: [setupEmbed], components: [row] });
                return int.reply({ content: "✅ System Deployed. Logs and Staff Role saved.", ephemeral: true });
            }

            // 2. PROMOTE
            if (commandName === 'promote') {
                const embed = new EmbedBuilder()
                    .setTitle('🔔 Alaska State Staff Promotion')
                    .setDescription(`Congratulations, <@${options.getUser('user').id}>!`)
                    .addFields({ name: 'Rank', value: options.getString('rank'), inline: true }, { name: 'Reason', value: options.getString('reason'), inline: true })
                    .setImage(PROMO_BANNER).setColor("#3498db").setFooter({ text: `Signed, ${int.user.tag}` });
                return int.reply({ content: `<@${options.getUser('user').id}>`, embeds: [embed] });
            }

            // 3. INFRACTION
            if (commandName === 'infraction') {
                const embed = new EmbedBuilder()
                    .setTitle('⚖️ Formal Infraction Issued')
                    .addFields(
                        { name: 'User', value: `<@${options.getUser('user').id}>`, inline: true },
                        { name: 'Type', value: options.getString('type'), inline: true },
                        { name: 'Reason', value: options.getString('reason') }
                    ).setColor("#e74c3c").setTimestamp();
                return int.reply({ embeds: [embed] });
            }

            // 4. LOCKDOWN/UNLOCK
            if (commandName === 'lockdown' || commandName === 'unlock') {
                const lock = commandName === 'lockdown';
                await int.channel.permissionOverwrites.edit(int.guild.id, { SendMessages: lock ? false : null });
                return int.reply(`${lock ? '🔒' : '🔓'} **Channel ${lock ? 'Locked' : 'Unlocked'}.**`);
            }

            // 5. SNIPE
            if (commandName === 'snipe') {
                const msg = snipes.get(int.channelId);
                if (!msg) return int.reply({ content: "Nothing to snipe.", ephemeral: true });
                return int.reply({ embeds: [new EmbedBuilder().setAuthor({ name: msg.author }).setDescription(msg.content).setColor(BOT_COLOR)] });
            }
            
            // 6. HANDBOOK
            if (commandName === 'handbook') {
                return int.reply({ content: "📖 **Staff Handbook:** Use `/promote`, `/infraction`, and the Ticket Dashboard to manage the server.", ephemeral: true });
            }
        }
    } catch (error) {
        console.error("Critical System Catch:", error);
        if (!int.replied && !int.deferred) await int.reply({ content: "⚠️ An internal error occurred. Please check permissions.", ephemeral: true });
    }
});

// -------------------- DEPLOYMENT --------------------

client.on('messageDelete', m => { if (!m.author?.bot && m.content) snipes.set(m.channelId, { content: m.content, author: m.author.tag }); });

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log('✅ consolidated Alaska System Online.');
    client.user.setActivity('Alaska State RP', { type: ActivityType.Watching });
});

client.login(process.env.TOKEN);
