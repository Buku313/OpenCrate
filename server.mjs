import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,rename,access} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import {resolve,dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {safeName,spotifyId,normalizeTrack,parseEmbed,run,youtubeLink,parseYouTube,collectionFolder,trackFilename,bestImage} from './core.mjs';
import {publicUrl,finishAudio} from './media.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const data=resolve(process.env.OPENCRATE_DATA||join(root,'data'));
const output=join(data,'downloads');await mkdir(output,{recursive:true});
const port=Number(process.env.PORT||4783), origin=`http://127.0.0.1:${port}`;
const publicOrigin=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:'';
const publicHost=publicOrigin?new URL(publicOrigin).host:'';
if(publicOrigin&&new URL(publicOrigin).protocol!=='https:')throw Error('PUBLIC_ORIGIN must use HTTPS.');
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,publicHost].filter(Boolean));
const allowedOrigins=new Set([origin,`http://localhost:${port}`,publicOrigin].filter(Boolean));
const bindAddress=process.env.OPENCRATE_BIND||'127.0.0.1';
const ytdlp=process.env.YTDLP_BIN||'yt-dlp';
const localPython=join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.PYTHON_BIN||(existsSync(localPython)?localPython:'python3');
let jobs=[];try{jobs=JSON.parse(await readFile(join(data,'jobs.json'),'utf8'));}catch{}
for(const j of jobs){j.track=normalizeTrack(j.track);if(['running','queued'].includes(j.status)){j.status='interrupted';j.error='Server restarted. Retry this track.';}if(j.status==='done'&&!j.coverEmbedded){j.retagOnly=true;j.status='queued';}}
let saveChain=Promise.resolve();
function save(){saveChain=saveChain.catch(()=>{}).then(async()=>{await writeFile(join(data,'jobs.tmp'),JSON.stringify(jobs,null,2));await rename(join(data,'jobs.tmp'),join(data,'jobs.json'));});return saveChain;}
let active=false;
let dependenciesPromise;
function dependencies(){
 return dependenciesPromise ||=Promise.allSettled([run(ytdlp,['--version']),run('ffmpeg',['-version']),run(python,['-c','import mutagen'])]).then(results=>({ytdlp:results[0].status==='fulfilled',ffmpeg:results[1].status==='fulfilled',tagger:results[2].status==='fulfilled'}));
}
async function writeCollection(folder,batch){
 const collectionJobs=jobs.filter(x=>x.batch===batch),complete=collectionJobs.filter(x=>x.status==='done');
 await writeFile(join(folder,'playlist.m3u8'),'#EXTM3U\n'+complete.map(x=>`#EXTINF:${Math.round(x.track.duration)||-1},${x.track.artist} - ${x.track.title}\n${x.filename}.${x.format}`).join('\n')+'\n');
 await writeFile(join(folder,'manifest.json'),JSON.stringify({collection:collectionJobs[0]?.collection||{},tracks:collectionJobs},null,2));
}
async function queue(){
 if(active)return;active=true;
 try {for(let j;j=jobs.find(x=>x.status==='queued');){
  j.status='running';delete j.error;await save();const folder=join(output,j.batch);
  try{
   const base=join(folder,j.filename);await mkdir(dirname(base),{recursive:true});
   let existing=false;try{await access(base+'.'+j.format);existing=true;}catch{}
   if(!j.retagOnly&&!existing){
    const args=['--ignore-config','--js-runtimes','node','--no-playlist','--no-overwrites','--no-progress','--newline','--socket-timeout','20','--retries','2','-x','--audio-format',j.format,'--audio-quality',j.format==='mp3'?'320K':'0','--write-thumbnail','--convert-thumbnails','jpg','--write-info-json','--embed-metadata','-o',base+'.%(ext)s','--',j.track.source];
    await run(ytdlp,args,{timeout:600000});
   }
   await finishAudio(j,{folder,root,python});
   if(j.track.origin==='youtube'){
    const corrected=trackFilename(j.track,j.totalDiscs>1);
    if(corrected!==j.filename&&!existsSync(join(folder,corrected+'.'+j.format))){
     await mkdir(dirname(join(folder,corrected)),{recursive:true});await rename(join(folder,j.filename+'.'+j.format),join(folder,corrected+'.'+j.format));j.filename=corrected;
     if(j.artwork){const renamedArt='Artwork/'+corrected.replaceAll('/',' - ')+'.jpg';await rename(join(folder,j.artwork),join(folder,renamedArt));j.artwork=renamedArt;}
    }
   }
   j.file=`${j.batch}/${j.filename}.${j.format}`;j.status='done';delete j.retagOnly;
  }catch(e){j.status='failed';j.error=e.message;}
  await writeCollection(folder,j.batch).catch(()=>{});await save();
 }}finally{active=false;}
}
async function body(req){let b='';for await(const part of req){b+=part;if(b.length>2000000)throw Error('Request exceeds 2 MB.');}return JSON.parse(b||'{}');}
async function remote(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`Provider returned HTTP ${r.status}${r.status===403?'. Spotify permits playlist items only for owners/collaborators; import an exported JSON instead.':''}${r.status===429?'. Rate limited; try again later.':''}`);return r;}
async function importSpotify(input,token){
 const {type,id}=spotifyId(input);
 if(!token){const r=await remote(`https://open.spotify.com/embed/${type}/${id}`);return parseEmbed(await r.text());}
 const api=async u=>{if(!u.startsWith('https://api.spotify.com/v1/'))throw Error('Invalid pagination URL.');return (await remote(u,{headers:{Authorization:`Bearer ${token}`}})).json();};
 const entity=await api(`https://api.spotify.com/v1/${type}s/${id}`);
 if(type==='track')return {name:entity.name,type,origin:'spotify',cover:bestImage(entity.album||{}),tracks:[normalizeTrack({...entity,origin:'spotify'})]};
 let page=type==='playlist'?(entity.items||entity.tracks):entity.tracks;
 if(!page)page=await api(`https://api.spotify.com/v1/${type}s/${id}/${type==='playlist'?'items':'tracks'}?limit=50`);
 const tracks=[];let pages=0;
 do{for(const t of page.items||[]){const track=t.track||t.item||t;if(track&&track.type!=='episode')tracks.push(normalizeTrack({...track,origin:'spotify',...(type==='album'?{album:entity}:{} )},tracks.length));}if(++pages>500)throw Error('Playlist pagination limit exceeded.');page=page.next?await api(page.next):null;}while(page);
 return {name:entity.name,type,origin:'spotify',artist:entity.artists?.map(a=>a.name).join(', ')||'',date:entity.release_date||'',cover:bestImage(entity),tracks};
}
const server=http.createServer(async(req,res)=>{
 const json=(s,v)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
 try{
  if(!allowedHosts.has(req.headers.host))return json(403,{error:'Invalid host'});
  if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))return json(403,{error:'Invalid origin'});
  const url=new URL(req.url,origin),p=url.pathname;
  if(req.method==='GET'&&p==='/api/status'){
   return json(200,{jobs,data,dependencies:await dependencies()});
  }
  if(req.method==='POST'&&p==='/api/import'){const b=await body(req);
   if(/^(?:https?:\/\/)?(?:www\.|music\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(b.url||'')){
    const link=youtubeLink(b.url);const result=JSON.parse(await run(ytdlp,['--ignore-config','--js-runtimes','node','--flat-playlist','--yes-playlist','--ignore-errors','--playlist-end','1000','--dump-single-json','--no-warnings','--',link.url],{timeout:180000}));
    const collection=parseYouTube(result,link);if(!collection.tracks.length)throw Error('No playable entries returned by YouTube.');if(collection.tracks.length>=1000)collection.warning='Imported the first 1000 entries. Split larger playlists before importing.';return json(200,collection);
   }
   let parsed;try{parsed=new URL(b.url);}catch{throw Error('Paste a full song or playlist URL.');}
   if(parsed.hostname==='open.spotify.com')return json(200,await importSpotify(b.url,String(b.token||process.env.SPOTIFY_ACCESS_TOKEN||'')));
   const source=await publicUrl(parsed.href);
   const result=JSON.parse(await run(ytdlp,['--ignore-config','--js-runtimes','node','--no-playlist','--dump-single-json','--no-warnings','--',source],{timeout:180000}));
   const title=result.track||result.title;if(!title)throw Error('Could not read a song from that link. Try a Spotify, YouTube, SoundCloud, or Bandcamp track URL.');
   const artist=result.artist||result.artists?.join(', ')||result.uploader||result.channel||'';
   const track=normalizeTrack({id:result.id||source,title,artist,duration:result.duration,source,origin:'direct',album:result.album||'',albumArtist:result.album_artist||artist,date:result.release_date||String(result.release_year||''),trackNumber:result.track_number||1,cover:bestImage(result)});
   return json(200,{name:title,type:'track',origin:'direct',artist,cover:track.cover,tracks:[track]});}
  if(req.method==='POST'&&p==='/api/search'){
   const b=await body(req);if(!['youtube','soundcloud'].includes(b.provider))throw Error('Unknown search provider');
   const prefix=b.provider==='youtube'?'ytsearch5:':'scsearch5:';
   const result=JSON.parse(await run(ytdlp,['--ignore-config','--flat-playlist','--dump-single-json','--no-warnings','--',prefix+String(b.query).slice(0,500)]));
   return json(200,{matches:(result.entries||[]).map(t=>({title:t.title,artist:t.uploader||t.channel||'',duration:t.duration||0,url:t.webpage_url||(b.provider==='youtube'?`https://www.youtube.com/watch?v=${t.id}`:t.url)}))});
  }
  if(req.method==='POST'&&p==='/api/download'){
   const b=await body(req);if(!['mp3','flac','m4a','opus'].includes(b.format))throw Error('Unsupported format');
   if(!Array.isArray(b.tracks)||!b.tracks.length||b.tracks.length>1000)throw Error('Select 1–1000 matched tracks.');
   const tracks=b.tracks.map(normalizeTrack);for(const t of tracks)await publicUrl(t.source);
   const collection={name:String(b.name||'Untitled'),type:b.type||'playlist',artist:String(b.artist||''),date:String(b.date||''),cover:String(b.cover||''),origin:String(b.origin||'')};
   const desired=collectionFolder({...collection,tracks});let batch=desired,suffix=1;
   while(jobs.some(j=>j.batch===batch)||existsSync(join(output,batch)))batch=desired+' ('+(++suffix)+')';
   const multidisc=tracks.some(t=>t.discNumber>1),totalDiscs=Math.max(...tracks.map(t=>t.discNumber));
   const names=new Set();const added=tracks.map((track,i)=>{
    let filename=trackFilename(track,multidisc);if(names.has(filename))filename+=' ('+(i+1)+')';names.add(filename);
    return {id:randomUUID(),batch,collection,track,format:b.format,filename,totalTracks:Number(b.discTracks?.[track.discNumber])||Number(b.totalTracks)||Math.max(...tracks.map(t=>t.trackNumber)),totalDiscs,status:'queued'};
   });
   jobs.push(...added);await save();void queue();return json(200,{jobs:added});
  }
  if(req.method==='POST'&&p==='/api/retry'){const b=await body(req);const j=jobs.find(j=>j.id===b.id);if(!j||!['failed','interrupted',...(b.retag?['done']:[])].includes(j.status))throw Error('Job cannot be retried.');if(b.retag)j.retagOnly=true;if(b.track){const edited=normalizeTrack({...j.track,...b.track});await publicUrl(edited.source);j.track=edited;}j.status='queued';delete j.error;await save();void queue();return json(200,{ok:true});}
  if(req.method==='GET'&&p.startsWith('/zip/')){
   const batch=decodeURIComponent(p.slice(5));const done=jobs.filter(j=>j.batch===batch&&j.status==='done');
   if(!done.length)return json(404,{error:'No completed files for this batch'});
   const folder=resolve(output,batch);if(!folder.startsWith(output+'/'))throw Error('Invalid batch');
   const archive=join(folder,'playlist.zip');
   await run(python,['-c',"import sys,zipfile,os,uuid; root=sys.argv[1]; temp=sys.argv[2]+'.'+uuid.uuid4().hex+'.tmp'; z=zipfile.ZipFile(temp,'w',zipfile.ZIP_STORED); [z.write(os.path.join(root,n),n) for n in sys.argv[3:]]; z.close(); os.replace(temp,sys.argv[2])",folder,archive,...new Set(done.flatMap(j=>[j.filename+'.'+j.format,...(j.artwork?[j.artwork]:[])])),'cover.jpg','playlist.m3u8','manifest.json'],{timeout:120000});
   res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(batch+'.zip')}`});return createReadStream(archive).pipe(res);
  }
  if(req.method==='GET'&&p.startsWith('/files/')){
   const relative=decodeURIComponent(p.slice(7));const file=resolve(output,relative);if(!file.startsWith(output+'/'))return json(403,{error:'Invalid path'});
   if(!jobs.some(j=>j.status==='done'&&(j.file===relative||relative===`${j.batch}/playlist.m3u8`||relative===`${j.batch}/manifest.json`||relative===`${j.batch}/cover.jpg`||relative===`${j.batch}/${j.artwork}`)))return json(404,{error:'File not found'});
   await readFile(file);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.split('/').pop())}`});return createReadStream(file).pipe(res);
  }
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(p)){const file=p==='/'?'index.html':p.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html':file.endsWith('css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});return res.end(await readFile(join(root,'public',file)));}
  return json(404,{error:'Not found'});
 }catch(e){return json(400,{error:e.message});}
});server.listen(port,bindAddress,()=>{console.log(`OpenCrate → ${publicOrigin||origin}\nDownloads → ${output}`);void queue();});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'OpenCrate is already running on this port.':e.message);process.exitCode=1;});
