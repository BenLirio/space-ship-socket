# Scoreboard integration

The server now updates a REST scoreboard service whenever a player gets a kill and broadcasts the latest scoreboard to all connected clients.

## How it works

- On kill: when a projectile destroys a ship, the killer's `kills` count increments.
- The server POSTs to `POST /scoreboard` with:
  - `id`: the player's socket id
  - `name`: ship display name (or id if not set)
  - `score`: current kill count
  - `shipImageUrl`: the `thrustersOnMuzzleOff` variant if available, otherwise the current `appearance.shipImageUrl`.
- After updating, the server calls `GET /scoreboard` and broadcasts:
  - WebSocket message `{ type: 'scoreboard', payload: { items: [...] } }`

By default, the REST base URL is `http://localhost:3000`. Override with env var:

- `SCOREBOARD_BASE_URL` (e.g. `https://api.example.com`)

## Client message contract

- Message type: `scoreboard`
- Payload shape:

```
{
  items: [
    {
      id: string,
      name: string,
      score: number,
      shipImageUrl: string,
      createdAt?: string
    },
    ...
  ]
}
```

## Minimal client example

- Subscribe to `scoreboard` messages and render a list.

JavaScript (browser):

```
const ws = new WebSocket('ws://<host>:<port>');
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'scoreboard' && msg.payload?.items) {
      renderScoreboard(msg.payload.items);
    }
  } catch {}
};

function renderScoreboard(items) {
  // Sort by score descending then createdAt
  items.sort((a, b) => (b.score - a.score) || (new Date(b.createdAt||0) - new Date(a.createdAt||0)));
  const root = document.getElementById('scoreboard');
  root.innerHTML = items.map(i => `
    <div class=\"row\">\n      <img src=\"${i.shipImageUrl}\" alt=\"ship\" width=\"32\" height=\"32\"/>\n      <span class=\"name\">${i.name}</span>\n      <span class=\"score\">${i.score}</span>\n    </div>
  `).join('');
}
```

## Notes

- Scoreboard updates only on changes (kills). Clients can cache the latest list.
- Network failures to the REST service are ignored to keep the game loop smooth; the server will try again on the next score change.
- The broadcasted list mirrors the REST `GET /scoreboard` response.
