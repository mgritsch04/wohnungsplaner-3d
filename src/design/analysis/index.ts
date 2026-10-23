/** Stage 0, read the room (#438): what the later stages import. */
export { analyzeFlat, WAY_WIDTH } from './flat';
export { wallOutline } from './outline';
export { flatSketch, roomSketch, type SketchContext } from './sketch';
export { checkWalkways, clearanceAt, walkGrid, walkRoute, wayEnds, type WalkCheck, type WalkGrid, type WayEnd } from './walk';
