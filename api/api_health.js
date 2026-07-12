/**
 * Health Check Endpoint
 * Vercel automatically runs this at: /api/health
 * 
 * Copy this file to: api/health.js
 * Use this to monitor if your API is online
 * 
 * Test in browser: https://mls-analyzer.vercel.app/api/health
 */

export default async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime() * 1000) / 1000
    });
};
