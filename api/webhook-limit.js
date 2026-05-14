const fetch = require('node-fetch');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || 'BotUtama';
const CREATOR_USERNAME = '@xnecz';
const VERCEL_URL = process.env.VERCEL_URL || '';

// ==================== DATABASE ====================
async function getDB() {
    const res = await fetch(GIST_API, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    const gist = await res.json();
    return JSON.parse(gist.files['database.json'].content);
}

async function saveDB(db) {
    await fetch(GIST_API, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            files: {
                'database.json': { content: JSON.stringify(db, null, 2) }
            }
        })
    });
}

// ==================== HELPERS ====================
async function sendMessage(chatId, text, replyMarkup = null, botToken) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch {
        return false;
    }
}

async function sendPhoto(chatId, photoUrl, caption = '', replyMarkup = null, botToken) {
    try {
        const payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch {
        return false;
    }
}

function containsBlacklistWord(text, blacklistWords) {
    if (!text || !blacklistWords.length) return false;
    const lowerText = text.toLowerCase();
    return blacklistWords.some(word => lowerText.includes(word.toLowerCase()));
}

// ==================== HANDLER ====================
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'OK', message: 'Bot Limit System Active' });
    }
    
    const body = req.body;
    
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const fromUser = msg.from;
        const senderId = fromUser.id;
        const senderUsername = fromUser.username || '';
        const senderName = fromUser.first_name || 'Unknown';
        
        // Get bot token from webhook URL or determine which bot this is
        const db = await getDB();
        
        // Find the bot by checking which token matches
        let currentBot = null;
        for (const [botId, bot] of Object.entries(db.bots)) {
            // We'll identify the bot by the chat ID pattern or token
            // Since we can't get token from webhook directly, we'll use a different approach
            // Store bot info in message context via webhook URL parameter
            if (bot.status === 'active' && !bot.settings.isPaused) {
                // Try sending to this bot's owner to verify
                currentBot = bot;
                break; // Temporary - we'll fix this logic
            }
        }
        
        // Better approach: Identify bot from the request URL
        // The webhook URL should include bot identifier
        const urlParts = req.url?.split('/') || [];
        const botIdentifier = urlParts[urlParts.length - 1] || '';
        
        // Find bot by identifier
        for (const [botId, bot] of Object.entries(db.bots)) {
            if (botId === botIdentifier || bot.botUsername === botIdentifier.replace('@', '')) {
                currentBot = bot;
                break;
            }
        }
        
        if (!currentBot) {
            // Fallback: find any active bot that might match
            for (const [botId, bot] of Object.entries(db.bots)) {
                if (bot.status === 'active') {
                    currentBot = bot;
                    break;
                }
            }
        }
        
        if (!currentBot) {
            return res.status(200).json({ status: 'OK', message: 'No active bot found' });
        }
        
        const bot = currentBot;
        const botToken = bot.token;
        const ownerId = bot.ownerId;
        const settings = bot.settings;
        
        // Check if sender is blocked
        if (settings.blockedUsers[senderId]) {
            return res.status(200).json({ status: 'OK', message: 'User blocked' });
        }
        
        // Check if sender is the owner
        const isOwner = senderId === ownerId;
        
        // Handle /start command
        if (text === '/start') {
            // Build welcome message
            let welcomeMsg = settings.welcomeMessage;
            welcomeMsg = welcomeMsg.replace('{name}', senderName);
            welcomeMsg = welcomeMsg.replace('{username}', senderUsername || senderName);
            welcomeMsg = welcomeMsg.replace('{botname}', bot.botName);
            
            // Build buttons
            const buttons = [];
            
            // Add custom buttons
            if (settings.customButtons.length > 0) {
                const row = [];
                for (const btn of settings.customButtons) {
                    row.push({ text: btn.text, url: btn.url });
                    if (row.length === 2) {
                        buttons.push([...row]);
                        row.length = 0;
                    }
                }
                if (row.length > 0) buttons.push(row);
            }
            
            // Add default buttons
            buttons.push([{ text: '🔗 Buat Bot Limit Sendiri', url: `https://t.me/${MAIN_BOT_USERNAME}` }]);
            
            const keyboard = { inline_keyboard: buttons };
            
            await sendMessage(chatId, welcomeMsg, keyboard, botToken);
            
            // Notify owner about new user
            if (settings.notifyOwner && !isOwner) {
                try {
                    await sendMessage(ownerId,
                        `🔔 <b>NOTIFIKASI BOT</b>\n\n` +
                        `🤖 Bot: @${bot.botUsername}\n` +
                        `👤 User baru: @${senderUsername || 'Tanpa Username'}\n` +
                        `📝 Nama: ${senderName}\n` +
                        `🔗 Link: t.me/${senderUsername || senderId}\n\n` +
                        `User ini baru saja memulai bot kamu.`,
                        null,
                        process.env.BOT_TOKEN // Use main bot token for notification
                    );
                } catch {}
            }
            
            // Update stats
            if (!isOwner) {
                bot.stats.uniqueUsers[senderId] = {
                    username: senderUsername,
                    firstName: senderName,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    messageCount: 0
                };
            }
            
            await saveDB(db);
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle /panel for owner
        if (text === '/panel' && isOwner) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Statistik', callback_data: `limit_stats_${bot.botId}` }],
                    [{ text: '⚙️ Pengaturan', callback_data: `limit_settings_${bot.botId}` }],
                    [{ text: '🔙 Ke Bot Utama', url: `https://t.me/${MAIN_BOT_USERNAME}` }]
                ]
            };
            
            await sendMessage(chatId,
                `🎛️ <b>PANEL BOT</b>\n\n` +
                `🤖 @${bot.botUsername}\n` +
                `📨 Pesan: ${bot.stats.totalMessages}\n` +
                `👥 User Unik: ${Object.keys(bot.stats.uniqueUsers).length}\n\n` +
                `🔗 t.me/${bot.botUsername}`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle messages
        if (!isOwner && !text.startsWith('/')) {
            // Message from someone else to the owner
            
            // Check blacklist words
            if (containsBlacklistWord(text, settings.blacklistWords)) {
                await sendMessage(chatId,
                    '⚠️ Pesan kamu mengandung kata yang diblokir oleh pemilik bot.',
                    null,
                    botToken
                );
                return res.status(200).json({ status: 'OK' });
            }
            
            // Check operating hours
            if (settings.operatingHours?.enabled) {
                const now = new Date();
                const currentHour = now.getHours();
                const currentMinute = now.getMinutes();
                const currentTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
                
                if (currentTime < settings.operatingHours.start || currentTime > settings.operatingHours.end) {
                    if (settings.autoReply) {
                        await sendMessage(chatId, settings.autoReplyText, null, botToken);
                    }
                    return res.status(200).json({ status: 'OK' });
                }
            }
            
            // Forward message to owner
            const forwardKeyboard = {
                inline_keyboard: [
                    [{ text: '💬 Balas', callback_data: `reply_${senderId}_${bot.botId}` }],
                    [{ text: '🚫 Blokir User', callback_data: `block_${senderId}_${bot.botId}` }]
                ]
            };
            
            let forwardText = `📩 <b>PESAN BARU</b>\n\n`;
            forwardText += `🤖 Bot: @${bot.botUsername}\n`;
            forwardText += `👤 Dari: @${senderUsername || 'Tanpa Username'}\n`;
            forwardText += `📝 Nama: ${senderName}\n`;
            forwardText += `🆔 ID: <code>${senderId}</code>\n`;
            if (senderUsername) forwardText += `🔗 Link: t.me/${senderUsername}\n`;
            forwardText += `\n💬 <b>Pesan:</b>\n${text}`;
            
            if (settings.forwardToOwner) {
                await sendMessage(ownerId, forwardText, forwardKeyboard, process.env.BOT_TOKEN);
            }
            
            // Auto reply if enabled
            if (settings.autoReply) {
                await sendMessage(chatId, settings.autoReplyText, null, botToken);
            }
            
            // Update stats
            bot.stats.totalMessages++;
            bot.stats.totalIncoming++;
            bot.stats.todayMessages++;
            if (bot.stats.uniqueUsers[senderId]) {
                bot.stats.uniqueUsers[senderId].lastSeen = new Date().toISOString();
                bot.stats.uniqueUsers[senderId].messageCount++;
            }
            
            // Add to chat log
            bot.chatLog.push({
                direction: 'in',
                from: senderUsername || senderName,
                userId: senderId,
                text: text,
                timestamp: new Date().toISOString()
            });
            
            // Keep only last 50 logs
            if (bot.chatLog.length > 50) {
                bot.chatLog = bot.chatLog.slice(-50);
            }
            
            const mainDB = await getDB();
            mainDB.stats.totalMessages++;
            await saveDB(db);
            
            return res.status(200).json({ status: 'OK' });
        }
    }
    
    // Handle callback queries
    if (body.callback_query) {
        const callback = body.callback_query;
        const data = callback.data;
        const chatId = callback.message.chat.id;
        const userId = callback.from.id;
        
        const db = await getDB();
        
        // Find bot
        let currentBot = null;
        for (const [botId, bot] of Object.entries(db.bots)) {
            if (data.includes(botId)) {
                currentBot = bot;
                break;
            }
        }
        
        if (!currentBot) {
            return res.status(200).json({ status: 'OK' });
        }
        
        const bot = currentBot;
        const botToken = bot.token;
        
        // Handle reply
        if (data.startsWith('reply_')) {
            const parts = data.replace('reply_', '').split('_');
            const targetUserId = parts[0];
            
            await sendMessage(chatId,
                `💬 Untuk membalas pesan ke user ${targetUserId}, ketik:\n\n` +
                `<code>/reply ${targetUserId} PESAN_KAMU</code>\n\n` +
                `Contoh:\n<code>/reply ${targetUserId} Halo! Terima kasih sudah chat.</code>`,
                null,
                botToken
            );
        }
        
        // Handle block
        if (data.startsWith('block_')) {
            const parts = data.replace('block_', '').split('_');
            const blockUserId = parts[0];
            
            bot.settings.blockedUsers[blockUserId] = {
                blockedAt: new Date().toISOString()
            };
            await saveDB(db);
            
            await sendMessage(chatId,
                `✅ User ${blockUserId} berhasil diblokir dari bot @${bot.botUsername}`,
                null,
                botToken
            );
        }
        
        // Handle limit stats
        if (data.startsWith('limit_stats_')) {
            const st = bot.stats;
            await sendMessage(chatId,
                `📊 <b>STATISTIK BOT</b>\n\n` +
                `🤖 @${bot.botUsername}\n\n` +
                `📨 Total Pesan: ${st.totalMessages}\n` +
                `📥 Masuk: ${st.totalIncoming}\n` +
                `📤 Keluar: ${st.totalOutgoing}\n` +
                `👥 User Unik: ${Object.keys(st.uniqueUsers).length}\n` +
                `📅 Hari Ini: ${st.todayMessages}`,
                null,
                botToken
            );
        }
        
        return res.status(200).json({ status: 'OK' });
    }
    
    res.status(200).json({ status: 'OK' });
};
