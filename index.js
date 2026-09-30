const http = require('http');
const axios = require('axios');

// Tạo một HTTP Server giả để "lừa" Render Web Service quét thấy Port
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Roblox Tracker Bot is running!\n');
}).listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

// ... giữ nguyên toàn bộ code cũ bên dưới ...

// CONFIGURE YOUR DATA HERE
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ROBLOX_USER_ID = process.env.ROBLOX_USER_ID;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID;
const CHECK_INTERVAL = 15000; 

// Danh sách các Place ID cần theo dõi
const TARGET_PLACE_IDS = ['85776757589518', '77649408247578'];

const PresenceType = {
    0: '🔴 Offline',
    1: '🟢 Online',
    2: '🎣 In Game',
    3: '🛠️ In Studio'
};

let lastPresence = null;
let lastPlaceId = null;
let joinedGameAt = null;

// Format thời gian hiển thị chuẩn mẫu (vd: 2m 30s)
function formatTimeInGame(startTime) {
    if (!startTime) return '0m 0s';
    const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m${seconds}s`;
    return `${minutes}m${seconds}s`;
}

// Format thời gian phát hiện (vd: 7:28:13 CH)
function getDetectedTime() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: true });
}

// Lấy Username và Display Name
async function getUserDetails(userId) {
    try {
        const response = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        return {
            displayName: response.data.displayName || 'Không rõ',
            username: response.data.name || 'Không rõ'
        };
    } catch (error) {
        return { displayName: 'Roblox User', username: 'Unknown' };
    }
}

// Lấy Avatar Headshot
async function getUserAvatar(userId) {
    try {
        const response = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        return response.data.data?.[0]?.imageUrl || 'https://www.roblox.com/favicon.ico';
    } catch (error) {
        return 'https://www.roblox.com/favicon.ico';
    }
}

async function checkUserPresence() {
    try {
        const response = await axios.post('https://presence.roblox.com/v1/presence/users', {
            userIds: [ROBLOX_USER_ID]
        });

        const userData = response.data.userPresences?.[0];
        if (!userData) return;

        const currentPresence = userData.userPresenceType;
        const currentPlaceId = userData.placeId ? String(userData.placeId) : null;
        const gameTitle = userData.lastLocation || 'Trò chơi mục tiêu';

        // Lần đầu khởi chạy
        if (lastPresence === null) {
            lastPresence = currentPresence;
            lastPlaceId = currentPlaceId;
            if (currentPresence === 2 && TARGET_PLACE_IDS.includes(currentPlaceId)) {
                joinedGameAt = Date.now();
            }
            console.log(`[Khởi tạo] Trạng thái hiện tại: ${PresenceType[currentPresence] || currentPresence}`);
            return;
        }

        const isStatusChanged = currentPresence !== lastPresence;
        const isGameChanged = (currentPresence === 2) && (currentPlaceId !== lastPlaceId);

        if (isStatusChanged || isGameChanged) {
            const isCurrentTarget = currentPresence === 2 && TARGET_PLACE_IDS.includes(currentPlaceId);
            const isPreviousTarget = lastPresence === 2 && TARGET_PLACE_IDS.includes(lastPlaceId);

            // 1. Vừa gia nhập một trong các Game mục tiêu
            if (isCurrentTarget) {
                joinedGameAt = Date.now();

                const [userInfo, avatarUrl] = await Promise.all([
                    getUserDetails(ROBLOX_USER_ID),
                    getUserAvatar(ROBLOX_USER_ID)
                ]);

                await sendDiscordNotification({
                    action: 'JOINED',
                    userData,
                    gameTitle,
                    userInfo,
                    avatarUrl,
                    currentPresence,
                    previousPresence: lastPresence,
                    placeId: currentPlaceId
                });
            } 
            // 2. Vừa rời khỏi Game mục tiêu
            else if (isPreviousTarget) {
                const timePlayed = formatTimeInGame(joinedGameAt);

                const [userInfo, avatarUrl] = await Promise.all([
                    getUserDetails(ROBLOX_USER_ID),
                    getUserAvatar(ROBLOX_USER_ID)
                ]);

                await sendDiscordNotification({
                    action: 'LEFT',
                    userData,
                    gameTitle,
                    userInfo,
                    avatarUrl,
                    currentPresence,
                    previousPresence: lastPresence,
                    placeId: lastPlaceId,
                    timePlayed
                });

                joinedGameAt = null;
            }

            lastPresence = currentPresence;
            lastPlaceId = currentPlaceId;
        }

    } catch (error) {
        console.error('Lỗi khi kiểm tra Roblox API:', error.message);
    }
}

async function sendDiscordNotification(data) {
    const { action, userInfo, avatarUrl, currentPresence, previousPresence, placeId, gameTitle, timePlayed } = data;
    const mentionContent = DISCORD_USER_ID ? `<@${DISCORD_USER_ID}>` : '@everyone';

    const isJoined = action === 'JOINED';
    const detectedAtTime = getDetectedTime();

    const embed = {
        title: isJoined ? '🎢 Still In Game' : '🔴 Player Left Their Match',
        color: isJoined ? 0x2B2D31 : 0x2B2D31, // Màu nền tối theo phong cách Discord Embed gốc
        thumbnail: { url: avatarUrl },
        fields: [
            // Hàng 1: Username | Display Name | User ID
            { name: 'Username', value: `@${userInfo.username}`, inline: true },
            { name: 'Display Name', value: userInfo.displayName, inline: true },
            { name: 'User ID', value: `\`${ROBLOX_USER_ID}\``, inline: true },

            // Hàng 2: Current Status | Previous Status | Detected At
            { name: 'Current Status', value: PresenceType[currentPresence] || 'Không rõ', inline: true },
            { name: 'Previous Status', value: PresenceType[previousPresence] || 'Không rõ', inline: true },
            { name: 'Detected At', value: `${detectedAtTime}`, inline: true },

            // Hàng 3: Game Name
            { 
                name: isJoined ? 'Current Game' : 'Previous Game', 
                value: `[${gameTitle}](https://www.roblox.com/games/${placeId})`, 
                inline: false 
            },
        ],
        footer: {
            text: `Roblox Presence Tracker • Hôm nay lúc ${detectedAtTime}`
        }
    };

    try {
        await axios.post(DISCORD_WEBHOOK_URL, { 
            content: isJoined ? `${mentionContent}` : undefined,
            username: 'Roblox Tracker',
            avatar_url: avatarUrl,
            embeds: [embed] 
        });
        console.log(`[${detectedAtTime}] Đã gửi thông báo (${action}) cho${userInfo.displayName}`);
    } catch (error) {
        console.error('Lỗi khi gửi Discord Webhook:', error.message);
    }
}

console.log(`Đang theo dõi Roblox User (${ROBLOX_USER_ID}) trong các Game ID: ${TARGET_PLACE_IDS.join(', ')}...`);
checkUserPresence();
setInterval(checkUserPresence, CHECK_INTERVAL);