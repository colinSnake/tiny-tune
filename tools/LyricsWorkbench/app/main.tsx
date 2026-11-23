import { createRoot } from 'react-dom/client';
import SongDownload from './song-download';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('页面根节点不存在。');

// Old links open the inline tools without switching to a separate view.
const url = new URL(location.href);
const legacyTools = url.searchParams.get('view') === 'lyrics';
if (legacyTools) {
  url.searchParams.delete('view');
  url.hash = 'local-lyrics';
  history.replaceState(history.state, '', url);
}
createRoot(root).render(<SongDownload showLocalLyrics={url.hash === '#local-lyrics'} />);
