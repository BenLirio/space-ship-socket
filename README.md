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

Connect with a client (plain ws locally):

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

`PORT` (default 8080; on EC2 we set 443 for wss via /etc/space-ship-socket/env)
`REQUIRE_TLS` (set to `1` in production bootstrap so the service will refuse to start without certificates when binding 443)

### Enabling WSS (TLS)

The server auto-detects TLS if it finds a certificate + key at:

```
/etc/space-ship-socket/certs/fullchain.pem
/etc/space-ship-socket/certs/privkey.pem
```

Override paths with env vars `TLS_CERT_PATH` / `TLS_KEY_PATH` (add to `/etc/space-ship-socket/env`).

Steps (example using certbot + standalone HTTP challenge, assuming DNS A record points to instance):

1. SSH to instance.
2. Install certbot: `sudo dnf install -y certbot`.
3. Stop service temporarily if bound to 80 (not by default): `sudo systemctl stop space-ship-socket`.
4. Run: `sudo certbot certonly --standalone -d your.domain.example`.
5. Symlink or copy resulting `fullchain.pem` and `privkey.pem` into `/etc/space-ship-socket/certs/`.
6. Ensure permissions: `sudo chown root:ec2-user /etc/space-ship-socket/certs/*.pem` and `sudo chmod 640 /etc/space-ship-socket/certs/*.pem`.
7. Set PORT=443 in `/etc/space-ship-socket/env` (already defaulted) and restart: `sudo systemctl restart space-ship-socket`.

Client connects with:

```
new WebSocket('wss://your.domain.example');
```

If cert/key absent, server falls back to plain ws on configured port UNLESS `REQUIRE_TLS=1` (or binding 443), in which case startup fails fast.

---

MIT License

## Deployment (AWS EC2 + GitHub Actions)

This repo includes an opinionated, minimal setup to deploy the built WebSocket server to a single Amazon EC2 instance using a GitHub Actions workflow.

### 1. Provision Infrastructure

Run (review first):

```
bash infra/provision-ec2.sh
```

It will:

1. Create (or reuse) a key pair (default: `space-ship-socket-key`).
2. Create (or reuse) a security group allowing inbound 22 (SSH from your IP) and 8080 (public).
3. Launch (or reuse) a `t3.small` Amazon Linux 2023 instance tagged `Name=space-ship-socket` with a bootstrap script that installs Node.js and a systemd service placeholder.
4. Output the public DNS / IP.

Keep the generated `*.pem` file safe.

### 2. Configure GitHub Secrets

Add repository secrets (Settings > Secrets > Actions):

| Secret                  | Description                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | IAM user / role key with EC2 describe privileges (and optionally create if you run provisioning elsewhere). |
| `AWS_SECRET_ACCESS_KEY` | Matching secret.                                                                                            |
| `AWS_REGION`            | Region used (e.g. `us-east-1`).                                                                             |
| `EC2_SSH_KEY`           | Contents of the generated `.pem` private key (multi-line).                                                  |

Permissions needed for deploy workflow runtime: `ec2:DescribeInstances`. Provisioning requires more (create key pair, security groups, run instances).

### 3. Deploy

Push to `master` (or run the workflow manually). The workflow will:

1. Build the TypeScript project.
2. Package `dist` + `package.json` into a tarball.
3. Discover the running instance by tag `Name=space-ship-socket`.
4. Copy the artifact via SSH and install production dependencies (`npm install --omit=dev`).
5. Restart the systemd service `space-ship-socket`.
6. Perform a WebSocket ping smoke test.

Service file installed at provisioning time: `/etc/systemd/system/space-ship-socket.service`.

Adjust ports or instance sizing by editing `infra/provision-ec2.sh` and re-running (will reuse existing resources when possible).

### 4. Rollback

You can redeploy a previous commit by re-running the workflow on that commit. For deeper rollback, keep AMI snapshots or adopt an immutable / blue-green approach (future improvement suggestion).

### Future Improvements

- Parameterize port & instance tag via workflow inputs.
- Add health endpoint & HTTP ALB.
- Containerize & use ECS / Fargate or Elastic Beanstalk.
- Use CodeDeploy or SSM Session Manager instead of raw SSH.
