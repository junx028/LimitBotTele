const fetch = require('node-fetch');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const CHANNEL_USERNAME = '@LeguminY';
const CHANNEL_ID = '@LeguminY';
const OWNER_ID = process.env.OWNER_ID || '';
const VERCEL_URL = process.env.VERCEL_URL || 'https://limit-bot.vercel.app';
const BOT_START_TIME = Date.now();

// ==================== UPTIME ====================
function getUptime() {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const seconds = Math.floor(uptimeMs / 1000);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}h`);
    if (h > 0) parts.push(`${h}j`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}d`);
    return parts.join(' ') || '0d';
}

// ==================== DATABASE ====================
async function getDB() {
    try {
        const res = await fetch(GIST_API, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const gist = await res.json();
        return JSON.parse(gist.files['database.json'].content);
    } catch (error) { return initDB(); }
}

async function saveDB(db) {
    await fetch(GIST_API, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'database.json': { content: JSON.stringify(db, null, 2) } } })
    });
}

function initDB() {
    return {
        users: {}, bots: {}, stats: { totalUsers: 0, totalBots: 0, totalMessages: 0, totalBroadcasts: 0 },
        bannedUsers: {}, blockedUsers: {}, globalAd: { active: false, text: '', impressions: 0 }, broadcastHistory: []
    };
}

// ==================== HELPERS ====================
async function sendMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return true;
    } catch (error) { return false; }
}

async function editMessageText(chatId, messageId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`${TELEGRAM_API}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return true;
    } catch (error) { return false; }
}

async function answerCallback(queryId, text, alert = false) {
    try {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: queryId, text, show_alert: alert }) });
    } catch (error) {}
}

async function checkChannelMembership(userId) {
    try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: userId }) });
        const data = await res.json();
        return ['creator', 'administrator', 'member'].includes(data.result?.status);
    } catch (error) { return false; }
}

async function verifyBotToken(token) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json();
        return data.ok ? data.result : null;
    } catch (error) { return null; }
}

async function setLimitBotWebhook(token, botId) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${VERCEL_URL}/api/webhook-limit?botId=${botId}`);
        const data = await res.json();
        return data.ok;
    } catch (error) { return false; }
}

// ==================== HANDLERS ====================
async function handleStart(msg) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const chatId = msg.chat.id;
    const db = await getDB();
    const uptime = getUptime();

    if (db.bannedUsers[userId]) return sendMessage(chatId, '🚫 Akun kamu telah diblokir.');

    if (!db.users[userId]) {
        db.users[userId] = { userId, username, firstName: msg.from.first_name || '', joinedAt: new Date().toISOString(), totalBots: 0, lastActive: new Date().toISOString() };
        db.stats.totalUsers++;
        await saveDB(db);
    }

    const isMember = await checkChannelMembership(userId);
    if (!isMember) {
        return sendMessage(chatId,
            `⚠️ <b>AKSES DITOLAK!</b>\n\nKamu <b>wajib join</b> channel:\n📢 <b>${CHANNEL_USERNAME}</b>\n\nKlik <b>Cek Ulang</b> 👇`,
            { inline_keyboard: [[{ text: '📢 JOIN @LeguminY', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }], [{ text: '🔄 Cek Ulang', callback_data: 'check_member' }]] }
        );
    }

    await sendMessage(chatId,
        `🤖 <b>SELAMAT DATANG!</b>\n\nHalo <b>${username}</b>!\n\n` +
        `⏳ <b>Uptime:</b> ${uptime}\n` +
        `👥 <b>Total User:</b> ${db.stats.totalUsers}\n` +
        `🤖 <b>Total Bot:</b> ${db.stats.totalBots}\n\n` +
        `📢 <b>Wajib join:</b> ${CHANNEL_USERNAME}\n👨‍💻 <b>Created by:</b> @xnecz\n\n👇 Pilih menu:`,
        { inline_keyboard: [[{ text: '🤖 Buat Bot Limit', callback_data: 'create_bot' }], [{ text: '📋 Bot Saya', callback_data: 'my_bots' }], [{ text: '📊 Statistik', callback_data: 'user_stats' }], [{ text: 'ℹ️ Tentang', callback_data: 'about' }]] }
    );
}

