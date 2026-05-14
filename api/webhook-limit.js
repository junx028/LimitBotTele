const fetch = require('node-fetch');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const MAIN_BOT_TOKEN = process.env.BOT_TOKEN;
const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || 'BotUtama';
const VERCEL_URL = 'https://limit-bot.vercel.app';

async function getDB() {
    try {
        const res = await fetch(GIST_API, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const gist = await res.json();
        return JSON.parse(gist.files['database.json'].content);
    } catch (e) { return null; }
}

async function saveDB(db) {
    try {
        await fetch(GIST_API, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { 'database.json': { content: JSON.stringify(db, null, 2) } } })
        });
        return true;
    } catch (e) { return false; }
}

async function sendMsg(chatId, text, replyMarkup, botToken) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        return true;
    } catch (e) { return false; }
}

async function findBotByOwner(ownerId) {
    const db = await getDB();
    if (!db || !db.bots) return null;
    const bots = Object.entries(db.bots).filter(([_, b]) => b.ownerId === ownerId && b.status === 'active');
    if (bots.length === 0) return null;
    return { ...bots[0][1], botId: bots[0][0] };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'OK', message: 'Limit Bot Active' });
    }
    
    const body = req.body;
    const db = await getDB();
    if (!db) return res.status(200).json({ status: 'OK' });
    
    if (body.callback_query) {
        const callback = body.callback_query;
        const data = callback.data;
        const chatId = callback.message.chat.id;
        const userId = callback.from.id;
        const bot = await findBotByOwner(userId);
        if (!bot) return res.status(200).json({ status: 'OK' });
        
        const botToken = bot.token;
        const settings = bot.settings || {};
        const stats = bot.stats || {};
        
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callback.id })
            });
        } catch (e) {}
        
        if (data === 'panel') {
            const k = {
                inline_keyboard: [
                    [{ text: '📊 Statistik', callback_data: 'stats' }],
                    [{ text: '🤖 Auto Reply: ' + (settings.autoReply ? 'ON' : 'OFF'), callback_data: 'autoreply' }],
                    [{ text: '📤 Forward: ' + (settings.forwardToOwner ? 'ON' : 'OFF'), callback_data: 'forward' }],
                    [{ text: '🔔 Notif: ' + (settings.notifyOwner ? 'ON' : 'OFF'), callback_data: 'notify' }],
                    [{ text: settings.isPaused ? '▶️ Resume' : '⏸️ Pause', callback_data: 'pause' }],
                    [{ text: '📋 Chat Log', callback_data: 'chatlog' }],
                    [{ text: '🚫 Blacklist', callback_data: 'blacklist' }],
                    [{ text: '🗑️ Reset', callback_data: 'reset' }],
                    [{ text: '🔙 Tutup', callback_data: 'close' }]
                ]
            };
            await sendMsg(chatId, `🎛️ <b>CONTROL PANEL</b>\n\n🤖 @${bot.botUsername}\n\n📊 Pesan: ${stats.totalMessages || 0}\n👥 User: ${Object.keys(stats.uniqueUsers || {}).length}\n📅 Hari ini: ${stats.todayMessages || 0}\n\n🔗 t.me/${bot.botUsername}`, k, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'stats') {
            await sendMsg(chatId, `📊 <b>STATISTIK</b>\n\nTotal: ${stats.totalMessages || 0}\nMasuk: ${stats.totalIncoming || 0}\nKeluar: ${stats.totalOutgoing || 0}\nUser: ${Object.keys(stats.uniqueUsers || {}).length}\nHari ini: ${stats.todayMessages || 0}`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'autoreply') {
            bot.settings.autoReply = !settings.autoReply;
            await saveDB(db);
            await sendMsg(chatId, `✅ Auto Reply: <b>${bot.settings.autoReply ? 'AKTIF' : 'MATI'}</b>`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'forward') {
            bot.settings.forwardToOwner = !settings.forwardToOwner;
            await saveDB(db);
            await sendMsg(chatId, `✅ Forward: <b>${bot.settings.forwardToOwner ? 'AKTIF' : 'MATI'}</b>`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'notify') {
            bot.settings.notifyOwner = !settings.notifyOwner;
            await saveDB(db);
            await sendMsg(chatId, `✅ Notifikasi: <b>${bot.settings.notifyOwner ? 'AKTIF' : 'MATI'}</b>`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'pause') {
            bot.settings.isPaused = !settings.isPaused;
            bot.status = bot.settings.isPaused ? 'paused' : 'active';
            await saveDB(db);
            await sendMsg(chatId, `✅ Bot: <b>${bot.settings.isPaused ? 'DIPAUSE' : 'AKTIF'}</b>`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'chatlog') {
            const log = (bot.chatLog || []).slice(-10).reverse();
            let text = '📋 <b>10 CHAT TERAKHIR</b>\n\n';
            if (log.length > 0) {
                for (const l of log) text += `${l.direction === 'in' ? '📥' : '📤'} ${l.from}: "${(l.text || '').slice(0, 30)}"\n`;
            } else text += 'Belum ada chat.';
            await sendMsg(chatId, text, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'blacklist') {
            const words = (settings.blacklistWords || []).join(', ') || '(kosong)';
            await sendMsg(chatId, `🚫 <b>BLACKLIST</b>\n\nKata: ${words}\n\nTambah: /addblacklist KATA\nHapus: /removeblacklist KATA`, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'reset') {
            await sendMsg(chatId, '⚠️ <b>RESET?</b>\nSemua data akan dihapus.', { inline_keyboard: [[{ text: '✅ YA', callback_data: 'reset_yes' }, { text: '❌ TIDAK', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'reset_yes') {
            bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            bot.chatLog = [];
            await saveDB(db);
            await sendMsg(chatId, '✅ Berhasil direset!', { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data === 'close') {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, message_id: callback.message.message_id })
                });
            } catch (e) {}
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data.startsWith('reply_')) {
            const targetId = data.replace('reply_', '');
            await sendMsg(chatId, `💬 Balas: /reply ${targetId} PESAN`, null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (data.startsWith('block_')) {
            const targetId = data.replace('block_', '');
            if (!settings.blockedUsers) settings.blockedUsers = {};
            settings.blockedUsers[targetId] = { blockedAt: new Date().toISOString() };
            await saveDB(db);
            await sendMsg(chatId, `✅ User ${targetId} diblokir!`, null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        return res.status(200).json({ status: 'OK' });
    }
    
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || '';
        const firstName = msg.from.first_name || 'Unknown';
        
        let bot = await findBotByOwner(userId);
        if (!bot) {
            for (const [botId, b] of Object.entries(db.bots)) {
                if (b.status === 'active') { bot = { ...b, botId }; break; }
            }
        }
        if (!bot) return res.status(200).json({ status: 'OK' });
        
        const botToken = bot.token;
        const settings = bot.settings || {};
        const stats = bot.stats || {};
        const isOwner = (userId === bot.ownerId);
        
        if (text === '/start') {
            let welcome = settings.welcomeMessage || `🤖 <b>Bot ini dibuat oleh @xnecz</b>\n\n📩 Kirim pesan untuk pemilik bot\n🔗 Buat bot limit sendiri: @${MAIN_BOT_USERNAME}`;
            welcome = welcome.replace('{name}', firstName).replace('{username}', username || firstName).replace('{botname}', bot.botName || '');
            
            const buttons = [];
            const customBtns = settings.customButtons || [];
            for (const btn of customBtns) buttons.push([{ text: btn.text, url: btn.url }]);
            buttons.push([{ text: '🔗 Buat Bot Limit Sendiri', url: `https://t.me/${MAIN_BOT_USERNAME}` }]);
            
            await sendMsg(chatId, welcome, buttons.length > 0 ? { inline_keyboard: buttons } : null, botToken);
            
            if (!isOwner) {
                if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
                bot.stats.uniqueUsers[userId] = { username, firstName, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), messageCount: 0 };
                await saveDB(db);
                
                if (settings.notifyOwner) {
                    try {
                        await fetch(`https://api.telegram.org/bot${MAIN_BOT_TOKEN}/sendMessage`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: bot.ownerId, text: `🔔 @${bot.botUsername}\n👤 ${firstName} (@${username || 'Tanpa'}) baru start!`, parse_mode: 'HTML' })
                        });
                    } catch (e) {}
                }
            }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text === '/panel' && isOwner) {
            await sendMsg(chatId, `🎛️ <b>PANEL</b>\n🤖 @${bot.botUsername}\n📨 ${stats.totalMessages || 0} pesan\n👥 ${Object.keys(stats.uniqueUsers || {}).length} user`, { inline_keyboard: [[{ text: '🎛️ Buka Control Panel', callback_data: 'panel' }]] }, botToken);
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text.startsWith('/reply') && isOwner) {
            const parts = text.replace('/reply', '').trim().split(' ');
            const targetId = parts[0];
            const replyText = parts.slice(1).join(' ');
            if (targetId && replyText) {
                await sendMsg(targetId, `📤 <b>Balasan Owner:</b>\n\n${replyText}`, null, botToken);
                await sendMsg(chatId, '✅ Terkirim!', null, botToken);
                if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
                bot.stats.totalMessages++; bot.stats.totalOutgoing++; bot.stats.todayMessages = (bot.stats.todayMessages || 0) + 1;
                await saveDB(db);
            } else {
                await sendMsg(chatId, '❌ Format: /reply ID PESAN', null, botToken);
            }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text.startsWith('/addblacklist') && isOwner) {
            const word = text.replace('/addblacklist', '').trim();
            if (word) {
                if (!settings.blacklistWords) settings.blacklistWords = [];
                settings.blacklistWords.push(word.toLowerCase());
                await saveDB(db);
                await sendMsg(chatId, `✅ "${word}" ditambahkan!`, null, botToken);
            }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text.startsWith('/removeblacklist') && isOwner) {
            const word = text.replace('/removeblacklist', '').trim().toLowerCase();
            if (word && settings.blacklistWords) {
                settings.blacklistWords = settings.blacklistWords.filter(w => w !== word);
                await saveDB(db);
                await sendMsg(chatId, `✅ "${word}" dihapus!`, null, botToken);
            }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text.startsWith('/setwelcome') && isOwner) {
            const welcome = text.replace('/setwelcome', '').trim();
            if (welcome) { settings.welcomeMessage = welcome; await saveDB(db); await sendMsg(chatId, '✅ Welcome diupdate!', null, botToken); }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (text.startsWith('/setautoreply') && isOwner) {
            const reply = text.replace('/setautoreply', '').trim();
            if (reply) { settings.autoReplyText = reply; settings.autoReply = true; await saveDB(db); await sendMsg(chatId, `✅ Auto reply: "${reply}"`, null, botToken); }
            return res.status(200).json({ status: 'OK' });
        }
        
        if (!isOwner && text && !text.startsWith('/')) {
            if (settings.isPaused) return res.status(200).json({ status: 'OK' });
            if (settings.blockedUsers && settings.blockedUsers[userId]) return res.status(200).json({ status: 'OK' });
            if (settings.blacklistWords && settings.blacklistWords.some(w => text.toLowerCase().includes(w))) {
                await sendMsg(chatId, '⚠️ Pesan mengandung kata terlarang.', null, botToken);
                return res.status(200).json({ status: 'OK' });
            }
            
            if (!bot.stats) bot.stats = { totalMessages: 0, totalIncoming: 0, totalOutgoing: 0, uniqueUsers: {}, todayMessages: 0 };
            if (!bot.stats.uniqueUsers) bot.stats.uniqueUsers = {};
            if (!bot.chatLog) bot.chatLog = [];
            
            bot.stats.totalMessages++; bot.stats.totalIncoming++; bot.stats.todayMessages = (bot.stats.todayMessages || 0) + 1;
            
            if (bot.stats.uniqueUsers[userId]) {
                bot.stats.uniqueUsers[userId].lastSeen = new Date().toISOString();
                bot.stats.uniqueUsers[userId].messageCount++;
            } else {
                bot.stats.uniqueUsers[userId] = { username, firstName, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), messageCount: 1 };
            }
            
            bot.chatLog.push({ direction: 'in', from: username || firstName, userId, text, timestamp: new Date().toISOString() });
            if (bot.chatLog.length > 50) bot.chatLog = bot.chatLog.slice(-50);
            await saveDB(db);
            
            if (settings.forwardToOwner !== false) {
                try {
                    await fetch(`https://api.telegram.org/bot${MAIN_BOT_TOKEN}/sendMessage`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: bot.ownerId, text: `📩 <b>@${bot.botUsername}</b>\n👤 ${firstName} (@${username || 'Tanpa'})\n🆔 <code>${userId}</code>\n\n💬 ${text}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💬 Balas', callback_data: `reply_${userId}` }, { text: '🚫 Blokir', callback_data: `block_${userId}` }]] } })
                    });
                } catch (e) {}
            }
            
            if (settings.autoReply) await sendMsg(chatId, settings.autoReplyText || 'Owner sedang offline.', null, botToken);
            return res.status(200).json({ status: 'OK' });
        }
    }
    
    res.status(200).json({ status: 'OK' });
};
