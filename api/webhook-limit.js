const fetch = require('node-fetch');

// ==================== CONFIG ====================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const MAIN_BOT_TOKEN = process.env.BOT_TOKEN;
const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || 'LimitsModullarBOT';
const CREATOR_USERNAME = '@xnecz';

// ==================== DATABASE ====================
async function getDB() {
    try {
        const res = await fetch(GIST_API, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        const gist = await res.json();
        return JSON.parse(gist.files['database.json'].content);
    } catch (error) {
        return null;
    }
}

async function saveDB(db) {
    try {
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
        return true;
    } catch (error) {
        return false;
    }
}

// ==================== HELPERS ====================
async function sendMessage(chatId, text, replyMarkup = null, botToken) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch (error) {
        return false;
    }
}

async function sendPhoto(chatId, photoUrl, caption = '', replyMarkup = null, botToken) {
    try {
        const payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch (error) {
        return false;
    }
}

function containsBlacklistWord(text, blacklistWords) {
    if (!text || !blacklistWords || !blacklistWords.length) return false;
    const lowerText = text.toLowerCase();
    return blacklistWords.some(word => lowerText.includes(word.toLowerCase()));
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    // GET request - health check
    if (req.method !== 'POST') {
        return res.status(200).json({ 
            status: 'OK', 
            message: 'Bot Limit System Active',
            creator: CREATOR_USERNAME 
        });
    }
    
    // Ambil botId dari URL query parameter Webhook (e.g. ?botId=BOT123)
    let targetBotId = req.query?.botId;
    if (!targetBotId && req.url) {
        const match = req.url.match(/botId=([^&]+)/);
        if (match) targetBotId = match[1];
    }
    
    const body = req.body;
    
    // ==================== HANDLE CALLBACK QUERY ====================
    if (body.callback_query) {
        const callback = body.callback_query;
        const data = callback.data;
        const chatId = callback.message.chat.id;
        const userId = callback.from.id;
        const messageId = callback.message.message_id;
        
        const db = await getDB();
        if (!db) {
            return res.status(200).json({ status: 'OK' });
        }
        
        let currentBot = null;
        let botToken = null;
        
        // Deteksi bot berdasarkan parameter URL atau fallback mencocokkan data callback
        if (targetBotId && db.bots[targetBotId]) {
            currentBot = db.bots[targetBotId];
            botToken = currentBot.token;
            currentBot.botId = targetBotId;
        } else {
            for (const [botId, bot] of Object.entries(db.bots)) {
                if (data.includes(botId) || bot.ownerId === userId) {
                    currentBot = bot;
                    botToken = bot.token;
                    currentBot.botId = botId;
                    break;
                }
            }
        }
        
        if (!currentBot || !botToken) {
            try {
                await fetch(`https://api.telegram.org/bot${MAIN_BOT_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: callback.id, text: '⚠️ Bot tidak ditemukan!', show_alert: true })
                });
            } catch (error) {}
            return res.status(200).json({ status: 'OK' });
        }
        
        // Answer callback dulu biar gak loading terus
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callback.id, text: '⏳ Memproses...' })
            });
        } catch (error) {}
        
        const bot = currentBot;
        const settings = bot.settings || {};
        const stats = bot.stats || {};
        
        // Handle /panel
        if (data === 'limit_panel' || data.startsWith('limit_panel_')) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Statistik', callback_data: `limit_stats_${bot.botId}` }],
                    [{ text: '⚙️ Auto Reply', callback_data: `limit_autoreply_${bot.botId}` }],
                    [{ text: '🚫 Blacklist', callback_data: `limit_blacklist_${bot.botId}` }],
                    [{ text: '👤 Blokir User', callback_data: `limit_block_${bot.botId}` }],
                    [{ text: '📤 Forward', callback_data: `limit_forward_${bot.botId}` }],
                    [{ text: '🔔 Notifikasi', callback_data: `limit_notify_${bot.botId}` }],
                    [{ text: settings.isPaused ? '▶️ Resume' : '⏸️ Pause', callback_data: `limit_pause_${bot.botId}` }],
                    [{ text: '📋 Chat Log', callback_data: `limit_chatlog_${bot.botId}` }],
                    [{ text: '🗑️ Reset', callback_data: `limit_reset_${bot.botId}` }],
                    [{ text: '🔙 Tutup', callback_data: `limit_close` }]
                ]
            };
            
            await sendMessage(chatId,
                `🎛️ <b>CONTROL PANEL</b>\n\n` +
                `🤖 Bot: @${bot.botUsername}\n` +
                `🆔 ID: ${bot.botId}\n\n` +
                `📊 <b>Statistik:</b>\n` +
                `├── Total Pesan: ${stats.totalMessages || 0}\n` +
                `├── Masuk: ${stats.totalIncoming || 0}\n` +
                `├── Keluar: ${stats.totalOutgoing || 0}\n` +
                `└── User Unik: ${Object.keys(stats.uniqueUsers || {}).length}\n\n` +
                `⚙️ <b>Status:</b>\n` +
                `├── Auto Reply: ${settings.autoReply ? '✅' : '❌'}\n` +
                `├── Forward: ${settings.forwardToOwner ? '✅' : '❌'}\n` +
                `├── Notifikasi: ${settings.notifyOwner ? '✅' : '❌'}\n` +
                `└── Status: ${settings.isPaused ? '⏸️ PAUSED' : '✅ AKTIF'}\n\n` +
                `🔗 t.me/${bot.botUsername}`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle stats
        if (data.startsWith('limit_stats_')) {
            const st = stats;
            await sendMessage(chatId,
                `📊 <b>STATISTIK</b>\n\n` +
                `🤖 @${bot.botUsername}\n\n` +
                `📨 Total: ${st.totalMessages || 0}\n` +
                `📥 Masuk: ${st.totalIncoming || 0}\n` +
                `📤 Keluar: ${st.totalOutgoing || 0}\n` +
                `👥 User Unik: ${Object.keys(st.uniqueUsers || {}).length}\n` +
                `📅 Hari Ini: ${st.todayMessages || 0}`,
                null,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle auto reply toggle
        if (data.startsWith('limit_autoreply_')) {
            bot.settings.autoReply = !settings.autoReply;
            await saveDB(db);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `✅ Auto Reply: <b>${bot.settings.autoReply ? 'AKTIF' : 'MATI'}</b>\n\n` +
                `Pesan: "${settings.autoReplyText || 'Maaf, owner sedang offline.'}"\n\n` +
                `Edit pesan: /setautoreply ${bot.botId} PESAN`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle forward toggle
        if (data.startsWith('limit_forward_')) {
            bot.settings.forwardToOwner = !settings.forwardToOwner;
            await saveDB(db);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `✅ Forward ke Telegram: <b>${bot.settings.forwardToOwner ? 'AKTIF' : 'MATI'}</b>`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle notify toggle
        if (data.startsWith('limit_notify_')) {
            bot.settings.notifyOwner = !settings.notifyOwner;
            await saveDB(db);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `✅ Notifikasi: <b>${bot.settings.notifyOwner ? 'AKTIF' : 'MATI'}</b>`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle pause toggle
        if (data.startsWith('limit_pause_')) {
            bot.settings.isPaused = !settings.isPaused;
            bot.status = bot.settings.isPaused ? 'paused' : 'active';
            await saveDB(db);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `✅ Bot: <b>${bot.settings.isPaused ? 'DIPAUSE' : 'DIAKTIFKAN'}</b>`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle chat log
        if (data.startsWith('limit_chatlog_')) {
            const log = (bot.chatLog || []).slice(-10).reverse();
            let text = '📋 <b>10 CHAT TERAKHIR</b>\n\n';
            
            if (log.length > 0) {
                for (const l of log) {
                    const dir = l.direction === 'in' ? '📥' : '📤';
                    text += `${dir} ${l.from}: "${(l.text || '').substring(0, 30)}"\n`;
                    text += `   ${new Date(l.timestamp).toLocaleString('id-ID')}\n\n`;
                }
            } else {
                text += 'Belum ada chat.';
            }
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId, text, keyboard, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle reset
        if (data.startsWith('limit_reset_')) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ YA, RESET', callback_data: `limit_confirmreset_${bot.botId}` },
                     { text: '❌ BATAL', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `⚠️ <b>RESET BOT?</b>\n\n` +
                `Semua chat history akan dihapus.\n\n` +
                `Lanjutkan?`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle confirm reset
        if (data.startsWith('limit_confirmreset_')) {
            bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.chatLog = [];
            await saveDB(db);
            
            await sendMessage(chatId, '✅ Bot berhasil direset!', null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle blacklist view
        if (data.startsWith('limit_blacklist_')) {
            const words = (settings.blacklistWords || []).join(', ') || '(kosong)';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `🚫 <b>BLACKLIST KATA</b>\n\n` +
                `Kata diblokir: ${words}\n\n` +
                `Tambah: /addblacklist ${bot.botId} KATA\n` +
                `Hapus: /removeblacklist ${bot.botId} KATA`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle block view
        if (data.startsWith('limit_block_')) {
            const blocked = Object.keys(settings.blockedUsers || {}).join(', ') || '(kosong)';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]
                ]
            };
            
            await sendMessage(chatId,
                `👤 <b>BLOKIR USER</b>\n\n` +
                `User diblokir: ${blocked}\n\n` +
                `Blokir: /block ${bot.botId} USER_ID\n` +
                `Unblock: /unblock ${bot.botId} USER_ID`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle close
        if (data === 'limit_close') {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
                });
            } catch (error) {}
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle reply button (Edukasi Swipe to Reply)
        if (data.startsWith('reply_')) {
            await sendMessage(chatId,
                `💡 <b>Tips:</b> Kamu tidak perlu menekan tombol ini lagi.\n\nCukup <b>Swipe / Reply</b> (Balas) langsung pada pesan dari user, ketik pesanmu, dan kirim. Pesan akan otomatis diteruskan ke user tersebut!`,
                null,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle block user button
        if (data.startsWith('limitblock_')) {
            const blockUserId = data.replace('limitblock_', '');
            if (!settings.blockedUsers) settings.blockedUsers = {};
            settings.blockedUsers[blockUserId] = { blockedAt: new Date().toISOString() };
            await saveDB(db);
            
            await sendMessage(chatId, `✅ User <code>${blockUserId}</code> berhasil diblokir!`, null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        return res.status(200).json({ status: 'OK' });
    }
    
    // ==================== HANDLE MESSAGE ====================
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const fromUser = msg.from;
        const senderId = fromUser.id;
        const senderUsername = fromUser.username || '';
        const senderName = fromUser.first_name || 'Unknown';
        
        const db = await getDB();
        if (!db) {
            return res.status(200).json({ status: 'OK' });
        }
        
        let currentBot = null;
        
        // Deteksi bot mana yang menerima pesan langsung dari URL ?botId=
        if (targetBotId && db.bots[targetBotId]) {
            currentBot = db.bots[targetBotId];
            currentBot.botId = targetBotId;
        }
        
        if (!currentBot) {
            return res.status(200).json({ status: 'OK', message: 'Bot not identified' });
        }
        
        const bot = currentBot;
        const botToken = bot.token;
        const ownerId = bot.ownerId;
        const settings = bot.settings || {};
        const isOwner = (senderId === ownerId);

        // ==========================================
        // 🚀 FITUR DIRECT REPLY + REACTION BATO 🗿
        // (SEKARANG BERJALAN 100% DI DALAM BOT LIMIT)
        // ==========================================
        if (isOwner && msg.reply_to_message && msg.reply_to_message.text) {
            const repliedText = msg.reply_to_message.text;
            
            // Cek apakah pesan yang dibalas adalah forward pesan dari user
            if (repliedText.includes('PESAN BARU') && repliedText.includes('🆔 ID:')) {
                // Ambil target User ID
                const idMatch = repliedText.match(/🆔 ID:\s*(\d+)/);
                
                if (idMatch) {
                    if (!text) {
                        await sendMessage(chatId, '⚠️ Saat ini hanya mendukung balasan berupa teks.', null, botToken);
                        return res.status(200).json({ status: 'OK' });
                    }
                    
                    const targetUserId = idMatch[1];
                    const payload = { 
                        chat_id: targetUserId, 
                        text: `📤 <b>Balasan dari Owner:</b>\n\n${text}`, 
                        parse_mode: 'HTML' 
                    };
                    
                    try {
                        // Kirim balasan menggunakan token Bot Limit itu sendiri
                        const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const sendData = await sendRes.json();
                        
                        if (sendData.ok) {
                            // 🗿 Beri reaction ke pesan owner
                            await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: chatId,
                                    message_id: msg.message_id,
                                    reaction: [{ type: 'emoji', emoji: '🗿' }]
                                })
                            });
                            
                            // Update database stats & history
                            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                            bot.stats.totalMessages++;
                            bot.stats.totalOutgoing++;
                            bot.stats.todayMessages++;
                            
                            if (!bot.chatLog) bot.chatLog = [];
                            bot.chatLog.push({
                                direction: 'out',
                                from: 'Owner',
                                userId: targetUserId,
                                text: text,
                                timestamp: new Date().toISOString()
                            });
                            await saveDB(db);
                        } else {
                            await sendMessage(chatId, `❌ Gagal mengirim balasan ke user.\nAlasan API: ${sendData.description}`, null, botToken);
                        }
                    } catch (error) {}
                    
                    return res.status(200).json({ status: 'OK' });
                }
            }
        }
        
        // Handle /start
        if (text === '/start') {
            let welcomeMsg = settings.welcomeMessage || 
                `🤖 <b>Bot ini dibuat oleh @xnecz</b>\n\n` +
                `📩 Kirim pesan untuk pemilik bot\n` +
                `🔗 Buat bot limit sendiri: @${MAIN_BOT_USERNAME}`;
            
            welcomeMsg = welcomeMsg
                .replace('{name}', senderName)
                .replace('{username}', senderUsername || senderName)
                .replace('{botname}', bot.botName || '');
            
            const buttons = [];
            
            // Custom buttons
            const customButtons = settings.customButtons || [];
            if (customButtons.length > 0) {
                const row = [];
                for (const btn of customButtons) {
                    row.push({ text: btn.text, url: btn.url });
                    if (row.length === 2) {
                        buttons.push([...row]);
                        row.length = 0;
                    }
                }
                if (row.length > 0) buttons.push(row);
            }
            
            // Default button
            buttons.push([{ text: '🔗 Buat Bot Limit Sendiri', url: `https://t.me/${MAIN_BOT_USERNAME}` }]);
            
            const keyboard = buttons.length > 0 ? { inline_keyboard: buttons } : null;
            
            await sendMessage(chatId, welcomeMsg, keyboard, botToken);
            
            // Update stats & notify owner
            if (!isOwner) {
                if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
                
                bot.stats.uniqueUsers[senderId] = {
                    username: senderUsername,
                    firstName: senderName,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    messageCount: 0
                };
                
                await saveDB(db);
                
                // PEMBERITAHUAN USER BARU (Dikirim oleh Bot Limit ke Owner)
                if (settings.notifyOwner) {
                    try {
                        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: ownerId,
                                text: `🔔 <b>NOTIFIKASI USER BARU</b>\n\n` +
                                    `🤖 Bot: @${bot.botUsername}\n` +
                                    `👤 User: @${senderUsername || 'Tanpa Username'}\n` +
                                    `📝 Nama: ${senderName}\n` +
                                    `🔗 ${senderUsername ? 't.me/' + senderUsername : 'ID: ' + senderId}`,
                                parse_mode: 'HTML'
                            })
                        });
                    } catch (error) {}
                }
            }
            
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle /panel for owner
        if (text === '/panel' && isOwner) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🎛️ Buka Control Panel', callback_data: `limit_panel_${bot.botId}` }],
                    [{ text: '📊 Statistik Cepat', callback_data: `limit_stats_${bot.botId}` }],
                    [{ text: '🔙 Ke Bot Utama', url: `https://t.me/${MAIN_BOT_USERNAME}` }]
                ]
            };
            
            await sendMessage(chatId,
                `🎛️ <b>PANEL BOT</b>\n\n` +
                `🤖 @${bot.botUsername}\n` +
                `📨 Pesan: ${bot.stats?.totalMessages || 0}\n` +
                `👥 User Unik: ${Object.keys(bot.stats?.uniqueUsers || {}).length}\n\n` +
                `🔗 t.me/${bot.botUsername}`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle /reply command (Manual reply via ID)
        if (text.startsWith('/reply') && isOwner) {
            const parts = text.replace('/reply', '').trim().split(' ');
            const targetUserId = parts[0];
            const replyText = parts.slice(1).join(' ');
            
            if (!targetUserId || !replyText) {
                await sendMessage(chatId, '❌ Format: /reply USER_ID PESAN\nContoh: /reply 123456 Halo!', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }
            
            await sendMessage(targetUserId, `📤 <b>Balasan dari Owner:</b>\n\n${replyText}`, null, botToken);
            await sendMessage(chatId, `✅ Balasan terkirim ke user ${targetUserId}`, null, botToken);
            
            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.stats.totalMessages++;
            bot.stats.totalOutgoing++;
            bot.stats.todayMessages++;
            
            if (!bot.chatLog) bot.chatLog = [];
            bot.chatLog.push({
                direction: 'out',
                from: 'Owner',
                userId: senderId,
                text: replyText,
                timestamp: new Date().toISOString()
            });
            
            await saveDB(db);
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle incoming message from non-owner (FORWARD KE OWNER)
        if (!isOwner && text && !text.startsWith('/')) {
            if (settings.isPaused) return res.status(200).json({ status: 'OK' });
            if (settings.blockedUsers && settings.blockedUsers[senderId]) return res.status(200).json({ status: 'OK' });
            
            if (containsBlacklistWord(text, settings.blacklistWords)) {
                await sendMessage(chatId, '⚠️ Pesan kamu mengandung kata yang diblokir.', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }
            
            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
            if (!bot.chatLog) bot.chatLog = [];
            
            bot.stats.totalMessages++;
            bot.stats.totalIncoming++;
            bot.stats.todayMessages = (bot.stats.todayMessages || 0) + 1;
            
            if (bot.stats.uniqueUsers[senderId]) {
                bot.stats.uniqueUsers[senderId].lastSeen = new Date().toISOString();
                bot.stats.uniqueUsers[senderId].messageCount = (bot.stats.uniqueUsers[senderId].messageCount || 0) + 1;
            } else {
                bot.stats.uniqueUsers[senderId] = {
                    username: senderUsername,
                    firstName: senderName,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    messageCount: 1
                };
            }
            
            bot.chatLog.push({
                direction: 'in',
                from: senderUsername || senderName,
                userId: senderId,
                text: text,
                timestamp: new Date().toISOString()
            });
            
            if (bot.chatLog.length > 50) bot.chatLog = bot.chatLog.slice(-50);
            await saveDB(db);
            
            // =====================================
            // FORWARD PESAN KE OWNER DENGAN TOKEN BOT LIMIT SENDIRI
            // =====================================
            if (settings.forwardToOwner !== false) {
                const forwardKeyboard = {
                    inline_keyboard: [
                        [{ text: '💬 Balas (Tips)', callback_data: `reply_${senderId}_${bot.botId}` },
                         { text: '🚫 Blokir', callback_data: `limitblock_${senderId}` }]
                    ]
                };
                
                let forwardText = `📩 <b>PESAN BARU</b>\n\n`;
                forwardText += `👤 Dari: @${senderUsername || 'Tanpa Username'}\n`;
                forwardText += `📝 Nama: ${senderName}\n`;
                forwardText += `🆔 ID: <code>${senderId}</code>\n`;
                if (senderUsername) forwardText += `🔗 t.me/${senderUsername}\n`;
                forwardText += `\n💬 <b>Pesan:</b>\n${text}`;
                
                try {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ownerId,
                            text: forwardText,
                            parse_mode: 'HTML',
                            reply_markup: forwardKeyboard
                        })
                    });
                } catch (error) {}
            }
            
            if (settings.autoReply) {
                await sendMessage(chatId, settings.autoReplyText || 'Maaf, owner sedang offline.', null, botToken);
            }
            
            return res.status(200).json({ status: 'OK' });
        }
    }
    
    res.status(200).json({ status: 'OK' });
};
