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

// ─── Constants ──────────────────────────────────────────────────
const BOT_COLOR = "#2f3136"; 
const SUPPORT_BANNER = "https://image2url.com/r2/default/images/1771467061096-fc09db59-fd9e-461f-ba30-c8b1ee42ff1f.jpg";
const TICKET_ROLE_ID = "1474234032677060795"; // The role to add/remove
const CONFIG_PATH = './config.json';

let config = (() => {
    try { return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : {}; }
    catch { return {}; }
})();

const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

// Metadata storage for logs and durations
const ticketData = new Map();

// ─── Interaction Handler ─────────────────────────────────────────
client.on('interactionCreate', async (int) => {
    if (!int.guild || int.user.bot) return;

    try {
        // 1. TICKET CREATION
        if (int.isStringSelectMenu() && int.customId === 'ticket_type') {
            await int.deferReply({ ephemeral: true });
            if (!config.staffRole) return int.editReply("⚠️ Bot not configured. Run `/setup`.");

            const dept = int.values[0];
            let pingRole = config.staffRole; 
            if (dept === 'internal-affairs') pingRole = config.iaRole;
            if (dept === 'management') pingRole = config.mgmtRole;

            // --- ADD TICKET ROLE ---
            try {
                await int.member.roles.add(TICKET_ROLE_ID);
            } catch (e) {
                console.error("Failed to add role. Check bot permissions hierarchy.");
            }

            const channel = await int.guild.channels.create({
                name: `${dept}-${int.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: int.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                    { id: pingRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

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
                    .setDescription("Welcome. Please explain your situation in detail. Our team will assist you shortly.")
                    .setImage(SUPPORT_BANNER)
                    .setTimestamp()],
                components: [row]
            });

            return int.editReply(`✅ Session opened: ${channel}`);
        }

        // 2. CLAIM SYSTEM
        if (int.isButton() && int.customId === 'claim_ticket') {
            const data = ticketData.get(int.channel.id);
            if (data?.claimedBy) return int.reply({ content: "⚠️ Already claimed.", ephemeral: true });

            data.claimedBy = int.user.id;
            ticketData.set(int.channel.id, data);

            await int.reply({ 
                embeds: [new EmbedBuilder().setColor("#43b581").setDescription(`✅ This session has been claimed by ${int.user}.`)] 
            });

            const newRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
            );
            await int.message.edit({ components: [newRow] });
        }

        // 3. CLOSE & REMOVE ROLE
        if (int.isButton() && int.customId === 'close_ticket') {
            const data = ticketData.get(int.channel.id) || { openerId: "Unknown", startTime: Date.now(), claimedBy: null };
            await int.reply("📑 **Processing logs and closing...**");

            // --- REMOVE TICKET ROLE ---
            if (data.openerId !== "Unknown") {
                try {
                    const member = await int.guild.members.fetch(data.openerId).catch(() => null);
                    if (member) await member.roles.remove(TICKET_ROLE_ID);
                } catch (e) {
                    console.error("Failed to remove role.");
                }
            }

            // Duration calculation
            const durationMs = Date.now() - data.startTime;
            const mins = Math.floor(durationMs / 60000);
            const secs = ((durationMs % 60000) / 1000).toFixed(0);

            const msgs = await int.channel.messages.fetch({ limit: 100 });
            const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
            const logCh = int.guild.channels.cache.get(config.logChannel);

            if (logCh) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("📁 Ticket Logged")
                    .setColor("#ff4757")
                    .addFields(
                        { name: "Opener", value: `<@${data.openerId}>`, inline: true },
                        { name: "Claimed By", value: data.claimedBy ? `<@${data.claimedBy}>` : "Unclaimed", inline: true },
                        { name: "Closed By", value: `${int.user}`, inline: true },
                        { name: "Duration", value: `\`${mins}m ${secs}s\``, inline: true }
                    ).setTimestamp();

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

            const panelEmbed = new EmbedBuilder()
                .setTitle('🏛️ Alaska Support & Relations')
                .setColor(BOT_COLOR)
                .setDescription('Select a category below to initiate a private session.\n\n🔹 **General Support**\nServer help and partnerships.\n\n🔹 **Internal Affairs**\nStaff misconduct reports.\n\n🔹 **Management**\nExecutive appeals and perk claims.')
                .setImage(SUPPORT_BANNER);

            await int.channel.send({ embeds: [panelEmbed], components: [new ActionRowBuilder().addComponents(menu)] });
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
