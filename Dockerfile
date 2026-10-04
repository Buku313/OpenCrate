FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/opencrate-venv/bin:${PATH}" \
    PYTHON_BIN=/opt/opencrate-venv/bin/python \
    OPENCRATE_DATA=/data \
    PORT=4783 \
    OPENCRATE_BIND=0.0.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && python3 -m venv /opt/opencrate-venv \
 && /opt/opencrate-venv/bin/pip install --no-cache-dir 'yt-dlp[default]' mutagen \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /app \
 && chown -R node:node /data /app

WORKDIR /app
COPY --chown=node:node . .
USER node

EXPOSE 4783
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4783/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "launch.mjs"]
