import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

// Регистрация SW (vite-plugin-pwa)
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
