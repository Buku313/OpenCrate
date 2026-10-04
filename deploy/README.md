# Share OpenCrate from an existing Caddy Docker host

This deployment reuses an existing Docker host and Caddy proxy. It adds one isolated OpenCrate container and one authenticated HTTPS site. It does not publish the OpenCrate container port directly to the internet.

## 1. Pick a hostname

Create a DNS A record such as `opencrate.example.com` pointing to the server's public IPv4 address. If you use an AAAA record, it must point to the same server. Allow inbound TCP ports 80 and 443 in the provider firewall. Replace `opencrate.example.com` in the example Caddy block with the hostname you chose.

## 2. Create a password hash

Choose a long random password to share with your friends. On the server, run:

```sh
docker exec ts-caddy caddy hash-password --plaintext 'YOUR-LONG-RANDOM-PASSWORD'
```

Copy the resulting hash into the `basic_auth` block in [Caddyfile.example](Caddyfile.example), replacing `REPLACE_WITH_CADDY_HASH_PASSWORD_OUTPUT`. Keep the actual password out of the Caddyfile and Git. The same username (`djfriends`) and password prompt will protect both the UI and download API.

## 3. Join the existing Caddy network

Find the Docker network shared by the Caddy container:

```sh
docker inspect ts-caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}'
```

In the OpenCrate project directory, create an untracked `.env` file:

```dotenv
OPENCRATE_PUBLIC_ORIGIN=https://opencrate.example.com
CADDY_DOCKER_NETWORK=teamspeak_default
```

Replace both example values. Keep `.env` private. The project `.gitignore` excludes it.

## 4. Add the proxy route and start OpenCrate

Append the authenticated site block from `Caddyfile.example` to the existing Caddyfile, then validate and reload Caddy using the host's normal process. From the OpenCrate project directory, run:

```sh
docker compose -f deploy/docker-compose.yml up -d --build
```

Open the HTTPS hostname and sign in with the configured username/password. Share the URL and password with your group out of band. The OpenCrate container joins only the existing proxy network and a persistent data volume; it has no direct public port mapping.

## Notes

- This setup assumes the Caddy container is named `ts-caddy`; adjust the commands if yours has a different name.
- OpenCrate is a personal library tool, not a multi-user service. Everyone using the shared password can import links, start downloads, edit the shared library, and use the shared disk space.
- Keep the site password within your group. Rotate it by generating a new Caddy hash and reloading the Caddyfile.
- Do not use the service to download media you do not have permission to save.