async function handleCreateBot(msg) {
    await sendMessage(msg.chat.id,
        `🤖 <b>TUTORIAL BIKIN BOT LIMIT</b>\n\n1️⃣ Buka @BotFather\n2️⃣ /newbot\n3️⃣ Kasih nama\n4️⃣ Kasih username\n5️⃣ Simpan TOKEN!\n\n⚠️ Token rahasia!\n\nKirim:\n<code>/register TOKEN_BOT</code>`
    );
}

async function handleRegisterBot(msg, token) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    if (!token) return sendMessage(chatId, '❌ Format: /register TOKEN');

    const botInfo = await verifyBotToken(token);
    if (!botInfo) return sendMessage(chatId, '❌ Token tidak valid!');

    const db = await getDB();
    if (Object.values(db.bots).find(b => b.token === token)) return sendMessage(chatId, '❌ Token sudah terdaftar!');
    if (Object.values(db.bots).filter(b => b.ownerId === userId).length >= 5) return sendMessage(chatId, '❌ Maksimal 5 bot!');

    const botId = 'BOT' + Date.now().toString(36).toUpperCase();
    const webhookSet = await setLimitBotWebhook(token, botId);
    if (!webhookSet) return sendMessage(chatId, '❌ Gagal set webhook!');

    db.bots[botId] = {
        botId, ownerId: userId, token, botUsername: botInfo.username, botName: botInfo.first_name,
        createdAt: new Date().toISOString(), status: 'active',
        stats: { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 },
        settings: { welcomeMessage: `🤖 Bot ini dibuat oleh @xnecz\n\n📩 Kirim pesan untuk pemilik bot\n🔗 Buat bot limit sendiri: @${msg.from.username || 'BotUtama'}`, autoReply: false, autoReplyText: 'Maaf, owner sedang offline.', forwardToOwner: true, notifyOwner: true, isPaused: false, blacklistWords: [], blockedUsers: {}, operatingHours: { enabled: false, start: '00:00', end: '23:59' }, customButtons: [] },
        chatLog: []
    };
    db.users[userId].totalBots++;
    db.stats.totalBots++;
    await saveDB(db);

    await sendMessage(chatId, `✅ <b>BOT BERHASIL DIBUAT!</b>\n\n🤖 @${botInfo.username}\n🆔 ${botId}\n🔗 t.me/${botInfo.username}`, { inline_keyboard: [[{ text: '🎛️ Control Panel', callback_data: `panel_${botId}` }], [{ text: '🔗 Link Bot', url: `https://t.me/${botInfo.username}` }]] });
}

async function handleMyBots(msg) {
    const userId = msg.from.id;
    const db = await getDB();
    const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
    if (!userBots.length) return sendMessage(msg.chat.id, '📋 Belum punya bot.', { inline_keyboard: [[{ text: '🤖 Buat Bot', callback_data: 'create_bot' }]] });

    let text = `📋 <b>BOT KAMU</b> (${userBots.length}/5)\n\n`;
    const buttons = [];
    for (const bot of userBots) {
        text += `${bot.status === 'active' ? '✅' : '⏸️'} @${bot.botUsername} | Pesan: ${bot.stats.totalMessages}\n`;
        buttons.push([{ text: `🎛️ @${bot.botUsername}`, callback_data: `panel_${bot.botId}` }, { text: '🔗', url: `https://t.me/${bot.botUsername}` }]);
    }
    buttons.push([{ text: '➕ Buat Bot Baru', callback_data: 'create_bot' }]);
    await sendMessage(msg.chat.id, text, { inline_keyboard: buttons });
}

