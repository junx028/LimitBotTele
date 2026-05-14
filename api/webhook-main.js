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
const VERCEL_URL = 'https://limit-bot.vercel.app';

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
    } catch (e) {
        return initDB();
    }
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

function initDB() {
    return {
        users: {},
        bots: {},
        stats: {
            totalUsers: 0,
            totalBots: 0,
            totalMessages: 0,
            totalBroadcasts: 0
        },
        bannedUsers: {},
        blockedUsers: {},
        globalAd: {
            active: false,
            text: '',
            impressions: 0
        },
        broadcastHistory: []
    };
}

// ==================== HELPERS ====================
async function sendMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
        
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch (e) {
        return false;
    }
}

async function checkChannelMembership(userId) {
    try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: userId })
        });
        const data = await res.json();
        return ['creator', 'administrator', 'member'].includes(data.result?.status);
    } catch {
        return false;
    }
}

async function verifyBotToken(token) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json();
        return data.ok ? data.result : null;
    } catch {
        return null;
    }
}

async function setLimitBotWebhook(token) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${VERCEL_URL}/api/webhook-limit`);
        const data = await res.json();
        return data.ok;
    } catch (e) {
        return false;
    }
}

function generateUserId() {
    return 'USR' + Date.now().toString(36).toUpperCase();
}

// ==================== HANDLERS ====================

// START COMMAND
async function handleStart(msg) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const chatId = msg.chat.id;
    
    const db = await getDB();
    
    // Check banned
    if (db.bannedUsers[userId]) {
        return sendMessage(chatId, '🚫 Maaf, akun kamu telah diblokir dari sistem.');
    }
    
    // Register user
    if (!db.users[userId]) {
        db.users[userId] = {
            userId: userId,
            username: username,
            firstName: msg.from.first_name || '',
            joinedAt: new Date().toISOString(),
            totalBots: 0,
            lastActive: new Date().toISOString()
        };
        db.stats.totalUsers++;
        await saveDB(db);
    }
    
    // Check channel membership
    const isMember = await checkChannelMembership(userId);
    
    if (!isMember) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '📢 JOIN @LeguminY', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                [{ text: '🔄 Cek Ulang', callback_data: 'check_member' }]
            ]
        };
        return sendMessage(chatId,
            `⚠️ <b>AKSES DITOLAK!</b>\n\n` +
            `Kamu <b>wajib join</b> channel kami dulu:\n` +
            `📢 <b>${CHANNEL_USERNAME}</b>\n\n` +
            `Setelah join, klik <b>Cek Ulang</b> 👇`,
            keyboard
        );
    }
    
    // Main menu
    const keyboard = {
        inline_keyboard: [
            [{ text: '🤖 Buat Bot Limit', callback_data: 'create_bot' }],
            [{ text: '📋 Bot Saya', callback_data: 'my_bots' }],
            [{ text: '📊 Statistik', callback_data: 'user_stats' }],
            [{ text: 'ℹ️ Tentang', callback_data: 'about' }]
        ]
    };
    
    await sendMessage(chatId,
        `🤖 <b>SELAMAT DATANG!</b>\n\n` +
        `Halo <b>${username}</b>!\n\n` +
        `🔹 <b>Bot Limit System</b> — Bikin bot Telegram kamu sendiri!\n` +
        `🔹 Orang bisa chat kamu lewat bot itu\n` +
        `🔹 Kamu bisa bales langsung\n` +
        `🔹 Control panel lengkap\n\n` +
        `📢 <b>Wajib join:</b> ${CHANNEL_USERNAME}\n` +
        `👨‍💻 <b>Created by:</b> @xnecz\n\n` +
        `👇 Pilih menu di bawah:`,
        keyboard
    );
}

// CREATE BOT
async function handleCreateBot(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    await sendMessage(chatId,
        `🤖 <b>TUTORIAL BIKIN BOT LIMIT</b>\n\n` +
        `1️⃣ Buka @BotFather di Telegram\n` +
        `2️⃣ Kirim: /newbot\n` +
        `3️⃣ Kasih nama bot (contoh: Bot Limit Budi)\n` +
        `4️⃣ Kasih username (contoh: budilimit_bot)\n` +
        `5️⃣ Simpan TOKEN yang diberikan!\n\n` +
        `⚠️ <b>TOKEN ADALAH RAHASIA!</b>\n` +
        `Jangan share ke siapapun!\n\n` +
        `Setelah dapat token, kirim ke sini:\n\n` +
        `<code>/register TOKEN_BOT_KAMU</code>\n\n` +
        `Contoh:\n` +
        `<code>/register 123456:ABCdefGHIjklMNO</code>`
    );
}

// REGISTER BOT
async function handleRegisterBot(msg, token) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (!token) {
        return sendMessage(chatId, '❌ Format salah!\nContoh: /register 123456:ABCdef...');
    }
    
    await sendMessage(chatId, '⏳ Memverifikasi token...');
    
    // Verify token
    const botInfo = await verifyBotToken(token);
    if (!botInfo) {
        return sendMessage(chatId, '❌ Token tidak valid! Pastikan token dari @BotFather.');
    }
    
    const db = await getDB();
    
    // Check if token already registered
    const existingBot = Object.values(db.bots).find(b => b.token === token);
    if (existingBot) {
        return sendMessage(chatId, '❌ Token ini sudah terdaftar di sistem!');
    }
    
    // Check user bot limit (max 5)
    const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
    if (userBots.length >= 5) {
        return sendMessage(chatId, '❌ Kamu sudah mencapai limit 5 bot!');
    }
    
    // Set webhook for limit bot
    const webhookSet = await setLimitBotWebhook(token);
    if (!webhookSet) {
        return sendMessage(chatId, '❌ Gagal mengatur webhook! Coba lagi nanti.');
    }
    
    // Save to database
    const botId = 'BOT' + Date.now().toString(36).toUpperCase();
    db.bots[botId] = {
        botId: botId,
        ownerId: userId,
        token: token,
        botUsername: botInfo.username,
        botName: botInfo.first_name,
        createdAt: new Date().toISOString(),
        status: 'active',
        stats: {
            totalMessages: 0,
            totalIncoming: 0,
            totalOutgoing: 0,
            uniqueUsers: {},
            todayMessages: 0
        },
        settings: {
            welcomeMessage: `🤖 Bot ini dibuat oleh @xnecz\n\n📩 Kirim pesan untuk pemilik bot\n🔗 Buat bot limit sendiri: @${msg.from.username || 'BotUtama'}`,
            autoReply: false,
            autoReplyText: 'Maaf, owner sedang offline.',
            forwardToOwner: true,
            notifyOwner: true,
            isPaused: false,
            blacklistWords: [],
            blockedUsers: {},
            operatingHours: { enabled: false, start: '00:00', end: '23:59' },
            customButtons: []
        },
        chatLog: []
    };
    
    db.users[userId].totalBots++;
    db.stats.totalBots++;
    
    await saveDB(db);
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎛️ Control Panel', callback_data: `panel_${botId}` }],
            [{ text: '🔗 Link Bot', url: `https://t.me/${botInfo.username}` }]
        ]
    };
    
    await sendMessage(chatId,
        `✅ <b>BOT BERHASIL DIBUAT!</b>\n\n` +
        `🤖 Nama: @${botInfo.username}\n` +
        `🆔 ID: ${botId}\n\n` +
        `🔗 Link: t.me/${botInfo.username}\n\n` +
        `📌 <b>Share link bot ini ke siapa aja!</b>\n` +
        `Orang lain bisa chat kamu lewat bot itu.\n\n` +
        `🎛️ Akses <b>Control Panel</b> di bawah 👇`,
        keyboard
    );
}

