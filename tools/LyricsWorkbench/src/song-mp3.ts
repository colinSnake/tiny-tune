const mpeg1Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

// Count the actual frames, not the advertised Xing/Info duration (a truncated file may still contain it).
export function mp3Duration(bytes: Buffer): number | null {
  let pos = 0;
  let end = bytes.length;
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') {
    if (end < 10 || bytes[3] < 2 || bytes[3] > 4 || bytes.subarray(6, 10).some(n => n > 127)) return null;
    pos = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    if (bytes[3] === 4 && (bytes[5] & 0x10)) pos += 10;
  }
  if (end - pos >= 128 && bytes.toString('ascii', end - 128, end - 125) === 'TAG') end -= 128;
  let frames = 0, sampleRate = 0, samples = 0;
  while (pos + 4 <= end) {
    const b = bytes[pos + 1], c = bytes[pos + 2];
    const version = (b >> 3) & 3;
    const layer = (b >> 1) & 3;
    const rate = (version === 3 ? mpeg1Rates : mpeg2Rates)[c >> 4];
    const base = [44100, 48000, 32000][(c >> 2) & 3];
    if (bytes[pos] !== 255 || (b & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || !rate || !base) return null;
    const hz = base / (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (sampleRate && hz !== sampleRate) return null;
    sampleRate = hz;
    const frame = Math.floor((version === 3 ? 144000 : 72000) * rate / hz) + ((c >> 1) & 1);
    pos += frame;
    samples += version === 3 ? 1152 : 576;
    frames++;
  }
  return pos === end && frames >= 3 ? samples / sampleRate : null;
}
