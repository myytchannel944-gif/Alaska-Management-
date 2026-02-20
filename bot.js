// ... (keep all previous code the same up to the 'setup' command)

// Inside the 'setup' command block:
if (interaction.commandName === 'setup') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "Admin only.", ephemeral: true });
    }

    config.logChannel    = interaction.options.getChannel('logs')?.id ?? null;
    config.staffRole     = interaction.options.getRole('staff')?.id ?? null;
    config.iaRole        = interaction.options.getRole('ia_role')?.id ?? null;
    config.mgmtRole      = interaction.options.getRole('management_role')?.id ?? null;

    await saveConfig();

    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type')
        .setPlaceholder('Select Department...')
        .addOptions([
            { label: 'General Support',   value: 'general',         emoji: '❓' },
            { label: 'Internal Affairs',  value: 'internal-affairs', emoji: '👮' },
            { label: 'Management',        value: 'management',      emoji: '💎' },
        ]);

    const embed = new EmbedBuilder()
        .setTitle("🏛️ Alaska Support & Relations")
        .setDescription(
            "**Select a category below to initiate a private session.**\n\n" +

            "♦ **General Support**\n" +
            "Server help and partnerships.\n\n" +

            "♦ **Internal Affairs**\n" +
            "Staff misconduct reports.\n\n" +

            "♦ **Management**\n" +
            "Executive appeals and perk claims."
        )
        .setColor(COLORS.PRIMARY)
        .setImage(ASSETS.SUPPORT_BANNER)
        .setFooter({ text: "SUPPORT — Alaska State Roleplay" });

    await interaction.channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)],
    });

    return interaction.reply({ content: "Ticket panel deployed.", ephemeral: true });
}

// ... (rest of the code remains unchanged)
