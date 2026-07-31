import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('elemento #root não encontrado no index.html');
createRoot(rootEl).render(<App />);
