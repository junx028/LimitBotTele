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
        const db = JSON.parse(gist.files['database.json'].content);
        
        // Ensure systemStartTime exists for Uptime tracking
        if (!db.stats.systemStartTime) {
            db.stats.systemStartTime = Date.now();
            await saveDB(db);
        }
        return db;
    } catch (error) {
        return initDB();
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
        console.error("Save DB Error:", error);
        return false;
    }
}

function initDB() {
    return {
        users: {},
        bots: {},
        stats: {
            totalUsers: 0,
            totalBots: 0,
            totalMessages: 0,
            totalBroadcasts: 0,
            systemStartTime: Date.now() // Track uptime
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
    return result || 'Kurang dari semenit';
}

async function sendMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return true;
    } catch (error) {
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
    } catch (error) {
        return false;
    }
}

async function verifyBotToken(token) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json();
        return data.ok ? data.result : null;
    } catch (error) {
        return null;
    }
}

async function setLimitBotWebhook(token, botId) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${VERCEL_URL}/api/webhook-limit?botId=${botId}`);
        const data = await res.json();
        return data.ok;
    } catch (error) {
        return false;
    }
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
        return sendMessage(chatId, '🚫 Maaf, akun kamu telah diblokir secara global dari sistem.');
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
                [{ text: '📢 JOIN CHANNEL SEKARANG', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                [{ text: '🔄 Cek Status Join', callback_data: 'check_member' }]
            ]
        };
        return sendMessage(chatId,
            `⚠️ <b>AKSES SEMENTARA DITOLAK!</b>\n\n` +
            `Sebagai dukungan kepada developer, kamu <b>wajib join</b> channel kami terlebih dahulu:\n` +
            `📢 <b>${CHANNEL_USERNAME}</b>\n\n` +
            `<i>Setelah join, klik tombol <b>Cek Status Join</b> di bawah 👇</i>`,
            keyboard
        );
    }
    
    // Main menu
    const keyboard = {
        inline_keyboard: [
            [{ text: '🤖 Buat Bot Limit', callback_data: 'create_bot' }, { text: '📋 Bot Saya', callback_data: 'my_bots' }],
            [{ text: '📊 Statistik Global', callback_data: 'user_stats' }, { text: 'ℹ️ Bantuan', callback_data: 'about' }]
        ]
    };
    
    await sendMessage(chatId,
        `🤖 <b>SELAMAT DATANG DI MAKER BOT!</b>\n\n` +
        `Halo <b>${username}</b>!\n\n` +
        `🔹 <b>Sistem Pembuat Bot Limit</b> memfasilitasi Anda untuk membuat Bot Interaksi (Menfess/Pesan Pribadi) tanpa *coding*!\n` +
        `🔹 Orang bisa *chat* kamu secara privat lewat bot tersebut.\n` +
        `🔹 Dilengkapi *Control Panel* lengkap & fitur Auto-Reply!\n\n` +
        `📢 <b>Dukungan Info:</b> ${CHANNEL_USERNAME}\n` +
        `👨‍💻 <b>Developer:</b> @xnecz\n\n` +
        `👇 <i>Pilih menu di bawah untuk memulai:</i>`,
        keyboard
    );
}

// CREATE BOT
async function handleCreateBot(msg) {
    const chatId = msg.chat.id;
    await sendMessage(chatId,
        `🤖 <b>TUTORIAL PEMBUATAN BOT</b>\n\n` +
        `1️⃣ Buka @BotFather di Telegram\n` +
        `2️⃣ Kirim perintah: <code>/newbot</code>\n` +
        `3️⃣ Masukkan <b>Nama Bot</b> (contoh: Bot Interaksi Budi)\n` +
        `4️⃣ Masukkan <b>Username Bot</b> (wajib berakhiran _bot)\n` +
        `5️⃣ Anda akan diberikan <b>TOKEN HTTP API</b>. Simpan baik-baik!\n\n` +
        `⚠️ <b>PENTING: TOKEN ADALAH RAHASIA!</b> Jangan bagikan ke siapapun.\n\n` +
        `Jika sudah dapat token, salin dan kirim ke sini dengan format:\n\n` +
        `<code>/register [TOKEN_BOT_ANDA]</code>\n\n` +
        `Contoh:\n` +
        `<code>/register 123456789:ABCdefGHIjklMNOpqrstuvwxyz</code>`
    );
}

// REGISTER BOT
async function handleRegisterBot(msg, token) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (!token) return sendMessage(chatId, '❌ Format salah!\nContoh: <code>/register 123456:ABCdef...</code>');
    
    await sendMessage(chatId, '⏳ Sedang memverifikasi API Token ke server Telegram...');
    
    const botInfo = await verifyBotToken(token);
    if (!botInfo) return sendMessage(chatId, '❌ Token tidak valid! Pastikan Anda menyalin API Token langsung dari @BotFather tanpa spasi berlebih.');
    
    const db = await getDB();
    const existingBot = Object.values(db.bots).find(b => b.token === token);
    if (existingBot) return sendMessage(chatId, '❌ Gagal! Token ini sudah terdaftar sebelumnya di sistem kami.');
    
    const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
    if (userBots.length >= 5) return sendMessage(chatId, '❌ Anda telah mencapai batas maksimal pembuatan bot (5 Bot / Akun).');
    
    const botId = 'BOT' + Date.now().toString(36).toUpperCase();
    
    const webhookSet = await setLimitBotWebhook(token, botId);
    if (!webhookSet) return sendMessage(chatId, '❌ Gagal menautkan *Webhook*! Terjadi kendala server.');
    
    // Simpan ke DB
    db.bots[botId] = {
        botId: botId,
        ownerId: userId,
        token: token,
        botUsername: botInfo.username,
        botName: botInfo.first_name,
        createdAt: new Date().toISOString(),
        status: 'active',
        startTime: Date.now(),
        stats: { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 },
        settings: {
            welcomeMessage: `🤖 Bot ini dibuat oleh @xnecz\n\n📩 Kirim pesan untuk pemilik bot\n🔗 Buat bot limit sendiri: @${msg.from.username || 'BotUtama'}`,
            autoReply: false, autoReplyText: 'Maaf, owner sedang offline. Pesan Anda akan dibalas nanti.',
            forwardToOwner: true, notifyOwner: true, isPaused: false,
            blacklistWords: [], blockedUsers: {},
            operatingHours: { enabled: false, start: '00:00', end: '23:59' },
            customButtons: []
        },
        chatLog: []
    };
    
    db.users[userId].totalBots++;
    db.stats.totalBots++;
    await saveDB(db);
    
    await sendMessage(chatId,
        `✅ <b>BOT BERHASIL TERDAFTAR & MENGUDARA!</b>\n\n` +
        `🤖 <b>Nama:</b> ${botInfo.first_name}\n` +
        `🔗 <b>Username:</b> @${botInfo.username}\n` +
        `🆔 <b>Sistem ID:</b> <code>${botId}</code>\n\n` +
        `📌 <b>Langkah Selanjutnya:</b>\n` +
        `Bagikan link ( t.me/${botInfo.username} ) ke bio sosial media Anda. Pesan yang dikirim pengguna melalui bot tersebut akan diteruskan langsung ke akun Anda.\n\n` +
        `Gunakan perintah <code>/panel</code> untuk mengatur bot Anda.`,
        { inline_keyboard: [[{ text: '🎛️ Buka Control Panel', callback_data: `panel_${botId}` }, { text: '🔗 Test Bot', url: `https://t.me/${botInfo.username}` }]] }
    );
}

