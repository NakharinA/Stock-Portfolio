# Cloudflare tunnel

`config.yml` is the routing table. `credentials.json` is the tunnel's private key and is
gitignored — it is created by `cloudflared tunnel create`, not by hand.

## One-time setup

```bash
brew install cloudflared            # or use the cloudflare/cloudflared image
cloudflared tunnel login            # opens a browser, pick the pueyleng.com zone
cloudflared tunnel create portfolio # prints a tunnel UUID and writes a credentials file
```

Copy the credentials file it wrote (`~/.cloudflared/<UUID>.json`) to
`cloudflared/credentials.json`, then create the DNS records:

```bash
cloudflared tunnel route dns portfolio port.pueyleng.com
cloudflared tunnel route dns portfolio port-api.pueyleng.com
```

Those two commands create the CNAMEs described in the project README. Doing it by hand in
the dashboard works too and produces exactly the same records.

## Checking it

```bash
docker compose up -d cloudflared
docker compose logs -f cloudflared     # look for "Registered tunnel connection"
cloudflared tunnel info portfolio
```