async function handleUserPanel(msg, botId) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const db = await getDB();
    const bot = db.bots[botId];
    if (!bot || bot.ownerId !== userId) return sendMessage(chatId, '❌ Bot tidak ditemukan!');

    const s = bot.settings;
    const st = bot.stats;

    await sendMessage(chatId,
        `🎛️ <b>CONTROL PANEL</b>\n\n🤖 @${bot.botUsername}\n🆔 ${botId}\n\n` +
        `📊 Pesan: ${st.totalMessages} | Masuk: ${st.totalIncoming} | Keluar: ${st.totalOutgoing}\n👥 User: ${Object.keys(st.uniqueUsers).length}\n\n` +
        `⚙️ Auto Reply: ${s.autoReply ? '✅' : '❌'} | Forward: ${s.forwardToOwner ? '✅' : '❌'} | Notif: ${s.notifyOwner ? '✅' : '❌'}\n` +
        `⏰ Jam: ${s.operatingHours.enabled ? s.operatingHours.start + '-' + s.operatingHours.end : 'Nonaktif'}\n` +
        `🚫 Blacklist: ${s.blacklistWords.length} kata | 👤 Blokir: ${Object.keys(s.blockedUsers).length}\n` +
        `⏸️ Status: ${s.isPaused ? 'PAUSED' : 'AKTIF'}`,
        { inline_keyboard: [
            [{ text: '✏️ Welcome', callback_data: `setwelcome_${botId}` }, { text: '🤖 Auto Reply', callback_data: `autoreply_${botId}` }],
            [{ text: '🚫 Blacklist', callback_data: `blacklist_${botId}` }, { text: '👤 Blokir', callback_data: `blockuser_${botId}` }],
            [{ text: '📤 Forward', callback_data: `forward_${botId}` }, { text: '🔔 Notif', callback_data: `notify_${botId}` }],
            [{ text: '⏰ Jam Operasional', callback_data: `ophours_${botId}` }],
            [{ text: '🔘 Custom Button', callback_data: `custombtn_${botId}` }],
            [{ text: s.isPaused ? '▶️ Resume' : '⏸️ Pause', callback_data: `pause_${botId}` }],
            [{ text: '📋 Chat Log', callback_data: `chatlog_${botId}` }, { text: '📊 Detail', callback_data: `detailstats_${botId}` }],
            [{ text: '🗑️ Reset', callback_data: `reset_${botId}` }],
            [{ text: '🔙 Kembali', callback_data: 'my_bots' }]
        ]}
    );
}

async function handleOwnerPanel(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    if (userId.toString() !== OWNER_ID) return;

    const db = await getDB();
    const uptime = getUptime();
    const activeBots = Object.values(db.bots).filter(b => b.status === 'active' && !b.settings?.isPaused);

    await sendMessage(chatId,
        `👑 <b>OWNER DASHBOARD</b>\n\n⏳ Uptime: ${uptime}\n\n` +
        `👥 User: ${db.stats.totalUsers} | 🤖 Bot: ${db.stats.totalBots} | ✅ Aktif: ${activeBots.length}\n` +
        `📨 Pesan: ${db.stats.totalMessages} | 📢 Broadcast: ${db.stats.totalBroadcasts}\n` +
        `🚫 Banned: ${Object.keys(db.bannedUsers).length} | 📢 Iklan: ${db.globalAd.active ? 'AKTIF' : 'MATI'}`,
        { inline_keyboard: [
            [{ text: '📢 Broadcast', callback_data: 'owner_broadcast' }, { text: '📊 Stats', callback_data: 'owner_stats' }],
            [{ text: '👥 List User', callback_data: 'owner_users' }, { text: '🤖 List Bot', callback_data: 'owner_bots' }],
            [{ text: '🚫 Ban User', callback_data: 'owner_ban' }, { text: '🔓 Unban', callback_data: 'owner_unban' }],
            [{ text: '💰 Iklan', callback_data: 'owner_ad' }, { text: '🗄️ Backup', callback_data: 'owner_backup' }],
            [{ text: '🔍 Cari User', callback_data: 'owner_search' }, { text: '📋 History', callback_data: 'owner_history' }]
        ]}
    );
}

async function handleBroadcast(msg, target, broadcastMsg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    if (userId.toString() !== OWNER_ID) return;

    const db = await getDB();
    let targetUsers = [];
    if (target === 'all') targetUsers = Object.keys(db.users);
    else if (target === 'bot_owners') targetUsers = [...new Set(Object.values(db.bots).map(b => b.ownerId))];
    else if (target === 'active') targetUsers = Object.keys(db.users).filter(id => Object.values(db.bots).some(b => b.ownerId === parseInt(id)));

    let success = 0, failed = 0;
    for (const uid of targetUsers) {
        try { await sendMessage(uid, broadcastMsg); success++; } catch { failed++; }
    }

    db.stats.totalBroadcasts++;
    db.broadcastHistory.push({ date: new Date().toISOString(), target, message: broadcastMsg, success, failed });
    await saveDB(db);
    await sendMessage(chatId, `📢 <b>BROADCAST SELESAI</b>\n\n🎯 ${target}\n✅ ${success} | ❌ ${failed} | 📊 ${targetUsers.length}`);
}

