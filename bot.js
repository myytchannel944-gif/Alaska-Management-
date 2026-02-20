client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild || interaction.user.bot) return;

    // ── Debug: log every interaction ───────────────────────────────
    console.log(
        `[INTERACTION] ${interaction.type} | ` +
        `ID: ${interaction.customId || interaction.commandName || 'n/a'} | ` +
        `User: ${interaction.user.tag} (${interaction.user.id}) | ` +
        `Guild: ${interaction.guild.name} | Channel: ${interaction.channel?.name || 'DM'}`
    );

    try {
        // ── Slash Commands ────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            // These are usually fast → no defer needed unless you add slow stuff later
            if (interaction.commandName === 'dashboard') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: "ALASKA STATE ROLEPLAY • OFFICIAL DIRECTORY", iconURL: ASSETS.DASHBOARD_ICON })
                    .setTitle("Dashboard")
                    .setDescription(
                        "**Welcome to Alaska State RolePlay!**\n\n" +
                        "The best ER:LC roleplay community.\n\n" +
                        "Make sure you've read the rules and understand the application process.\n" +
                        "Use the menu below to navigate."
                    )
                    .setColor(COLORS.PRIMARY)
                    .setImage(ASSETS.DASHBOARD_ICON)
                    .setTimestamp();

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('asrp_dashboard')
                    .setPlaceholder('Select an option...')
                    .addOptions([
                        { label: 'Staff Applications', value: 'staff_apps', emoji: '📝' },
                        { label: 'In-Game Rules',      value: 'ig_rules',   emoji: '🎮' },
                        { label: 'Discord Rules',      value: 'dc_rules',   emoji: '📜' },
                    ]);

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                }).catch(err => console.error('Failed to send dashboard message:', err));

                return interaction.reply({ content: "✅ Dashboard panel deployed.", ephemeral: true });
            }

            if (interaction.commandName === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: "🚫 Admin only.", ephemeral: true });
                }

                config.logChannel     = interaction.options.getChannel('logs')?.id ?? null;
                config.staffRole      = interaction.options.getRole('staff')?.id ?? null;
                config.iaRole         = interaction.options.getRole('ia_role')?.id ?? null;
                config.mgmtRole       = interaction.options.getRole('management_role')?.id ?? null;

                await saveConfig().catch(err => console.error('Save config failed:', err));

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_type')
                    .setPlaceholder('Select Department...')
                    .addOptions([
                        { label: 'General Support',   value: 'general',         emoji: '❓' },
                        { label: 'Internal Affairs',  value: 'internal-affairs', emoji: '👮' },
                        { label: 'Management',        value: 'management',      emoji: '💎' },
                    ]);

                const embed = new EmbedBuilder()
                    .setTitle('🏛️ Alaska Support')
                    .setColor(COLORS.PRIMARY)
                    .setImage(ASSETS.SUPPORT_BANNER);

                await interaction.channel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(menu)],
                }).catch(err => console.error('Failed to send ticket panel:', err));

                return interaction.reply({ content: "✅ Ticket panel deployed.", ephemeral: true });
            }
        }

        // ── String Select Menus ───────────────────────────────────────
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'asrp_dashboard') {
                // Fast → no defer needed
                const pages = {
                    staff_apps: {
                        title: "📝 Applications + Forms",
                        content:
                            "• **Staff Application**\n" +
                            "Applications are currently **OPEN**\n\n" +
                            "🔗 [Apply here](https://your-link.com)\n\n" +
                            "Check your status in <#staff-announcements>",
                    },
                    ig_rules: {
                        title: "🎮 In-Game Rules",
                        content:
                            "**Serious Roleplay Only**\n\n" +
                            "• Be respectful — no hate speech / toxicity\n" +
                            "• No exploits, cheats, mods\n" +
                            "• No RDM / VDM\n" +
                            "• No failed RP or powergaming\n" +
                            "• No trolling or unrealistic scenarios",
                    },
                    dc_rules: {
                        title: "📜 Discord Rules",
                        content: "Same core rules as in-game:\nRespect, no toxicity, no spam, no advertising.",
                    },
                };

                const selected = interaction.values[0];
                const page = pages[selected];

                if (!page) {
                    return interaction.reply({ content: "Invalid option.", ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle(page.title)
                    .setDescription(page.content)
                    .setColor(COLORS.PRIMARY)
                    .setThumbnail(ASSETS.DASHBOARD_ICON);

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (interaction.customId === 'ticket_type') {
                // This can be slow → defer immediately
                await interaction.deferReply({ ephemeral: true }).catch(err => {
                    console.error('Defer ticket reply failed:', err);
                });

                try {
                    if (!config.staffRole) {
                        return interaction.editReply("⚠️ Bot not fully configured. Run `/setup` first.");
                    }

                    const department = interaction.values[0];
                    const pingRoleId = getPingRoleId(department);
                    if (!pingRoleId) {
                        return interaction.editReply("⚠️ Missing role configuration for this department.");
                    }

                    await interaction.member.roles.add(TICKET_ROLE_ID).catch(err => {
                        console.warn(`Failed to add ticket role to ${interaction.user.tag}:`, err);
                    });

                    const ticketChannel = await interaction.guild.channels.create({
                        name: `${department}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100),
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: interaction.guild.id,               deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: interaction.user.id,                 allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: pingRoleId,                          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ],
                    }).catch(err => {
                        console.error('Channel creation failed:', err);
                        throw new Error('Failed to create ticket channel');
                    });

                    ticketData.set(ticketChannel.id, {
                        openerId: interaction.user.id,
                        startTime: Date.now(),
                        claimedBy: null,
                        department,
                    });

                    await ticketChannel.send({
                        content: `${interaction.user} | <@&${pingRoleId}>`,
                        embeds: [createTicketEmbed(department)],
                        components: [createControlButtons()],
                    }).catch(err => console.error('Failed to send initial ticket message:', err));

                    await interaction.editReply(`✅ Ticket created: ${ticketChannel}`);

                } catch (err) {
                    console.error('Ticket creation flow failed:', err);
                    await interaction.editReply({ content: "❌ Failed to create ticket. Check bot permissions (Manage Channels, etc.)." }).catch(() => {});
                }
            }
        }

        // ── Buttons ───────────────────────────────────────────────────
        if (interaction.isButton()) {
            const channelId = interaction.channel?.id;
            const data = channelId ? ticketData.get(channelId) : null;

            if (!data) {
                console.warn(`No ticket data found for channel ${channelId}`);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: "This ticket no longer exists or data was lost.", ephemeral: true }).catch(() => {});
                }
                return;
            }

            // Buttons can involve edits → deferUpdate
            await interaction.deferUpdate().catch(err => console.warn('Defer update failed:', err));

            try {
                if (interaction.customId === 'claim_ticket') {
                    if (data.claimedBy) {
                        return interaction.editReply({ content: "This ticket is already claimed.", components: [] }).catch(() => {});
                    }

                    data.claimedBy = interaction.user.id;

                    const claimedEmbed = new EmbedBuilder()
                        .setColor(COLORS.SUCCESS)
                        .setDescription(`✅ Claimed by ${interaction.user}`);

                    const closeOnlyRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('close_ticket')
                            .setLabel('Close')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await interaction.editReply({
                        embeds: [claimedEmbed],
                        components: [closeOnlyRow],
                    });
                }

                if (interaction.customId === 'close_ticket') {
                    await interaction.editReply({ content: "📑 Closing ticket in a few seconds..." }).catch(() => {});

                    const member = await interaction.guild.members.fetch(data.openerId).catch(() => null);
                    if (member) {
                        await member.roles.remove(TICKET_ROLE_ID).catch(err => {
                            console.warn(`Failed to remove ticket role from ${member.user.tag}:`, err);
                        });
                    }

                    // Log to channel
                    if (config.logChannel) {
                        const logCh = interaction.guild.channels.cache.get(config.logChannel);
                        if (logCh?.isTextBased()) {
                            const duration = Math.floor((Date.now() - data.startTime) / 60000);
                            const logEmbed = new EmbedBuilder()
                                .setTitle("📁 Ticket Closed")
                                .setColor(COLORS.DANGER)
                                .addFields(
                                    { name: "Opener",     value: `<@${data.openerId}>`, inline: true },
                                    { name: "Closed by",  value: `${interaction.user}`, inline: true },
                                    { name: "Duration",   value: `${duration} min`,     inline: true },
                                    { name: "Department", value: data.department,       inline: true },
                                )
                                .setTimestamp();

                            await logCh.send({ embeds: [logEmbed] }).catch(err => console.error('Log send failed:', err));
                        }
                    }

                    ticketData.delete(channelId);
                    setTimeout(() => {
                        interaction.channel?.delete().catch(err => console.error('Channel delete failed:', err));
                    }, 3500);
                }
            } catch (btnErr) {
                console.error('Button action failed:', btnErr);
                await interaction.editReply({ content: "Error while processing — ticket may still be open." }).catch(() => {});
            }
        }

    } catch (topLevelErr) {
        console.error('Critical interaction handler error:', topLevelErr);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "Something went wrong on our end. Admins have been notified.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});
