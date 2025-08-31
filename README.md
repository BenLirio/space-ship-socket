# space-ship-socket

TypeScript WebSocket server using `ws`.

## Quick Start

Install dependencies (already done if you cloned with node_modules):

```
npm install
```

Development (auto-restart with nodemon + ts-node):

```
npm run dev
```

Build & run production:

```
npm run build
npm start
```

Connect with a client:

```
node -e "const WebSocket=require('ws');const ws=new WebSocket('ws://localhost:8080');ws.on('message',m=>console.log('msg',m.toString()));ws.on('open',()=>{ws.send('ping');setTimeout(()=>ws.send(JSON.stringify({hello:'world'})),500)});"
```

### Message Types

| type    | payload                         |
| ------- | ------------------------------- |
| welcome | { message: string }             |
| clients | { count: number }               |
| echo    | any (what was sent by a client) |
| error   | error details (reserved)        |

### Environment

`PORT` (default 8080)

---

MIT License