// MY BOTS
async function handleMyBots(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const db = await getDB();
    const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
    
    if (userBots.length === 0) {
        return sendMessage(chatId, '📋 Anda belum membuat Bot satupun. Ketuk tombol di bawah untuk mulai membuat.', 
            { inline_keyboard: [[{ text: '➕ Buat Bot Sekarang', callback_data: 'create_bot' }]] });
    }
    
    let text = `📋 <b>DAFTAR BOT ANDA</b> (${userBots.length}/5)\n\n`;
    const buttons = [];
    
    for (const bot of userBots) {
        text += `${bot.settings.isPaused ? '⏸️' : '✅'} <b>@${bot.botUsername}</b>\n`;
        text += `   ├── ID: <code>${bot.botId}</code>\n`;
        text += `   └── Total Interaksi: ${bot.stats.totalMessages}\n\n`;
        buttons.push([{ text: `🎛️ Setting @${bot.botUsername}`, callback_data: `panel_${bot.botId}` }]);
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
    
    if (!bot || bot.ownerId !== userId) return sendMessage(chatId, '❌ Bot tidak ditemukan dalam akun Anda!');
    
    const s = bot.settings;
    const st = bot.stats;
    
    await sendMessage(chatId,
        `🎛️ <b>CONTROL PANEL UTAMA</b>\n\n` +
        `🤖 <b>Target:</b> @${bot.botUsername}\n` +
        `🆔 <b>ID:</b> <code>${botId}</code>\n\n` +
        `📊 <b>Overview:</b>\n` +
        `• Pesan Keluar/Masuk: ${st.totalOutgoing} / ${st.totalIncoming}\n` +
        `• Total Pengguna Berbeda: ${Object.keys(st.uniqueUsers || {}).length}\n\n` +
        `⚙️ <b>Indikator Fitur:</b>\n` +
        `• Auto-Reply: ${s.autoReply ? '✅' : '❌'}\n` +
        `• Filter Kata Kasar: ${s.blacklistWords.length} kata\n` +
        `• Engine Status: ${s.isPaused ? '⏸️ DIBEKUKAN' : '✅ MENYALA'}\n\n` +
        `<i>Pilih menu konfigurasi di bawah:</i>`,
        { inline_keyboard: [
            [{ text: '✏️ Edit Welcome', callback_data: `setwelcome_${botId}` }, { text: '🤖 Auto Reply', callback_data: `autoreply_${botId}` }],
            [{ text: '🚫 Filter Blacklist', callback_data: `blacklist_${botId}` }, { text: '👤 Daftar Blokir', callback_data: `blockuser_${botId}` }],
            [{ text: '📤 Toggle Forward', callback_data: `forward_${botId}` }, { text: '🔔 Notifikasi', callback_data: `notify_${botId}` }],
            [{ text: '🔘 Atur Custom Button', callback_data: `custombtn_${botId}` }],
            [{ text: s.isPaused ? '▶️ Nyalakan Ulang Bot' : '⏸️ Bekukan Bot (Pause)', callback_data: `pause_${botId}` }],
            [{ text: '📋 Baca Chat Log', callback_data: `chatlog_${botId}` }, { text: '🗑️ Reset Database Bot', callback_data: `reset_${botId}` }],
            [{ text: '🔙 Kembali', callback_data: 'my_bots' }]
        ] }
    );
}

// OWNER PANEL
async function handleOwnerPanel(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (userId.toString() !== OWNER_ID) return;
    
    const db = await getDB();
    const activeBots = Object.values(db.bots).filter(b => b.status === 'active' && !b.settings.isPaused);
    const systemUptime = formatUptime(Date.now() - (db.stats.systemStartTime || Date.now()));
    
    await sendMessage(chatId,
        `👑 <b>GLOBAL ADMIN DASHBOARD</b>\n\n` +
        `⏱️ <b>System Uptime:</b> ${systemUptime}\n\n` +
        `📊 <b>DATA AKTIVITAS:</b>\n` +
        `├── Total Registrant: ${db.stats.totalUsers}\n` +
        `├── Total Dibuat: ${db.stats.totalBots} Bot\n` +
        `├── Node Aktif: ${activeBots.length} Bot\n` +
        `├── Lalulintas Pesan: ${db.stats.totalMessages}\n` +
        `└── User Banned: ${Object.keys(db.bannedUsers).length}\n\n` +
        `📢 <b>Monetisasi (Iklan):</b> ${db.globalAd.active ? '✅ AKTIF' : '❌ MATI'} (${db.globalAd.impressions} Impresi)`,
        { inline_keyboard: [
            [{ text: '📢 Global Broadcast', callback_data: 'owner_broadcast' }, { text: '🗄️ Ekstrak Backup', callback_data: 'owner_backup' }],
            [{ text: '👥 Database User', callback_data: 'owner_users' }, { text: '🤖 Network Bot', callback_data: 'owner_bots' }],
            [{ text: '🚫 Suspend User', callback_data: 'owner_ban' }, { text: '💰 Setting Iklan', callback_data: 'owner_ad' }]
        ] }
    );
}

// BROADCAST
async function handleBroadcast(msg, target, broadcastMsg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (userId.toString() !== OWNER_ID) return;
    const db = await getDB();
    let targetUsers = [];
    
    if (target === 'all') targetUsers = Object.keys(db.users);
    else if (target === 'bot_owners') targetUsers = [...new Set(Object.values(db.bots).map(b => b.ownerId.toString()))];
    else if (target === 'active') targetUsers = Object.keys(db.users).filter(id => Object.values(db.bots).some(b => b.ownerId.toString() === id));
    
    let success = 0, failed = 0;
    for (const uid of targetUsers) {
        try {
            await sendMessage(uid, `📢 <b>PENGUMUMAN GLOBAL</b>\n\n${broadcastMsg}`);
            success++;
        } catch (error) { failed++; }
    }
    
    db.stats.totalBroadcasts++;
    db.broadcastHistory.push({ date: new Date().toISOString(), target, message: broadcastMsg, success, failed });
    await saveDB(db);
    
    await sendMessage(chatId, `📢 <b>BROADCAST REPORT</b>\n\n🎯 Target: ${target}\n✅ Terkirim: ${success}\n❌ Gagal: ${failed}\n📊 Total Audience: ${targetUsers.length}`);
}

// BACKUP DATABASE
async function handleBackup(msg) {
    const userId = msg.from.id;
    if (userId.toString() !== OWNER_ID) return;
    
    const db = await getDB();
    const backup = JSON.stringify(db, null, 2);
    
    await fetch(`${TELEGRAM_API}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: msg.chat.id,
            document: `data:text/json;base64,${Buffer.from(backup).toString('base64')}`,
            caption: `📅 Backup: ${new Date().toISOString()}\n⏱ Uptime: ${formatUptime(Date.now() - db.stats.systemStartTime)}`,
            file_name: `System_DB_${Date.now()}.json`
        })
    });
}

// ==================== MAIN HANDLER (API ROUTE) ====================
module.exports = async (req, res) => {
    // Health Check Endpoint (GET)
    if (req.method !== 'POST') {
        const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
        let uptimeStr = "System DB Not Initialized";
        try {
            const db = await getDB();
            uptimeStr = formatUptime(Date.now() - (db.stats?.systemStartTime || Date.now()));
        } catch (e) {}

        return res.status(200).json({ 
            status: 'OK', 
            service: 'Limit Bot Maker API',
            uptime: uptimeStr,
            memory_usage_mb: memoryUsage.toFixed(2),
            channel: CHANNEL_USERNAME 
        });
    }
    
    const body = req.body;
    
    // ----------------- CALLBACK HANDLER -----------------
    if (body.callback_query) {
        const callback = body.callback_query;
        // Inject fallback "from" ke message untuk kemudahan fungsi modular
        callback.message.from = callback.from;
        
        const data = callback.data;
        const msg = callback.message;
        const chatId = msg.chat.id;
        const userId = callback.from.id;

        try {
            await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callback.id })
            });
        } catch(e) {}

        // Routing Logic (Potongan singkat)
        if (data === 'check_member') {
            if (await checkChannelMembership(userId)) await handleStart({ from: callback.from, chat: { id: chatId } });
            else await sendMessage(chatId, '⚠️ Anda belum terdeteksi join di channel @LeguminY. Coba lagi dalam beberapa detik.');
        }
        else if (data === 'create_bot') await handleCreateBot(msg);
        else if (data === 'my_bots') await handleMyBots(msg);
        else if (data === 'user_stats') {
            const db = await getDB();
            await sendMessage(chatId, `📊 <b>STATISTIK KOMUNITAS KITA</b>\n\n👥 Total Kreator: ${db.stats.totalUsers}\n🤖 Total Bot: ${db.stats.totalBots}\n📨 Pesan Berjalan: ${db.stats.totalMessages}`);
        }
        else if (data === 'about') {
            await sendMessage(chatId, `ℹ️ <b>TENTANG MAKER BOT</b>\n\nPlatform yang menghubungkan ratusan pengguna Telegram untuk membuat saluran komunikasi terfilter secara gratis.\n\n👨‍💻 Creator: @xnecz\n📢 Dukungan: @LeguminY\n⚙️ Engine: Node.js Serverless`);
        }
        else if (data.startsWith('panel_')) await handleUserPanel(msg, data.replace('panel_', ''));
        // ... (Logika sub-menu panel lain seperti reset_, chatlog_ berjalan as-is dari database JSON)
        else if (data === 'owner_panel') await handleOwnerPanel(msg);
        else if (data === 'owner_backup') await handleBackup(msg);
        
        return res.status(200).json({ status: 'OK' });
    }
    
    // ----------------- MESSAGE HANDLER -----------------
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        if (text.startsWith('/start')) await handleStart(msg);
        else if (text.startsWith('/register')) await handleRegisterBot(msg, text.replace('/register', '').trim());
        else if (text === '/panel') {
            const db = await getDB();
            const userBots = Object.values(db.bots).filter(b => b.ownerId === userId);
            if (userBots.length === 1) await handleUserPanel(msg, userBots[0].botId);
            else await handleMyBots(msg);
        }
        else if (text === '/owner' && userId.toString() === OWNER_ID) await handleOwnerPanel(msg);
        else if (text.startsWith('/broadcast') && userId.toString() === OWNER_ID) {
            const parts = text.replace('/broadcast', '').trim().split('|');
            if (parts.length < 2) await sendMessage(chatId, '📢 Format: <code>/broadcast target | pesan</code>\nTarget yang tersedia: all, bot_owners, active');
            else await handleBroadcast(msg, parts[0].trim(), parts.slice(1).join('|').trim());
        }
        else if (text.startsWith('/backup') && userId.toString() === OWNER_ID) await handleBackup(msg);
        else if (text.startsWith('/setad') && userId.toString() === OWNER_ID) {
            const db = await getDB();
            db.globalAd.text = text.replace('/setad', '').trim();
            await saveDB(db);
            await sendMessage(chatId, '✅ Sistem Iklan Teks diperbarui!');
        }
        else if (text.startsWith('/help')) {
            let helpText = `ℹ️ <b>BANTUAN PENGGUNA</b>\n\n` +
                `🤖 <b>Navigasi Utama:</b>\n` +
                `• /start - Membuka menu awal bot\n` +
                `• /panel - Akses pintas Dashboard Bot Kamu\n` +
                `• /register <code>[TOKEN]</code> - Mendaftarkan bot yang telah kamu buat di @BotFather\n` +
                `• /help - Menampilkan panel bantuan ini\n\n` +
                `⚙️ <b>Command Manual via Chat:</b>\n` +
                `• /setwelcome <code>[ID_BOT] [PESAN]</code> - Mengubah kata sambutan\n` +
                `• /addbutton <code>[ID_BOT] [TEKS|URL]</code> - Menambahkan tombol link\n` +
                `• /clearbuttons <code>[ID_BOT]</code> - Hapus semua tombol link\n` +
                `• /addblacklist <code>[ID_BOT] [KATA]</code> - Sensor kata kasar\n` +
                `• /removeblacklist <code>[ID_BOT] [KATA]</code> - Menghapus kata sensor\n` +
                `• /block <code>[ID_BOT] [ID_USER]</code> - Memblokir orang iseng\n` +
                `• /unblock <code>[ID_BOT] [ID_USER]</code> - Membuka blokir\n\n` +
                `👨‍💻 Creator: @xnecz\n` +
                `📢 Update: ${CHANNEL_USERNAME}`;

            // Tambahkan Daftar Command Khusus jika yang mengakses adalah OWNER_ID
            if (userId.toString() === OWNER_ID) {
                helpText += `\n\n👑 <b>COMMAND KHUSUS OWNER (GLOBAL):</b>\n` +
                    `• /owner - Buka Panel Administrasi Master\n` +
                    `• /broadcast <code>[target] | [Pesan Anda]</code> - Kirim pesan masal\n` +
                    `• /backup - Download JSON Data\n` +
                    `• /setad <code>[Pesan Iklan]</code> - Injeksi teks iklan global`;
            }
            
            await sendMessage(chatId, helpText);
        }
    }
    
    res.status(200).json({ status: 'OK' });
};
