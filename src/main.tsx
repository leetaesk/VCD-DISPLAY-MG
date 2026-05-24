import { createRoot } from 'react-dom/client';

import App from '@/App.tsx';
import '@/index.css';

// StrictMode 잠시 비활성 — WebGL 페이지의 init/dispose/init double-mount가
// loseContext 사이드이펙트와 충돌해 ctxState 정합성이 깨지는 케이스가 있어
// 디버깅 동안 꺼둠. 필요해지면 다시 켤 것.
createRoot(document.getElementById('root')!).render(<App />);
