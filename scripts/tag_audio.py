"""Write exact library metadata and front cover without re-encoding audio."""
import json, sys
from pathlib import Path
try:
    from mutagen.id3 import ID3, TIT2, TPE1, TALB, TPE2, TRCK, TPOS, TDRC, TCON, APIC, TIT1, TXXX, ID3NoHeaderError
    from mutagen.flac import FLAC, Picture
    from mutagen.mp4 import MP4, MP4Cover
    from mutagen.oggopus import OggOpus
except ImportError:
    raise SystemExit('Cover-art tagging requires mutagen. Install yt-dlp[default] in the project environment.')
import base64

def tag(path, cover, t):
    image = Path(cover).read_bytes()
    if not image.startswith(b'\xff\xd8'):
        raise ValueError('Cover must be a valid JPEG image.')
    collection = t.get('collection', '')
    ext = Path(path).suffix.lower()
    number = (int(t.get('trackNumber', 1)), int(t.get('totalTracks', 0)))
    disc = (int(t.get('discNumber', 1)), int(t.get('totalDiscs', 1)))
    if ext == '.mp3':
        try: tags = ID3(path)
        except ID3NoHeaderError: tags = ID3()
        values = [(TIT2, t['title']), (TPE1, t['artist']), (TALB, t.get('album', '')), (TPE2, t.get('albumArtist', '')), (TDRC, t.get('date', '')), (TCON, t.get('genre', '')), (TIT1, collection), (TRCK, str(number[0]) + ('/' + str(number[1]) if number[1] else '')), (TPOS, str(disc[0]) + '/' + str(disc[1]))]
        for frame, value in values:
            tags.delall(frame.__name__)
            if value: tags.add(frame(encoding=3, text=str(value)))
        tags.delall('APIC'); tags.add(APIC(encoding=3, mime='image/jpeg', type=3, desc='Front cover', data=image))
        tags.add(TXXX(encoding=3, desc='SOURCE', text=t.get('source', '')))
        tags.save(path, v2_version=3)
    elif ext == '.m4a':
        audio = MP4(path)
        if audio.tags is None: audio.add_tags()
        for key, value in {'\xa9nam': t['title'], '\xa9ART': t['artist'], '\xa9alb': t.get('album', ''), 'aART': t.get('albumArtist', ''), '\xa9day': t.get('date', ''), '\xa9gen': t.get('genre', ''), '\xa9grp': collection}.items():
            audio.tags.pop(key, None)
            if value: audio.tags[key] = [str(value)]
        audio.tags['trkn'] = [number]; audio.tags['disk'] = [disc]
        audio.tags['covr'] = [MP4Cover(image, imageformat=MP4Cover.FORMAT_JPEG)]
        audio.save()
    elif ext in ('.flac', '.opus'):
        audio = FLAC(path) if ext == '.flac' else OggOpus(path)
        values = {'title': t['title'], 'artist': t['artist'], 'album': t.get('album', ''), 'albumartist': t.get('albumArtist', ''), 'date': t.get('date', ''), 'genre': t.get('genre', ''), 'grouping': collection, 'tracknumber': str(number[0]), 'discnumber': str(disc[0]), 'disctotal': str(disc[1]), 'source': t.get('source', '')}
        if number[1]: values['tracktotal'] = str(number[1])
        for key, value in values.items():
            audio.pop(key, None)
            if value: audio[key] = str(value)
        picture = Picture(); picture.type = 3; picture.mime = 'image/jpeg'; picture.desc = 'Front cover'; picture.data = image
        if ext == '.flac': audio.clear_pictures(); audio.add_picture(picture)
        else: audio['metadata_block_picture'] = [base64.b64encode(picture.write()).decode('ascii')]
        audio.save()
    else: raise ValueError('Unsupported audio format for artwork tagging.')
    print(json.dumps({'coverEmbedded': True, 'format': ext[1:]}))

if __name__ == '__main__':
    tag(sys.argv[1], sys.argv[2], json.loads(Path(sys.argv[3]).read_text()))
