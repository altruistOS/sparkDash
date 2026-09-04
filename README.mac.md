# sparkDash — Run on macOS (Docker Desktop)

This guide covers running sparkDash on a **Mac** with **Docker Desktop** using
[`docker-compose.mac.yml`](./docker-compose.mac.yml).

> **What this setup is for:** a Mac that **monitors remote DGX Spark / Nvidia GPU
> hosts over SSH**. The Mac itself is **not** a monitored unit — it has no Linux
> `sysfs` / `proc` / `nvidia-smi` metric sources, so local-host collectors and
> `network_mode: host` do not apply here. Use this on a Mac; use the default
> `docker-compose.yml` on the DGX Spark itself.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running with
  the **Docker Engine** started (`docker info` works).
- **SSH access** (key recommended) from this Mac to each remote Spark / GPU host
  you want to monitor.
- Enough free disk/memory for the container (the image bundles Node 22 runtime).

---

## 1. Build the image

`docker-compose.mac.yml` reuses the already-built image `sparkdash-sparkdash`
instead of rebuilding on every `up`. Build it once from the repo root:

```bash
cd /Volumes/Elements/GitHub/sparkDash
docker build -t sparkdash-sparkdash .
```

This targets `linux/arm64` (the Mac default architecture for Apple Silicon; the
agent image is ARM64). On Apple Silicon this is the native architecture, so it
builds fine. On an Intel Mac you may need `--platform linux/arm64` support and
emulation enabled in Docker Desktop.

---

## 2. Start the container

```bash
cd /Volumes/Elements/GitHub/sparkDash
docker compose -f docker-compose.mac.yml up -d
```

Verify it is running and listening:

```bash
docker ps --filter name=sparkDash
lsof -nP -iTCP:5555 -sTCP:LISTEN
```

Open the dashboard: **http://localhost:5555**

The `ports: "5555:5555"` mapping publishes it to `localhost` on the Mac. Set
`BIND_HOST=0.0.0.0` (already set in this file) so other machines on your LAN can
also reach it at `http://<mac-ip>:5555`.

---

## 3. Add a remote Spark / GPU host

1. Open the dashboard and click the **`+`** tab.
2. Choose **Unit type**:
   - **NVIDIA DGX Spark** — default; shows fixed GB10 specs.
   - **Dedicated GPU host** — any Linux box with an Nvidia GPU; shown via
     `nvidia-smi` over SSH with separate **RAM** / **VRAM** panels.
3. Fill in:
   - **Name**
   - **LAN IP** (required) — the IP as seen **from the Mac**, not your laptop's
     view of itself.
   - Optional **CX7 IP** (Sparks only).
   - **SSH user** and auth (**key or password**).
4. Save. The unit appears in the Overview and gets its own tab.

> The dashboard runs **inside the container**, so SSH is executed from the
> container. Configured LAN IPs are from the **container's** point of view.

---

## 4. SSH key auth from the container

OpenSSH inside the container looks for keys under **`/root/.ssh`**, not the
Mac user's `~/.ssh`. To use **key** auth, bind-mount your private key into the
container. Add this line under `volumes:` in `docker-compose.mac.yml`:

```yaml
    volumes:
      - ./config:/app/config
      - ${HOME}/.ssh/id_ed25519:/root/.ssh/id_ed25519:ro
```

Then recreate the container:

```bash
docker compose -f docker-compose.mac.yml up -d
```

Notes:
- Keep the key file mode `600`.
- If your key has a non-default name (e.g. `id_ed25519_shared`), mount it **as**
  `id_ed25519`, or set `SSH_IDENTITY_FILE` to the in-container path.
- Password auth needs no mount (the app encrypts and stores SSH passwords).

---

## 5. Persistence

`./config:/app/config` keeps runtime state across restarts:

- `sparks.json` — the unit registry (additions/edits).
- `sparks-secrets.json` — AES-256-GCM encrypted SSH passwords.
- `.secrets-key` / `settings.json` — encryption key and global settings.

These live on the Mac bind mount, so they survive `down`/`up` and container
recreates. Keep `config/` out of version control if you deploy this folder.

---

## 6. Update / rebuild

Pull the latest code, rebuild the image, and recreate the container:

```bash
cd /Volumes/Elements/GitHub/sparkDash
git pull --ff-only
docker build -t sparkdash-sparkdash .
docker compose -f docker-compose.mac.yml up -d
```

---

## 7. Stop / logs

```bash
# Stop but keep the container
docker compose -f docker-compose.mac.yml stop

# Stop and remove the container (keeps ./config state)
docker compose -f docker-compose.mac.yml down

# Follow logs
docker logs -f sparkDash
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `localhost:5555` not loading | Container not running; check `docker ps`, run `docker logs sparkDash`. |
| No such image `sparkdash-sparkdash` | Build the image first (step 1). |
| SSH auth fails from dashboard | Container can't find the key; mount it into `/root/.ssh` (step 4). |
| Remote unit shows offline | The LAN IP is wrong from the container's view, or SSH user/key is wrong. |
| Host metrics missing | The Mac itself cannot be monitored (no host metrics). Only **remote** units are supported on macOS. |

---

## Differences vs. the default `docker-compose.yml`

| Aspect | `docker-compose.yml` | `docker-compose.mac.yml` |
|----------|----------------------|--------------------------|
| Location | On the DGX Spark (Linux/ARM64) | On a Mac (Docker Desktop) |
| Network | `network_mode: host` | `bridge` + `ports: "5555:5555"` |
| Local host metrics | Yes (`/proc`, `/sys`, `nvidia-smi` mounts) | No — Mac not monitored |
| Monitoring scope | Local + remote units | Remote units only (over SSH) |

Use `docker-compose.yml` when running on the Spark itself; use
`docker-compose.mac.yml` when the dashboard should run on your Mac and monitor
remote units.