// MY BOTS
async function handleMyBots(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const db = await getDB();
    const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
    
    if (userBots.length === 0) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '🤖 Buat Bot Sekarang', callback_data: 'create_bot' }]
            ]
        };
        return sendMessage(chatId,
            '📋 Kamu belum punya bot.\nBikin sekarang yuk! 👇',
            keyboard
        );
    }
    
    let text = `📋 <b>BOT KAMU</b> (${userBots.length}/5)\n\n`;
    const buttons = [];
    
    for (const bot of userBots) {
        const statusEmoji = bot.status === 'active' ? '✅' : '⏸️';
        text += `${statusEmoji} @${bot.botUsername}\n`;
        text += `   ├── ID: ${bot.botId}\n`;
        text += `   ├── Pesan: ${bot.stats.totalMessages}\n`;
        text += `   └── Status: ${bot.settings.isPaused ? 'Paused' : 'Active'}\n\n`;
        
        buttons.push([
            { text: `🎛️ @${bot.botUsername}`, callback_data: `panel_${bot.botId}` },
            { text: '🔗', url: `https://t.me/${bot.botUsername}` }
        ]);
    }
    
    buttons.push([{ text: '➕ Buat Bot Baru', callback_data: 'create_bot' }]);
    
    await sendMessage(chatId, text, { inline_keyboard: buttons });
}

