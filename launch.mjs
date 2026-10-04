import {existsSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));const binary=join(root,'.venv',process.platform==='win32'?'Scripts/yt-dlp.exe':'bin/yt-dlp');
if(!process.env.YTDLP_BIN&&existsSync(binary))process.env.YTDLP_BIN=binary;
await import('./server.mjs');
