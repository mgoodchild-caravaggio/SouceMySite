import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import { AuthGate } from './components/AuthGate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>{(session) => <App userEmail={session.user.email ?? ''} />}</AuthGate>
  </React.StrictMode>,
);
