import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import { AuthGate } from './components/AuthGate';
import UnsubscribePage from './pages/UnsubscribePage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* The unsubscribe page is public: people follow it from campaign emails without a Hub account. */}
    {window.location.pathname === '/unsubscribe' ? <UnsubscribePage /> : <AuthGate>{(session) => <App session={session} />}</AuthGate>}
  </React.StrictMode>,
);
