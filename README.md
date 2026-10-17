# Selfmail

<p align="center"><img src="logo.svg" width="96" alt="Selfmail"></p>

**Your own mail on your own domain, as a page of your [Aegis × Burrow](https://github.com/alexd-aero/aegis-burrow) dashboard.** Accounts with passwords and roles, service accounts the machine answers for, API keys for other programs, and preset responses — writing and sending by hand too, handed to your machine's own mail agent exactly the way [selfmail](https://github.com/alexd-aero/selfmail) does it, received through a relay — all from one page behind your existing login, styled in the [Bulwark](https://github.com/alexd-aero/bulwark) family — cold colours throughout, violet on cool slate. An addon in the [Weft](https://github.com/alexd-aero/weft) format.

It is a **separate page**, like [Bulwark](https://github.com/alexd-aero/bulwark): while it is installed, Aegis × Burrow runs its extension inside itself, mounts the mail app under the dashboard's login at `/__gate/selfmail/`, gives it a tile on the home page, and shows its card on the Burrow page.

## What it does

- **Accounts.** Usernames with passwords (scrypt-hashed) and roles: **admin** or **user**. Sign-in and first-run are a page of their own — brand, one card, a quiet foot, none of the app's shell — listing the accounts in a dropdown and asking for the password of the one you pick. Each account is an address (`name@your-domain`) with its own Inbox, Drafts, Sent and Trash — no account sees another's mail, and admins can open any of them.
- **Service accounts.** Accounts like `subsystem`, with no password: only an admin can open them (from *Users → Open*). They are what the machine itself speaks with. Each one decides what a contact to it does: the mail files into its inbox (as always), and it can **hand its mail on** — a copy lands with a real account of your choosing, never with another service account (no chains) — plus its own preset answer, in text or HTML.
- **API keys.** Give another program access to one account's mail: a key with a **read**, **send** or **admin** scope, sent as `Authorization: Bearer sm_…`. The key is shown once and kept only as a hash; revoke it any time.
- **Preset responses.** Per account: what is auto-sent when someone contacts it — subject and an answer written in plain text or HTML (the composer's own editor), with `{subject}`, `{sender}` and `{domain}` placeholders on both sides, a cooldown per sender, and loop guards (never to your own domain, never to robots: `Auto-Submitted` is honoured both ways). An HTML answer is sent beside the text one, `multipart/alternative`, like the composer sends.
- **Invalid addresses.** Mail for a name no account has lands with the **first admin** by default — nothing that reaches the machine is dropped. Under *Service accounts*, an admin can change that: drop it quietly, have a service account send the preset answer (plain text or HTML, with an optional copy kept), or deliver it to a catch-all account of their choosing. Machine-sent answers — presets and invalid-address replies — share a cap of 30 per rolling hour, so a spam wave on one of your domains cannot bury a small machine in queue retries; the mail itself still files, and the Service accounts tab shows how much of the hour's budget is spent.
- **Write in HTML.** The composer has a **Plain text / HTML** switch: the HTML side is a small editor (bold, italic, strike, headings, lists, quote, links) and sends both parts — `multipart/alternative`, plain text beside the HTML, so even a client that shows no HTML reads it. Quoted replies and forwards of an HTML message keep its formatting.
- **Read, reply, forward.** Every message opens with **Reply** (addressed back, `Re:` subject, the original quoted, and `In-Reply-To`/`References` so it lands in the sender's thread) and **Forward** (`Fwd:` subject, the whole original quoted). A draft saves mid-reply too — the threading is kept with it — and reopens with an **Edit draft** button to finish later.
- **Send.** Each message is handed to the machine's own mail agent, exactly as the working selfmail hands it to Postfix: SMTP on `127.0.0.1:25` first, the sendmail binary as the fallback (`postdrop → pickup → cleanup`, which never touches smtpd). Both waits are capped at 8 seconds on purpose — Postfix asks its milter (OpenDKIM) about every connection *before* it greets, and a milter that is listening but not answering holds the banner for its 30-second default, which is longer than most clients wait: every send then dies as *greeting never received*. With the cap, a sick milter costs a DKIM signature, not the whole send. A 5xx from the agent is a real answer and is reported as-is; when neither door answers, the app probes the agent and says in plain words which of the three failures it was — nothing listening, something else on the port, or the banner being withheld. **The app itself never connects to the internet to deliver anything — no outbound port 25 from the app, ever, and nothing on any other port either.** The agent's acceptance is reported as exactly that — *handed to the agent* — because what happens after (the agent's own queue, its retries, the receiver's filters) is the agent's to do, not a claim this app can make. The sending requirement is selfmail's own: **outbound port 25 must not be blocked by the line, or the machine cannot send at all** — no DNS record changes that. The app looks at the reverse-DNS of the machine's public IP and, when it looks like a consumer line, says so in the composer and on the Status page — other servers refuse or junk mail sent straight out from such lines, and home ISPs usually block the agent's own outbound port. That is a statement of fact, not a setup suggestion: what the agent does with its queue is the machine's business, exactly as in selfmail. Receiving is never affected by any of this. A failed hand-off stays in Sent with a **Try again** button. Nothing is ever marked sent that the agent didn't take.
- **Receive.** Burrow publishes a public HTTPS address for this addon (a tunnel on your linked domain, `mail.your-domain` by default). A free relay — [forwardemail.net](https://forwardemail.net), as in selfmail's relay mode — owns port 25 for your domain and POSTs each incoming message to that address, which files it into your Inbox. The inbound endpoint takes every shape a sender can POST, as the working selfmail does: the bare message (how a local mail agent pipes it), a JSON envelope carrying the whole original message — under `raw`, `message`, `email` or `mime`, nested or not — or plain fields with no raw copy at all, from which a message is rebuilt. The envelope recipients route the mail, so blind copies land too, not just what the headers admit; and mail for an address no account has **lands with the first admin** rather than being dropped — the same way the working selfmail files everything into its one mailbox. The **DNS** tab comes with the records ready to add — the default relay domains `mx1`/`mx2.forwardemail.net` filled in from the moment the extension is installed, the **DKIM** record read from the machine's own OpenDKIM key (selector `mail` by default, or the one the standalone selfmail's installer wrote to `/etc/selfmail/config.json` when both share the machine; without the record, every signed message fails verification and lands as spam — it is the record this tab used to be missing), and a row for the inbound host itself, which must resolve or the relay has nowhere to connect. The app cannot write your DNS itself (Burrow lets an addon read records, not write them), so each row's value carries a **copy** button — paste it into your DNS panel; the tab checks every served domain the moment it opens and on demand, each in its own section (a domain whose records were never added is laid out in the open, not hidden behind the primary): one question per record, in parallel, against public resolvers straight (1.1.1.1/8.8.8.8) and over DNS-over-HTTPS when a network blocks plain DNS. It reads back what it finds — MX priorities and TXT values — and says exactly what is wrong when something does not match, without pretending a placeholder is ready to paste. A last row asks the inbound address itself, across the internet, whether it answers — so an all-clear means the whole way in works, not just the records. Until the tunnel is published the hook record stays red on purpose: pasting its placeholder would look fine and deliver nothing.
- **Every domain on the machine.** Nothing is asked about domains at install: the app takes them from Aegis × Burrow itself — the install seeds the list from the dashboard (its main domain and every extra one linked under Settings) and the extension keeps it fresh — and serves mail on **all of them by default**: `bob@any-of-them` reaches Bob, an admin can switch a domain off under *DNS → Served domains* or right in the rail (the machine's main domain is always served), and the Inbox's *Sending from* pick — kept on the device — chooses the one new mail goes out as; the composer's From line can still change it per message, and a reply keeps the domain the mail arrived on. The DNS tab checks each served domain's records, all at once. And an admin has a **domain lens** in the sidebar: flip any domain on — no domain is favored over another — and every folder lists every account's mail for it (each row says whose mailbox it sits in; opening one opens it as that account, so replies and the usual actions just work), with the accounts a click away and the domain's on/off switch beside it. Turn it off and the sidebar is your own mail again.
- **See what was sent.** The Sent folder keeps every delivery with its outcome.
- **Keeps itself current.** The Status page has an Update card: the app asks its own git source — the repository it was installed from — whether a newer build is out, every 3 hours and on demand, and shows what it found (version, the newest commit's subject). Applying an update belongs to the dashboard, which owns the addon's files: from inside the dashboard the card's **Update now** presses it for you and the page reloads when the new build is up; anywhere else it points you at the dashboard's Add-ons page.
- **Says so when its looks are gone.** If the page ever loads without its stylesheet — a broken update can lose `app.css` — a plain notice at the top says what happened and what fixes it, instead of leaving a white wreck. The sidebar also stays fully hidden on the sign-in page: a CSS `display` rule could otherwise show its empty rail beside the card.
- **Local storage.** The whole mailbox — inbox, drafts, sent, trash — lives in plain JSON in the addon's data folder (`data/store.json`). No database, nothing leaves the machine.

## Running it

It runs on **Aegis × Burrow only** (`"platforms": ["burrow"]`, Burrow 2.15.0+), because it *is* a Burrow extension: its code runs inside Burrow, its page is served under the dashboard's login, and it reads the domain you linked and publishes its inbound address through Burrow's tunnels. Add it under *Burrow → Addons* by pasting this repository's link.

**Add it by hand for development:** `node tools/weft-run.mjs <this folder> install --host burrow` (from a checkout of the [Weft](https://github.com/alexd-aero/weft) repository).

### Settings

| Setting | Default | What it is |
|---|---|---|
| Port | 8796 | Where the app listens; the dashboard's page reaches it there |
| Mailbox name | me | The name of the mailbox before any account exists; the first account (created on first run) takes over |
| Sender name | — | The name on the mail you send |
| Inbound subdomain | mail | The public name for receiving mail, e.g. `mail.your-domain` |
| Publish the inbound address | on | Burrow's public HTTPS address a relay posts incoming mail to |
| Inbound secret | — | The secret in the inbound URL; one is made for you when empty |

### Action

- **Restart** — stop and start the mail app.

## What install changes on the machine

- a systemd user unit (`weft-selfmail-….service`, or a background process with a pid file when there is no user systemd), running `app/server.mjs` from this folder;
- the addon's data folder (`data/` beside the host's other addon data): `config.json` (settings), `state.json` (written by the extension: the linked domain, the tunnel), `store.json` (the mailbox, mode 600) and a log;
- an entry on the [Weft mesh](https://github.com/alexd-aero/weft) (`~/.config/weft/mesh/selfmail.json`), refreshed every 30 s and removed on uninstall;
- while it is installed: its extension runs inside Aegis × Burrow, and — when a domain is linked and publishing is on — one **public** tunnel named after the Inbound subdomain setting (visible on the Tunnels page, marked as Selfmail's).

Uninstalling with the data kept pauses that tunnel and stops the app; a reinstall brings both back. Uninstalling and deleting the data removes the tunnel too. Nothing else on the machine is touched, and nothing outside the addon's folder and data is written.

## For programs: the API

Another program on this machine can use one account's mail with an API key (make one under *API keys*):

```bash
KEY=sm_…   # read, send or admin scope; the app listens on its own port (8796 by default)

curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8796/api/messages?box=inbox     # list
curl -H "Authorization: Bearer $KEY" "http://127.0.0.1:8796/api/messages?box=inbox&all=1&domain=your-domain"   # an admin key: every account's mail for one domain
curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8796/api/message/m1234abc      # read one
curl -H "Authorization: Bearer $KEY" -X POST http://127.0.0.1:8796/api/send \
     -H 'Content-Type: application/json' -d '{"to":"ada@example.org","subject":"Hi","text":"From a program."}'
```

A **read** key lists and reads; a **send** key also drafts, sends and files; an **admin** key also manages accounts, keys and system settings. Sessions (the page) and keys see exactly the same API. The app's port answers on the host's bind address (loopback by default) — keep it that way unless you mean otherwise.

## Being blunt about sending, as selfmail is

Sending is the local mail agent's job, not the app's: the app hands each message to the sendmail binary or the MTA on `127.0.0.1` (the same hop selfmail's app makes to Postfix), and the agent delivers — over its own outbound port 25, from your line. The app itself never makes an outbound connection to deliver mail. If there is no agent on the machine, sends fail with the honest reason, and the Status tab's one-button check says which side is missing. When the agent does deliver, expect residential-IP realities: no reverse DNS you control, Spamhaus PBL listings, and Gmail filing first mail as spam; [selfmail's README](https://github.com/alexd-aero/selfmail#deliverability) explains exactly what helps. The webhook a relay posts to is public (its secret is in the URL, published in a DNS TXT record), so at worst anyone who reads your zone can put junk in your inbox — exactly as in selfmail.

The page sits behind your Aegis login and then behind its own account sign-in page; passwords are scrypt-hashed, sessions are HMAC-signed, API keys are kept hashed and shown once. The app's own port answers on the host's bind address (loopback by default) — the account list on the sign-in page is the only thing it shows without a password. Keep it that way.

## Where things are

| Piece | What it is |
|---|---|
| `app/server.mjs`, `app/mail.mjs`, `app/public/` | the mail app: pages, API, accounts and keys, MIME read/write, sending through the local mail agent, the mesh entry |
| `burrow/extension.mjs` | runs inside Burrow: mounts the page, publishes the inbound tunnel, answers the card's API |
| `burrow/ui.js` | its card on the Burrow page |
| `weft/*.sh` | the lifecycle scripts (with `weft/lib.sh` and `weft/mesh.py` vendored from the Weft Architecture, unedited) |

Derived from [selfmail](https://github.com/alexd-aero/selfmail) by Alexd Aero (MIT): the MIME reading code, the inbound webhook's shape and the relay-mode DNS records are carried over from it. Made with the Weft Architecture. MIT licensed — see `LICENSE`.

## Credits

Powered by the [Weft Architecture](https://github.com/alexd-aero/weft). Runs on [Selkies Forge](https://github.com/adatskov-wcpss/animated-fiesta) and [Aegis × Burrow](https://github.com/alexd-aero/aegis-burrow).
