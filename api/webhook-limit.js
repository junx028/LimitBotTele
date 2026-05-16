const fetch = require('node-fetch');

// ==================== CONFIG ====================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const MAIN_BOT_TOKEN = process.env.BOT_TOKEN;
const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || 'LimitsModullarBOT';
const CREATOR_USERNAME = '@xnecz';
const MAIN_BOT_URL = 'https://limit-bot.vercel.app';
const BOT_START_TIME = Date.now();

// ==================== UPTIME ====================
function getUptime() {
    const s = Math.floor((Date.now() - BOT_START_TIME) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}h`);
    if (h > 0) parts.push(`${h}j`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${sec}d`);
    return parts.join(' ') || '0d';
}

// ==================== DATABASE ====================
async function getDB() {
    try {
        const r = await fetch(GIST_API, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        const g = await r.json();
        return JSON.parse(g.files['database.json'].content);
    } catch (e) { return null; }
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
                files: { 'database.json': { content: JSON.stringify(db, null, 2) } }
            })
        });
        return true;
    } catch (e) { return false; }
}

// ==================== HELPERS ====================
async function sendMsg(chatId, text, replyMarkup, botToken) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch (e) { return false; }
}

async function react(chatId, msgId, emoji, botToken) {
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: msgId,
                reaction: [{ type: 'emoji', emoji: emoji }]
            })
        });
        return true;
    } catch (e) { return false; }
}

