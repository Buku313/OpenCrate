import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {run} from '../core.mjs';
test('MP3, FLAC, M4A, and Opus retain exact tags and embedded front covers without changing decoded audio',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencrate-tags-')),python=resolve('.venv/bin/python');
 try{
  const cover=join(dir,'cover.jpg');await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=300x300','-frames:v','1',cover]);
  const metadata=join(dir,'tags.json');await writeFile(metadata,JSON.stringify({title:'Title: 100% — café',artist:'Artist',album:'Album',albumArtist:'Album Artist',date:'2024-02-01',genre:'Electronic',trackNumber:7,totalTracks:12,discNumber:2,totalDiscs:2,collection:'My playlist'}));
  for(const [format,codec] of [['mp3','libmp3lame'],['flac','flac'],['m4a','aac'],['opus','libopus']]){
   const audio=join(dir,'audio.'+format);await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.3','-c:a',codec,audio]);
   const digest=()=>run('ffmpeg',['-v','error','-i',audio,'-map','0:a:0','-f','md5','-']);const before=await digest();
   await run(python,['scripts/tag_audio.py',audio,cover,metadata]);assert.equal(await digest(),before,format+' audio changed');
   const report=JSON.parse(await run(python,['-c',`import sys,json,base64; from mutagen import File; from mutagen.flac import Picture; a=File(sys.argv[1]); ext=sys.argv[1].split('.')[-1]; t=a.tags
if ext=='mp3': title=str(t['TIT2']); album=str(t['TALB']); artist=str(t['TPE2']); track=str(t['TRCK']); cover=bool(t.getall('APIC'))
elif ext=='m4a': title=t['\\xa9nam'][0]; album=t['\\xa9alb'][0]; artist=t['aART'][0]; track=str(t['trkn'][0][0])+'/'+str(t['trkn'][0][1]); cover=bool(t['covr'])
else: title=t['title'][0]; album=t['album'][0]; artist=t['albumartist'][0]; track=t['tracknumber'][0]+'/'+t['tracktotal'][0]; cover=bool(a.pictures) if ext=='flac' else Picture(base64.b64decode(t['metadata_block_picture'][0])).type==3
print(json.dumps(dict(title=title,album=album,artist=artist,track=track,cover=cover)))`,audio]));
   assert.deepEqual(report,{title:'Title: 100% — café',album:'Album',artist:'Album Artist',track:'7/12',cover:true},format);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
