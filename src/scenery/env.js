// ENVIRONMENT LIGHT: a tiny procedural night stadium (sky gradient, a ring of hot floodlight banks, the lit bowl of the
// stands, dark turf below) prefiltered once with PMREM. Standard materials then get image-based ambient and real
// reflections: the cage steel, the discus rim, a sweaty shoulder and wet track all pick up the floodlights.
// Built once per look (night / golden hour), a few milliseconds each; nothing per frame.
import * as THREE from 'three';

function envScene(look) {
  const sc = new THREE.Scene();
  const sunset = look === 'sunset';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false }));
  const pos = dome.geometry.attributes.position;
  const cols = [];
  const top = sunset ? new THREE.Color(0.06, 0.1, 0.24) : new THREE.Color(0.004, 0.007, 0.02);
  const hor = sunset ? new THREE.Color(0.9, 0.42, 0.2) : new THREE.Color(0.05, 0.04, 0.035);
  const stands = sunset ? new THREE.Color(0.32, 0.22, 0.16) : new THREE.Color(0.09, 0.07, 0.055);
  const turf = sunset ? new THREE.Color(0.09, 0.11, 0.05) : new THREE.Color(0.02, 0.035, 0.015);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 50;
    if (h < -0.02) c.copy(turf);
    else if (h < 0.22) c.copy(stands).lerp(hor, h / 0.22);
    else c.copy(hor).lerp(top, Math.min(1, (h - 0.22) / 0.5));
    cols.push(c.r, c.g, c.b);
  }
  dome.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  sc.add(dome);
  // six floodlight banks (unevenly spaced, like the real towers) and a warm low sun at golden hour
  const lampMat = new THREE.MeshBasicMaterial({ color: sunset ? new THREE.Color(3, 2.6, 2.2) : new THREE.Color(9, 7.6, 6), fog: false });
  const az = [-2.6, -1.55, -0.45, 0.6, 1.65, 2.55];
  for (const a of az) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 4), lampMat);
    q.position.set(Math.sin(a) * 40, 26, Math.cos(a) * 40);
    q.lookAt(0, 0, 0);
    sc.add(q);
  }
  if (sunset) {
    const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 18, 7), fog: false }));
    sun.position.set(-0.66, 0.2, -0.72).normalize().multiplyScalar(45);
    sun.lookAt(0, 0, 0);
    sc.add(sun);
  }
  return sc;
}

export function buildEnv(renderer) {
  const cache = {};
  const pm = new THREE.PMREMGenerator(renderer);
  return {
    /** The prefiltered environment for a look ('night' | 'sunset'), built on first use. */
    get(look = 'night') {
      if (!cache[look]) {
        const sc = envScene(look);
        cache[look] = pm.fromScene(sc, 0.02, 0.1, 100);
        sc.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
      return cache[look].texture;
    },
    dispose() {
      Object.values(cache).forEach((rt) => rt.dispose());
      pm.dispose();
    },
  };
}
