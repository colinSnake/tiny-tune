#!/usr/bin/env python3
"""Create tiny original PCM test tones. Refuses to overwrite an existing directory."""
import argparse
import math
import struct
import wave
from pathlib import Path


def tone(path: Path, frequency: int, duration: int) -> None:
    rate = 22050
    samples = bytearray()
    for index in range(rate * duration):
        envelope = min(1, index / 550, (rate * duration - index) / 550)
        samples.extend(struct.pack('<h', int(800 * envelope * math.sin(2 * math.pi * frequency * index / rate))))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(samples)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    tone(args.output / 'Daybreak' / 'In the Quiet' / '01 First Light.wav', 392, 24)
    tone(args.output / 'Daybreak' / 'In the Quiet' / '02 Glass Lake (Live).wav', 440, 22)
    tone(args.output / 'Field Notes' / 'Coastline' / '01 Distant Tide.wav', 330, 19)
    (args.output / 'broken.mp3').write_text('This is not an audio file.\n', encoding='utf-8')
    print(f'Created 3 synthetic songs and 1 intentionally invalid file in {args.output}')


if __name__ == '__main__':
    main()