// CONTROL PANEL USER
async function handleUserPanel(msg, botId) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const db = await getDB();
    const bot = db.bots[botId];
    
    if (!bot || bot.ownerId !== userId) {
        return sendMessage(chatId, '❌ Bot tidak ditemukan!');
    }
    
    const s = bot.settings;
    const st = bot.stats;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✏️ Edit Welcome', callback_data: `setwelcome_${botId}` },
             { text: '🤖 Auto Reply', callback_data: `autoreply_${botId}` }],
            [{ text: '🚫 Blacklist', callback_data: `blacklist_${botId}` },
             { text: '👤 Blokir User', callback_data: `blockuser_${botId}` }],
            [{ text: '📤 Forward', callback_data: `forward_${botId}` },
             { text: '🔔 Notifikasi', callback_data: `notify_${botId}` }],
            [{ text: '⏰ Jam Operasional', callback_data: `ophours_${botId}` }],
            [{ text: '🔘 Custom Button', callback_data: `custombtn_${botId}` }],
            [{ text: s.isPaused ? '▶️ Resume Bot' : '⏸️ Pause Bot', callback_data: `pause_${botId}` }],
            [{ text: '📋 Chat Log', callback_data: `chatlog_${botId}` },
             { text: '📊 Detail Stats', callback_data: `detailstats_${botId}` }],
            [{ text: '🗑️ Reset Bot', callback_data: `reset_${botId}` }],
            [{ text: '🔙 Kembali', callback_data: 'my_bots' }]
        ]
    };
    
    await sendMessage(chatId,
        `🎛️ <b>CONTROL PANEL</b>\n\n` +
        `🤖 Bot: @${bot.botUsername}\n` +
        `🆔 ID: ${botId}\n\n` +
        `📊 <b>Statistik:</b>\n` +
        `├── Total pesan: ${st.totalMessages}\n` +
        `├── Masuk: ${st.totalIncoming}\n` +
        `├── Keluar: ${st.totalOutgoing}\n` +
        `└── User unik: ${Object.keys(st.uniqueUsers).length}\n\n` +
        `⚙️ <b>Status:</b>\n` +
        `├── Auto Reply: ${s.autoReply ? '✅' : '❌'}\n` +
        `├── Forward: ${s.forwardToOwner ? '✅' : '❌'}\n` +
        `├── Notifikasi: ${s.notifyOwner ? '✅' : '❌'}\n` +
        `├── Blacklist kata: ${s.blacklistWords.length}\n` +
        `├── User diblokir: ${Object.keys(s.blockedUsers).length}\n` +
        `└── Status: ${s.isPaused ? '⏸️ PAUSED' : '✅ AKTIF'}\n\n` +
        `🔗 t.me/${bot.botUsername}`,
        keyboard
    );
}

