# The Internet Room

A minimalist shared digital room where only one visitor can be present at any given time, globally.

## Philosophy

- **Scarcity is intentional** — There is only one room, and only one person can be inside
- **Waiting is a feature, not a bug** — If someone is inside, you wait
- **Anonymity enables honesty** — No accounts, no usernames, no history
- **The room is leased, never owned** — Your time is limited

## What It Is

The Internet Room is a digital confessional, an art installation, a moment of solitude on the internet. When you enter, you see what the previous stranger left behind — a message, a drawing, or nothing at all. You can leave something for the next visitor, or simply be present.

## Technical Overview

### Stack
- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS
- **Storage**: File-based JSON (easily replaceable with Redis/database)

### Features
- Global mutex lock ensuring single occupancy
- Heartbeat system (12 second intervals)
- Automatic timeout on network disconnect (30 seconds)
- Hard session limit (3 minutes, non-extendable)
- Rate limiting on entry and heartbeat endpoints
- Graceful handling of tab close via `sendBeacon`
- Optional drawing canvas
- Admin endpoint for emergency clearing

## Running the Application

### Install Dependencies

```bash
npm install
```

### Start the Server

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Configuration

Environment variables:

- `PORT` — Server port (default: 3000)
- `ADMIN_SECRET` — Secret for admin endpoints (default: `the-void-awaits`)

Server configuration in `server/index.js`:

```javascript
const CONFIG = {
  HEARTBEAT_INTERVAL: 12000,      // Client heartbeat every 12 seconds
  HEARTBEAT_TIMEOUT: 30000,       // 30 seconds without heartbeat = dead session
  HARD_SESSION_TIMEOUT: 180000,   // 3 minutes hard limit
  MAX_TEXT_LENGTH: 500            // Maximum text characters
};
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Check if room is occupied |
| POST | `/api/enter` | Attempt to enter the room |
| POST | `/api/heartbeat` | Keep session alive |
| POST | `/api/leave` | Leave the room and save content |

### Admin (requires secret)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/clear` | Force clear the room |
| GET | `/api/admin/status` | Get full room state |

**Admin clear example:**
```bash
curl -X POST http://localhost:3000/api/admin/clear \
  -H "Content-Type: application/json" \
  -d '{"secret": "the-void-awaits"}'
```

## Data Model

```javascript
{
  // Content (left by previous visitor)
  current_text: "",
  current_drawing: null,  // Base64 PNG
  
  // Lock state
  is_occupied: false,
  session_id: null,
  occupied_since: null,
  last_heartbeat_at: null
}
```

## Production Considerations

For production deployment:

1. **Use Redis** instead of file-based storage for better concurrency
2. **Add HTTPS** via reverse proxy (nginx, Caddy)
3. **Set proper CORS** if serving from different domain
4. **Use `helmet`** for security headers
5. **Consider WebSocket** for real-time status updates (optional, current polling is minimal)
6. **Monitor** heartbeat failures and lock releases

## License

MIT
