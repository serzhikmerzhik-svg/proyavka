import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './index.css';
import { initTheme } from './ui/theme';
import Archive from './pages/Archive';
import Expose from './pages/Expose';
import Develop from './pages/Develop';
import Lab from './pages/Lab';
import LabMusic from './pages/LabMusic';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* на GitHub Pages сайт живёт в подпапке репозитория */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, '') || undefined}>
      <Routes>
        <Route path="/" element={<Archive />} />
        <Route path="/new" element={<Expose />} />
        <Route path="/day/:id" element={<Develop />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/lab/music" element={<LabMusic />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