// OWNER PANEL
async function handleOwnerPanel(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (userId.toString() !== OWNER_ID) return;
    
    const db = await getDB();
    const activeBots = Object.values(db.bots).filter(b => b.status === 'active' && !b.settings.isPaused);
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '📢 Broadcast', callback_data: 'owner_broadcast' },
             { text: '📊 Global Stats', callback_data: 'owner_stats' }],
            [{ text: '👥 List User', callback_data: 'owner_users' },
             { text: '🤖 List Bot', callback_data: 'owner_bots' }],
            [{ text: '🚫 Ban User', callback_data: 'owner_ban' },
             { text: '🔓 Unban User', callback_data: 'owner_unban' }],
            [{ text: '💰 Iklan Global', callback_data: 'owner_ad' },
             { text: '🗄️ Backup DB', callback_data: 'owner_backup' }],
            [{ text: '🔍 Cari User', callback_data: 'owner_search' },
             { text: '📋 Broadcast History', callback_data: 'owner_history' }]
        ]
    };
    
    await sendMessage(chatId,
        `👑 <b>OWNER DASHBOARD</b>\n\n` +
        `📊 <b>GLOBAL STATS:</b>\n` +
        `├── Total User: ${db.stats.totalUsers}\n` +
        `├── Total Bot: ${db.stats.totalBots}\n` +
        `├── Bot Aktif: ${activeBots.length}\n` +
        `├── Total Pesan: ${db.stats.totalMessages}\n` +
        `├── Broadcast: ${db.stats.totalBroadcasts}\n` +
        `└── User Banned: ${Object.keys(db.bannedUsers).length}\n\n` +
        `📢 Iklan: ${db.globalAd.active ? '✅ AKTIF' : '❌ MATI'}\n` +
        `🖼️ Impresi: ${db.globalAd.impressions}`,
        keyboard
    );
}

// BROADCAST
async function handleBroadcast(msg, target, broadcastMsg, broadcastPhoto) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (userId.toString() !== OWNER_ID) return;
    
    const db = await getDB();
    let targetUsers = [];
    
    switch(target) {
        case 'all':
            targetUsers = Object.keys(db.users);
            break;
        case 'bot_owners':
            targetUsers = [...new Set(Object.values(db.bots).map(b => b.ownerId))];
            break;
        case 'active':
            targetUsers = Object.keys(db.users).filter(id => {
                const userBots = Object.values(db.bots).filter(b => b.ownerId === parseInt(id));
                return userBots.length > 0;
            });
            break;
    }
    
    let success = 0;
    let failed = 0;
    
    for (const uid of targetUsers) {
        try {
            if (broadcastPhoto) {
                await fetch(`${TELEGRAM_API}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: uid,
                        photo: broadcastPhoto,
                        caption: broadcastMsg,
                        parse_mode: 'HTML'
                    })
                });
            } else {
                await sendMessage(uid, broadcastMsg);
            }
            success++;
        } catch {
            failed++;
        }
    }
    
    db.stats.totalBroadcasts++;
    db.broadcastHistory.push({
        date: new Date().toISOString(),
        target: target,
        message: broadcastMsg,
        success: success,
        failed: failed
    });
    
    await saveDB(db);
    
    await sendMessage(chatId,
        `📢 <b>BROADCAST SELESAI</b>\n\n` +
        `🎯 Target: ${target}\n` +
        `✅ Berhasil: ${success}\n` +
        `❌ Gagal: ${failed}\n` +
        `📊 Total: ${targetUsers.length}`
    );
}

// BACKUP DATABASE
async function handleBackup(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (userId.toString() !== OWNER_ID) return;
    
    const db = await getDB();
    const backup = JSON.stringify(db, null, 2);
    
    await fetch(`${TELEGRAM_API}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            document: `data:text/json;base64,${Buffer.from(backup).toString('base64')}`,
            caption: `📅 Backup: ${new Date().toISOString()}\n👥 Users: ${db.stats.totalUsers}\n🤖 Bots: ${db.stats.totalBots}`,
            file_name: `backup_${Date.now()}.json`
        })
    });
}

