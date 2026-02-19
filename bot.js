require('dotenv').config();
const fs = require('fs');
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, REST, Routes, ActivityType, 
    StringSelectMenuBuilder 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

const BOT_COLOR = "#2f3136"; 
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const CONFIG_PATH = './config.json';

let config = (() => {
    try { return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : {}; }
    catch { return {}; }
})();

const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

// Store ticket metadata: { channelId: { openerId, startTime, claimedBy } }
const ticketData = new Map();

client.on('interactionCreate', async (int) => {
    if (!int.guild || int.user.bot) return;

    try {
        // 1. TICKET CREATION
        if (int.isStringSelectMenu() && int.customId === 'ticket_type') {
            await int.deferReply({ ephemeral: true });
            if (!config.staffRole) return int.editReply("⚠️ Use `/setup` first.");

            const dept = int.values[0];
            let pingRole = config.staffRole; 
            if (dept === 'internal-affairs') pingRole = config.iaRole;
            if (dept === 'management') pingRole = config.mgmtRole;

            const channel = await int.guild.channels.create({
                name: `${dept}-${int.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: pingRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            // Store Metadata
            ticketData.set(channel.id, { openerId: int.user.id, startTime: Date.now(), claimedBy: null });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
            );
            
            await channel.send({
                content: `${int.user} | <@&${pingRole}>`,
                embeds: [new EmbedBuilder()
                    .setTitle(`🏛️ ${dept.replace('-', ' ').toUpperCase()} Session`)
                    .setColor(BOT_COLOR)
                    .setDescription("Staff will be with you shortly. Use the buttons below to manage this session.")
                    .setImage(SUPPORT_BANNER)],
                components: [row]
            });

            return int.editReply(`✅ Session created: ${channel}`);
        }

        // 2. CLAIM LOGIC
        if (int.isButton() && int.customId === 'claim_ticket') {
            const data = ticketData.get(int.channel.id);
            if (data?.claimedBy) return int.reply({ content: `⚠️ Already claimed by <@${data.claimedBy}>`, ephemeral: true });

            data.claimedBy = int.user.id;
            ticketData.set(int.channel.id, data);

            const claimEmbed = new EmbedBuilder()
                .setColor(ButtonStyle.Success)
                .setDescription(`✅ This ticket is now being handled by ${int.user}.`);

            await int.reply({ embeds: [claimEmbed] });
            // Remove the claim button but keep the close button
            const newRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
            );
            await int.message.edit({ components: [newRow] });
        }

        // 3. CLOSE & DETAILED LOGS
        if (int.isButton() && int.customId === 'close_ticket') {
            const data = ticketData.get(int.channel.id) || { openerId: "Unknown", startTime: Date.now(), claimedBy: "None" };
            
            await int.reply("📑 **Processing logs and closing...**");

            // Calculate Duration
            const durationMs = Date.now() - data.startTime;
            const mins = Math.floor(durationMs / 60000);
            const secs = ((durationMs % 60000) / 1000).toFixed(0);
            const durationString = `${mins}m ${secs}s`;

            const msgs = await int.channel.messages.fetch({ limit: 100 });
            const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
            const logCh = int.guild.channels.cache.get(config.logChannel);

            if (logCh) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("📁 Session Closed")
                    .setColor("#ff4757")
                    .addFields(
                        { name: "Opened By", value: `<@${data.openerId}>`, inline: true },
                        { name: "Claimed By", value: data.claimedBy ? `<@${data.claimedBy}>` : "Unclaimed", inline: true },
                        { name: "Closed By", value: `${int.user}`, inline: true },
                        { name: "Duration", value: `\`${durationString}\``, inline: true },
                        { name: "Channel", value: `\`${int.channel.name}\``, inline: true }
                    )
                    .setTimestamp();

                const buffer = Buffer.from(transcript, 'utf-8');
                await logCh.send({ embeds: [logEmbed], files: [{ attachment: buffer, name: `transcript-${int.channel.name}.txt` }] });
            }

            ticketData.delete(int.channel.id);
            setTimeout(() => int.channel.delete().catch(() => {}), 5000);
        }

        // 4. SETUP
        if (int.isChatInputCommand() && int.commandName === 'setup') {
            if (!int.member.permissions.has(PermissionsBitField.Flags.Administrator)) return int.reply({ content: "🚫 Admin only.", ephemeral: true });
            config = { logChannel: int.options.getChannel('logs').id, staffRole: int.options.getRole('staff').id, iaRole: int.options.getRole('ia_role').id, mgmtRole: int.options.getRole('management_role').id };
            saveConfig();
            const menu = new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('Select Department...')
                .addOptions([
                    { label: 'General Support', value: 'general', emoji: '❓' },
                    { label: 'Internal Affairs', value: 'internal-affairs', emoji: '👮' },
                    { label: 'Management', value: 'management', emoji: '💎' }
                ]);
            await int.channel.send({ 
                embeds: [new EmbedBuilder().setTitle('🏛️ Alaska Support & Relations').setColor(BOT_COLOR).setDescription('Select a category to begin.').setImage(SUPPORT_BANNER)], 
                components: [new ActionRowBuilder().addComponents(menu)] 
            });
            return int.reply({ content: "✅ Deployed.", ephemeral: true });
        }
    } catch (e) { console.error(e); }
});

client.once('ready', async () => {
    const commands = [new SlashCommandBuilder().setName('setup').setDescription('Deploy ticket panel').addChannelOption(o => o.setName('logs').setDescription('Logs').setRequired(true)).addRoleOption(o => o.setName('staff').setDescription('Staff').setRequired(true)).addRoleOption(o => o.setName('ia_role').setDescription('IA').setRequired(true)).addRoleOption(o => o.setName('management_role').setDescription('Mgmt').setRequired(true))];
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ Alaska Executive Online.`);
});

client.login(process.env.TOKEN);
