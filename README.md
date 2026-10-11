# WhatsApp Customer Auto-Reply Bot

Unofficial personal-WhatsApp automation using whatsapp-web.js. Use at your own risk: WhatsApp may restrict unofficial automation.

## Deploy (Render)
1. Create a private GitHub repository and upload these files (including the Dockerfile).
2. Render → New → Web Service → Connect the repository.
3. Set **Runtime: Docker**, **Instance: Free**.
4. Add environment variable `ADMIN_TOKEN` with a random secret of at least 24 characters. Do not publish it.
5. Deploy; examine logs. Visit `https://YOUR-SERVICE.onrender.com/admin` in Chrome. When prompted, enter username `admin` and your `ADMIN_TOKEN` as the password. Do not share the token.
6. On your phone, go to WhatsApp → Settings → Linked Devices → Link a device, and scan the QR.

## Change replies
Edit `rules` in `server.js`; commit to trigger deployment.

## Limitations
Render free web services spin down when inactive. The WhatsApp socket does not reliably wake them, so new customer messages may be missed. Free services have ephemeral filesystem: authentication can be lost after restarts, requiring re-linking. There is no guaranteed 24/7 uptime. WhatsApp Web automated via an unofficial library may be restricted; don't send bulk unsolicited messages.
