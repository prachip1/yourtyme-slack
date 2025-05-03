const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log('Bot is online!');
});
client.on('messageCreate', message => {
    if (message.content === '!ping') {
      message.channel.send('Pong!');
    }
  });
client.on('messageCreate', async message => {
    if (message.content.startsWith('!timezone')) {
        const args = message.content.split(' ');
        const cityName = args[1];
        
        if (!cityName) {
            message.channel.send('Please provide a city name.');
            return;
        }

        try {
            const response = await axios.get(`https://timely-backend-five.vercel.app/api/worldtime`, { params: { city: cityName } });
            const { datetime, day_of_week } = response.data;

            message.channel.send(`The current time in ${cityName} is ${datetime} and it's ${day_of_week}`);
        } catch (error) {
            console.error('Error fetching time data:', error);
            message.channel.send('Error fetching time data. Please try again.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
