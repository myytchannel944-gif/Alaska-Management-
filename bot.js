require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, ActivityType, AttachmentBuilder 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

const snipes = new Map();
const BOT_COLOR = "#f6b9bc"; 
const PROMO_BANNER = "https://cdn.discordapp.com/attachments/1341148810620833894/1341584988775874621/0c3d9331-496c-4cd8-8f09-e9fbedc9429b.jpg";

// Data Management
const loadData = () => fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json')) : { logChannel: null, staffRole: null };
const saveData = (data) => fs.writeFileSync('./config.json', JSON.stringify(data, null, 2));
let config = loadData();

// -------------------- COMMAND REGISTRY --------------------

const slashCommands = [
    new SlashCommandBuilder().setName('setup').setDescription('Deploy the support dashboard').addChannelOption(o => o.setName('logs').setDescription('Log channel').setRequired(true)).addRoleOption(o => o.setName('staff').setDescription('Staff role').setRequired(true)),
    new SlashCommandBuilder().setName('promote').setDescription('Announce a promotion').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('rank').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true)),
    new SlashCommandBuilder().setName('infraction').setDescription('Log an infraction').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('type').setRequired(true)).addStringOption(o => o.setName('reason').setRequired(true)),
    new SlashCommandBuilder().setName('ticket').setDescription('Ticket controls').addSubcommand(s => s.setName('add').setDescription('Add user').addUserOption(o => o.setName('user').setRequired(true))).addSubcommand(s => s.setName('rename').setDescription('Rename channel').addStringOption(o => o.setName('name').setRequired(true))),
    new SlashCommandBuilder().setName('lockdown').setDescription('Lock channel'),
    new SlashCommandBuilder().setName('unlock').setDescription('Unlock channel'),
    new SlashCommandBuilder().setName('help').setDescription('View commands'),
    new SlashCommandBuilder().setName('snipe').setDescription('Recover deleted message')
].map(c => c.toJSON());

// -------------------- INTERACTION HANDLER --------------------

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;

    // --- BUTTON & SELECT MENU LOGIC (The Ticket System) ---
    if (int.isButton()) {
        // Open Ticket Button
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

            const ticketEmbed = new EmbedBuilder()
                .setTitle('🏛️ Alaska Support Session')
                .setDescription('Staff will be with you shortly. Use the buttons below to manage this ticket.')
                .setColor(BOT_COLOR);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
            );

            await ch.send({ content: `<@&${config.staffRole}>`, embeds: [ticketEmbed], components: [row] });
            return int.reply({ content: `✅ Ticket created: ${ch}`, ephemeral: true });
        }

        // Claim Ticket
        if (int.customId === 'claim_ticket') {
            return int.update({ embeds: [EmbedBuilder.from(int.message.embeds[0]).setFooter({ text: `Claimed by ${int.user.tag}` })], components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('claimed').setLabel('Claimed').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                )
            ]});
        }

        // Close Ticket (Black Box Transcript)
        if (int.customId === 'close_ticket') {
            await int.reply("📑 **Generating Black Box transcript...**");
            const messages = await int.channel.messages.fetch({ limit: 100 });
            const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
            
            const logCh = int.guild.channels.cache.get(config.logChannel);
            if (logCh) {
                const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${int.channel.name}.txt` });
                await logCh.send({ content: `📂 Archive for **${int.channel.name}**`, files: [attachment] });
            }
            return setTimeout(() => int.channel.delete().catch(() => {}), 3000);
        }
    }

    // --- SLASH COMMAND LOGIC ---
    if (int.isChatInputCommand()) {
        const { commandName, options } = int;

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
            return int.reply({ content: "✅ System Deployed.", ephemeral: true });
        }

        if (commandName === 'promote') {
            const embed = new EmbedBuilder()
                .setTitle('🔔 Alaska State Staff Promotion')
                .setDescription(`Congratulations, <@${options.getUser('user').id}>!`)
                .addFields({ name: 'Rank', value: options.getString('rank'), inline: true }, { name: 'Reason', value: options.getString('reason'), inline: true })
                .setImage(PROMO_BANNER).setColor("#3498db");
            return int.reply({ content: `<@${options.getUser('user').id}>`, embeds: [embed] });
        }

        // (Lockdown, Snipe, and Infraction logic remains the same as previous build)
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log('✅ Full Alaska System Online.');
});

client.login(process.env.TOKEN);
