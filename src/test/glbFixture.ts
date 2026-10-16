/** Build a minimal, valid GLB (glTF 2.0 binary) containing one box mesh – for tests. */
export function boxGlb(w: number, h: number, d: number): Uint8Array<ArrayBuffer> {
  const x = w / 2;
  const z = d / 2;
  const pos = new Float32Array([-x, 0, -z, x, 0, -z, x, h, -z, -x, h, -z, -x, 0, z, x, 0, z, x, h, z, -x, h, z]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength + ((4 - (idx.byteLength % 4)) % 4));
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'wohnungsplaner-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-x, 0, -z], max: [x, h, z] },
      { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(jsonBytes.length + pad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.length, bin.byteLength, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.length);
  return out;
}