async function handleBackup(msg) {
    if (msg.from.id.toString() !== OWNER_ID) return;
    const db = await getDB();
    const backup = JSON.stringify(db, null, 2);
    await fetch(`${TELEGRAM_API}/sendDocument`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: msg.chat.id, document: `data:text/json;base64,${Buffer.from(backup).toString('base64')}`, caption: `📅 ${new Date().toISOString()}\n👥 ${db.stats.totalUsers} users\n🤖 ${db.stats.totalBots} bots`, file_name: `backup_${Date.now()}.json` }) });
}

// ==================== CALLBACK HANDLER ====================
async function handleCallback(callback) {
    const userId = callback.from.id;
    const chatId = callback.message.chat.id;
    const data = callback.data;
    const msg = callback.message;
    const messageId = callback.message.message_id;
    msg.from = callback.from;

    await answerCallback(callback.id, '⏳');

    // Check member
    if (data === 'check_member') {
        const isMember = await checkChannelMembership(userId);
        if (isMember) await handleStart({ from: callback.from, chat: { id: chatId } });
        else await sendMessage(chatId, '⚠️ Belum join @LeguminY!');
        return;
    }

    if (data === 'create_bot') { await handleCreateBot(msg); return; }
    if (data === 'my_bots') { await handleMyBots(msg); return; }
    if (data === 'user_stats') {
        const db = await getDB();
        await sendMessage(chatId, `📊 <b>STATISTIK</b>\n\n👥 User: ${db.stats.totalUsers}\n🤖 Bot: ${db.stats.totalBots}\n📨 Pesan: ${db.stats.totalMessages}\n⏳ Uptime: ${getUptime()}`);
        return;
    }
    if (data === 'about') {
        await sendMessage(chatId, `ℹ️ <b>TENTANG</b>\n\n🤖 Bot Limit System\n👨‍💻 @xnecz\n📢 @LeguminY\n⏳ Uptime: ${getUptime()}\n\n/register TOKEN - Daftar bot\n/panel - Control panel\n/start - Menu`);
        return;
    }

    // Panel
    if (data.startsWith('panel_')) { await handleUserPanel(msg, data.replace('panel_', '')); return; }
    if (data === 'owner_panel') { await handleOwnerPanel(msg); return; }

    // Owner stats
    if (data === 'owner_stats') {
        const db = await getDB();
        const active = Object.values(db.bots).filter(b => b.status === 'active');
        await sendMessage(chatId, `📊 <b>STATS</b>\n\n👥 ${db.stats.totalUsers} | 🤖 ${db.stats.totalBots} | ✅ ${active.length}\n📨 ${db.stats.totalMessages} | 📢 ${db.stats.totalBroadcasts}\n🚫 ${Object.keys(db.bannedUsers).length} | ⏳ ${getUptime()}`);
        return;
    }

    if (data === 'owner_bots') {
        const db = await getDB();
        const bots = Object.values(db.bots).slice(0, 20);
        let text = '🤖 <b>LIST BOT</b>\n\n';
        for (const b of bots) text += `@${b.botUsername} | Owner: @${db.users[b.ownerId]?.username || '?'}\n`;
        await sendMessage(chatId, text + `\nTotal: ${db.stats.totalBots}`);
        return;
    }

    if (data === 'owner_backup') { await handleBackup(msg); return; }

    // Owner ad
    if (data === 'owner_ad') {
        const db = await getDB();
        await sendMessage(chatId,
            `💰 <b>IKLAN GLOBAL</b>\n\nStatus: ${db.globalAd.active ? 'AKTIF' : 'MATI'}\nImpresi: ${db.globalAd.impressions}\n\nTeks: "${db.globalAd.text || '(kosong)'}"`,
            { inline_keyboard: [[{ text: db.globalAd.active ? '❌ Matikan' : '✅ Aktifkan', callback_data: 'toggle_ad' }], [{ text: '✏️ Edit Teks', callback_data: 'edit_ad' }], [{ text: '🔙 Kembali', callback_data: 'owner_panel' }]] }
        );
        return;
    }

    if (data === 'toggle_ad') {
        const db = await getDB();
        db.globalAd.active = !db.globalAd.active;
        await saveDB(db);
        await editMessageText(chatId, messageId, `✅ Iklan ${db.globalAd.active ? 'DIAKTIFKAN' : 'DIMATIKAN'}`);
        return;
    }

    if (data === 'edit_ad') {
        await sendMessage(chatId, `✏️ Kirim teks iklan baru:\n<code>/setad TEKS_IKLAN</code>`);
        return;
    }

    if (data === 'owner_history') {
        const db = await getDB();
        const h = db.broadcastHistory.slice(-5).reverse();
        let text = '📋 <b>HISTORY</b>\n\n';
        for (const x of h) text += `📅 ${new Date(x.date).toLocaleDateString()} | ${x.target} | ✅${x.success} ❌${x.failed}\n`;
        await sendMessage(chatId, text || 'Kosong');
        return;
    }

    if (data === 'owner_users') {
        const db = await getDB();
        const users = Object.values(db.users).slice(-10).reverse();
        let text = '👥 <b>LIST USER</b>\n\n';
        for (const u of users) text += `├ @${u.username || '?'} (${u.userId}) | Bot: ${u.totalBots}\n`;
        await sendMessage(chatId, text + `\nTotal: ${db.stats.totalUsers}`);
        return;
    }

    if (data === 'owner_ban') {
        await sendMessage(chatId, `🚫 Kirim User ID yang mau di-ban:\n<code>/ban USER_ID</code>`);
        return;
    }

    if (data === 'owner_unban') {
        const db = await getDB();
        const banned = Object.keys(db.bannedUsers).join(', ') || 'Kosong';
        await sendMessage(chatId, `🔓 Banned: ${banned}\n\nUnban:\n<code>/unban USER_ID</code>`);
        return;
    }

    if (data === 'owner_search') {
        await sendMessage(chatId, `🔍 Kirim User ID:\n<code>/search USER_ID</code>`);
        return;
    }

    // User panel actions
    if (data.startsWith('pause_')) {
        const botId = data.replace('pause_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.settings.isPaused = !bot.settings.isPaused;
            bot.status = bot.settings.isPaused ? 'paused' : 'active';
            await saveDB(db);
            await sendMessage(chatId, `✅ Bot ${bot.settings.isPaused ? 'DIPAUSE' : 'AKTIF'}`);
            await handleUserPanel(msg, botId);
        }
        return;
    }

    if (data.startsWith('forward_')) {
        const botId = data.replace('forward_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.settings.forwardToOwner = !bot.settings.forwardToOwner;
            await saveDB(db);
            await sendMessage(chatId, `✅ Forward ${bot.settings.forwardToOwner ? 'ON' : 'OFF'}`);
            await handleUserPanel(msg, botId);
        }
        return;
    }

    if (data.startsWith('notify_')) {
        const botId = data.replace('notify_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.settings.notifyOwner = !bot.settings.notifyOwner;
            await saveDB(db);
            await sendMessage(chatId, `✅ Notif ${bot.settings.notifyOwner ? 'ON' : 'OFF'}`);
            await handleUserPanel(msg, botId);
        }
        return;
    }

    if (data.startsWith('chatlog_')) {
        const botId = data.replace('chatlog_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const log = bot.chatLog.slice(-10).reverse();
            let text = '📋 <b>CHAT LOG</b>\n\n';
            for (const l of log) text += `${l.direction === 'in' ? '📥' : '📤'} ${l.from}: "${(l.text || '').substring(0, 30)}"\n`;
            await sendMessage(chatId, text || 'Kosong');
        }
        return;
    }

    if (data.startsWith('reset_')) {
        const botId = data.replace('reset_', '');
        await sendMessage(chatId, `⚠️ <b>RESET?</b>\nSemua data bot akan dihapus.`, { inline_keyboard: [[{ text: '✅ YA', callback_data: `confirmreset_${botId}` }, { text: '❌ BATAL', callback_data: `panel_${botId}` }]] });
        return;
    }

    if (data.startsWith('confirmreset_')) {
        const botId = data.replace('confirmreset_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.chatLog = [];
            bot.settings.welcomeMessage = `🤖 Bot ini dibuat oleh @xnecz\n\n📩 Kirim pesan untuk pemilik bot\n🔗 Buat bot limit sendiri: @BotUtama`;
            bot.settings.autoReply = false;
            bot.settings.blacklistWords = [];
            bot.settings.blockedUsers = {};
            bot.settings.customButtons = [];
            bot.settings.operatingHours = { enabled: false, start: '00:00', end: '23:59' };
            await saveDB(db);
            await sendMessage(chatId, '✅ Reset berhasil!');
            await handleUserPanel(msg, botId);
        }
        return;
    }

    if (data.startsWith('autoreply_')) {
        const botId = data.replace('autoreply_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            await sendMessage(chatId,
                `🤖 <b>AUTO REPLY</b>\n\nStatus: ${bot.settings.autoReply ? 'AKTIF' : 'MATI'}\nPesan: "${bot.settings.autoReplyText}"\n\nEdit: /setautoreply ${botId} PESAN`,
                { inline_keyboard: [[{ text: bot.settings.autoReply ? '❌ Matikan' : '✅ Aktifkan', callback_data: `togglear_${botId}` }], [{ text: '✏️ Edit Pesan', callback_data: `editar_${botId}` }], [{ text: '🔙 Kembali', callback_data: `panel_${botId}` }]] }
            );
        }
        return;
    }

    if (data.startsWith('togglear_')) {
        const botId = data.replace('togglear_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.settings.autoReply = !bot.settings.autoReply;
            await saveDB(db);
            await sendMessage(chatId, `✅ Auto Reply ${bot.settings.autoReply ? 'ON' : 'OFF'}`);
        }
        return;
    }

    if (data.startsWith('editar_')) {
        const botId = data.replace('editar_', '');
        await sendMessage(chatId, `✏️ Kirim pesan auto reply baru:\n<code>/setautoreply ${botId} PESAN</code>`);
        return;
    }

    if (data.startsWith('blacklist_')) {
        const botId = data.replace('blacklist_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            await sendMessage(chatId, `🚫 <b>BLACKLIST</b>\n\n${(bot.settings.blacklistWords || []).join(', ') || 'Kosong'}\n\n+ /addblacklist ${botId} KATA\n- /removeblacklist ${botId} KATA`);
        }
        return;
    }

    if (data.startsWith('blockuser_')) {
        const botId = data.replace('blockuser_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            await sendMessage(chatId, `👤 <b>BLOKIR</b>\n\n${Object.keys(bot.settings.blockedUsers || {}).join(', ') || 'Kosong'}\n\n+ /block ${botId} ID\n- /unblock ${botId} ID`);
        }
        return;
    }

    if (data.startsWith('detailstats_')) {
        const botId = data.replace('detailstats_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const st = bot.stats;
            await sendMessage(chatId, `📊 <b>DETAIL</b>\n\n📨 ${st.totalMessages} | 📥 ${st.totalIncoming} | 📤 ${st.totalOutgoing}\n👥 ${Object.keys(st.uniqueUsers).length} | 📅 ${st.todayMessages}`);
        }
        return;
    }

    if (data.startsWith('custombtn_')) {
        const botId = data.replace('custombtn_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const btns = bot.settings.customButtons || [];
            let text = '🔘 <b>CUSTOM BUTTON</b>\n\n';
            for (const b of btns) text += `├ ${b.text} → ${b.url}\n`;
            text += `\n+ /addbutton ${botId} TEKS|URL\n- /clearbuttons ${botId}`;
            await sendMessage(chatId, text || 'Kosong');
        }
        return;
    }

    if (data.startsWith('setwelcome_')) {
        const botId = data.replace('setwelcome_', '');
        await sendMessage(chatId, `✏️ Edit welcome:\n<code>/setwelcome ${botId} PESAN</code>\n\n{name} {username} {botname}`);
        return;
    }

    if (data.startsWith('ophours_')) {
        const botId = data.replace('ophours_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const oh = bot.settings.operatingHours || { enabled: false, start: '00:00', end: '23:59' };
            await sendMessage(chatId,
                `⏰ <b>JAM OPERASIONAL</b>\n\nStatus: ${oh.enabled ? 'AKTIF' : 'NONAKTIF'}\nJam: ${oh.start} - ${oh.end}\n\nAktifkan: /ophours ${botId} on\nMatikan: /ophours ${botId} off\nSet jam: /ophours ${botId} 08:00-22:00`,
                { inline_keyboard: [[{ text: oh.enabled ? '❌ Matikan' : '✅ Aktifkan', callback_data: `toggleoh_${botId}` }], [{ text: '🔙 Kembali', callback_data: `panel_${botId}` }]] }
            );
        }
        return;
    }

    if (data.startsWith('toggleoh_')) {
        const botId = data.replace('toggleoh_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            bot.settings.operatingHours.enabled = !bot.settings.operatingHours.enabled;
            await saveDB(db);
            await sendMessage(chatId, `✅ Jam Operasional ${bot.settings.operatingHours.enabled ? 'AKTIF' : 'NONAKTIF'}`);
        }
        return;
    }
}