function hasBlacklist(text, words) {
    if (!text || !words || !words.length) return false;
    return words.some(w => text.toLowerCase().includes(w.toLowerCase()));
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    // GET request - health check
    if (req.method !== 'POST') {
        return res.status(200).json({
            status: 'OK',
            message: 'Bot Limit System Active',
            creator: CREATOR_USERNAME,
            uptime: getUptime()
        });
    }

    const body = req.body;

    // Ambil botId dari URL query parameter (?botId=XXX)
    let targetBotId = req.query?.botId;
    if (!targetBotId && req.url) {
        const match = req.url.match(/botId=([^&]+)/);
        if (match) targetBotId = match[1];
    }

    // ==================== CALLBACK QUERY HANDLER ====================
    if (body.callback_query) {
        const q = body.callback_query;
        const data = q.data;
        const chatId = q.message.chat.id;
        const userId = q.from.id;
        const messageId = q.message.message_id;

        const db = await getDB();
        if (!db) return res.status(200).json({ status: 'OK' });

        // Cari bot
        let bot = null, botToken = null;
        if (targetBotId && db.bots[targetBotId]) {
            bot = db.bots[targetBotId];
            bot.botId = targetBotId;
            botToken = bot.token;
        } else {
            for (const [id, b] of Object.entries(db.bots)) {
                if (data.includes(id) || b.ownerId === userId) {
                    bot = b;
                    bot.botId = id;
                    botToken = b.token;
                    break;
                }
            }
        }

        if (!bot || !botToken) {
            try {
                await fetch(`https://api.telegram.org/bot${MAIN_BOT_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: q.id,
                        text: '⚠️ Bot tidak ditemukan!',
                        show_alert: true
                    })
                });
            } catch (e) {}
            return res.status(200).json({ status: 'OK' });
        }

        // Answer callback
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id })
            });
        } catch (e) {}

        const settings = bot.settings || {};
        const stats = bot.stats || {};

        // ============ CONTROL PANEL ============
        if (data === 'limit_panel' || data.startsWith('limit_panel_')) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Statistik', callback_data: `limit_stats_${bot.botId}` },
                     { text: '🤖 Auto Reply', callback_data: `limit_autoreply_${bot.botId}` }],
                    [{ text: '🚫 Blacklist', callback_data: `limit_blacklist_${bot.botId}` },
                     { text: '👤 Blokir User', callback_data: `limit_block_${bot.botId}` }],
                    [{ text: '📤 Forward', callback_data: `limit_forward_${bot.botId}` },
                     { text: '🔔 Notifikasi', callback_data: `limit_notify_${bot.botId}` }],
                    [{ text: settings.isPaused ? '▶️ Resume' : '⏸️ Pause', callback_data: `limit_pause_${bot.botId}` }],
                    [{ text: '📋 Chat Log', callback_data: `limit_chatlog_${bot.botId}` },
                     { text: '🗑️ Reset Bot', callback_data: `limit_reset_${bot.botId}` }],
                    [{ text: '🔙 Tutup', callback_data: 'limit_close' }]
                ]
            };

            await sendMsg(chatId,
                `🎛️ <b>CONTROL PANEL</b>\n\n` +
                `🤖 Bot: @${bot.botUsername}\n` +
                `🆔 ID: ${bot.botId}\n\n` +
                `📊 <b>Statistik:</b>\n` +
                `├ Total: ${stats.totalMessages || 0}\n` +
                `├ Masuk: ${stats.totalIncoming || 0}\n` +
                `├ Keluar: ${stats.totalOutgoing || 0}\n` +
                `└ User: ${Object.keys(stats.uniqueUsers || {}).length}\n\n` +
                `⚙️ <b>Status:</b>\n` +
                `├ Auto Reply: ${settings.autoReply ? '✅' : '❌'}\n` +
                `├ Forward: ${settings.forwardToOwner ? '✅' : '❌'}\n` +
                `├ Notifikasi: ${settings.notifyOwner ? '✅' : '❌'}\n` +
                `└ Status: ${settings.isPaused ? '⏸️ PAUSED' : '✅ AKTIF'}\n\n` +
                `🔗 t.me/${bot.botUsername}`,
                keyboard,
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ STATS ============
        if (data.startsWith('limit_stats_')) {
            await sendMsg(chatId,
                `📊 <b>STATISTIK</b>\n\n` +
                `🤖 @${bot.botUsername}\n\n` +
                `📨 Total: ${stats.totalMessages || 0}\n` +
                `📥 Masuk: ${stats.totalIncoming || 0}\n` +
                `📤 Keluar: ${stats.totalOutgoing || 0}\n` +
                `👥 User Unik: ${Object.keys(stats.uniqueUsers || {}).length}\n` +
                `📅 Hari Ini: ${stats.todayMessages || 0}`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ TOGGLE HANDLERS ============
        if (data.startsWith('limit_autoreply_')) {
            bot.settings.autoReply = !settings.autoReply;
            await saveDB(db);
            await sendMsg(chatId,
                `✅ Auto Reply: <b>${bot.settings.autoReply ? 'AKTIF' : 'MATI'}</b>\n\n` +
                `Pesan: "${settings.autoReplyText || 'Owner sedang offline.'}"\n\n` +
                `Edit: /setautoreply PESAN`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        if (data.startsWith('limit_forward_')) {
            bot.settings.forwardToOwner = !settings.forwardToOwner;
            await saveDB(db);
            await sendMsg(chatId,
                `✅ Forward: <b>${bot.settings.forwardToOwner ? 'AKTIF' : 'MATI'}</b>`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        if (data.startsWith('limit_notify_')) {
            bot.settings.notifyOwner = !settings.notifyOwner;
            await saveDB(db);
            await sendMsg(chatId,
                `✅ Notifikasi: <b>${bot.settings.notifyOwner ? 'AKTIF' : 'MATI'}</b>`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        if (data.startsWith('limit_pause_')) {
            bot.settings.isPaused = !settings.isPaused;
            bot.status = bot.settings.isPaused ? 'paused' : 'active';
            await saveDB(db);
            await sendMsg(chatId,
                `✅ Bot: <b>${bot.settings.isPaused ? 'DIPAUSE' : 'DIAKTIFKAN'}</b>`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ CHAT LOG ============
        if (data.startsWith('limit_chatlog_')) {
            const log = (bot.chatLog || []).slice(-10).reverse();
            let text = '📋 <b>10 CHAT TERAKHIR</b>\n\n';
            if (log.length > 0) {
                for (const l of log) {
                    text += `${l.direction === 'in' ? '📥' : '📤'} ${l.from}: "${(l.text || '').substring(0, 30)}"\n`;
                }
            } else {
                text += 'Belum ada chat.';
            }
            await sendMsg(chatId, text,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ RESET ============
        if (data.startsWith('limit_reset_')) {
            await sendMsg(chatId,
                '⚠️ <b>RESET BOT?</b>\n\nSemua chat history akan dihapus.',
                {
                    inline_keyboard: [
                        [{ text: '✅ YA, RESET', callback_data: `limit_confirmreset_${bot.botId}` },
                         { text: '❌ BATAL', callback_data: `limit_panel_${bot.botId}` }]
                    ]
                },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        if (data.startsWith('limit_confirmreset_')) {
            bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.chatLog = [];
            await saveDB(db);
            await sendMsg(chatId, '✅ Bot berhasil direset!',
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ BLACKLIST ============
        if (data.startsWith('limit_blacklist_')) {
            const words = (settings.blacklistWords || []).join(', ') || '(kosong)';
            await sendMsg(chatId,
                `🚫 <b>BLACKLIST KATA</b>\n\nKata: ${words}\n\nTambah: /addblacklist KATA\nHapus: /removeblacklist KATA`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ BLOCK USER ============
        if (data.startsWith('limit_block_')) {
            const blocked = Object.keys(settings.blockedUsers || {}).join(', ') || '(kosong)';
            await sendMsg(chatId,
                `👤 <b>BLOKIR USER</b>\n\nUser: ${blocked}\n\nBlokir: /block USER_ID\nUnblock: /unblock USER_ID`,
                { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ CLOSE ============
        if (data === 'limit_close') {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
                });
            } catch (e) {}
            return res.status(200).json({ status: 'OK' });
        }

        // ============ REPLY TIPS ============
        if (data.startsWith('reply_')) {
            await sendMsg(chatId,
                '💡 <b>Tips:</b> Reply/Swipe langsung pada pesan user untuk membalas. Tidak perlu tekan tombol ini.',
                null, botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ BLOCK USER BUTTON ============
        if (data.startsWith('limitblock_')) {
            const uid = data.replace('limitblock_', '');
            if (!settings.blockedUsers) settings.blockedUsers = {};
            settings.blockedUsers[uid] = { blockedAt: new Date().toISOString() };
            await saveDB(db);
            await sendMsg(chatId, `✅ User <code>${uid}</code> diblokir!`, null, botToken);
            return res.status(200).json({ status: 'OK' });
        }

        return res.status(200).json({ status: 'OK' });
    }

    // ==================== MESSAGE HANDLER ====================
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || '';
        const firstName = msg.from.first_name || 'Unknown';

        const db = await getDB();
        if (!db) return res.status(200).json({ status: 'OK' });

        // Cari bot
        let bot = null;
        if (targetBotId && db.bots[targetBotId]) {
            bot = db.bots[targetBotId];
            bot.botId = targetBotId;
        }
        if (!bot) return res.status(200).json({ status: 'OK' });

        const botToken = bot.token;
        const ownerId = bot.ownerId;
        const settings = bot.settings || {};
        const isOwner = (userId === ownerId);

        // ============ 👍 REACTION SEMUA PESAN ============
        await react(chatId, msg.message_id, '👍', botToken);

        // ============ OWNER DIRECT REPLY ============
        if (isOwner && msg.reply_to_message && msg.reply_to_message.text && text) {
            const idMatch = msg.reply_to_message.text.match(/🆔\s*(\d+)/);
            if (idMatch) {
                const targetId = idMatch[1];
                try {
                    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: targetId,
                            text: `📤 <b>Balasan Owner:</b>\n\n${text}`,
                            parse_mode: 'HTML'
                        })
                    });
                    const rd = await r.json();
                    if (rd.ok) {
                        // 🗿 Reaction untuk balasan sukses
                        await react(chatId, msg.message_id, '🗿', botToken);

                        // Update stats
                        if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                        bot.stats.totalMessages++;
                        bot.stats.totalOutgoing++;
                        bot.stats.todayMessages++;

                        if (!bot.chatLog) bot.chatLog = [];
                        bot.chatLog.push({
                            direction: 'out',
                            from: 'Owner',
                            userId: targetId,
                            text: text,
                            timestamp: new Date().toISOString()
                        });
                        await saveDB(db);
                    } else {
                        await sendMsg(chatId, `❌ Gagal: ${rd.description}`, null, botToken);
                    }
                } catch (e) {}
                return res.status(200).json({ status: 'OK' });
            }
        }

        // ============ /start ============
        if (text === '/start') {
            if (isOwner) {
                // TAMPILAN OWNER
                const ownerUsername = db.users?.[ownerId]?.username || username || 'Owner';
                await sendMsg(chatId,
                    `🤖 <b>BOT LIMIT KAMU</b>\n\n` +
                    `👑 Owner: @${ownerUsername}\n` +
                    `🤖 Bot: @${bot.botUsername}\n` +
                    `⏳ Uptime: ${getUptime()}\n` +
                    `👥 User: ${Object.keys(bot.stats?.uniqueUsers || {}).length}\n` +
                    `📨 Pesan: ${bot.stats?.totalMessages || 0}\n\n` +
                    `📋 <b>FULL COMMAND LIST:</b>\n` +
                    `/panel — Control panel bot\n` +
                    `/start — Menu ini\n` +
                    `/reply ID PESAN — Balas user via ID\n` +
                    `/addblacklist KATA — Filter kata kasar\n` +
                    `/removeblacklist KATA — Hapus filter\n` +
                    `/block USER_ID — Blokir user\n` +
                    `/unblock USER_ID — Buka blokir\n` +
                    `/setwelcome PESAN — Edit welcome message\n` +
                    `/setautoreply PESAN — Set auto reply\n` +
                    `/addbutton TEKS|URL — Tambah tombol\n` +
                    `/clearbuttons — Hapus semua tombol\n` +
                    `/ophours on/off/JAM — Atur jam operasional\n\n` +
                    `💡 <b>Tips:</b> Reply langsung pesan user untuk membalas!`,
                    {
                        inline_keyboard: [
                            [{ text: '🎛️ Control Panel', callback_data: `limit_panel_${bot.botId}` }],
                            [{ text: '📊 Statistik', callback_data: `limit_stats_${bot.botId}` }],
                            [{ text: '🔙 Ke Bot Utama', url: `https://t.me/${MAIN_BOT_USERNAME}` }]
                        ]
                    },
                    botToken
                );
            } else {
                // TAMPILAN USER BIASA
                const ownerUser = db.users?.[ownerId];
                const ownerUsername = ownerUser?.username || 'pemilik';
                const ownerName = ownerUser?.firstName || 'Pemilik Bot';

                let welcome = settings.welcomeMessage ||
                    `🤖 <b>Bot ini dibuat oleh @xnecz</b>\n\n` +
                    `📩 Kirim pesan untuk <a href="tg://user?id=${ownerId}">${ownerName}</a> (@${ownerUsername})\n` +
                    `🔗 Buat bot limit sendiri di bawah`;

                welcome = welcome
                    .replace('{name}', firstName)
                    .replace('{username}', username || firstName)
                    .replace('{botname}', bot.botName || '')
                    .replace('{owner}', `@${ownerUsername}`)
                    .replace('{ownerid}', ownerId);

                const buttons = [];
                const customButtons = settings.customButtons || [];
                for (const btn of customButtons) {
                    buttons.push([{ text: btn.text, url: btn.url }]);
                }
                buttons.push([{ text: '🔗 Buat Bot Limit Sendiri', url: MAIN_BOT_URL }]);

                await sendMsg(chatId, welcome,
                    buttons.length > 0 ? { inline_keyboard: buttons } : null,
                    botToken
                );

                // Update stats
                if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
                bot.stats.uniqueUsers[userId] = {
                    username, firstName,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    messageCount: 0
                };
                await saveDB(db);

                // Notifikasi ke owner
                if (settings.notifyOwner) {
                    try {
                        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: ownerId,
                                text: `🔔 <b>User Baru!</b>\n\n📩 Dari: @${username || 'Tanpa'}\n📝 Nama: ${firstName}\n🆔 ${userId}`,
                                parse_mode: 'HTML'
                            })
                        });
                    } catch (e) {}
                }
            }
            return res.status(200).json({ status: 'OK' });
        }

        // ============ /panel (owner) ============
        if (text === '/panel' && isOwner) {
            await sendMsg(chatId,
                `🎛️ <b>PANEL BOT</b>\n\n` +
                `🤖 @${bot.botUsername}\n` +
                `📨 Pesan: ${bot.stats?.totalMessages || 0}\n` +
                `👥 User: ${Object.keys(bot.stats?.uniqueUsers || {}).length}\n` +
                `⏳ Uptime: ${getUptime()}`,
                { inline_keyboard: [[{ text: '🎛️ Buka Control Panel', callback_data: `limit_panel_${bot.botId}` }]] },
                botToken
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ============ OWNER COMMANDS ============
        if (isOwner) {
            // /reply
            if (text.startsWith('/reply')) {
                const parts = text.replace('/reply', '').trim().split(' ');
                const targetId = parts[0];
                const replyText = parts.slice(1).join(' ');
                if (targetId && replyText) {
                    await sendMsg(targetId, `📤 <b>Balasan Owner:</b>\n\n${replyText}`, null, botToken);
                    await sendMsg(chatId, '✅ Terkirim!', null, botToken);
                    if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                    bot.stats.totalMessages++;
                    bot.stats.totalOutgoing++;
                    bot.stats.todayMessages++;
                    if (!bot.chatLog) bot.chatLog = [];
                    bot.chatLog.push({ direction: 'out', from: 'Owner', userId: targetId, text: replyText, timestamp: new Date().toISOString() });
                    await saveDB(db);
                } else {
                    await sendMsg(chatId, '❌ Format: /reply ID PESAN\nContoh: /reply 123456 Halo!', null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /addblacklist
            if (text.startsWith('/addblacklist')) {
                const word = text.replace('/addblacklist', '').trim();
                if (word) {
                    if (!settings.blacklistWords) settings.blacklistWords = [];
                    settings.blacklistWords.push(word.toLowerCase());
                    await saveDB(db);
                    await sendMsg(chatId, `✅ "${word}" ditambahkan ke blacklist!`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /removeblacklist
            if (text.startsWith('/removeblacklist')) {
                const word = text.replace('/removeblacklist', '').trim().toLowerCase();
                if (word && settings.blacklistWords) {
                    settings.blacklistWords = settings.blacklistWords.filter(w => w !== word);
                    await saveDB(db);
                    await sendMsg(chatId, `✅ "${word}" dihapus dari blacklist!`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /block
            if (text.startsWith('/block')) {
                const id = text.replace('/block', '').trim();
                if (id) {
                    if (!settings.blockedUsers) settings.blockedUsers = {};
                    settings.blockedUsers[id] = { blockedAt: new Date().toISOString() };
                    await saveDB(db);
                    await sendMsg(chatId, `✅ User ${id} diblokir!`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /unblock
            if (text.startsWith('/unblock')) {
                const id = text.replace('/unblock', '').trim();
                if (id && settings.blockedUsers) {
                    delete settings.blockedUsers[id];
                    await saveDB(db);
                    await sendMsg(chatId, `✅ User ${id} diunblock!`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /setwelcome
            if (text.startsWith('/setwelcome')) {
                const welcome = text.replace('/setwelcome', '').trim();
                if (welcome) {
                    settings.welcomeMessage = welcome;
                    await saveDB(db);
                    await sendMsg(chatId, '✅ Welcome message diupdate!', null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /setautoreply
            if (text.startsWith('/setautoreply')) {
                const reply = text.replace('/setautoreply', '').trim();
                if (reply) {
                    settings.autoReplyText = reply;
                    settings.autoReply = true;
                    await saveDB(db);
                    await sendMsg(chatId, `✅ Auto reply diupdate: "${reply}"`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /addbutton
            if (text.startsWith('/addbutton')) {
                const parts = text.replace('/addbutton', '').trim().split('|');
                const btnText = parts[0]?.trim();
                const btnUrl = parts[1]?.trim();
                if (btnText && btnUrl) {
                    if (!settings.customButtons) settings.customButtons = [];
                    if (settings.customButtons.length >= 3) {
                        await sendMsg(chatId, '❌ Maksimal 3 button!', null, botToken);
                    } else {
                        settings.customButtons.push({ text: btnText, url: btnUrl });
                        await saveDB(db);
                        await sendMsg(chatId, `✅ Button "${btnText}" ditambahkan!`, null, botToken);
                    }
                }
                return res.status(200).json({ status: 'OK' });
            }

            // /clearbuttons
            if (text.startsWith('/clearbuttons')) {
                settings.customButtons = [];
                await saveDB(db);
                await sendMsg(chatId, '✅ Semua button dihapus!', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // /ophours
            if (text.startsWith('/ophours')) {
                const parts = text.replace('/ophours', '').trim().split(' ');
                const arg = parts[0];
                if (arg === 'on') {
                    settings.operatingHours = { enabled: true, start: settings.operatingHours?.start || '00:00', end: settings.operatingHours?.end || '23:59' };
                    await saveDB(db);
                    await sendMsg(chatId, '✅ Jam operasional AKTIF!', null, botToken);
                } else if (arg === 'off') {
                    if (!settings.operatingHours) settings.operatingHours = {};
                    settings.operatingHours.enabled = false;
                    await saveDB(db);
                    await sendMsg(chatId, '❌ Jam operasional MATI!', null, botToken);
                } else if (arg && arg.includes('-')) {
                    const [start, end] = arg.split('-');
                    settings.operatingHours = { enabled: true, start, end };
                    await saveDB(db);
                    await sendMsg(chatId, `✅ Jam operasional: ${start}-${end}`, null, botToken);
                }
                return res.status(200).json({ status: 'OK' });
            }
        }

        // ============ PESAN DARI USER BIASA ============
        if (!isOwner && text && !text.startsWith('/')) {
            // Cek pause
            if (settings.isPaused) return res.status(200).json({ status: 'OK' });

            // Cek blokir
            if (settings.blockedUsers?.[userId]) return res.status(200).json({ status: 'OK' });

            // Cek blacklist
            if (hasBlacklist(text, settings.blacklistWords)) {
                await sendMsg(chatId, '⚠️ Pesan kamu mengandung kata yang diblokir.', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }

            // Init stats
            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
            if (!bot.chatLog) bot.chatLog = [];

            // Update stats
            bot.stats.totalMessages++;
            bot.stats.totalIncoming++;
            bot.stats.todayMessages++;

            if (bot.stats.uniqueUsers[userId]) {
                bot.stats.uniqueUsers[userId].lastSeen = new Date().toISOString();
                bot.stats.uniqueUsers[userId].messageCount++;
            } else {
                bot.stats.uniqueUsers[userId] = {
                    username, firstName,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    messageCount: 1
                };
            }

            // Chat log
            bot.chatLog.push({
                direction: 'in',
                from: username || firstName,
                userId,
                text,
                timestamp: new Date().toISOString()
            });
            if (bot.chatLog.length > 50) bot.chatLog = bot.chatLog.slice(-50);

            await saveDB(db);

            // Forward pesan ke owner (SIMPLE)
            if (settings.forwardToOwner !== false) {
                try {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ownerId,
                            text: `📩 <b>Pesan dari</b> @${username || 'Tanpa'}:\n\n${text}\n\n🆔 ${userId}`,
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '💬 Balas', callback_data: `reply_${userId}` },
                                    { text: '🚫 Blokir', callback_data: `limitblock_${userId}` }
                                ]]
                            }
                        })
                    });
                } catch (e) {}
            }

            // Auto reply
            if (settings.autoReply) {
                await sendMsg(chatId, settings.autoReplyText || 'Maaf, owner sedang offline.', null, botToken);
            }

            return res.status(200).json({ status: 'OK' });
        }
    }

    res.status(200).json({ status: 'OK' });
};
