# Triple Threat — Party Battle (Local Core Loop)

A dependency-free Node.js test build for 2–8 players. It includes guest play, username/email/password accounts, room codes, Quiz Battle, Bluff Battle, Reaction Rush, scoring, and a final leaderboard.

## Requirements
- Node.js 20 or newer
- No `npm install` required

## Run locally
1. Extract this ZIP.
2. Open a terminal in the extracted `triple-threat-party-battle` folder.
3. Run `node server.js` (or `npm start`).
4. Open **http://localhost:3000** in your browser.
5. To test two players on the same computer, use a second browser profile/incognito window. In each window, choose Guest Mode with a different name. Create a room in the first window, copy the six-character room code, or use Copy invite link / Share on WhatsApp from the lobby. Invite links prefill the room code. For friends outside your computer/network, deploy the game to a public host first; a localhost link only works on your own computer.

For a different device on the same Wi-Fi, start the server on the host computer and open `http://HOST-COMPUTER-LAN-IP:3000` on the other device. Allow Node.js through the host computer's firewall if prompted.

## Notes for this core-loop build
- Rooms and player sessions live in server memory; restarting the server clears active rooms and sessions.
- Registered account credentials and basic profile stats are stored in `local-data.json` using Node's built-in scrypt password hashing. Keep this local test build private; add production-grade protections before public deployment.
- Match status refreshes through short HTTP polling. It does not require Socket.IO or any npm packages.
- This is a prototype: reaction timing is server-arrival order, not a latency-compensated competition system. Reconnect handling, moderation, rate limiting, robust persistence, and production deployment need further work.
