import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {run} from '../core.mjs';
test('real tagged audio, artwork, nested album folders, ZIP/M3U, YouTube import, and restart persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencrate-test-'));const bin=join(dir,'fake-ytdlp');
 await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a','libmp3lame',join(dir,'audio.mp3')]);
 await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=300x300','-frames:v','1',join(dir,'art.jpg')]);
 await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),path=require('path');const a=process.argv.slice(2);if(a.includes('--version')){console.log('fixture');process.exit(0)}
if(a.includes('--dump-single-json')){console.log(JSON.stringify({title:'YouTube fixture',entries:[{id:'pMoGZqsm1QM',title:'One',uploader:'Artist - Topic',playlist_index:3}]}));process.exit(0)}
const out=a[a.indexOf('-o')+1].replace('%(ext)s','mp3'),base=out.slice(0,-4);fs.copyFileSync(path.join(__dirname,'audio.mp3'),out);fs.copyFileSync(path.join(__dirname,'art.jpg'),base+'.jpg');fs.writeFileSync(base+'.info.json',JSON.stringify({track:'Clean Title',artist:'Artist',album:'Source album',duration:0.2}));`,{mode:0o755});
 const port=14873,base=`http://127.0.0.1:${port}`;let child,stderr='';
 function start(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OPENCRATE_DATA:dir,YTDLP_BIN:bin},stdio:'pipe'});child.stderr.on('data',b=>stderr+=b);}
 async function ready(){for(let n=0;n<100;n++){try{const r=await fetch(base+'/api/status');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Test server did not start: '+stderr);}
 async function post(path,b){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});}
 try{start();await ready();
  assert.equal((await fetch(base+'/api/status',{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await post('/api/download',{name:'Bad',format:'mp3',tracks:[{title:'Bad',source:'http://127.0.0.1/secret'}]})).status,400);
  const imported=await (await post('/api/import',{url:'https://music.youtube.com/playlist?list=PLabcdefghijk'})).json();assert.equal(imported.tracks[0].trackNumber,3);assert.equal(imported.tracks[0].source,'https://www.youtube.com/watch?v=pMoGZqsm1QM');
  const response=await post('/api/download',{name:'Test',type:'album',artist:'Artist',date:'2024',format:'mp3',totalTracks:9,tracks:[{title:'One',artist:'Artist',album:'Test',albumArtist:'Artist',date:'2024',trackNumber:7,discNumber:2,source:'https://93.184.216.34/audio.mp3'}]});assert.equal(response.status,200,await response.clone().text());const {jobs:added}=await response.json();
  let job;for(let n=0;n<180;n++){job=(await (await fetch(base+'/api/status')).json()).jobs[0];if(job.status==='done'||job.status==='failed')break;await new Promise(r=>setTimeout(r,50));}assert.equal(job.status,'done',job.error);assert.equal(job.coverEmbedded,true);assert.equal(job.batch,'Albums/Artist/2024 - Test');assert.match(job.file,/Disc 02\/07 - Artist - One.mp3/);
  const probe=JSON.parse(await run('ffprobe',['-v','error','-show_entries','format_tags:stream_disposition=attached_pic','-of','json',join(dir,'downloads',job.file)]));assert.equal(probe.format.tags.title,'One');assert.equal(probe.format.tags.artist,'Artist');assert.equal(probe.format.tags.album,'Test');assert.equal(probe.format.tags.track,'7/9');assert(probe.streams.some(s=>s.disposition.attached_pic===1));
  const file=await fetch(base+'/files/'+encodeURI(job.file));assert.equal(file.status,200);assert((await file.arrayBuffer()).byteLength>1000);
  const m3u=await (await fetch(base+'/files/'+encodeURIComponent(job.batch)+'/playlist.m3u8')).text();assert.match(m3u,/#EXTM3U/);assert.match(m3u,/Disc 02\/07 - Artist - One.mp3/);
  const cover=await fetch(base+'/files/'+encodeURIComponent(job.batch)+'/cover.jpg');assert.equal(cover.status,200);
  const zip=await fetch(base+'/zip/'+encodeURIComponent(job.batch));assert.equal(zip.status,200);const zipData=Buffer.from(await zip.arrayBuffer());assert.equal(zipData.subarray(0,2).toString(),'PK');assert(zipData.includes(Buffer.from('cover.jpg')));assert(zipData.includes(Buffer.from(job.artwork)));
  assert.equal((await fetch(base+'/files/'+encodeURIComponent('../jobs.json'))).status,403);
  const youtubeDownload=await post('/api/download',{name:'YouTube Test',format:'mp3',tracks:[{title:'Video title (Official Audio)',artist:'Uploader',origin:'youtube',trackNumber:2,source:'https://93.184.216.34/audio.mp3'}]});assert.equal(youtubeDownload.status,200);
  let youtubeJob;for(let n=0;n<180;n++){youtubeJob=(await (await fetch(base+'/api/status')).json()).jobs[1];if(youtubeJob.status==='done'||youtubeJob.status==='failed')break;await new Promise(r=>setTimeout(r,50));}assert.equal(youtubeJob.status,'done',youtubeJob.error);assert.match(youtubeJob.file,/02 - Artist - Clean Title.mp3/);assert.equal(youtubeJob.artwork,'Artwork/02 - Artist - Clean Title.jpg');
  const retag=await post('/api/retry',{id:job.id,retag:true,track:{...job.track,title:'Updated title'}});assert.equal(retag.status,200);
  for(let n=0;n<180;n++){job=(await (await fetch(base+'/api/status')).json()).jobs[0];if(job.status==='done'||job.status==='failed')break;await new Promise(r=>setTimeout(r,50));}assert.equal(job.status,'done',job.error);assert.equal(job.track.title,'Updated title');assert.equal(job.coverEmbedded,true);
  child.kill();await new Promise(r=>child.once('exit',r));start();await ready();assert.equal((await (await fetch(base+'/api/status')).json()).jobs[0].id,added[0].id);
 }finally{if(child&&!child.killed){child.kill();await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
