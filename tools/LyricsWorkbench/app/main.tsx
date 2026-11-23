import { createRoot } from 'react-dom/client';
import Workbench from './page';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('页面根节点不存在。');

createRoot(root).render(<Workbench />);
