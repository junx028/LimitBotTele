const fetch = require('node-fetch');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    try {
        const gistRes = await fetch(GIST_API, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        const gist = await gistRes.json();
        const db = JSON.parse(gist.files['database.json'].content);
        
        const activeBots = Object.values(db.bots || {}).filter(b => 
            b.status === 'active' && !b.settings?.isPaused
        );
        
        const onlineUsers = Object.values(db.users || {})
            .filter(u => {
                const lastActive = new Date(u.lastActive);
                const now = new Date();
                return (now - lastActive) < 30 * 60 * 1000; // 30 menit
            })
            .map(u => ({
                username: u.username,
                bots: u.totalBots || 0,
                status: 'online'
            }));
        
        const today = new Date().toISOString().split('T')[0];
        const activeToday = Object.values(db.users || {}).filter(u => 
            u.lastActive?.startsWith(today)
        ).length;
        
        res.status(200).json({
            success: true,
            data: {
                totalUsers: db.stats?.totalUsers || 0,
                totalBots: db.stats?.totalBots || 0,
                activeBots: activeBots.length,
                totalMessages: db.stats?.totalMessages || 0,
                activeToday: activeToday,
                onlineUsers: onlineUsers.slice(0, 20),
                globalAd: db.globalAd || { active: false, text: '' },
                totalBroadcasts: db.stats?.totalBroadcasts || 0
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
