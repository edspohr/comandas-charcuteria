import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
// Capture the install prompt as early as possible (InstallButton).
import './lib/install';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
