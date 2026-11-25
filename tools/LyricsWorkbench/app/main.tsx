import { createRoot } from 'react-dom/client';
import Workbench from './workbench';
import './styles.css';
import './workbench.css';

const root = document.getElementById('root');
if (!root) throw new Error('页面根节点不存在。');
createRoot(root).render(<Workbench />);
