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
        console.error("DB Fetch Error:", error);
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
        console.error("DB Save Error:", error);
        return false;
    }
}

// ==================== HELPERS ====================
async function sendMessage(chatId, text, replyMarkup = null, botToken) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
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

function containsBlacklistWord(text, blacklistWords) {
    if (!text || !blacklistWords || !blacklistWords.length) return false;
    const lowerText = text.toLowerCase();
    return blacklistWords.some(word => lowerText.includes(word.toLowerCase()));
}

function formatUptime(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const daysMs = ms % (24 * 60 * 60 * 1000);
    const hours = Math.floor(daysMs / (60 * 60 * 1000));
    const hoursMs = ms % (60 * 60 * 1000);
    const minutes = Math.floor(hoursMs / (60 * 1000));
    
    let result = '';
    if (days > 0) result += `${days} Hari, `;
    if (hours > 0 || days > 0) result += `${hours} Jam, `;
    result += `${minutes} Menit`;
    return result;
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    // GET request - health check
    if (req.method !== 'POST') {
        const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
        return res.status(200).json({ 
            status: 'OK', 
            message: 'Bot Limit System Active',
            creator: CREATOR_USERNAME,
            memory_usage_mb: memoryUsage.toFixed(2)
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
        if (!db) return res.status(200).json({ status: 'OK' });
        
        let currentBot = null;
        let botToken = null;
        
        // Deteksi bot
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
        
        // Setup startTime jika belum ada
        if (!currentBot.startTime) {
            currentBot.startTime = Date.now();
            await saveDB(db);
        }
        
        // Answer callback
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
        const uptime = formatUptime(Date.now() - bot.startTime);
        
        // Handle /panel Callback
        if (data === 'limit_panel' || data.startsWith('limit_panel_')) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Statistik', callback_data: `limit_stats_${bot.botId}` }, { text: '📋 Chat Log', callback_data: `limit_chatlog_${bot.botId}` }],
                    [{ text: '⚙️ Auto Reply', callback_data: `limit_autoreply_${bot.botId}` }, { text: '🚫 Blacklist', callback_data: `limit_blacklist_${bot.botId}` }],
                    [{ text: '📤 Forward', callback_data: `limit_forward_${bot.botId}` }, { text: '🔔 Notifikasi', callback_data: `limit_notify_${bot.botId}` }],
                    [{ text: '👤 Blokir User', callback_data: `limit_block_${bot.botId}` }, { text: settings.isPaused ? '▶️ Resume Bot' : '⏸️ Pause Bot', callback_data: `limit_pause_${bot.botId}` }],
                    [{ text: '🗑️ Reset Data', callback_data: `limit_reset_${bot.botId}` }],
                    [{ text: '🔙 Tutup Panel', callback_data: `limit_close` }]
                ]
            };
            
            await sendMessage(chatId,
                `🎛️ <b>CONTROL PANEL (OWNER)</b>\n\n` +
                `🤖 <b>Bot:</b> @${bot.botUsername}\n` +
                `⏱️ <b>Uptime:</b> ${uptime}\n\n` +
                `📊 <b>Statistik:</b>\n` +
                `├── Total Pesan: ${stats.totalMessages || 0}\n` +
                `├── User Unik: ${Object.keys(stats.uniqueUsers || {}).length}\n` +
                `└── Interaksi Hari Ini: ${stats.todayMessages || 0}\n\n` +
                `⚙️ <b>Status Fitur:</b>\n` +
                `├── Auto Reply: ${settings.autoReply ? '✅ Aktif' : '❌ Mati'}\n` +
                `├── Forward Pesan: ${settings.forwardToOwner ? '✅ Aktif' : '❌ Mati'}\n` +
                `├── Notifikasi User: ${settings.notifyOwner ? '✅ Aktif' : '❌ Mati'}\n` +
                `└── Status Bot: ${settings.isPaused ? '⏸️ DIPAUSE' : '✅ BERJALAN'}\n\n` +
                `<i>Gunakan /help untuk melihat daftar perintah.</i>`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle stats
        if (data.startsWith('limit_stats_')) {
            const st = stats;
            await sendMessage(chatId,
                `📊 <b>STATISTIK DETAIL</b>\n\n` +
                `🤖 @${bot.botUsername}\n` +
                `⏱ Uptime: ${uptime}\n\n` +
                `📨 Total Pesan: ${st.totalMessages || 0}\n` +
                `📥 Pesan Masuk: ${st.totalIncoming || 0}\n` +
                `📤 Pesan Keluar: ${st.totalOutgoing || 0}\n` +
                `👥 Jumlah Pengguna: ${Object.keys(st.uniqueUsers || {}).length}\n` +
                `📅 Pesan Hari Ini: ${st.todayMessages || 0}`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle auto reply toggle
        if (data.startsWith('limit_autoreply_')) {
            bot.settings.autoReply = !settings.autoReply;
            await saveDB(db);
            await sendMessage(chatId,
                `✅ Auto Reply: <b>${bot.settings.autoReply ? 'AKTIF' : 'MATI'}</b>\n\n` +
                `Pesan Saat Ini:\n<i>"${settings.autoReplyText || 'Maaf, owner sedang offline.'}"</i>\n\n` +
                `Untuk mengubah pesan, ketik:\n<code>/setautoreply [Pesan Baru]</code>`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle forward, notify, pause toggles (Similar logic)
        const toggles = {
            'limit_forward_': ['forwardToOwner', 'Forward ke Telegram'],
            'limit_notify_': ['notifyOwner', 'Notifikasi User Baru'],
            'limit_pause_': ['isPaused', 'Status Pause']
        };

        for (const [prefix, [settingKey, name]] of Object.entries(toggles)) {
            if (data.startsWith(prefix)) {
                bot.settings[settingKey] = !settings[settingKey];
                if (settingKey === 'isPaused') bot.status = bot.settings.isPaused ? 'paused' : 'active';
                await saveDB(db);
                await sendMessage(chatId, `✅ ${name}: <b>${bot.settings[settingKey] ? 'AKTIF' : 'MATI'}</b>`, 
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] }, botToken);
                return res.status(200).json({ status: 'OK' });
            }
        }
        
        // Handle chat log
        if (data.startsWith('limit_chatlog_')) {
            const log = (bot.chatLog || []).slice(-10).reverse();
            let text = '📋 <b>10 CHAT TERAKHIR</b>\n\n';
            if (log.length > 0) {
                for (const l of log) {
                    const dir = l.direction === 'in' ? '📥' : '📤';
                    text += `${dir} <b>${l.from}</b>: "${(l.text || '').substring(0, 40)}..."\n`;
                    text += `   <tg-spoiler>${new Date(l.timestamp).toLocaleString('id-ID')}</tg-spoiler>\n\n`;
                }
            } else text += 'Belum ada chat.';
            
            await sendMessage(chatId, text, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        // Handle reset
        if (data.startsWith('limit_reset_')) {
            await sendMessage(chatId, `⚠️ <b>PERINGATAN RESET</b>\n\nSemua statistik, riwayat chat, dan user akan dihapus permanen. Lanjutkan?`,
                { inline_keyboard: [[{ text: '✅ YA, RESET', callback_data: `limit_confirmreset_${bot.botId}` }, { text: '❌ BATAL', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data.startsWith('limit_confirmreset_')) {
            bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.chatLog = [];
            bot.startTime = Date.now(); // Reset uptime
            await saveDB(db);
            await sendMessage(chatId, '✅ Bot berhasil direset ke pengaturan awal!', { inline_keyboard: [[{ text: '🔙 Kembali ke Panel', callback_data: `limit_panel_${bot.botId}` }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        // View Blacklist / Blocked
        if (data.startsWith('limit_blacklist_')) {
            const words = (settings.blacklistWords || []).join(', ') || '(kosong)';
            await sendMessage(chatId, `🚫 <b>BLACKLIST KATA</b>\n\nKata diblokir: <b>${words}</b>\n\nCara Tambah:\n<code>/addblacklist KATA</code>\n\nCara Hapus:\n<code>/removeblacklist KATA</code>`, 
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data.startsWith('limit_block_')) {
            const blocked = Object.keys(settings.blockedUsers || {}).join(', ') || '(kosong)';
            await sendMessage(chatId, `👤 <b>USER DIBLOKIR</b>\n\nID Terblokir: <b>${blocked}</b>\n\nCara Blokir:\n<code>/block ID_USER</code>\n\nCara Buka Blokir:\n<code>/unblock ID_USER</code>`, 
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] }, botToken);
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
        
        // Handle action buttons
        if (data.startsWith('reply_')) {
            await sendMessage(chatId, `💡 <b>Tips Owner:</b>\nKamu tidak perlu menekan tombol ini. Cukup <b>Swipe / Reply (Balas)</b> langsung pada chat forward dari user ini, ketik pesan, lalu kirim. Sistem akan meneruskannya otomatis!`, null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data.startsWith('limitblock_')) {
            const blockUserId = data.replace('limitblock_', '');
            if (!settings.blockedUsers) settings.blockedUsers = {};
            settings.blockedUsers[blockUserId] = { blockedAt: new Date().toISOString() };
            await saveDB(db);
            await sendMessage(chatId, `✅ User ID <code>${blockUserId}</code> berhasil diblokir. Mereka tidak bisa mengirim pesan lagi.`, null, botToken);
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
        if (!db) return res.status(200).json({ status: 'OK' });
        
        let currentBot = null;
        if (targetBotId && db.bots[targetBotId]) {
            currentBot = db.bots[targetBotId];
            currentBot.botId = targetBotId;
        }
        
        if (!currentBot) return res.status(200).json({ status: 'OK' });
        
        // Setup startTime init
        if (!currentBot.startTime) {
            currentBot.startTime = Date.now();
            await saveDB(db);
        }

        const bot = currentBot;
        const botToken = bot.token;
        const ownerId = bot.ownerId;
        const settings = bot.settings || {};
        const isOwner = (senderId === ownerId);

        // ==========================================
        // 🚀 FITUR DIRECT REPLY VIA SWIPE 
        // ==========================================
        if (isOwner && msg.reply_to_message && msg.reply_to_message.text) {
            const repliedText = msg.reply_to_message.text;
            if (repliedText.includes('PESAN BARU') && repliedText.includes('🆔 ID:')) {
                const idMatch = repliedText.match(/🆔 ID:\s*(\d+)/);
                if (idMatch) {
                    if (!text) {
                        await sendMessage(chatId, '⚠️ Mohon balas dengan teks.', null, botToken);
                        return res.status(200).json({ status: 'OK' });
                    }
                    
                    const targetUserId = idMatch[1];
                    try {
                        const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: targetUserId, text: `📤 <b>Balasan Owner:</b>\n\n${text}`, parse_mode: 'HTML' })
                        });
                        const sendData = await sendRes.json();
                        
                        if (sendData.ok) {
                            await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ chat_id: chatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '🗿' }] })
                            });
                            
                            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                            bot.stats.totalMessages++;
                            bot.stats.totalOutgoing++;
                            
                            if (!bot.chatLog) bot.chatLog = [];
                            bot.chatLog.push({ direction: 'out', from: 'Owner', userId: targetUserId, text: text, timestamp: new Date().toISOString() });
                            await saveDB(db);
                        } else {
                            await sendMessage(chatId, `❌ Gagal membalas: ${sendData.description}`, null, botToken);
                        }
                    } catch (error) {}
                    return res.status(200).json({ status: 'OK' });
                }
            }
        }
        
        // ==========================================
        // 👑 COMMANDS KHUSUS OWNER
        // ==========================================
        if (isOwner && text.startsWith('/')) {
            const args = text.split(' ');
            const command = args[0].toLowerCase();
            
            // 1. HELP COMMAND
            if (command === '/help') {
                const helpMsg = `🛠️ <b>COMMAND CENTER (KHUSUS OWNER)</b>\n\n` +
                    `Berikut adalah perintah yang bisa Anda gunakan untuk mengelola Bot Limit Anda:\n\n` +
                    `🎛️ <b>General:</b>\n` +
                    `• /panel - Buka Dashboard UI\n` +
                    `• /stats - Lihat statistik bot & uptime\n\n` +
                    `💬 <b>Interaksi:</b>\n` +
                    `• /reply <code>[ID_USER] [PESAN]</code> - Balas chat user manual via ID\n` +
                    `• /broadcast <code>[PESAN]</code> - Kirim pesan masal ke semua user bot Anda\n\n` +
                    `⚙️ <b>Pengaturan:</b>\n` +
                    `• /setautoreply <code>[PESAN]</code> - Ubah teks balasan otomatis\n` +
                    `• /addblacklist <code>[KATA]</code> - Tambah sensor kata\n` +
                    `• /removeblacklist <code>[KATA]</code> - Hapus sensor kata\n\n` +
                    `🛡️ <b>Keamanan:</b>\n` +
                    `• /block <code>[ID_USER]</code> - Blokir pengguna\n` +
                    `• /unblock <code>[ID_USER]</code> - Buka blokir pengguna\n\n` +
                    `<i>💡 Tips: Anda juga bisa membalas chat user dengan cara me-reply (swipe) langsung pesan mereka yang diforward ke Anda.</i>`;
                
                await sendMessage(chatId, helpMsg, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // 2. PANEL COMMAND
            if (command === '/panel') {
                const uptimeStr = formatUptime(Date.now() - bot.startTime);
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🎛️ Buka Control Panel', callback_data: `limit_panel_${bot.botId}` }],
                        [{ text: '🔙 Kelola Bot di Main Bot', url: `https://t.me/${MAIN_BOT_USERNAME}` }]
                    ]
                };
                
                await sendMessage(chatId,
                    `🎛️ <b>PANEL AKSES CEPAT</b>\n\n` +
                    `🤖 Bot: @${bot.botUsername}\n` +
                    `⏱️ Uptime: ${uptimeStr}\n` +
                    `👥 Total User: ${Object.keys(bot.stats?.uniqueUsers || {}).length}`,
                    keyboard,
                    botToken
                );
                return res.status(200).json({ status: 'OK' });
            }

            // 3. STATS COMMAND
            if (command === '/stats') {
                const uptimeStr = formatUptime(Date.now() - bot.startTime);
                await sendMessage(chatId, `📊 <b>Statistik Cepat</b>\n\n⏱️ Uptime: ${uptimeStr}\n📨 Total Chat: ${bot.stats?.totalMessages || 0}\n👥 User: ${Object.keys(bot.stats?.uniqueUsers || {}).length}`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // 4. REPLY COMMAND
            if (command === '/reply') {
                const targetUserId = args[1];
                const replyText = args.slice(2).join(' ');
                if (!targetUserId || !replyText) {
                    await sendMessage(chatId, '❌ Format salah!\nContoh: <code>/reply 12345678 Halo apa kabar?</code>', null, botToken);
                    return res.status(200).json({ status: 'OK' });
                }
                
                await sendMessage(targetUserId, `📤 <b>Balasan Owner:</b>\n\n${replyText}`, null, botToken);
                await sendMessage(chatId, `✅ Pesan terkirim ke <code>${targetUserId}</code>`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // 5. BROADCAST COMMAND
            if (command === '/broadcast') {
                const broadcastText = args.slice(1).join(' ');
                if (!broadcastText) {
                    await sendMessage(chatId, '❌ Format salah!\nContoh: <code>/broadcast Halo semua, bot sedang maintenance!</code>', null, botToken);
                    return res.status(200).json({ status: 'OK' });
                }

                const users = Object.keys(bot.stats?.uniqueUsers || {});
                if (users.length === 0) {
                    await sendMessage(chatId, '⚠️ Belum ada user yang bisa di-broadcast.', null, botToken);
                    return res.status(200).json({ status: 'OK' });
                }

                await sendMessage(chatId, `⏳ Memulai broadcast ke ${users.length} pengguna...`, null, botToken);
                
                let success = 0;
                for (const uid of users) {
                    const sent = await sendMessage(uid, `📢 <b>BROADCAST DARI OWNER</b>\n\n${broadcastText}`, null, botToken);
                    if (sent) success++;
                }

                await sendMessage(chatId, `✅ <b>Broadcast Selesai!</b>\nBerhasil terkirim ke ${success} dari ${users.length} pengguna.`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // 6. SETTINGS COMMANDS (AutoReply, Blacklist, Block)
            if (command === '/setautoreply') {
                bot.settings.autoReplyText = args.slice(1).join(' ');
                await saveDB(db);
                await sendMessage(chatId, `✅ Auto Reply diubah menjadi:\n<i>"${bot.settings.autoReplyText}"</i>`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            if (command === '/addblacklist') {
                if (!args[1]) return res.status(200).json({ status: 'OK' });
                if (!bot.settings.blacklistWords) bot.settings.blacklistWords = [];
                bot.settings.blacklistWords.push(args[1].toLowerCase());
                await saveDB(db);
                await sendMessage(chatId, `✅ Kata <b>${args[1]}</b> ditambahkan ke blacklist.`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            if (command === '/removeblacklist') {
                if (!args[1] || !bot.settings.blacklistWords) return res.status(200).json({ status: 'OK' });
                bot.settings.blacklistWords = bot.settings.blacklistWords.filter(w => w !== args[1].toLowerCase());
                await saveDB(db);
                await sendMessage(chatId, `✅ Kata <b>${args[1]}</b> dihapus dari blacklist.`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            if (command === '/block') {
                if (!args[1]) return res.status(200).json({ status: 'OK' });
                if (!bot.settings.blockedUsers) bot.settings.blockedUsers = {};
                bot.settings.blockedUsers[args[1]] = { blockedAt: new Date().toISOString() };
                await saveDB(db);
                await sendMessage(chatId, `✅ User <code>${args[1]}</code> diblokir.`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            if (command === '/unblock') {
                if (!args[1] || !bot.settings.blockedUsers) return res.status(200).json({ status: 'OK' });
                delete bot.settings.blockedUsers[args[1]];
                await saveDB(db);
                await sendMessage(chatId, `✅ Blokir untuk User <code>${args[1]}</code> dibuka.`, null, botToken);
                return res.status(200).json({ status: 'OK' });
            }
        }
        
        // ==========================================
        // 👤 HANDLE USER COMMANDS (/start)
        // ==========================================
        if (text === '/start') {
            let welcomeMsg = settings.welcomeMessage || 
                `🤖 <b>Halo! Ini adalah Bot Asisten Pribadi.</b>\n\n` +
                `📩 Silahkan kirim pesan Anda, dan akan langsung diteruskan ke pemilik bot.\n\n` +
                `🔗 <i>Powered by Limit Bot Engine</i>`;
            
            welcomeMsg = welcomeMsg
                .replace('{name}', senderName)
                .replace('{username}', senderUsername || senderName)
                .replace('{botname}', bot.botName || '');
            
            const buttons = [];
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
            buttons.push([{ text: '🔗 Buat Bot Limit Sendiri', url: `https://t.me/${MAIN_BOT_USERNAME}` }]);
            
            await sendMessage(chatId, welcomeMsg, { inline_keyboard: buttons }, botToken);
            
            // Registrasi User Baru di Statistik & Notif Owner
            if (!isOwner) {
                if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
                
                if (!bot.stats.uniqueUsers[senderId]) {
                    bot.stats.uniqueUsers[senderId] = {
                        username: senderUsername,
                        firstName: senderName,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        messageCount: 0
                    };
                    await saveDB(db);
                    
                    if (settings.notifyOwner) {
                        try {
                            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: ownerId,
                                    text: `🔔 <b>USER BARU MENGAKSES BOT</b>\n\n` +
                                        `👤 Akun: <a href="tg://user?id=${senderId}">${senderName}</a>\n` +
                                        `🆔 ID: <code>${senderId}</code>\n` +
                                        `🔗 Username: @${senderUsername || '-'}`,
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (error) {}
                    }
                }
            }
            return res.status(200).json({ status: 'OK' });
        }
        
        // ==========================================
        // 📨 FORWARD PESAN DARI USER KE OWNER
        // ==========================================
        if (!isOwner && text && !text.startsWith('/')) {
            if (settings.isPaused) return res.status(200).json({ status: 'OK' });
            if (settings.blockedUsers && settings.blockedUsers[senderId]) return res.status(200).json({ status: 'OK' });
            
            if (containsBlacklistWord(text, settings.blacklistWords)) {
                await sendMessage(chatId, '⚠️ Pesan kamu ditolak karena mengandung kata yang dilarang (Blacklist).', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }
            
            // Catat Statistik
            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            if (!bot.chatLog) bot.chatLog = [];
            bot.stats.totalMessages++;
            bot.stats.totalIncoming++;
            bot.stats.todayMessages = (bot.stats.todayMessages || 0) + 1;
            
            if (bot.stats.uniqueUsers[senderId]) {
                bot.stats.uniqueUsers[senderId].lastSeen = new Date().toISOString();
                bot.stats.uniqueUsers[senderId].messageCount = (bot.stats.uniqueUsers[senderId].messageCount || 0) + 1;
            } else {
                bot.stats.uniqueUsers[senderId] = { username: senderUsername, firstName: senderName, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), messageCount: 1 };
            }
            
            bot.chatLog.push({ direction: 'in', from: senderUsername || senderName, userId: senderId, text: text, timestamp: new Date().toISOString() });
            if (bot.chatLog.length > 50) bot.chatLog = bot.chatLog.slice(-50);
            await saveDB(db);
            
            // Kirim ke Owner
            if (settings.forwardToOwner !== false) {
                const forwardKeyboard = {
                    inline_keyboard: [
                        [{ text: '💬 Balas (Tips)', callback_data: `reply_${senderId}_${bot.botId}` }, { text: '🚫 Blokir User', callback_data: `limitblock_${senderId}` }]
                    ]
                };
                
                let forwardText = `📩 <b>PESAN BARU MASUK</b>\n\n`;
                forwardText += `👤 Dari: <a href="tg://user?id=${senderId}">${senderName}</a>\n`;
                forwardText += `🆔 ID: <code>${senderId}</code>\n`;
                if (senderUsername) forwardText += `🔗 Username: @${senderUsername}\n`;
                forwardText += `\n💬 <b>Pesan:</b>\n<i>${text}</i>`;
                
                try {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: ownerId, text: forwardText, parse_mode: 'HTML', reply_markup: forwardKeyboard })
                    });
                } catch (error) {}
            }
            
            // Auto Reply
            if (settings.autoReply) {
                await sendMessage(chatId, settings.autoReplyText || 'Pesan Anda telah diterima. Mohon tunggu balasan dari owner.', null, botToken);
            }
            
            return res.status(200).json({ status: 'OK' });
        }
    }
    
    res.status(200).json({ status: 'OK' });
};
