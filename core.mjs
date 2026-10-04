import {spawn} from 'node:child_process';
export const safeName = s => String(s || 'Untitled').normalize('NFKC').replace(/[\x00-\x1f/\\:*?"<>|%]/g,'_').replace(/^\.+/,'').replace(/[ .]+$/,'').slice(0,100) || 'Untitled';
export function spotifyId(input) {
 const s=String(input).trim(),uri=s.match(/^spotify:(playlist|album|track):([a-zA-Z0-9]{22})$/);
 if(uri) return {type:uri[1],id:uri[2]};
 let u;try{u=new URL(s)}catch{throw Error('Paste a Spotify or YouTube playlist, album, or track link.');}
 const m=u.pathname.match(/^\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([a-zA-Z0-9]{22})\/?$/);
 if(u.hostname!=='open.spotify.com'||!m)throw Error('Use a link from open.spotify.com.');
 return {type:m[1],id:m[2]};
}
export function youtubeLink(input){
 const u=new URL(String(input).trim());
 if(!['https:','http:'].includes(u.protocol)||!['youtube.com','www.youtube.com','music.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)||u.username||u.password)throw Error('Use a YouTube or YouTube Music playlist/album link.');
 const list=u.searchParams.get('list');
 if(list){if(!/^[A-Za-z0-9_-]{10,200}$/.test(list))throw Error('Invalid YouTube playlist ID.');
  // YouTube Mix IDs (RD...) are contextual: yt-dlp needs the seed video as well as the mix ID.
  const mixId=u.searchParams.get('v');
  if(list.startsWith('RD')&&/^[\w-]{11}$/.test(mixId||''))return {url:`https://www.youtube.com/watch?v=${mixId}&list=${list}`,type:'playlist'};
  return {url:`https://www.youtube.com/playlist?list=${list}`,type:list.startsWith('OLAK5uy_')?'album':'playlist'};}
 const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];
 if(!/^[\w-]{11}$/.test(id||''))throw Error('Use a YouTube playlist, album playlist, or video link.');
 return {url:`https://www.youtube.com/watch?v=${id}`,type:'track'};
}
export function bestImage(t){
 const images=t.images||t.coverArt?.sources||t.visualIdentity?.image||t.thumbnails||[];
 return t.cover||t.thumbnail||[...images].sort((a,b)=>(b.width||b.maxWidth||0)-(a.width||a.maxWidth||0))[0]?.url||'';
}
export function normalizeTrack(t,i=0) {
 if(!t || typeof t!=='object')throw Error('Each track must be an object.');
 const title=t.title||t.name; const artist=t.artist||t.artists?.map(a=>typeof a==='string'?a:a.name).join(', ')||t.subtitle||'';
 if(typeof title!=='string'||!title.trim())throw Error('Each track needs a title.');
 const album=t.album&&typeof t.album==='object'?t.album:{};
 const id=String(t.id||t.uri||i),spotify=t.spotify||t.external_urls?.spotify||(id.startsWith('spotify:track:')?`https://open.spotify.com/track/${id.split(':').pop()}`:'');
 return {id,title:title.slice(0,500),artist:String(artist).slice(0,500),duration:Number(t.duration||t.duration_ms/1000)||0,source:String(t.source||''),spotify:String(spotify),selected:t.selected!==false,
  origin:String(t.origin||''),album:String(typeof t.album==='string'?t.album:album.name||''),albumArtist:String(t.albumArtist||album.artists?.map(a=>a.name).join(', ')||''),date:String(t.date||album.release_date||t.releaseDate?.isoString?.slice(0,10)||''),trackNumber:Math.max(1,Number(t.trackNumber||t.track_number||t.playlist_index)||i+1),discNumber:Math.max(1,Number(t.discNumber||t.disc_number)||1),cover:String(t.cover||bestImage(album)||bestImage(t)||''),genre:String(t.genre||'')};
}
export function embedEntity(html){
 const match=html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
 if(!match)throw Error('Spotify changed its public embed. Import JSON or use a Spotify access token in Settings.');
 const entity=JSON.parse(match[1]).props?.pageProps?.state?.data?.entity;
 if(!entity)throw Error('No collection metadata available in this embed.');return entity;
}
export function parseEmbed(html) {
 const entity=embedEntity(html),type=entity.type||'playlist';
 const tracks=entity.trackList || (type==='track'||entity.uri?.includes(':track:')?[entity]:[]);
 return {name:entity.name||entity.title||'Spotify collection',type,origin:'spotify',cover:bestImage(entity),artist:entity.artists?.map(a=>a.name).join(', ')||entity.subtitle||'',date:entity.releaseDate?.isoString?.slice(0,10)||'',tracks:tracks.map((t,i)=>normalizeTrack({...t,origin:'spotify',duration:t.duration/1000,...(type==='album'?{album:entity.name||entity.title,albumArtist:entity.artists?.map(a=>a.name).join(', ')||entity.subtitle,cover:bestImage(entity),date:entity.releaseDate?.isoString?.slice(0,10)}:{})},i)),warning:'Public embeds may omit tracks. Check the count; use the Spotify API or a JSON export for a complete playlist.'};
}
export function parseYouTube(result,link){
 const entries=result.entries||[result];const unavailable=entries.filter(t=>!t||!t.id||t.title==='[Deleted video]'||t.title==='[Private video]'||t.availability==='private'||t.availability==='premium_only');
 const name=result.title||result.playlist_title||'YouTube collection';
 return {name,type:link.type,origin:'youtube',cover:bestImage(result),artist:result.artist||'',tracks:entries.filter(t=>!unavailable.includes(t)).map((t,i)=>normalizeTrack({id:t.id,title:t.track||t.title,artist:t.artist||t.artists?.join(', ')||(t.uploader||t.channel||'').replace(/ - Topic$/,''),duration:t.duration,source:`https://www.youtube.com/watch?v=${t.id}`,origin:'youtube',album:t.album||(link.type==='album'?name:''),albumArtist:t.album_artist||'',date:t.release_date||String(t.release_year||''),trackNumber:t.track_number||t.playlist_index||i+1,discNumber:t.disc_number||1,cover:bestImage(t)},i)),...(unavailable.length?{warning:`Skipped ${unavailable.length} unavailable/private entries.`}:{})};
}
export function collectionFolder(collection){
 const type=collection.type||'playlist';
 if(type==='album')return `Albums/${safeName(collection.artist||collection.tracks?.[0]?.albumArtist||collection.tracks?.[0]?.artist||'Various Artists')}/${safeName((collection.date?.slice(0,4)?collection.date.slice(0,4)+' - ':'')+collection.name)}`;
 return `${type==='track'?'Singles':'Playlists'}/${safeName(collection.name)}`;
}
export function trackFilename(track,multidisc=false){
 const title=`${String(track.trackNumber).padStart(2,'0')} - ${safeName(track.artist||'Unknown Artist')} - ${safeName(track.title)}`;
 return multidisc?`Disc ${String(track.discNumber).padStart(2,'0')}/${title}`:title;
}
export function run(command,args,{timeout=120000,onLine}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{shell:false});let out='',err='';let settled=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error(`${command} timed out.`));},timeout);
  function finish(error){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(out);}
  child.stdout.on('data',b=>{out+=b.toString();if(out.length>20000000){child.kill();finish(Error('Process output exceeded limit.'));}onLine?.(b.toString());});
  child.stderr.on('data',b=>{err=(err+b.toString()).slice(-4000);onLine?.(b.toString());});
  child.on('error',e=>finish(Error(e.code==='ENOENT'?`${command} is missing. See Setup in the README.`:e.message)));
  child.on('close',code=>finish(code===0?null:Error(err||`${command} exited with code ${code}`)));
 });
}
