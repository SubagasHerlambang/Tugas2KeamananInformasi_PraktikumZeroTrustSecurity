import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { createApiClient } from './api.js';
import './styles.css';

// Base URL gateway dapat diubah lewat VITE_API_BASE_URL; tidak ada secret service/gateway di bundle frontend.
const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';
createRoot(document.getElementById('root')).render(<App createClient={(opts) => createApiClient({ baseUrl, ...opts })} />);
