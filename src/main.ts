import './styles/main.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { inject } from '@vercel/analytics';
import { App } from './App';
import { debugInjectTestEvents, debugGetCells, getCellCount } from '@/services/geo-convergence';
import { initMetaTags } from '@/services/meta-tags';
import { installRuntimeFetchPatch } from '@/services/runtime';

// Initialize Vercel Analytics
inject();

// Initialize dynamic meta tags for sharing
initMetaTags();

// In desktop mode, route /api/* calls to the local Tauri sidecar backend.
installRuntimeFetchPatch();

const app = new App('app');
app.init().catch(console.error);

// Debug helpers for geo-convergence testing (remove in production)
(window as unknown as Record<string, unknown>).geoDebug = {
  inject: debugInjectTestEvents,
  cells: debugGetCells,
  count: getCellCount,
};
