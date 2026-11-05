# Vyuh Esports Discord Bot — announcement and command registration fixes

## Changes in this build

### Announcement layout and notifications
- `/announce` now posts a normal Discord message instead of an embed card. This matches the wider layout of a manually written announcement.
- Optional image and file uploads are re-uploaded as normal message attachments.
- Added `notify` choices: `none`, `@everyone`, and `@here`.
- Added an optional `mention` option for selecting one role or member.
- Mentions are explicitly included in Discord's `allowedMentions` payload so valid mentions generate notifications rather than appearing as inert text.

**Discord permission requirements:** The bot needs `Mention @everyone, @here, and All Roles` permission to send `@everyone`/`@here` notifications. For a role mention, the role must be mentionable or the bot must have that permission. Users may have notification preferences that suppress alerts on their own devices.

### Duplicate slash commands
- Commands are now registered in one scope only: the configured server (guild).
- The registration step clears the old global command set and bulk-replaces the server command set, removing stale global/guild duplicates and obsolete command definitions.
- The bot also performs this sync on startup. Do not run multiple copies of the bot with the same token.

## Install / update
1. Stop the currently running bot process. Ensure only one instance is running with this bot token.
2. Extract this ZIP into a new folder.
3. Copy your existing `.env` into the new folder. This ZIP deliberately does not include credentials.
4. If you need existing ticket/giveaway records, copy your existing `data` folder into the new folder while the old bot is stopped.
5. Run:

```bash
npm install
npm run register
npm start
```

`npm run register` requires `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` in `.env`. It clears global commands for this application and registers the full command list only in `GUILD_ID`.

## `/announce` usage
- `channel`: destination channel
- `message`: announcement body
- `image`: optional image shown as a standard attachment preview
- `attachment`: optional additional file
- `notify`: choose `No notification`, `@everyone`, or `@here`
- `mention`: optionally select a role or member to notify

Example: choose `#announcements`, enter the announcement text, select the banner image, and set `notify` to `@everyone` if a server-wide ping is intended. Use the ping option deliberately; do not select it for routine posts.

## Security
The uploaded source archive contained a `.env` file. This delivery excludes it, but you should rotate the Discord bot token and any other credentials that were present in that archive. Never share `.env` or your live database publicly.


## Slash-command acknowledgement fix

Commands implemented in `src/custom-commands.js` are now deferred immediately
before any slow Discord API calls or attachment downloads. Their response helper
edits the deferred response rather than attempting a second initial reply.
The central interaction error handler also edits a deferred response where
possible. This addresses Discord `10062 Unknown interaction` caused by late
initial acknowledgements in custom slash commands.

Copy your existing `.env` and `data` directory into this folder before running.
Do not run the command registration script for this code-only fix.


## Inline mentions in `/announce`

The `/announce` message field supports mention tokens anywhere in the text:

- User: `<@USER_ID>` (also accepts `<@!USER_ID>`)
- Role: `<@&ROLE_ID>`
- Everyone: `@everyone`
- Here: `@here`

The bot extracts inline user/role IDs and adds them to Discord's `allowedMentions`,
so valid mentions notify at the exact position where they appear. The bot does not
automatically notify everyone or every role: only mention tokens actually present
in the message (or selected in the optional notify/mention fields) are enabled.

Discord's slash-command text field does not provide the same mention autocomplete
as the regular message composer. Insert a copied mention token or use the IDs in
the formats above. After installing this update, run `npm run register` once to
update the slash-command description.
