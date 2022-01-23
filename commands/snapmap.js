const { MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios').default;

const API_BASE = 'https://ms.sc-jpl.com/web/';
const TILE_SET_TYPE_POI = 'POI';
const TILE_SET_TYPE_HEAT = 'HEAT';
const LATEST_TILESET_API = API_BASE + 'getLatestTileSet';
const PLAYLIST_API = API_BASE + 'getPlaylist';
const GEO_CODING_API = 'https://nominatim.openstreetmap.org/search';

const CITY_RADIUS_METER = 11811.130585458892;
const CITY_ZOOM_LEVEL = 8.301441394685607;

const SNAPMAP_CMD_NAME = 'snapmap';
const SNAPMAP_CMD_DESC = 'Get a random snap from a specified location.';
const SNAPMAP_CMD_PARAM_QUERY = 'query';
const SNAPMAP_CMD_PARAM_QUERY_DESC = 'A place to look for snaps.';

module.exports = {
    data: new SlashCommandBuilder()
        .setName(SNAPMAP_CMD_NAME)
        .setDescription(SNAPMAP_CMD_DESC)
        .addStringOption(option => option
            .setName(SNAPMAP_CMD_PARAM_QUERY)
            .setDescription(SNAPMAP_CMD_PARAM_QUERY_DESC)
            .setRequired(true),
        ),
    async execute(interaction) {
        try {
            const query = interaction.options.getString(SNAPMAP_CMD_PARAM_QUERY);
            const queryResponse = await axios.get(GEO_CODING_API, {
                params : {
                    q: query,
                    format: 'json',
                    adressdetails: 1,
                },
            });
            if (!queryResponse.data?.length) {
                await interaction.reply({ content: 'I can\'t find this location.', ephemeral: true });
                return;
            }
            const place = queryResponse.data[0];

            const epoch = await getEpoch(TILE_SET_TYPE_HEAT);
            const response = await axios.post(PLAYLIST_API, { 'requestGeoPoint': { 'lat': +place.lat, 'lon': +place.lon }, 'zoomLevel': CITY_ZOOM_LEVEL, 'tileSetId': { 'flavor': 'default', 'epoch': epoch, 'type': 1 }, 'radiusMeters': CITY_RADIUS_METER });

            const snaps = response.data.manifest.elements.filter(element => element.snapInfo.streamingMediaInfo.prefixUrl);
            if (!snaps.length) {
                await interaction.reply({ content: 'No snap found here.', ephemeral: true });
                return;
            }
            let currentSnapIndex = 0;
            let nbSnapsLeft = snaps.length - (currentSnapIndex + 1);
            const buttonNextId = `next${interaction.id}`;
            const buttonNext = new MessageButton()
                .setCustomId(buttonNextId)
                .setLabel('Next')
                .setStyle('PRIMARY');
            const buttonClearId = `clear${interaction.id}`;
            const buttonClear = new MessageButton()
                .setCustomId(buttonClearId)
                .setLabel('Clear')
                .setStyle('SECONDARY');
            const row = new MessageActionRow().addComponents(buttonNext, buttonClear);
            const embed = new MessageEmbed().setColor('#FFFC00');

            updateEmbed(embed, snaps, currentSnapIndex);
            await interaction.reply({
                components: nbSnapsLeft ? [row] : [],
                embeds: [embed],
                files: [getSnapUrl(snaps[currentSnapIndex])],
            });

            const filter = i => ([buttonNextId, buttonClearId].includes(i.customId)) && (i.user.id === interaction.member.id);
            const collector = interaction.channel.createMessageComponentCollector({ filter, idle: 120000, dispose: true });
            collector.on('collect', async i => {
                try {
                    if (i.customId === buttonNextId) {
                        currentSnapIndex++;
                        nbSnapsLeft = snaps.length - (currentSnapIndex + 1);
                        updateEmbed(embed, snaps, currentSnapIndex);
                        // TODO: can't use `update` because it adds another video instead of replacing it
                        await interaction.editReply({
                            components: nbSnapsLeft ? [row] : [],
                            embeds: [embed],
                            files: [getSnapUrl(snaps[currentSnapIndex])],
                        });
                        // TODO: still have to update to "reply" to the interaction button
                        await i.update({
                        });
                    }
                    else if (i.customId === buttonClearId) {
                        collector.stop();
                    }
                }
                catch (error) {
                    console.error(error);
                }
            });
            collector.on('end', async _collected => {
                try {
                    await interaction.deleteReply();
                }
                catch (error) {
                    console.error(error);
                }
            });
        }
        catch (error) {
            console.error(error);
        }
    },
};

function getSnapUrl(snap) {
    return `${snap.snapInfo.streamingMediaInfo.prefixUrl}${snap.snapInfo.streamingMediaInfo.mediaUrl}`;
}

/**
 * Updates the embed containing snap information.
 * @param {MessageEmbed} embed Embed to update.
 * @param {*[]} snaps Loaded snaps.
 * @param {number} currentSnapIndex Current show snap index.
 */
function updateEmbed(embed, snaps, currentSnapIndex) {
    embed.setTitle(snaps[currentSnapIndex].snapInfo.title.fallback)
        .setTimestamp(+snaps[currentSnapIndex].timestamp)
        .setFooter({ text: `${currentSnapIndex + 1}/${snaps.length} snaps` });
}

async function getEpoch(type) {
    const response = await getLatestTileSet();
    const tileSetInfos = response.data.tileSetInfos;
    switch (type) {
        case TILE_SET_TYPE_POI:
            return tileSetInfos[0].id.epoch;
        case TILE_SET_TYPE_HEAT:
            return tileSetInfos[1].id.epoch;
        default: return 0;
    }
}

async function getLatestTileSet() {
    return axios.post(LATEST_TILESET_API, {}).then(function(response) {
        return response;
    })
        .catch(function(error) {
            console.error(error);
            return error;
        });
}