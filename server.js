
'use strict';

const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.urlencoded({ extended: false, limit: '2kb' }));

const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN;

if (!adminToken || adminToken.length < 24) {
  console.error('Set ADMIN_TOKEN to at least 24 characters.');
  process.exit(1);
}

const rules = [
  {
    matches: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
    reply: 'Hello! 👋 Welcome. How can I help you today? Reply PRICE, REGISTER, or HELP.'
  },
  {
    matches: ['price', 'cost', 'how much', 'payment'],
    reply: 'Registration on LearnBridge is free! Premium books have separate prices. Visit https://learnbridge.ng'
  },
  {
    matches: ['register', 'registration', 'sign up', 'signup'],
    reply: 'Registration is free! Visit https://learnbridge.ng to create your account.'
  },
  {
    matches: ['help', 'support'],
    reply: 'Tell us what you need help with and a human will follow up when available.'
  }
];

let qr = null;
let pairingCode = null;
let status = 'starting';
let lastError = null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
});

client.on('qr', value => {
  qr = value;
  status = 'scan_required';
});

client.on('code', value => {
  pairingCode = value;
  status = 'pairing_code';
});

client.on('authenticated', () => {
  status = 'authenticated';
  qr = null;
  pairingCode = null;
});

client.on('ready', () => {
  status = 'ready';
  qr = null;
  pairingCode = null;
  console.log('WhatsApp bot ready');
});

client.on('auth_failure', error => {
  status = 'auth_failure';
  lastError = String(error).slice(0, 200);
});

client.on('disconnected', reason => {
  status = 'disconnected';
  qr = null;
  pairingCode = null;
  console.log('Disconnected:', reason);
});

client.on('message', async message => {
  try {
    if (
      status !== 'ready' ||
      message.fromMe ||
      message.isStatus ||
      message.from.endsWith('@g.us')
    ) return;

    const input = String(message.body || '').toLowerCase().trim();

    const matching = rules.find(rule =>
      rule.matches.some(word =>
        new RegExp(
          '(^|\\W)' +
          word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '(\\W|$)',
          'i'
        ).test(input)
      )
    );

    if (matching) {
      await message.reply(matching.reply);
    }
  } catch (error) {
    console.error('Reply failed:', error.message);
  }
});

app.get('/', (_, res) => {
  res.send('WhatsApp bot service running');
});

app.get('/health', (_, res) => {
  res.json({ status });
});

function requireAdmin(req, res, next) {
  let valid = false;
  const header = req.get('authorization') || '';

  if (header.startsWith('Basic ')) {
    try {
      const credentials = Buffer.from(
        header.slice(6), 'base64'
      ).toString('utf8');
      valid = credentials === `admin:${adminToken}`;
    } catch (_) {}
  }

  if (!valid) {
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Bot Admin"');
    return res.status(401).send('Admin login required');
  }

  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy',
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  next();
}

const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, character =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]
  );

app.get('/admin', requireAdmin, async (req, res) => {
  const qrHtml = qr
    ? `<img width="260" alt="WhatsApp QR code" src="${await QRCode.toDataURL(qr)}">`
    : '<p>QR code unavailable. Refresh shortly.</p>';

  const pairingHtml = pairingCode
    ? `<h2>Pairing Code: <code>${escapeHtml(pairingCode)}</code></h2>
       <p>Open WhatsApp on your phone, then Linked Devices, Link a Device, and Link with phone number instead.</p>`
    : '';

  res.type('html').send(`
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>WhatsApp Bot Admin</title>
<style>
body{font:16px system-ui;max-width:650px;margin:2rem auto;padding:1rem}
section{padding:18px;border:1px solid #ccc;border-radius:12px;margin:15px 0}
button,input{padding:12px;margin:6px 0}
code{font-size:24px}
</style>
</head>
<body>
<h1>WhatsApp Bot Connection</h1>
<p>Status: <strong>${escapeHtml(status)}</strong></p>
<p>${escapeHtml(lastError || '')}</p>

<section>
<h2>Option 1: Scan QR Code</h2>
${qrHtml}
<form action="/admin/qr" method="POST">
<button type="submit">Switch to QR Code</button>
</form>
</section>

<section>
<h2>Option 2: Pair with Phone Number</h2>
<form action="/admin/pair" method="POST">
<label>Phone number including country code</label>
<br>
<input name="phone" placeholder="2348012345678"
pattern="[0-9]{10,15}" maxlength="15"
autocomplete="off" required>
<br>
<button type="submit">Generate Pairing Code</button>
</form>
${pairingHtml}
</section>
<p>Refresh to see new status. Keep your codes private.</p>
</body>
</html>`);
});

app.post('/admin/pair', requireAdmin, async (req, res) => {
  const phone = String(req.body.phone || '').trim();

  if (!/^[1-9][0-9]{9,14}$/.test(phone)) {
    return res.status(400).send('Invalid phone number');
  }

  if (status === 'ready' || status === 'authenticated') {
    return res.redirect(303, '/admin');
  }

  try {
    pairingCode = await client.requestPairingCode(phone);
    qr = null;
    status = 'pairing_code';
    lastError = null;
    return res.redirect(303, '/admin');
  } catch (error) {
    lastError = String(error.message || error).slice(0, 180);
    return res.status(503).send(
      'Pairing not ready. Return to /admin and try again shortly.'
    );
  }
});

app.post('/admin/qr', requireAdmin, async (req, res) => {
  if (pairingCode && status !== 'ready') {
    try {
      await client.cancelPairingCode();
      pairingCode = null;
      status = 'scan_required';
    } catch (error) {
      lastError = String(error.message || error).slice(0, 180);
    }
  }
  return res.redirect(303, '/admin');
});

app.listen(port, '0.0.0.0', () => {
  console.log('Bot HTTP server running on', port);
});

client.initialize().catch(error => {
  status = 'error';
  lastError = error.message;
  console.error('WhatsApp startup failed:', error);
});
