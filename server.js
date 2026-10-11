'use strict';
const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const app = express();
const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 24) {
  console.error('Set ADMIN_TOKEN to a secret value of at least 24 characters.');
  process.exit(1);
}
const rules = [
  { matches: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'], reply: 'Hello! 👋 Welcome. How can I help you today? Reply PRICE, REGISTER, or HELP.' },
  { matches: ['price', 'cost', 'how much', 'payment'], reply: 'You can register on LearnBridge for free. Some premium books have separate prices. Visit https://learnbridge.ng to explore.' },
  { matches: ['register', 'registration', 'sign up', 'signup'], reply: 'Registration is free! Visit https://learnbridge.ng to create your account.' },
  { matches: ['help', 'support'], reply: 'Tell us what you need help with and a human will follow up when available.' },
];
let qr = null;
let status = 'starting';
let lastError = null;
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});
client.on('qr', value => { qr = value; status = 'scan_required'; console.log('QR available at the protected /admin route'); });
client.on('authenticated', () => {status='authenticated'; qr=null;});
client.on('ready', () => {status='ready'; qr=null; console.log('WhatsApp bot ready');});
client.on('auth_failure', msg => {status='auth_failure'; lastError=String(msg).slice(0,200);});
client.on('disconnected', reason => {status='disconnected'; qr=null; console.log('Disconnected:', reason);});
client.on('message', async message => {
  try {
    if (status !== 'ready' || message.fromMe || message.isStatus || message.from.endsWith('@g.us')) return;
    const input = String(message.body || '').toLowerCase().trim();
    if (!input) return;
    const matching = rules.find(rule => rule.matches.some(word => new RegExp('(^|\\W)' + word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(\\W|$)', 'i').test(input)));
    if (matching) await message.reply(matching.reply);
  } catch (e) {console.error('Message handling failed:', e.message);}
});
app.get('/', (_, res) => res.type('text').send('WhatsApp bot service: running.'));
app.get('/health', (_, res) => res.json({status}));
app.get('/admin', async (req, res) => {
  const header = req.get('authorization') || '';
  let valid = false;
  if (header.startsWith('Basic ')) {
    try { const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8'); valid = credentials === `admin:${adminToken}`; } catch (_) {}
  }
  if (!valid) {
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp bot admin"');
    return res.status(401).type('text').send('Log in with username admin and your ADMIN_TOKEN as password.');
  }
  if (!qr) return res.type('text').send(`Bot status: ${status}. ${lastError || ''}`);
  res.type('html').send(`<html><head><meta name="referrer" content="no-referrer"></head><body><h2>Scan in WhatsApp → Linked devices</h2><img alt="WhatsApp QR" src="${await QRCode.toDataURL(qr)}"/><p>Keep this page private.</p></body></html>`);
});
app.listen(port, '0.0.0.0', () => console.log('HTTP server on', port));
client.initialize().catch(err => { status='error'; lastError=err.message; console.error('WhatsApp initialization failed:',err); });
