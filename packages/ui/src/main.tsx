import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { initTelemetry } from './telemetry';

// Initialize OTel before React renders so document-load span captures everything.
initTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
