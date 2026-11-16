// PLAYERS' TUNNEL: a telescopic athletes' tunnel run out from the stand behind the circle across the outer lanes, as
// real stadiums do for introductions. Steel arch ribs, dark fabric with an accent stripe, a lit header, a glowing
// back wall to silhouette the athlete. The walk-out starts in here. Same ring maths as the stands, so it sits flush
// against the wall in both venues. Generic signage only: no event, sponsor or federation marks.
import * as THREE from 'three';
import { ringPoint, makeCanvas, toTexture, GeoBuilder, mat4 } from './util.js';
import { font } from './field.js';

export const TUNNEL = { t: 2.95, back: 11.9, mouth: 6.4, w: 3.1, h: 2.75 };

/** The tunnel's frame in three.js space: back (against the stand), mouth (on the track), dir (back -> mouth, unit). */
export function tunnelFrame() {
  const back = ringPoint(TUNNEL.t, TUNNEL.back, new THREE.Vector3());
  const mouth = ringPoint(TUNNEL.t, TUNNEL.mouth, new THREE.Vector3());
  const dir = mouth.clone().sub(back);
  const len = dir.length();
  dir.divideScalar(len);
  const side = new THREE.Vector3(-dir.z, 0, dir.x); // right-hand side looking out of the tunnel
  return { back, mouth, dir, side, len };
}

function paintHeader(W, H, sub) {
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ff8a1f';
  g.fillRect(0, H * 0.84, W, H * 0.16);
  g.fillStyle = '#f4f1e8';
  g.font = font(H * 0.46);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ATHLETES', W / 2, H * 0.4);
  g.fillStyle = '#9aa3b2';
  g.font = font(H * 0.16);
  g.fillText(sub, W / 2, H * 0.71);
  return c;
}

export function buildTunnel(ctx) {
  const { root, keep, venue } = ctx;
  const F = tunnelFrame();
  const L = F.len;
  const { w, h } = TUNNEL;
  const grp = new THREE.Group();
  grp.position.copy(F.back);
  grp.rotation.y = Math.atan2(F.dir.x, F.dir.z); // local +z = out of the tunnel
  root.add(grp);
  // arch profile: a flattened half ellipse
  const arch = (n, inset = 0) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      pts.push([Math.cos(a) * (w / 2 - inset), Math.sin(a) * (h - inset)]);
    }
    return pts;
  };
  // fabric shell: an extruded arch, open at the mouth, seen from inside and out
  const prof = arch(18);
  const segZ = 6;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let k = 0; k <= segZ; k++) {
    const z = (k / segZ) * L;
    prof.forEach(([x, y], i) => {
      // the fabric sags a little between ribs
      const sag = 0.04 * Math.sin(((k * 1.0) / segZ) * Math.PI * segZ) ** 2;
      pos.push(x * (1 - sag * 0.2), y - sag, z);
      uv.push(i / (prof.length - 1), z / L);
    });
  }
  const P = prof.length;
  for (let k = 0; k < segZ; k++)
    for (let i = 0; i < P - 1; i++) {
      const a = k * P + i;
      idx.push(a, a + 1, a + P, a + 1, a + P + 1, a + P);
    }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shellGeo.setIndex(idx);
  shellGeo.computeVertexNormals();
  // fabric: dark navy with an accent band along the crown
  const { c: fc, g: fg } = makeCanvas(256, 64);
  fg.fillStyle = '#141a26';
  fg.fillRect(0, 0, 256, 64);
  fg.fillStyle = '#ff8a1f';
  fg.fillRect(118, 0, 20, 64);
  fg.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < 256; x += 8) fg.fillRect(x, 0, 1, 64);
  const fabTex = toTexture(fc, { aniso: 4 });
  const fabric = new THREE.Mesh(shellGeo, keep(new THREE.MeshStandardMaterial({ map: fabTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })));
  fabric.name = 'tunnel-fabric';
  grp.add(fabric);
  // steel ribs + floor runners
  const gb = new GeoBuilder();
  const steel = new THREE.Color(0x8d969e);
  const ribs = Math.max(4, Math.round(L / 0.9));
  for (let r = 0; r <= ribs; r++) {
    const z = (r / ribs) * L;
    const pts = arch(14, -0.04);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      gb.add(new THREE.BoxGeometry(0.07, len + 0.02, 0.07), mat4((x0 + x1) / 2, (y0 + y1) / 2, z, 0, 1, 1, 1, 0, Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2), steel);
    }
  }
  for (const s of [-1, 1]) gb.add(new THREE.BoxGeometry(0.12, 0.1, L), mat4(s * (w / 2), 0.05, L / 2), new THREE.Color(0x30353c));
  // rubber floor mat
  gb.add(new THREE.BoxGeometry(w - 0.2, 0.025, L + 0.6), mat4(0, 0.0125, L / 2 + 0.3), new THREE.Color(0x1b1d21));
  const ribMesh = new THREE.Mesh(gb.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 })));
  ribMesh.name = 'tunnel-ribs';
  grp.add(ribMesh);
  // glowing back wall (silhouettes the athlete coming out) + a strip of ceiling lamps
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.2), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.45) })));
  glow.position.set(0, (h - 0.2) / 2, 0.06);
  grp.add(glow);
  const lampG = new THREE.BoxGeometry(0.5, 0.04, 0.16);
  const lampM = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.6) }));
  const lamps = new THREE.InstancedMesh(lampG, lampM, 4);
  for (let i = 0; i < 4; i++) lamps.setMatrixAt(i, mat4(0, h - 0.06, 0.8 + (i / 3) * (L - 1.6)));
  grp.add(lamps);
  // lit header over the mouth
  const hdrTex = toTexture(paintHeader(512, 128, venue === 'world' ? 'MERIDIAN GAMES' : 'KESTREL STATE'), { aniso: 8 });
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.62, 0.16), [
    keep(new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.6 })),
    keep(new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.6 })),
    keep(new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.6 })),
    keep(new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.6 })),
    keep(new THREE.MeshBasicMaterial({ map: hdrTex, color: new THREE.Color(1.6, 1.6, 1.6) })),
    keep(new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.6 })),
  ]);
  hdr.position.set(0, h + 0.28, L + 0.02);
  grp.add(hdr);
  ctx.contacts.push([F.mouth.x, F.mouth.z, 2.2, 1.0, 0, 0.4]);
  return { frame: F, group: grp, glowMat: glow.material };
}