// ==================== MAIN ====================
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).json({ status: 'OK', uptime: getUptime() });

    const body = req.body;

    if (body.callback_query) {
        await handleCallback(body.callback_query);
        return res.status(200).json({ status: 'OK' });
    }

    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try { await getDB(); } catch { await saveDB(initDB()); }

        if (text.startsWith('/start')) await handleStart(msg);
        else if (text.startsWith('/register')) await handleRegisterBot(msg, text.replace('/register', '').trim());
        else if (text.startsWith('/panel')) {
            const db = await getDB();
            const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
            if (userBots.length === 1) await handleUserPanel(msg, userBots[0].botId);
            else await handleMyBots(msg);
        }
        else if (text.startsWith('/owner') && userId.toString() === OWNER_ID) await handleOwnerPanel(msg);
        else if (text.startsWith('/broadcast') && userId.toString() === OWNER_ID) {
            const parts = text.replace('/broadcast', '').trim().split('|');
            if (parts[1]) await handleBroadcast(msg, parts[0]?.trim() || 'all', parts[1].trim());
            else await sendMessage(chatId, 'Format: /broadcast target | pesan\nTarget: all, bot_owners, active');
        }
        else if (text.startsWith('/backup') && userId.toString() === OWNER_ID) await handleBackup(msg);
        else if (text.startsWith('/ban') && userId.toString() === OWNER_ID) {
            const id = text.replace('/ban', '').trim();
            if (id) { const db = await getDB(); db.bannedUsers[id] = { bannedAt: new Date().toISOString() }; await saveDB(db); await sendMessage(chatId, `✅ ${id} diban!`); }
        }
        else if (text.startsWith('/unban') && userId.toString() === OWNER_ID) {
            const id = text.replace('/unban', '').trim();
            if (id) { const db = await getDB(); delete db.bannedUsers[id]; await saveDB(db); await sendMessage(chatId, `✅ ${id} diunban!`); }
        }
        else if (text.startsWith('/search') && userId.toString() === OWNER_ID) {
            const id = text.replace('/search', '').trim();
            const db = await getDB();
            const u = db.users[id];
            if (u) await sendMessage(chatId, `🔍 @${u.username} | ID: ${u.userId} | Bot: ${u.totalBots} | Join: ${new Date(u.joinedAt).toLocaleDateString()}`);
            else await sendMessage(chatId, '❌ Tidak ditemukan!');
        }
        else if (text.startsWith('/addblacklist')) {
            const parts = text.replace('/addblacklist', '').trim().split(' ');
            const botId = parts[0]; const word = parts.slice(1).join(' ');
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && word) { bot.settings.blacklistWords.push(word.toLowerCase()); await saveDB(db); await sendMessage(chatId, `✅ "${word}" ditambah!`); }
        }
        else if (text.startsWith('/removeblacklist')) {
            const parts = text.replace('/removeblacklist', '').trim().split(' ');
            const botId = parts[0]; const word = parts.slice(1).join(' ').toLowerCase();
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) { bot.settings.blacklistWords = bot.settings.blacklistWords.filter(w => w !== word); await saveDB(db); await sendMessage(chatId, `✅ "${word}" dihapus!`); }
        }
        else if (text.startsWith('/block')) {
            const parts = text.replace('/block', '').trim().split(' ');
            const botId = parts[0]; const blockId = parts[1];
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && blockId) { bot.settings.blockedUsers[blockId] = { blockedAt: new Date().toISOString() }; await saveDB(db); await sendMessage(chatId, `✅ ${blockId} diblokir!`); }
        }
        else if (text.startsWith('/unblock')) {
            const parts = text.replace('/unblock', '').trim().split(' ');
            const botId = parts[0]; const unblockId = parts[1];
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) { delete bot.settings.blockedUsers[unblockId]; await saveDB(db); await sendMessage(chatId, `✅ ${unblockId} diunblock!`); }
        }
        else if (text.startsWith('/setwelcome')) {
            const parts = text.replace('/setwelcome', '').trim();
            const space = parts.indexOf(' ');
            const botId = parts.substring(0, space);
            const message = parts.substring(space + 1);
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && message) { bot.settings.welcomeMessage = message; await saveDB(db); await sendMessage(chatId, '✅ Welcome diupdate!'); }
        }
        else if (text.startsWith('/setautoreply')) {
            const parts = text.replace('/setautoreply', '').trim();
            const space = parts.indexOf(' ');
            const botId = parts.substring(0, space);
            const message = parts.substring(space + 1);
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && message) { bot.settings.autoReplyText = message; bot.settings.autoReply = true; await saveDB(db); await sendMessage(chatId, '✅ Auto reply diupdate!'); }
        }
        else if (text.startsWith('/addbutton')) {
            const parts = text.replace('/addbutton', '').trim();
            const space = parts.indexOf(' ');
            const botId = parts.substring(0, space);
            const btnData = parts.substring(space + 1).split('|');
            const btnText = btnData[0]?.trim(); const btnUrl = btnData[1]?.trim();
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && btnText && btnUrl) {
                if ((bot.settings.customButtons || []).length >= 3) await sendMessage(chatId, '❌ Maks 3!');
                else { bot.settings.customButtons.push({ text: btnText, url: btnUrl }); await saveDB(db); await sendMessage(chatId, `✅ "${btnText}" ditambah!`); }
            }
        }
        else if (text.startsWith('/clearbuttons')) {
            const botId = text.replace('/clearbuttons', '').trim();
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) { bot.settings.customButtons = []; await saveDB(db); await sendMessage(chatId, '✅ Dihapus!'); }
        }
        else if (text.startsWith('/ophours')) {
            const parts = text.replace('/ophours', '').trim().split(' ');
            const botId = parts[0]; const arg = parts[1];
            const db = await getDB(); const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) {
                if (arg === 'on') { bot.settings.operatingHours.enabled = true; await saveDB(db); await sendMessage(chatId, '✅ Jam operasional AKTIF!'); }
                else if (arg === 'off') { bot.settings.operatingHours.enabled = false; await saveDB(db); await sendMessage(chatId, '❌ Jam operasional MATI!'); }
                else if (arg && arg.includes('-')) {
                    const [start, end] = arg.split('-');
                    bot.settings.operatingHours = { enabled: true, start, end };
                    await saveDB(db); await sendMessage(chatId, `✅ Jam: ${start}-${end}`);
                }
            }
        }
        else if (text.startsWith('/setad') && userId.toString() === OWNER_ID) {
            const adText = text.replace('/setad', '').trim();
            const db = await getDB(); db.globalAd.text = adText; await saveDB(db); await sendMessage(chatId, '✅ Iklan diupdate!');
        }
        else if (text.startsWith('/help')) {
            await sendMessage(chatId, `ℹ️ <b>BANTUAN</b>\n\n/start /register /panel /help\n⏳ Uptime: ${getUptime()}\n📢 @LeguminY | @xnecz`);
        }
    }

    res.status(200).json({ status: 'OK' });
};
