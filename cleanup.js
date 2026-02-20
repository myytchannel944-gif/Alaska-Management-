require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1473514468360196369';
const GUILD_ID = '1472277307002589216';   // your server ID

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Starting command cleanup...');

        // 1. Delete ALL global (worldwide) slash commands
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
        console.log('→ All global commands deleted');

        // 2. Delete ALL guild-specific commands in your server
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
        console.log(`→ All commands deleted in guild ${GUILD_ID}`);

        console.log('Cleanup finished successfully.');
        console.log('You can now restart your main bot — only the current commands should appear.');
    } catch (error) {
        console.error('Cleanup failed:', error);
        if (error.code) {
            console.log(`Error code: ${error.code} → ${error.message || 'No message'}`);
        }
    }
})();
