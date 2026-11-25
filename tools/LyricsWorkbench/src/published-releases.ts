import type { SongSummary } from './song-types';

export type PublishedTrack = Omit<SongSummary, 'provider' | 'availability'> & {
  sourceUrl: string; rightsUrl: string; licenseUrl: string; lyricSourceUrl: string;
  lyricsFormat?: 'text';
  audioUrl: string; lyricsUrl: string; audioHash: string; lyricHash: string;
};

// Original recording on the songwriter's site. The FAQ grants CC BY-NC for his own music and explicitly permits sharing.
// Pin the verified recording and transcription separately; an upstream replacement must be reviewed, not silently repackaged.
const codeMonkey: PublishedTrack = {
  id: '9172651910', title: 'Code Monkey', artist: 'Jonathan Coulton', album: 'Thing a Week Three', releaseId: 'thing-a-week-three', duration: 189.31,
  sourceUrl: 'https://www.jonathancoulton.com/2006/04/14/thing-a-week-29-code-monkey/',
  rightsUrl: 'https://www.jonathancoulton.com/faq/#can-i-use-a-song-in-my-student-filmpodcastawesome-dance-remix',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/3.0/',
  lyricSourceUrl: 'https://joco.wiki.gg/wiki/Code_Monkey/Lyrics?oldid=5403',
  audioUrl: 'https://www.jonathancoulton.com/wp-content/uploads/encodes/Thing_a_Week_Three/mp3/03_Code_Monkey_mp3_118604e.mp3',
  lyricsUrl: 'https://joco.wiki.gg/api.php?action=query&prop=revisions&revids=5403&rvprop=content&rvslots=main&format=json&formatversion=2',
  audioHash: '3866a8aa2fba54bdc278e8b55b278d73f51c6cf0ad06bf1e9835c409c824d586',
  lyricHash: '051a4a2d1a053fad10b9accde8934ea3f992d04e2fc136ba6d630914a252d92a',
};


// The archive's direct MP3 links can serve Git LFS pointers. Use the archive maintainer's
// media endpoint at the release commit, and check the full bytes against each LFS object ID.
const ccArchive = 'https://web-archive-2025.creativecommons.tw';
const ccRelease = `${ccArchive}/downloads/488.html`;
const ccPath = 'freelinking/welcome_to_my_song';
const ccMedia = 'https://media.githubusercontent.com/media/ocftw/creativecommons.tw/cdee8eada95c5baa93b24d8305db495dfc724f2f';
const pigHeadSkin = ['朱约信', '朱頭皮', '朱头皮', '豬頭皮', '猪头皮', 'Pig Head Skin', 'Chu Yueh-hsin'];
function ccTrack(id: string, title: string, titles: readonly string[], duration: number, stem: string, audioHash: string, lyricHash: string): PublishedTrack {
  const lyricsUrl = `${ccArchive}/${ccPath}/${stem}.txt`;
  return { id, title, artist: '朱約信', album: '歡迎來唱我的歌', releaseId: 'cc-tw-488', duration,
    aliases: { titles, artists: pigHeadSkin }, sourceUrl: ccRelease, rightsUrl: ccRelease,
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/2.0/tw/', lyricSourceUrl: lyricsUrl,
    audioUrl: `${ccMedia}/${ccPath}/${stem}.mp3`, lyricsUrl, lyricsFormat: 'text', audioHash, lyricHash };
}

export const publishedTracks: readonly PublishedTrack[] = [
  codeMonkey,
  ccTrack('48801', '歡迎來唱我的歌', ['欢迎来唱我的歌', 'Welcome to My Song'], 244.74, '01_welcome_to_my_song_cctw',
    'c838b4998d3267073d5331729eb0305d1adec075df3ce87e1686e27a8431ac8f', '333f94092c010892ddfcc3c481271b6c701d591b180a3d143422255e6c7001ae'),
  ccTrack('48803', '痛苦的和諧', ['痛苦的和谐', '痛苦和諧', '痛苦和谐', 'Painful Harmony'], 283.51, '03_painful_armony_cctw',
    '68d324e0fcd092b47d6a4239dcc3e19526b66fcf482a531a12dd7dd5b0b16d23', 'ab8b9fc49cdc6e13826244ab9aefbe8472cdfb8d9255cedd48786533537b12d7'),
  ccTrack('48804', '天公伯仔', ['GOD!'], 221.68, '04_God_tahr',
    '2221bbdae68a32b2e446810cfccc35cf4559a8b3fa3b3f88bb551cd309071357', '6adf59a50fe03006bb629864f43b218aa6a255155668703dbf0abee7c09ee1ae'),
  ccTrack('48805', '阿輝伯仔', ['阿辉伯仔', 'A-Hui'], 189.65, '05_A_Hui_cctw',
    '2ba6ea4ecf1c62d12daa62c8a5ba05222cdcf700f1c12597244ced57439ed04a', '8b580144bef1ab72488aba9da4f76437d9f024630fb140dc80b8696c9dd89a3d'),
  ccTrack('48806', '天公伯仔 Remix', ['天公伯仔 混音', 'GOD! Remix'], 207.10, '06_God_remix_cctw',
    'a7f4999a09cef42699c0f8febb540584a30a58b61b4c817a93232cd48992a434', '1d8180cbd0dcf2c9f9e73c903ececda9bb4420c4eab046009d1dc0ecf33bddc3'),
];
