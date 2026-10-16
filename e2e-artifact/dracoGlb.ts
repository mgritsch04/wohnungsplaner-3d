import { createRequire } from 'node:module';

/**
 * Build a Draco-compressed GLB (KHR_draco_mesh_compression) with one box mesh – for the
 * artifact test (#129). Encoded in Node with the `draco3d` encoder that ships with the
 * dependencies (three-stdlib → draco3d); decoding in the app must use the bundled decoder.
 */
export async function dracoBoxGlb(w: number, h: number, d: number): Promise<Uint8Array<ArrayBuffer>> {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Emscripten module
  const draco3d = require('draco3d') as { createEncoderModule: (o: object) => Promise<any> };
  const m = await draco3d.createEncoderModule({});
  const x = w / 2;
  const z = d / 2;
  const pos = new Float32Array([-x, 0, -z, x, 0, -z, x, h, -z, -x, h, -z, -x, 0, z, x, 0, z, x, h, z, -x, h, z]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);

  const encoder = new m.Encoder();
  const builder = new m.MeshBuilder();
  const mesh = new m.Mesh();
  builder.AddFacesToMesh(mesh, idx.length / 3, idx);
  const posId: number = builder.AddFloatAttributeToMesh(mesh, m.POSITION, 8, 3, pos);
  encoder.SetEncodingMethod(m.MESH_SEQUENTIAL_ENCODING);
  encoder.SetAttributeQuantization(m.POSITION, 14);
  const encoded = new m.DracoInt8Array();
  const length: number = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
  if (!length) throw new Error('Draco encoding failed');
  const drc = new Uint8Array(length + ((4 - (length % 4)) % 4));
  for (let i = 0; i < length; i++) drc[i] = encoded.GetValue(i) & 0xff;
  m.destroy(encoded);
  m.destroy(mesh);
  m.destroy(builder);
  m.destroy(encoder);

  const json = {
    asset: { version: '2.0', generator: 'wohnungsplaner-artifact-test' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: posId } } },
          },
        ],
      },
    ],
    buffers: [{ byteLength: drc.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: length }],
    accessors: [
      { componentType: 5126, count: 8, type: 'VEC3', min: [-x, 0, -z], max: [x, h, z] },
      { componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(jsonBytes.length + pad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + drc.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.length, drc.byteLength, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(drc, 28 + jsonBytes.length);
  return out;
}
