# WhatsApp Customer Bot — Light Edition

This replaces whatsapp-web.js (Chromium) with Baileys for a smaller memory footprint. It does not call paid AI models. Answer rules live in `knowledge.json`.

## Upgrade an existing Render deployment

1. In your GitHub repository, replace `server.js`, `package.json` and `Dockerfile` with the corresponding files from this folder.
2. Upload a new root-level file called `knowledge.json`.
3. Optionally replace/add `.gitignore` (no secrets in GitHub).
4. Commit the changes in GitHub; your Render web service set to auto-deploy should rebuild. Confirm the service remains on **Free**.
5. Keep existing `ADMIN_TOKEN` in the Render service's Environment settings; it must be at least 24 characters.
6. After the new deployment is Live, visit the deployed URL's `/admin` and log in with `admin` and your existing ADMIN_TOKEN.
7. Link WhatsApp again via QR or phone-number pairing. Old whatsapp-web.js sessions aren't compatible with Baileys.
8. Test example messages in the admin reply preview. For real chat tests, send from a DIFFERENT WhatsApp account.

## Essential limitations

- Render Free will spin down after 15 minutes without incoming HTTP/WebSocket traffic. WhatsApp traffic is primarily *outbound* from the hosted application and cannot be relied on to keep it awake.
- The Render Free filesystem is ephemeral. When it restarts, the WhatsApp login state may be lost, forcing relinking. Do not promise 24/7 service on this plan.
- A truly resilient production setup needs durable auth storage and a genuinely always-on host (e.g. an eligible Always Free virtual machine with persistent disk, if available and approved).
- Baileys is unofficial, not affiliated with WhatsApp. Avoid bulk messaging and spam. Your account can be restricted.

## Future development

Keep `knowledge.json` for editable business FAQs and command phrases. Later, an offline intent-matching library can improve classification without paid hosted AI. The bot only loads `knowledge.json` during startup; edit it in GitHub and let Render redeploy to apply changes.

## Troubleshooting

- `/health` returns the server status, WhatsApp connection status and memory usage in MiB.
- The `/admin` page is HTTP Basic authenticated; username is `admin`, password is the Render `ADMIN_TOKEN`.
- The pairing code only works when WhatsApp's companion socket is prepared. If request fails, wait and retry; check Render logs.
- No Chromium is installed by Docker, saving RAM. This package cannot be claimed production-tested until a successful Build, QR pairing and real WhatsApp reply are verified.

## Optional always-on (no-card) host: Silly Development

Silly Development currently advertises 256 MB RAM, 512 MB persistent disk, and no sleeping on its free plan. It is a small independent service with **no uptime guarantee**, and it provides only **plain HTTP** public access by default. Do **not** enter your `ADMIN_TOKEN` or pairing code on an unencrypted HTTP web admin page.

To avoid this, use the private HTTPS provider console instead of the web admin:

- On your new bot host, set `ADMIN_WEB_DISABLED=true`.
- Set `ADMIN_TOKEN` to a random secret of at least 24 characters (still required by the app; do not share it).
- To pair with phone number, set `BOT_PAIR_PHONE` to digits only, e.g. `2348012345678`. The pairing code will appear in the **private provider console**. Remove this variable once paired if possible. Otherwise leave `BOT_PAIR_PHONE` unset and scan the QR printed in the private console.
- Set your start command to `npm start` and use Node.js 20+; the bot reads the provider's `SERVER_PORT` automatically.
- Use the provider file manager or SFTP to upload `server.js`, `package.json`, `knowledge.json`, and `.gitignore`; the host installs dependencies with `npm install` during setup. Do not upload `Dockerfile` unless it supports Docker.
- Protect your provider account with strong authentication; never publish `.baileys_auth` or any pairing codes in GitHub.

**Important:** provider file persistence is claimed but not guaranteed. Unofficial personal WhatsApp bots can lead to account restrictions or bans. This is a risk even with perfect hosting.
