// Copies three.js' Draco decoder into public/draco so compressed GLB models
// decode locally (no request to an external CDN).
import { cpSync, mkdirSync } from 'node:fs';
const src = 'node_modules/three/examples/jsm/libs/draco/gltf';
mkdirSync('public/draco', { recursive: true });
cpSync(src, 'public/draco', { recursive: true });
