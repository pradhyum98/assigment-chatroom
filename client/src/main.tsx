import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store'
import App from './App'
import { socketService } from './services/socket';
import { syncEngine } from './services/SyncEngine';

// @ts-ignore
if (process.env.TEST_HARNESS === 'true') {
  (window as any).__redux_store__ = store;
  (window as any).__socket_service__ = socketService;
  (window as any).__sync_engine__ = syncEngine;
  console.log('[DEBUG] Exposed test hooks on window: __redux_store__, __socket_service__, __sync_engine__');
}


import './index.css'

import platformService from './platform/PlatformService';

if (!platformService.getCapabilities().isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('SW registered: ', registration);
    }).catch((registrationError) => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
)