// CALLBACK HANDLER
async function handleCallback(callback) {
    const userId = callback.from.id;
    const chatId = callback.message.chat.id;
    const data = callback.data;
    const msg = callback.message;
    
    // Check member
    if (data === 'check_member') {
        const isMember = await checkChannelMembership(userId);
        if (isMember) {
            await handleStart({ from: callback.from, chat: { id: chatId } });
        } else {
            await sendMessage(chatId, '⚠️ Kamu masih belum join @LeguminY!');
        }
        return;
    }
    
    // Create bot
    if (data === 'create_bot') {
        await handleCreateBot(msg);
        return;
    }
    
    // My bots
    if (data === 'my_bots') {
        await handleMyBots(msg);
        return;
    }
    
    // User stats
    if (data === 'user_stats') {
        const db = await getDB();
        await sendMessage(chatId,
            `📊 <b>STATISTIK KAMU</b>\n\n` +
            `👥 Total User: ${db.stats.totalUsers}\n` +
            `🤖 Total Bot: ${db.stats.totalBots}\n` +
            `📨 Total Pesan: ${db.stats.totalMessages}`
        );
        return;
    }
    
    // About
    if (data === 'about') {
        await sendMessage(chatId,
            `ℹ️ <b>TENTANG BOT</b>\n\n` +
            `🤖 <b>Bot Limit System</b>\n\n` +
            `Bikin bot Telegram kamu sendiri!\n` +
            `Orang bisa chat kamu lewat bot itu.\n\n` +
            `👨‍💻 Created by: @xnecz\n` +
            `📢 Channel: @LeguminY\n\n` +
            `🔹 /register TOKEN - Daftarin bot\n` +
            `🔹 /panel - Control panel bot\n` +
            `🔹 /start - Menu utama`
        );
        return;
    }
    
    // Control Panel
    if (data.startsWith('panel_')) {
        const botId = data.replace('panel_', '');
        await handleUserPanel(msg, botId);
        return;
    }
    
    // Owner Panel
    if (data === 'owner_panel') {
        await handleOwnerPanel(msg);
        return;
    }
    
    // Owner actions
    if (data === 'owner_stats') {
        const db = await getDB();
        const activeBots = Object.values(db.bots).filter(b => b.status === 'active');
        const activeToday = Object.values(db.users).filter(u => {
            const today = new Date().toISOString().split('T')[0];
            return u.lastActive?.startsWith(today);
        });
        
        await sendMessage(chatId,
            `📊 <b>GLOBAL STATISTIK</b>\n\n` +
            `👥 Total User: ${db.stats.totalUsers}\n` +
            `🤖 Total Bot: ${db.stats.totalBots}\n` +
            `✅ Bot Aktif: ${activeBots.length}\n` +
            `⏸️ Bot Paused: ${db.stats.totalBots - activeBots.length}\n` +
            `📨 Total Pesan: ${db.stats.totalMessages}\n` +
            `📢 Broadcast: ${db.stats.totalBroadcasts}\n` +
            `🔴 Aktif Hari Ini: ${activeToday.length}\n` +
            `🚫 Banned: ${Object.keys(db.bannedUsers).length}`
        );
        return;
    }
    
    if (data === 'owner_bots') {
        const db = await getDB();
        const bots = Object.values(db.bots).slice(0, 20);
        let text = '🤖 <b>LIST BOT</b>\n\n';
        
        for (const bot of bots) {
            const owner = db.users[bot.ownerId];
            text += `@${bot.botUsername} | Owner: @${owner?.username || 'Unknown'}\n`;
        }
        
        text += `\nTotal: ${db.stats.totalBots} bot`;
        await sendMessage(chatId, text);
        return;
    }
    
    if (data === 'owner_backup') {
        await handleBackup(msg);
        return;
    }
    
    if (data === 'owner_ad') {
        const db = await getDB();
        const status = db.globalAd.active ? 'AKTIF' : 'MATI';
        
        const keyboard = {
            inline_keyboard: [
                [{ text: db.globalAd.active ? '❌ Matikan Iklan' : '✅ Aktifkan Iklan', callback_data: 'toggle_ad' }],
                [{ text: '✏️ Edit Teks Iklan', callback_data: 'edit_ad' }],
                [{ text: '🔙 Kembali', callback_data: 'owner_panel' }]
            ]
        };
        
        await sendMessage(chatId,
            `💰 <b>IKLAN GLOBAL</b>\n\n` +
            `Status: ${status}\n` +
            `Impresi: ${db.globalAd.impressions}\n\n` +
            `Teks Iklan:\n"${db.globalAd.text || '(kosong)'}"`,
            keyboard
        );
        return;
    }
    
    if (data === 'toggle_ad') {
        const db = await getDB();
        db.globalAd.active = !db.globalAd.active;
        await saveDB(db);
        await sendMessage(chatId, `✅ Iklan ${db.globalAd.active ? 'DIAKTIFKAN' : 'DIMATIKAN'}`);
        return;
    }
    
    if (data === 'owner_history') {
        const db = await getDB();
        const history = db.broadcastHistory.slice(-5).reverse();
        let text = '📋 <b>BROADCAST HISTORY</b>\n\n';
        
        for (const h of history) {
            text += `📅 ${new Date(h.date).toLocaleDateString()}\n`;
            text += `├── Target: ${h.target}\n`;
            text += `├── Sukses: ${h.success}\n`;
            text += `└── Gagal: ${h.failed}\n\n`;
        }
        
        await sendMessage(chatId, text || 'Belum ada history');
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
            await sendMessage(chatId, `✅ Bot ${bot.settings.isPaused ? 'DIPAUSE' : 'DIAKTIFKAN KEMBALI'}`);
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
            await sendMessage(chatId, `✅ Forward ${bot.settings.forwardToOwner ? 'DIAKTIFKAN' : 'DIMATIKAN'}`);
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
            await sendMessage(chatId, `✅ Notifikasi ${bot.settings.notifyOwner ? 'DIAKTIFKAN' : 'DIMATIKAN'}`);
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
            let text = '📋 <b>10 CHAT TERAKHIR</b>\n\n';
            
            for (const l of log) {
                text += `├── ${l.direction === 'in' ? '📥' : '📤'} ${l.from}: "${l.text?.substring(0, 30)}"\n`;
                text += `└── ${new Date(l.timestamp).toLocaleTimeString()}\n\n`;
            }
            
            await sendMessage(chatId, text || 'Belum ada chat');
        }
        return;
    }
    
    if (data.startsWith('reset_')) {
        const botId = data.replace('reset_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ YA, RESET', callback_data: `confirmreset_${botId}` },
                     { text: '❌ BATAL', callback_data: `panel_${botId}` }]
                ]
            };
            await sendMessage(chatId,
                `⚠️ <b>RESET BOT?</b>\n\n` +
                `Semua chat history & setting akan dihapus.\n` +
                `Bot @${bot.botUsername} akan direset ke pengaturan awal.\n\n` +
                `Lanjutkan?`,
                keyboard
            );
        }
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
            await saveDB(db);
            await sendMessage(chatId, '✅ Bot berhasil direset!');
            await handleUserPanel(msg, botId);
        }
        return;
    }
    
    if (data.startsWith('autoreply_')) {
        const botId = data.replace('autoreply_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: bot.settings.autoReply ? '❌ Matikan' : '✅ Aktifkan', callback_data: `togglear_${botId}` }],
                    [{ text: '✏️ Edit Pesan', callback_data: `editar_${botId}` }],
                    [{ text: '🔙 Kembali', callback_data: `panel_${botId}` }]
                ]
            };
            await sendMessage(chatId,
                `🤖 <b>AUTO REPLY</b>\n\n` +
                `Status: ${bot.settings.autoReply ? '✅ AKTIF' : '❌ MATI'}\n` +
                `Pesan: "${bot.settings.autoReplyText}"`,
                keyboard
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
            await sendMessage(chatId, `✅ Auto Reply ${bot.settings.autoReply ? 'DIAKTIFKAN' : 'DIMATIKAN'}`);
        }
        return;
    }
    
    if (data.startsWith('blacklist_')) {
        const botId = data.replace('blacklist_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const words = bot.settings.blacklistWords.join(', ') || '(kosong)';
            await sendMessage(chatId,
                `🚫 <b>BLACKLIST KATA</b>\n\n` +
                `Kata diblokir: ${words}\n\n` +
                `Tambah kata:\n<code>/addblacklist ${botId} KATA</code>\n\n` +
                `Hapus kata:\n<code>/removeblacklist ${botId} KATA</code>`
            );
        }
        return;
    }
    
    if (data.startsWith('blockuser_')) {
        const botId = data.replace('blockuser_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const blocked = Object.keys(bot.settings.blockedUsers).join(', ') || '(kosong)';
            await sendMessage(chatId,
                `👤 <b>BLOKIR USER</b>\n\n` +
                `User diblokir: ${blocked}\n\n` +
                `Blokir user:\n<code>/block ${botId} USER_ID</code>\n\n` +
                `Unblock user:\n<code>/unblock ${botId} USER_ID</code>`
            );
        }
        return;
    }
    
    if (data.startsWith('detailstats_')) {
        const botId = data.replace('detailstats_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const st = bot.stats;
            await sendMessage(chatId,
                `📊 <b>DETAIL STATISTIK</b>\n\n` +
                `🤖 Bot: @${bot.botUsername}\n\n` +
                `📨 Total Pesan: ${st.totalMessages}\n` +
                `📥 Masuk: ${st.totalIncoming}\n` +
                `📤 Keluar: ${st.totalOutgoing}\n` +
                `👥 User Unik: ${Object.keys(st.uniqueUsers).length}\n` +
                `📅 Hari Ini: ${st.todayMessages}\n\n` +
                `📋 Response Rate: ${st.totalIncoming > 0 ? Math.round((st.totalOutgoing / st.totalIncoming) * 100) : 0}%`
            );
        }
        return;
    }
    
    if (data.startsWith('custombtn_')) {
        const botId = data.replace('custombtn_', '');
        const db = await getDB();
        const bot = db.bots[botId];
        if (bot && bot.ownerId === userId) {
            const buttons = bot.settings.customButtons;
            let text = '🔘 <b>CUSTOM BUTTON</b>\n\n';
            
            if (buttons.length > 0) {
                text += 'Button saat ini:\n';
                for (const btn of buttons) {
                    text += `├── ${btn.text} → ${btn.url}\n`;
                }
            } else {
                text += 'Belum ada button.\n';
            }
            
            text += '\nTambah button:\n<code>/addbutton ' + botId + ' TEKS|URL</code>\n\n';
            text += 'Hapus semua:\n<code>/clearbuttons ' + botId + '</code>';
            
            await sendMessage(chatId, text);
        }
        return;
    }
    
    if (data.startsWith('setwelcome_')) {
        const botId = data.replace('setwelcome_', '');
        await sendMessage(chatId,
            `✏️ <b>EDIT WELCOME</b>\n\n` +
            `Kirim pesan welcome baru:\n<code>/setwelcome ${botId} PESAN_BARU</code>\n\n` +
            `Gunakan:\n` +
            `{name} - Nama user\n` +
            `{username} - Username user\n` +
            `{botname} - Nama bot\n\n` +
            `Contoh:\n<code>/setwelcome ${botId} Halo {name}! Ada yang bisa dibantu?</code>`
        );
        return;
    }
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'OK', message: 'Bot Utama Aktif!', channel: CHANNEL_USERNAME });
    }
    
    const body = req.body;
    
    // Handle callback
    if (body.callback_query) {
        await handleCallback(body.callback_query);
        return res.status(200).json({ status: 'OK' });
    }
    
    // Handle message
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        // Init DB if needed
        try {
            await getDB();
        } catch {
            await saveDB(initDB());
        }
        
        // Commands
        if (text.startsWith('/start')) {
            await handleStart(msg);
        }
        else if (text.startsWith('/register')) {
            const token = text.replace('/register', '').trim();
            await handleRegisterBot(msg, token);
        }
        else if (text.startsWith('/panel')) {
            const db = await getDB();
            const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
            if (userBots.length === 1) {
                await handleUserPanel(msg, userBots[0].botId);
            } else {
                await handleMyBots(msg);
            }
        }
        else if (text.startsWith('/owner') && userId.toString() === OWNER_ID) {
            await handleOwnerPanel(msg);
        }
        else if (text.startsWith('/broadcast') && userId.toString() === OWNER_ID) {
            // Format: /broadcast target | pesan
            const parts = text.replace('/broadcast', '').trim().split('|');
            const target = parts[0]?.trim() || 'all';
            const broadcastMsg = parts[1]?.trim();
            
            if (!broadcastMsg) {
                await sendMessage(chatId,
                    '📢 Format: /broadcast target | pesan\n\n' +
                    'Target:\n' +
                    '- all (semua user)\n' +
                    '- bot_owners (pemilik bot)\n' +
                    '- active (user aktif)'
                );
            } else {
                await handleBroadcast(msg, target, broadcastMsg);
            }
        }
        else if (text.startsWith('/backup') && userId.toString() === OWNER_ID) {
            await handleBackup(msg);
        }
        else if (text.startsWith('/addblacklist')) {
            const parts = text.replace('/addblacklist', '').trim().split(' ');
            const botId = parts[0];
            const word = parts.slice(1).join(' ');
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && word) {
                bot.settings.blacklistWords.push(word.toLowerCase());
                await saveDB(db);
                await sendMessage(chatId, `✅ Kata "${word}" ditambahkan ke blacklist`);
            }
        }
        else if (text.startsWith('/removeblacklist')) {
            const parts = text.replace('/removeblacklist', '').trim().split(' ');
            const botId = parts[0];
            const word = parts.slice(1).join(' ').toLowerCase();
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) {
                bot.settings.blacklistWords = bot.settings.blacklistWords.filter(w => w !== word);
                await saveDB(db);
                await sendMessage(chatId, `✅ Kata "${word}" dihapus dari blacklist`);
            }
        }
        else if (text.startsWith('/block')) {
            const parts = text.replace('/block', '').trim().split(' ');
            const botId = parts[0];
            const blockUserId = parts[1];
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && blockUserId) {
                bot.settings.blockedUsers[blockUserId] = { blockedAt: new Date().toISOString() };
                await saveDB(db);
                await sendMessage(chatId, `✅ User ${blockUserId} diblokir`);
            }
        }
        else if (text.startsWith('/unblock')) {
            const parts = text.replace('/unblock', '').trim().split(' ');
            const botId = parts[0];
            const unblockUserId = parts[1];
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) {
                delete bot.settings.blockedUsers[unblockUserId];
                await saveDB(db);
                await sendMessage(chatId, `✅ User ${unblockUserId} diunblock`);
            }
        }
        else if (text.startsWith('/setwelcome')) {
            const parts = text.replace('/setwelcome', '').trim();
            const spaceIndex = parts.indexOf(' ');
            const botId = parts.substring(0, spaceIndex);
            const message = parts.substring(spaceIndex + 1);
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && message) {
                bot.settings.welcomeMessage = message;
                await saveDB(db);
                await sendMessage(chatId, '✅ Welcome message diupdate!');
            }
        }
        else if (text.startsWith('/addbutton')) {
            const parts = text.replace('/addbutton', '').trim();
            const firstSpace = parts.indexOf(' ');
            const botId = parts.substring(0, firstSpace);
            const buttonData = parts.substring(firstSpace + 1).split('|');
            const btnText = buttonData[0]?.trim();
            const btnUrl = buttonData[1]?.trim();
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId && btnText && btnUrl) {
                if (bot.settings.customButtons.length >= 3) {
                    await sendMessage(chatId, '❌ Maksimal 3 button!');
                } else {
                    bot.settings.customButtons.push({ text: btnText, url: btnUrl });
                    await saveDB(db);
                    await sendMessage(chatId, `✅ Button "${btnText}" ditambahkan!`);
                }
            }
        }
        else if (text.startsWith('/clearbuttons')) {
            const botId = text.replace('/clearbuttons', '').trim();
            const db = await getDB();
            const bot = db.bots[botId];
            if (bot && bot.ownerId === userId) {
                bot.settings.customButtons = [];
                await saveDB(db);
                await sendMessage(chatId, '✅ Semua button dihapus!');
            }
        }
        else if (text.startsWith('/setad') && userId.toString() === OWNER_ID) {
            const adText = text.replace('/setad', '').trim();
            const db = await getDB();
            db.globalAd.text = adText;
            await saveDB(db);
            await sendMessage(chatId, '✅ Teks iklan diupdate!');
        }
        else if (text.startsWith('/help')) {
            await sendMessage(chatId,
                `ℹ️ <b>BANTUAN</b>\n\n` +
                `/start - Menu utama\n` +
                `/register TOKEN - Daftarin bot limit\n` +
                `/panel - Control panel bot\n` +
                `/help - Bantuan ini\n\n` +
                `📢 Channel: ${CHANNEL_USERNAME}\n` +
                `👨‍💻 Creator: @xnecz`
            );
        }
    }
    
    res.status(200).json({ status: 'OK' });
};
