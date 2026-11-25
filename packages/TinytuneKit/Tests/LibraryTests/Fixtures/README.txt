Generated silence (no third-party audio). Sample rate: 44.1 kHz, mono.
Numbered.m4a: AAC with iTunes trkn 1/12 and disk 2/2.
Numbered.mp3: MP3 with ID3 TRCK 3/12 and TPOS 2/3.
Numbered.flac: FLAC with Vorbis TRACKNUMBER=3/12 and DISCNUMBER=2/3.
These fixtures exercise AVFoundation's actual metadata parsing without requiring ffmpeg at test time.
AlbumCredit.m4a: copy of generated AAC silence with artist Beyoncé and album artist 精选.
Review-base.m4a, Review-explicit.m4a, Review-broken-tag.m4a: the same generated AAC silence with artist Original, respectively without an album credit, with an explicit identical credit, and with a malformed legacy-style credit.
