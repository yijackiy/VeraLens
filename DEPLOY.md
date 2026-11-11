# Deploying VeraLens through a Cloudflare Tunnel

VeraLens runs **on this laptop**. Cloudflare only carries visitors to it:

```
Visitor → Cloudflare (HTTPS, optional login) → Tunnel → laptop: FastAPI on :8000 → GTX 1650
```

FastAPI serves both the API and the built frontend, so there is one process on
one port. The tunnel connects *outwards* from the laptop, so no router ports
are opened. While the laptop is asleep, off or offline, the site is down.

Why `/analyze` returns at once and the browser polls for the result:
ADR 0016 (Cloudflare cuts off any request that runs past 100 s).

## One-time setup

1. **Install cloudflared**, then open a new terminal:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

   Without winget, download `cloudflared-windows-amd64.exe` from
   <https://github.com/cloudflare/cloudflared/releases/latest>, save it as
   `cloudflared.exe` outside the repo, and check that
   `Get-AuthenticodeSignature` reports *Valid* for *Cloudflare, Inc.*

2. **Build the frontend.** Rebuild after every frontend change.

   ```powershell
   cd frontend
   npm ci
   npm run build
   cd ..
   ```

3. **Keep the laptop awake** while it is hosting: plug it in and set *Sleep*
   to *Never* while plugged in (Settings → System → Power).

## Run it

Use two terminals, both in `veralens/`.

**Terminal 1: the app.** Run one worker, bound to localhost only, without `--reload`:

```powershell
$env:VERALENS_PUBLIC = "1"
..\venv\Scripts\python.exe -m uvicorn backend.app.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Open <http://localhost:8000> and check that the app loads before going on.

**Terminal 2: the tunnel.** Pick one option.

### Option A: quick tunnel (no domain, no account)

```powershell
cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:8000
```

`--protocol http2` runs the tunnel over TCP. The default, QUIC, runs over UDP;
on the first live run it dropped for 9 s on home Wi-Fi with *no recent network
activity*. The tunnel reconnects either way, but TCP drops less often.

It prints a `https://<random-words>.trycloudflare.com` URL; share that.
The URL changes every time you run it, and anyone who has it can use the app.
Use this for a demo you are present at.

### Option B: named tunnel with a login (needs a domain on Cloudflare)

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel**
   → *Cloudflared* → name it `veralens`.
2. Under **Public hostname**, add `veralens.<your-domain>` → service
   `HTTP` → `localhost:8000`.
3. Copy the install command it shows and run it in an **administrator**
   PowerShell. It installs cloudflared as a Windows service that starts with
   the laptop:

   ```powershell
   cloudflared service install <TOKEN>
   ```

   The token is a secret. Never commit it.
4. **Zero Trust → Access → Applications → Add → Self-hosted** for
   `veralens.<your-domain>`. Add a policy that allows *Emails* for your
   supervisor and examiners, with *One-time PIN* login. Without this policy
   the site is open to anyone.

## Limits (environment variables)

| Variable                 | Default  | Effect |
|--------------------------|----------|--------|
| `VERALENS_PUBLIC`        | unset    | `1` disables `/docs`, `/redoc`, `/openapi.json` |
| `VERALENS_MAX_ACTIVE`    | `4`      | Analyses running or queued; past it, `/analyze` answers 429 |
| `VERALENS_MAX_UPLOAD_MB` | `20`     | Larger Submitted Photos are refused with 413 |
| `VERALENS_FRONTEND_DIST` | `frontend/dist` | Where the built frontend is served from |

Only one Analysis uses the GPU at a time. A Batch of 20 photos takes about
20 minutes, and other visitors queue behind it.

## Check it over the public URL

- One photo end to end. Ideally pick one whose Analysis runs past 100 s, which
  proves ADR 0016 is working rather than lucky.
- A Batch of 2–3 photos.
- Two browsers at once: the second should show *queued* while the first runs.
- A phone.

## Stop it

- `Ctrl+C` in both terminals. For option B installed as a service, use
  `cloudflared service uninstall`, or stop the *Cloudflared agent* service in
  `services.msc`.

## Privacy

Submitted Photos are written to the temp directory only until their Analysis
finishes, and are deleted then, or after 15 minutes if never analysed.
Saliency maps are kept in `backend/static/heatmaps/` until deleted by hand.
Faces are personal data: share a public URL only with people you have told
this, and prefer option B with an Access policy.
