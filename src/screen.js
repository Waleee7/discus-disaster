// STADIUM SCREEN FEED: the jumbotron shows a camera feed rendered into a texture, a slow-motion replay of the throw
// just made, from a different angle than the player saw, with a REPLAY bug, and a LIVE shot of the athlete during the
// walk-out. The feed is the real scene (same athlete, same disc flight), posed at the replay moment, rendered small and
// at a reduced rate (a stadium board does not need 60 fps): every frame on desktop, every 2nd mid tier, every 3rd phone.
import * as THREE from 'three';

const W = { high: 640, mid: 512, low: 384 };

function overlayCanvas() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  return c;
}

export class StadiumScreen {
  constructor(renderer, tierName, { hdr = true } = {}) {
    this.renderer = renderer;
    const w = W[tierName] || 512;
    this.rt = new THREE.WebGLRenderTarget(w, Math.round((w * 9) / 16), { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: tierName === 'high' ? 4 : 0 });
    this.rt.texture.name = 'jumbo-feed';
    this.cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.3, 700);
    this.every = tierName === 'high' ? 1 : tierName === 'mid' ? 2 : 3;
    this.frame = 0;
    this.mode = 'frames';
    this.cv = overlayCanvas();
    this.ctx = this.cv.getContext('2d');
    this.over = new THREE.CanvasTexture(this.cv);
    this.over.colorSpace = THREE.SRGBColorSpace;
    this.label = '';
  }

  /** Point a jumbotron screen material (obstacles.js) at this feed. */
  attach(mat) {
    this.mat = mat;
    mat.uniforms.tFeed.value = this.rt.texture;
    mat.uniforms.tOver.value = this.over;
  }

  /** mode 'frames' (the board's own cards) | 'replay' | 'live'; info = the line under the bug. */
  setMode(mode, info = '') {
    if (!this.mat) return;
    this.mat.uniforms.uMode.value = mode === 'frames' ? 0 : 1;
    const key = mode + '|' + info;
    if (mode !== 'frames' && key !== this.label) this.drawBug(mode, info);
    this.label = key;
    this.mode = mode;
  }

  drawBug(mode, info) {
    const g = this.ctx;
    const Wd = 512;
    const H = 288;
    g.clearRect(0, 0, Wd, H);
    // broadcast bug, top left: red box with the word, white chip with the info
    const red = mode === 'replay' ? '#e8202a' : '#e8202a';
    g.fillStyle = red;
    g.fillRect(18, 16, mode === 'replay' ? 118 : 86, 34);
    g.fillStyle = '#ffffff';
    g.font = '700 26px Oswald, Impact, "Arial Narrow", sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    if (mode === 'live') {
      g.beginPath();
      g.arc(34, 33, 6, 0, Math.PI * 2);
      g.fill();
      g.fillText('LIVE', 46, 34);
    } else g.fillText('REPLAY', 28, 34);
    if (info) {
      g.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
      const tw = g.measureText(info).width;
      const x0 = mode === 'replay' ? 136 : 104;
      g.fillStyle = 'rgba(8,10,16,0.88)';
      g.fillRect(x0, 16, tw + 22, 34);
      g.fillStyle = '#f4f8ff';
      g.fillText(info, x0 + 11, 34);
    }
    // a thin safe-area frame and the slow-motion tag, as real boards show
    if (mode === 'replay') {
      g.fillStyle = 'rgba(8,10,16,0.75)';
      g.fillRect(Wd - 98, H - 44, 80, 28);
      g.fillStyle = '#ffd23f';
      g.font = '700 18px "JetBrains Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('SLO-MO', Wd - 58, H - 29);
    }
    this.over.needsUpdate = true;
  }

  /** Should the feed be re-rendered this frame? (reduced rate per tier) */
  due() {
    this.frame++;
    return this.mode !== 'frames' && this.frame % this.every === 0;
  }

  /** Render the scene from the feed camera into the target. The board's own screen is hidden (no feedback loop). */
  render(scene, screenMesh) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const tm = r.toneMapping;
    if (screenMesh) screenMesh.visible = false;
    r.setRenderTarget(this.rt);
    r.render(scene, this.cam);
    r.setRenderTarget(prevTarget);
    r.toneMapping = tm;
    if (screenMesh) screenMesh.visible = true;
  }

  dispose() {
    this.rt.dispose();
    this.over.dispose();
  }
}
