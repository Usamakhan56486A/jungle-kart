import * as THREE from 'three';
import { ANIMALS, VEHICLES, COLORS, TRACKS, createTrack, sampleTrack, projectTrack, splitRects } from './world.js';

// Everything in this renderer is local, procedural artwork. Simulation data is read-only.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = '#ffffff';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function randomSeed(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function transform(p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) {
  const q = r.isQuaternion ? r : new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
}

// Bake primitives into one indexed, vertex-coloured mesh per material, not one draw per detail.
class Baker {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  add(g, p, s, r, color = WHITE) {
    g.applyMatrix4(transform(p, s, r));
    if (!g.attributes.normal) g.computeVertexNormals();
    const position = g.attributes.position, normal = g.attributes.normal, uv = g.attributes.uv, colors = g.attributes.color;
    const tint = new THREE.Color(color), offset = this.p.length / 3;
    for (let i = 0; i < position.count; i++) {
      this.p.push(position.getX(i), position.getY(i), position.getZ(i));
      this.n.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.c.push(tint.r * (colors ? colors.getX(i) : 1), tint.g * (colors ? colors.getY(i) : 1), tint.b * (colors ? colors.getZ(i) : 1));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.i.push(offset + g.index.getX(i));
    else for (let i = 0; i < position.count; i++) this.i.push(offset + i);
    g.dispose();
    return this;
  }
  box(p, s, color, r = [0, 0, 0]) { return this.add(new THREE.BoxGeometry(1, 1, 1), p, s, r, color); }
  ball(p, s, color, segments = 14) { return this.add(new THREE.SphereGeometry(1, segments, 10), p, s, undefined, color); }
  cone(p, s, color, r = [0, 0, 0], sides = 10) { return this.add(new THREE.ConeGeometry(1, 1, sides), p, s, r, color); }
  cylinder(p, s, color, r = [0, 0, 0], sides = 12) { return this.add(new THREE.CylinderGeometry(1, 1, 1, sides), p, s, r, color); }
  torus(p, radius, tube, color, r = [0, 0, 0]) { return this.add(new THREE.TorusGeometry(radius, tube, 6, 18), p, undefined, r, color); }
  rod(a, b, radius, color, endRadius = radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
    return this.add(new THREE.CylinderGeometry(endRadius, radius, direction.length(), 8), start.add(end).multiplyScalar(.5).toArray(), undefined, q, color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}
function canvasTexture(width, height, paint, repeat = true) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Jungle Kart needs a browser with Canvas 2D support for its original textures.');
  paint(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
function makeRibbon(track, offsets, heightAt, repeatLength = 7, colorAt = () => WHITE, start = 0, end = track.length, segments = track.samples.length) {
  const p = [], uv = [], colors = [], indices = [], columns = offsets.length;
  for (let i = 0; i <= segments; i++) {
    const distance = mix(start, end, i / segments), point = sampleTrack(track, distance);
    for (let j = 0; j < columns; j++) {
      const offset = offsets[j], color = new THREE.Color(colorAt(distance, j));
      p.push(point.x + point.nx * offset, heightAt(point, offset, distance, j), point.z + point.nz * offset);
      uv.push(j / (columns - 1), distance / repeatLength); colors.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < columns - 1; j++) {
    const a = i * columns + j, b = a + columns;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + Math.PI / 2, radius = i % 2 ? .43 : 1;
    if (i === 0) shape.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    else shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: .18, bevelEnabled: false });
}

export class RacingScene {
  constructor(canvas, { podium = false } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('RacingScene requires a canvas.');
    this.canvas = canvas;
    this._podium = podium;
    this.scene = new THREE.Scene();
    this.cameras = [];
    this.renderedViews = [];
    this._geometries = new Set(); this._materials = new Set(); this._textures = new Set();
    this._sharedMaterials = new Set(); this._sharedGeometries = new Set(); this._textureCache = new Map();
    this._models = new Map(); this._cameraStates = []; this._seenEvents = new Map(); this._bursts = [];
    this._smooth = new Map();
    this._clock = 0; this._demoClock = 0; this._low = false; this._viewCount = 1;
    this._width = 0; this._height = 0; this._drawable = false; this._disposed = false; this._contextLost = false;
    this._dummy = new THREE.Object3D(); this._color = new THREE.Color();
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error(`Jungle Kart could not start WebGL. Enable hardware acceleration and reload. ${error.message}`);
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene.add(new THREE.HemisphereLight('#dcf6e4', '#586847', 1.9));
    this.sun = new THREE.DirectionalLight('#fff0cc', 2.7);
    this.sun.position.set(-38, 74, 35);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 1, far: 200 });
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -.00035; this.sun.shadow.normalBias = .06;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.world = new THREE.Group(); this.world.name = 'Procedural wild circuit'; this.scene.add(this.world);
    this.racers = new THREE.Group(); this.racers.name = 'Animal racers'; this.scene.add(this.racers);
    this.effects = new THREE.Group(); this.effects.name = 'Race effects'; this.scene.add(this.effects);
    this._makeSharedMaterials();
    if (!podium) this._makeEffects();
    this._onLost = event => {
      event.preventDefault(); this._contextLost = true; this._drawable = false;
      this.scene.userData.contextLost = true;
      canvas.setAttribute('data-render-status', 'context-lost');
      console.warn('Jungle Kart: graphics context lost; rendering will resume when the browser restores it.');
    };
    this._onRestored = () => {
      if (this._disposed) return;
      this._contextLost = false; this.scene.userData.contextLost = false;
      for (const texture of this._textures) texture.needsUpdate = true;
      for (const material of this._materials) material.needsUpdate = true;
      this._cameraStates = []; this.renderer.shadowMap.needsUpdate = true;
      canvas.setAttribute('data-render-status', 'ready'); this.resize();
    };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._onResize); this._observer.observe(canvas);
    }
    if (!podium) this._buildTrack(0);
    canvas.setAttribute('data-render-status', 'ready');
    this.resize();
  }

  _geo(g, shared = false) { this._geometries.add(g); if (shared) this._sharedGeometries.add(g); return g; }
  _mat(options = {}, shared = false) {
    const m = new THREE.MeshStandardMaterial({ roughness: .83, vertexColors: true, ...options });
    this._materials.add(m); if (shared) this._sharedMaterials.add(m); return m;
  }
  _texture(key, factory) {
    if (!this._textureCache.has(key)) {
      const t = factory(); t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this._textureCache.set(key, t); this._textures.add(t);
    }
    return this._textureCache.get(key);
  }
  _mesh(parent, geometry, material, cast = true, receive = true) {
    const mesh = new THREE.Mesh(this._geo(geometry), material); mesh.castShadow = cast; mesh.receiveShadow = receive;
    parent.add(mesh); return mesh;
  }
  _instances(parent, geometry, material, count, shared = false) {
    const mesh = new THREE.InstancedMesh(this._geo(geometry, shared), material, Math.max(1, count));
    mesh.count = count; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  _place(mesh, index, p, s = [1, 1, 1], r = [0, 0, 0], color) {
    this._dummy.position.set(...p); this._dummy.scale.set(...s);
    if (r.isQuaternion) this._dummy.quaternion.copy(r);
    else this._dummy.rotation.set(r[0], r[1], r[2], 'YXZ');
    this._dummy.updateMatrix(); mesh.setMatrixAt(index, this._dummy.matrix);
    if (color !== undefined) mesh.setColorAt(index, this._color.set(color));
  }
  _finishInstances(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  _release(root) {
    const geometries = new Set(), materials = new Set();
    root.traverse(object => {
      if (object.geometry && !this._sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
      if (object.material) for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!this._sharedMaterials.has(m)) materials.add(m);
      }
      if (object.isInstancedMesh) object.dispose();
    });
    for (const g of geometries) { g.dispose(); this._geometries.delete(g); }
    for (const m of materials) { m.dispose(); this._materials.delete(m); }
    root.clear(); root.removeFromParent();
  }

  _makeSharedMaterials() {
    const fur = this._texture('fine-fur', () => canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#f6f2e8'; c.fillRect(0, 0, w, h); const rng = randomSeed(741);
      for (let i = 0; i < 28000; i++) {
        const x = rng() * w, y = rng() * h;
        c.strokeStyle = `rgba(96,81,57,${.02 + rng() * .13})`; c.lineWidth = .5 + rng() * 1.1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + rng() * 2 - 1, y + 2 + rng() * 5); c.stroke();
      }
      // Soft mottling so flat-colored animals read as fur, not plastic.
      for (let i = 0; i < 220; i++) {
        const x = rng() * w, y = rng() * h, r = 6 + rng() * 26;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(140,110,80,${.04 + rng() * .08})`); g.addColorStop(1, 'rgba(140,110,80,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }));
    // Slightly glossier body shell with a faint metalness so painted panels catch the sun.
    this.bodyMaterial = this._mat({ roughness: .42, metalness: .28, envMapIntensity: 1.1 }, true);
    this.furMaterial = this._mat({ map: fur, roughness: .94, metalness: 0 }, true);
    this.leafMaterial = this._mat({ side: THREE.DoubleSide, roughness: .92 }, true);
    const paint = this._texture('paint-flake', () => canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); const rng = randomSeed(2024);
      for (let i = 0; i < 4500; i++) {
        const x = rng() * w, y = rng() * h, s = .5 + rng() * 1.8;
        c.fillStyle = `rgba(255,255,255,${.25 + rng() * .55})`; c.fillRect(x, y, s, s);
        c.fillStyle = `rgba(120,140,140,${.06 + rng() * .14})`; c.fillRect(x + 1, y + 1, s * .8, s * .8);
      }
    }));
    this.paintMaterial = this._mat({ map: paint, roughness: .26, metalness: .55, envMapIntensity: 1.35 }, true);
    const chrome = this._texture('chrome-brushed', () => canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#dfe5e3'; c.fillRect(0, 0, w, h); const rng = randomSeed(88);
      for (let i = 0; i < 600; i++) {
        const y = rng() * h;
        c.strokeStyle = `rgba(${180 + rng() * 60},${190 + rng() * 50},${200 + rng() * 50},${.06 + rng() * .18})`;
        c.lineWidth = .4 + rng();
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + rng() * 2 - 1); c.stroke();
      }
    }));
    this.chromeMaterial = this._mat({ map: chrome, roughness: .18, metalness: .92, envMapIntensity: 1.6 }, true);
    const bark = this._texture('bark', () => canvasTexture(512, 1024, (c, w, h) => {
      c.fillStyle = '#b2a58c'; c.fillRect(0, 0, w, h); const rng = randomSeed(73);
      for (let i = 0; i < 1000; i++) {
        const x = rng() * w, y = rng() * h; c.strokeStyle = `rgba(64,45,30,${rng() * .2})`;
        c.lineWidth = 1 + rng() * 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + rng() * 9 - 4, y + rng() * 140); c.stroke();
      }
      for (let y = 0; y < h; y += 49) { c.fillStyle = '#766956'; c.fillRect(0, y, w, 5); c.fillStyle = '#c9bba0'; c.fillRect(0, y + 6, w, 3); }
    }));
    this.barkMaterial = this._mat({ map: bark }, true);
    const moss = this._texture('moss', () => canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#a6b88b'; c.fillRect(0, 0, w, h); const rng = randomSeed(955);
      for (let i = 0; i < 18000; i++) {
        c.fillStyle = i % 3 ? `rgba(48,77,38,${rng() * .22})` : `rgba(235,224,159,${rng() * .25})`;
        c.fillRect(rng() * w, rng() * h, 1 + rng() * 7, 1 + rng() * 5);
      }
    }));
    this.mossMaterial = this._mat({ map: moss, roughness: 1 }, true);
  }

  _roadTexture(surface) {
    return this._texture(`road-${surface}`, () => canvasTexture(1024, 2048, (c, w, h) => {
      const rng = randomSeed(surface === 'asphalt' ? 81 : surface === 'stone' ? 82 : 83);
      c.fillStyle = surface === 'asphalt' ? '#6d7c7c' : surface === 'stone' ? '#9b927b' : '#ac8053';
      c.fillRect(0, 0, w, h);
      if (surface === 'asphalt') {
        for (let i = 0; i < 110000; i++) {
          c.fillStyle = i % 2 ? `rgba(222,228,214,${rng() * .15})` : `rgba(24,39,35,${rng() * .2})`;
          const size = .4 + rng() * 2.3; c.fillRect(rng() * w, rng() * h, size, size);
        }
        for (let i = 0; i < 18; i++) {
          let x = rng() * w, y = rng() * h;
          c.strokeStyle = 'rgba(28,45,39,.27)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y);
          for (let j = 0; j < 6; j++) { x += rng() * 36 - 18; y += rng() * 30; c.lineTo(x, y); }
          c.stroke();
        }
        // Two subtly polished tyre lanes, with genuinely fine aggregate underneath.
        for (const x of [w * .26, w * .66]) { const g = c.createLinearGradient(x - 40, 0, x + 40, 0); g.addColorStop(0, 'transparent'); g.addColorStop(.5, 'rgba(21,42,37,.09)'); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(x - 40, 0, 80, h); }
      } else if (surface === 'stone') {
        for (let row = -1; row < 18; row++) for (let col = -1; col < 9; col++) {
          const x = col * 132 + (row % 2) * 66, y = row * 124;
          const shade = Math.floor(144 + rng() * 31);
          c.fillStyle = `rgb(${shade + 13},${shade + 5},${shade - 21})`; c.fillRect(x + 4, y + 4, 124, 115);
          c.fillStyle = 'rgba(248,230,176,.25)'; c.fillRect(x + 5, y + 5, 123, 3);
          c.fillStyle = 'rgba(46,63,33,.42)'; c.fillRect(x + 1, y, 3, 124); c.fillRect(x, y, 132, 3);
          for (let k = 0; k < 55; k++) { c.fillStyle = 'rgba(53,61,39,.10)'; c.fillRect(x + rng() * 124, y + rng() * 115, 2, 2); }
        }
      } else {
        for (let y = 0; y < h; y += 80) {
          const shade = Math.floor(127 + rng() * 33);
          c.fillStyle = `rgb(${shade + 36},${shade},${shade - 43})`; c.fillRect(0, y + 3, w, 75);
          c.fillStyle = '#674d37'; c.fillRect(0, y, w, 3);
          c.fillStyle = 'rgba(255,230,164,.35)'; c.fillRect(0, y + 4, w, 3);
          for (let i = 0; i < 35; i++) {
            const py = y + 8 + rng() * 65; c.strokeStyle = `rgba(65,42,23,${.06 + rng() * .15})`; c.lineWidth = .7 + rng();
            c.beginPath(); c.moveTo(0, py); c.bezierCurveTo(300, py - 4, 700, py + 4, w, py); c.stroke();
          }
          for (const x of [38, w - 38]) { c.fillStyle = '#564b3d'; c.beginPath(); c.arc(x, y + 19, 3, 0, TAU); c.fill(); }
        }
      }
      c.fillStyle = 'rgba(255,245,203,.84)'; c.fillRect(42, 0, 11, h); c.fillRect(w - 53, 0, 11, h);
      c.fillStyle = surface === 'stone' ? 'rgba(255,233,171,.70)' : 'rgba(255,234,166,.85)';
      for (let y = 90; y < h; y += 512) c.fillRect(w / 2 - 5, y, 10, 214);
    }));
  }

  _landHeight(point, offset) {
    const d = Math.abs(offset) - this.track.roadWidth / 2;
    return Math.max(.015, mix(Math.max(.04, point.y - .085), .025, smooth((d - .65) / 13.5)));
  }
  _buildTrack(id) {
    if (this.track && this.track.id === id) return;
    if (this.world) this._release(this.world);
    this.world = new THREE.Group(); this.world.name = 'Procedural wild circuit'; this.scene.add(this.world);
    this.track = createTrack(id); this.scene.userData.trackId = id;
    this._demoClock = 0; this._cameraStates = []; this._bursts = []; this._seenEvents.clear();
    const track = this.track, theme = track.theme, half = track.roadWidth / 2;
    const isNight = track.id === 6, isBoardwalk = track.surface === 'boardwalk', isStone = track.surface === 'stone';
    this.scene.fog = new THREE.Fog(theme.fog, isNight ? 50 : 70, isNight ? 140 : 180);
    this.scene.background = this._texture(`sky-${id}`, () => canvasTexture(2048, 1024, (c, w, h) => {
      const gradient = c.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, isNight ? '#0d1530' : isBoardwalk ? '#659faa' : '#4ba6b3');
      gradient.addColorStop(.36, theme.sky); gradient.addColorStop(.52, isNight ? '#1c2a4a' : isBoardwalk ? '#ffe3b2' : '#e3ecd0');
      gradient.addColorStop(.7, theme.fog); gradient.addColorStop(1, theme.fog);
      c.fillStyle = gradient; c.fillRect(0, 0, w, h);
      const rng = randomSeed(754 + id);
      if (isNight) {
        for (let i = 0; i < 320; i++) {
          const x = rng() * w, y = rng() * h * .55, size = .6 + rng() * 1.7;
          c.fillStyle = `rgba(255,250,220,${.35 + rng() * .55})`; c.fillRect(x, y, size, size);
        }
        const moon = c.createRadialGradient(w * .78, h * .22, 4, w * .78, h * .22, 70);
        moon.addColorStop(0, '#fffbe6'); moon.addColorStop(.22, 'rgba(220,230,255,.85)'); moon.addColorStop(1, 'rgba(180,200,255,0)');
        c.fillStyle = moon; c.fillRect(w * .78 - 90, h * .22 - 90, 180, 180);
      } else {
        for (let i = 0; i < 45; i++) {
          const x = rng() * w, y = 265 + rng() * 185, radius = 25 + rng() * 80;
          const cloud = c.createRadialGradient(x, y, 0, x, y, radius);
          cloud.addColorStop(0, 'rgba(255,249,225,.30)'); cloud.addColorStop(1, 'rgba(255,249,225,0)');
          c.fillStyle = cloud; c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        const sun = c.createRadialGradient(w * .73, h * .4, 2, w * .73, h * .4, isBoardwalk ? 115 : 75);
        sun.addColorStop(0, '#fff8d7'); sun.addColorStop(.18, 'rgba(255,243,198,.95)'); sun.addColorStop(1, 'rgba(255,225,166,0)');
        c.fillStyle = sun; c.fillRect(w * .73 - 120, h * .4 - 120, 240, 240);
      }
    }, false));
    this.scene.background.mapping = THREE.EquirectangularReflectionMapping;
    this.sun.color.set(theme.sun);
    this.sun.intensity = isNight ? 1.1 : isBoardwalk ? 2.9 : 2.7;
    this.sun.position.set(isNight ? 28 : isBoardwalk ? -62 : -38, isNight ? 62 : isBoardwalk ? 49 : 74, isNight ? -22 : 35);
    const roadMaterial = this._mat({ map: this._roadTexture(track.surface), roughness: isBoardwalk ? .78 : .94 });
    const road = this._mesh(this.world, makeRibbon(track, [-half, half], p => p.y + .026), roadMaterial, false);
    road.name = `${track.name}: full-width elevated ${track.surface} ribbon`;
    const earth = this._mat({ map: this._textureCache.get('moss'), roughness: 1 });
    for (const side of [-1, 1]) {
      const offsets = [half + .46, half + 2, half + 5, half + 9, half + 14.5].map(d => d * side).sort((a, b) => a - b);
      const land = makeRibbon(track, offsets, (p, off) => this._landHeight(p, off), 10, (s, j) => {
        const color = new THREE.Color(theme.grass); color.multiplyScalar(.88 + .12 * Math.sin(s * .15 + j)); return color;
      });
      const mesh = this._mesh(this.world, land, earth, false); mesh.name = 'Lush terrain follows road elevation';
    }
    const curbs = new Baker();
    const curbColors = ['#fff0c8', '#e8874d'];
    for (const side of [-1, 1]) {
      const offsets = [side * half, side * (half + .48)].sort((a, b) => a - b);
      const segments = Math.ceil(track.length / 2.25);
      for (let i = 0; i < segments; i++) {
        curbs.add(makeRibbon(track, offsets, p => p.y + .055, 1, () => WHITE, i * track.length / segments, (i + 1) * track.length / segments, 3), undefined, undefined, undefined, curbColors[i % 2]);
      }
    }
    this._mesh(this.world, curbs.geometry(), this.bodyMaterial, false).name = 'Cream and papaya rumble strips';
    const skirt = new Baker();
    for (const side of [-1, 1]) {
      // Two same-offset columns form a vertical wall; use DoubleSide for either bank.
      skirt.add(makeRibbon(track, [side * (half + .45), side * (half + .45)], (p, off, s, j) => j ? -3.2 : p.y - .02, 5), undefined, undefined, undefined, id === 2 || id === 3 ? '#897052' : id === 4 ? '#3f2e26' : id === 5 ? '#c8956b' : id === 6 ? '#2b3a30' : id === 7 ? '#848a9e' : '#71825b');
    }
    this._mesh(this.world, skirt.geometry(), this._mat({ map: this._textureCache.get(track.surface === 'boardwalk' ? 'bark' : 'moss'), side: THREE.DoubleSide }), true).name = 'Road foundations';
    this._makeWater(theme);
    this._makeVegetation();
    this._makeScenery();
    this._makeStart();
    this.renderer.shadowMap.needsUpdate = true;
  }

  _makeWater(theme) {
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, waterColor: { value: new THREE.Color(theme.water) }, fogColor: { value: new THREE.Color(theme.fog) }, fogNear: { value: 70 }, fogFar: { value: 180 } },
      fog: true,
      vertexShader: `#include <fog_pars_vertex>
        varying vec3 worldPoint;
        void main(){ vec4 world = modelMatrix * vec4(position,1.); worldPoint=world.xyz;
          vec4 mvPosition=viewMatrix*world; gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform vec3 waterColor; varying vec3 worldPoint;
        #include <fog_pars_fragment>
        void main(){ vec2 p=worldPoint.xz;
          float wave=sin(p.x*.48+sin(p.y*.32+time*.55)*1.7+time*.45)*sin(p.y*.62-time*.32);
          float caustic=pow(max(0.,sin(p.x*1.4+p.y*.8+sin(p.y*.4+time)*2.)),18.);
          float glint=pow(max(0.,wave),14.);
          vec3 color=waterColor*(.78+wave*.075)+vec3(.18,.23,.16)*caustic*.34+vec3(.5,.46,.30)*glint*.35;
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    this._materials.add(material); this.waterMaterial = material;
    const water = this._mesh(this.world, new THREE.PlaneGeometry(520, 520), material, false, false);
    water.rotation.x = -Math.PI / 2; water.position.y = -3; water.name = 'Animated turquoise lagoon';
  }

  _palmGeometry() {
    const trunk = new Baker(), leaves = new Baker();
    for (let i = 0; i < 7; i++) {
      const y = i * 1.05, x = Math.sin(i / 7 * 1.4) * .55;
      trunk.rod([x, y, 0], [Math.sin((i + 1) / 7 * 1.4) * .55, y + 1.09, 0], .27 - i * .017, '#a38e65', .25 - i * .017);
    }
    for (let i = 0; i < 9; i++) {
      const angle = i / 9 * TAU, length = 3 + (i % 3) * .35;
      const p = [], uv = [], idx = [], colors = [];
      for (let j = 0; j <= 9; j++) {
        const t = j / 9, radius = t * length, y = 7.35 + Math.sin(t * Math.PI) * .95 - t * t * 1.9;
        const width = Math.sin(Math.PI * t) * .48;
        for (let k = -1; k <= 1; k++) {
          p.push(.55 + Math.sin(angle) * radius + Math.cos(angle) * width * k, y - Math.abs(k) * .18, Math.cos(angle) * radius - Math.sin(angle) * width * k);
          uv.push((k + 1) / 2, t);
          const c = new THREE.Color(k === 0 ? '#93b74b' : i % 2 ? '#3d8853' : '#529b54'); colors.push(c.r, c.g, c.b);
        }
      }
      for (let j = 0; j < 9; j++) for (let k = 0; k < 2; k++) { const a = j * 3 + k; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(idx); g.computeVertexNormals();
      // Vertex colours preserve a lighter central rib on each sculpted leaf.
      leaves.add(g);
      trunk.add(new THREE.SphereGeometry(1, 7, 5), [.55 + Math.sin(angle) * .3, 7.08, Math.cos(angle) * .3], [.22, .25, .22], undefined, '#746042');
    }
    return { trunk: trunk.geometry(), leaves: leaves.geometry() };
  }
  _fernGeometry() {
    const fern = new Baker();
    // Folded leaf blades are both more fern-like and much cheaper than hundreds of spheres.
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * TAU, sx = Math.sin(angle), sz = Math.cos(angle);
      const at = t => [sx * t * 1.6, .14 + Math.sin(t * Math.PI * .87) * .94, sz * t * 1.6];
      for (let j = 0; j < 7; j++) {
        const t = j / 7, a = at(t), b = at((j + 1) / 7);
        const stem = new THREE.BufferGeometry();
        stem.setAttribute('position', new THREE.Float32BufferAttribute([
          a[0] - sz * .012, a[1], a[2] + sx * .012,
          a[0] + sz * .012, a[1], a[2] - sx * .012,
          b[0] - sz * .009, b[1], b[2] + sx * .009,
          b[0] + sz * .009, b[1], b[2] - sx * .009
        ], 3)); stem.setIndex([0, 2, 1, 1, 2, 3]); stem.computeVertexNormals(); fern.add(stem, undefined, undefined, undefined, '#a0b65c');
        for (const side of [-1, 1]) {
          const length = (1 - t) * .58 + .06, tipX = a[0] + sz * length * side + sx * .13, tipZ = a[2] - sx * length * side + sz * .13;
          const middleX = mix(a[0], tipX, .46), middleZ = mix(a[2], tipZ, .46);
          const leaf = new THREE.BufferGeometry();
          leaf.setAttribute('position', new THREE.Float32BufferAttribute([
            a[0], a[1], a[2], middleX - sx * .09, a[1] + .02, middleZ - sz * .09,
            middleX, a[1] + .095, middleZ, middleX + sx * .1, a[1] + .02, middleZ + sz * .1,
            tipX, a[1] - .035, tipZ
          ], 3)); leaf.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]); leaf.computeVertexNormals();
          fern.add(leaf, undefined, undefined, undefined, (i + j) % 2 ? '#539654' : '#7bad52');
        }
      }
    }
    return fern.geometry();
  }
  _makeVegetation() {
    const rng = randomSeed(1830 + this.track.id), track = this.track, half = track.roadWidth / 2;
    const palms = [], ferns = [], rocks = [], grass = [], flowers = [];
    const collect = (array, count, near, far) => {
      for (let i = 0; i < count; i++) {
        const s = rng() * track.length, offset = (half + near + rng() * (far - near)) * (rng() < .5 ? -1 : 1), p = sampleTrack(track, s, offset);
        const projection = projectTrack(track, p.x, p.z);
        if (Math.abs(projection.lateral) < half + near * .85) continue;
        array.push({ p: [p.x, this._landHeight(p, offset) - .04, p.z], r: rng() * TAU, size: .7 + rng() * .7 });
      }
    };
    collect(palms, 170, 4.2, 13); collect(ferns, 245, 1.8, 10); collect(rocks, 100, 2.8, 13);
    collect(grass, 370, 1.2, 13); collect(flowers, 85, 2, 8);
    const palmGeo = this._palmGeometry();
    const trunks = this._instances(this.world, palmGeo.trunk, this.barkMaterial, palms.length);
    const fronds = this._instances(this.world, palmGeo.leaves, this.leafMaterial, palms.length);
    palms.forEach((p, i) => { const scale = [p.size, p.size, p.size]; this._place(trunks, i, p.p, scale, [0, p.r, 0]); this._place(fronds, i, p.p, scale, [0, p.r, 0]); });
    this._finishInstances(trunks); this._finishInstances(fronds); trunks.name = 'Instanced ringed palm trunks'; fronds.name = 'Instanced sculpted palm fronds';
    const fernMesh = this._instances(this.world, this._fernGeometry(), this.leafMaterial, ferns.length);
    ferns.forEach((p, i) => this._place(fernMesh, i, p.p, [p.size, p.size, p.size], [0, p.r, 0]));
    fernMesh.castShadow = false; this._finishInstances(fernMesh);
    const rockGeo = new Baker().add(new THREE.IcosahedronGeometry(1, 1), undefined, undefined, undefined, '#86907a').geometry();
    const rockMesh = this._instances(this.world, rockGeo, this.mossMaterial, rocks.length);
    rocks.forEach((p, i) => this._place(rockMesh, i, [p.p[0], p.p[1] + .15, p.p[2]], [p.size * 1.4, p.size * .85, p.size], [0, p.r, .13])); this._finishInstances(rockMesh);
    const tuft = new Baker();
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * TAU;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-.10, 0, 0, .10, 0, 0, .08, .58, .13, -.06, .58, .13, 0, .98, .32], 3));
      g.setIndex([0, 3, 1, 1, 3, 2, 3, 4, 2]); g.computeVertexNormals();
      tuft.add(g, undefined, [1, .7 + rng() * .5, 1], [0, angle, 0], i % 2 ? '#90b95c' : '#638e45');
    }
    const grassMesh = this._instances(this.world, tuft.geometry(), this.leafMaterial, grass.length);
    grass.forEach((p, i) => this._place(grassMesh, i, p.p, [p.size, p.size, p.size], [0, p.r, 0])); grassMesh.castShadow = false; this._finishInstances(grassMesh);
    const flower = new Baker(); flower.rod([0, 0, 0], [.04, 1.2, 0], .035, '#587c38');
    flower.ball([0, .4, .16], [.06, .32, .23], '#679b48');
    for (let i = 0; i < 3; i++) flower.cone([i * .14 - .14, 1.12 + i * .11, 0], [.12, .52, .10], i % 2 ? '#ffd66c' : '#ed8651', [0, 0, -.5 + i * .15]);
    const flowerMesh = this._instances(this.world, flower.geometry(), this.leafMaterial, flowers.length);
    flowers.forEach((p, i) => this._place(flowerMesh, i, p.p, [p.size, p.size, p.size], [0, p.r, 0])); flowerMesh.castShadow = false; this._finishInstances(flowerMesh);
  }

  _makeScenery() {
    const track = this.track, half = track.roadWidth / 2, id = track.id, rng = randomSeed(id + 931);
    const wood = new Baker(), stone = new Baker(), accents = new Baker();
    const isStone = track.surface === 'stone', isBoardwalk = track.surface === 'boardwalk';
    const isVolcano = id === 4, isNight = id === 6, isDesert = id === 5, isSky = id === 7;
    // Low edge furniture remains outside the entire drivable width, including the curb.
    for (let s = 0; s < track.length; s += 4) for (const side of [-1, 1]) {
      const p = sampleTrack(track, s, side * (half + .95));
      const next = sampleTrack(track, s + 4, side * (half + .95));
      if (isStone) {
        stone.box([p.x, p.y + .32, p.z], [.48, .66, .48], isVolcano ? '#5a4a44' : isSky ? '#a6acc0' : '#b3a17e', [0, p.angle, 0]);
        accents.box([p.x, p.y + .69, p.z], [.53, .10, .53], isVolcano ? '#ff8a55' : isSky ? '#e6e9f5' : '#e2c792', [0, p.angle, 0]);
      } else {
        wood.box([p.x, p.y + .36, p.z], [.16, .76, .16], isNight ? '#4a5a4e' : isDesert ? '#a98859' : '#997752', [0, p.angle, 0]);
        wood.rod([p.x, p.y + .58, p.z], [next.x, next.y + .58, next.z], .065, isNight ? '#6a7d6c' : '#c0a276');
      }
      if (isBoardwalk || isSky) {
        const pierColor = isSky ? '#7f8a9e' : '#807259';
        wood.box([p.x, (p.y - 3.3) / 2, p.z], [.29, p.y + 3.3, .29], pierColor, [0, p.angle, 0]);
        if (side === 1) {
          const q = sampleTrack(track, s, -(half + .95));
          wood.rod([p.x, p.y - .35, p.z], [q.x, q.y - .35, q.z], .2, isSky ? '#8b95ab' : '#8c7654');
        }
      }
    }
    // Mountain islands: the available radius is bounded by the actual nearest road.
    for (const [x, z, desired] of [[-4, -12, 15], [5, 15, 13], [-16, -22, 11], [11, -30, 8]]) {
      const projection = projectTrack(track, x, z), clearance = Math.hypot(x - projection.x, z - projection.z) - half - 4;
      const radius = Math.min(desired, clearance);
      if (radius < 4) continue;
      const baseColor = isVolcano ? '#3b2b25' : isDesert ? '#c8956b' : isNight ? '#2a3a30' : isSky ? '#6f7c92' : isStone ? '#8a8d69' : '#6c8a61';
      stone.add(new THREE.IcosahedronGeometry(1, 2), [x, -1.8, z], [radius, radius * .8, radius * .88], [0, rng() * TAU, 0], baseColor);
      accents.add(new THREE.IcosahedronGeometry(1, 1), [x - 1, radius * .45, z], [radius * .66, radius * .3, radius * .62], undefined, isVolcano ? '#ff7a44' : isDesert ? '#e2b489' : isNight ? '#3f5f4a' : '#779750');
    }
    // Repeating wayfinding signs and sculpted ruins are baked, not individual draw calls.
    for (let n = 0; n < 10; n++) {
      const s = track.length * (n + .35) / 10, p = sampleTrack(track, s, half + 2.4);
      const m = transform([p.x, this._landHeight(p, half + 2.4), p.z], undefined, [0, p.angle, 0]);
      const local = new Baker();
      local.rod([0, 0, 0], [0, 1.65, 0], .085, isNight ? '#5b6c60' : '#a1855b');
      local.box([0, 1.56, 0], [1.12, .55, .13], isNight ? '#cfd8d2' : '#efe1af');
      for (const x of [-.25, .12]) {
        local.box([x, 1.68, -.085], [.12, .28, .04], isNight ? '#7fa6c9' : '#d87c47', [0, 0, -.65]);
        local.box([x, 1.47, -.085], [.12, .28, .04], isNight ? '#7fa6c9' : '#d87c47', [0, 0, .65]);
      }
      const g = local.geometry(); g.applyMatrix4(m); accents.add(g);
      if (isStone) {
        const q = sampleTrack(track, s, -(half + 5.2)), base = this._landHeight(q, half + 5.2), angle = q.angle;
        for (const side of [-1, 1]) {
          const x = q.x + q.nx * side * 1.9, z = q.z + q.nz * side * 1.9, height = n % 3 ? 4.3 : 2.7;
          const pillarColor = isVolcano ? '#4a3a35' : isSky ? '#9aa0b4' : '#a6a17d';
          stone.box([x, base + height / 2, z], [1.1, height, 1.1], pillarColor, [0, angle, 0]);
          stone.box([x, base + .25, z], [1.5, .5, 1.5], isVolcano ? '#3a2c28' : isSky ? '#848a9e' : '#929273', [0, angle, 0]);
          accents.box([x, base + height - .4, z], [1.25, .16, 1.25], isVolcano ? '#ff8a55' : isSky ? '#e6e9f5' : '#c6b984', [0, angle, 0]);
        }
        if (n % 3) {
          stone.box([q.x, base + 4.6, q.z], [5.3, .7, 1.5], isVolcano ? '#5a4a44' : isSky ? '#a8aec2' : '#b4aa84', [0, angle, .035]);
          accents.ball([q.x, base + 5.15, q.z], [.54, .54, .3], isVolcano ? '#ffb066' : isSky ? '#f0f2fa' : '#d2b96e');
        }
      }
    }
    // One large waterfall (or lava fall on the volcano) visible over the inside verge, never across the racing line.
    const wp = sampleTrack(track, track.length * .17, half + 12.5), wy = this._landHeight(wp, half + 12.5);
    const waterfallHeight = isStone ? 8.5 : 11.5;
    stone.add(new THREE.IcosahedronGeometry(1, 1), [wp.x + wp.nx * 2.6, wy + 3.6, wp.z + wp.nz * 2.6], [4.5, 7.6, 4], [0, wp.angle, 0], isVolcano ? '#3a2a24' : isNight ? '#2c3a32' : '#7d8972');
    const falling = this._texture(isVolcano ? 'lavafall' : 'waterfall', () => canvasTexture(256, 1024, (c, w, h) => {
      c.fillStyle = isVolcano ? '#ff7a3a' : '#b1ddd0'; c.fillRect(0, 0, w, h); const r = randomSeed(isVolcano ? 99 : 41);
      for (let i = 0; i < 210; i++) {
        c.fillStyle = isVolcano ? `rgba(255,238,160,${.18 + r() * .55})` : `rgba(246,255,239,${.13 + r() * .5})`;
        c.fillRect(r() * w, r() * h, 1 + r() * 6, 25 + r() * 170);
      }
      const g = c.createLinearGradient(0, 0, w, 0);
      if (isVolcano) { g.addColorStop(0, 'rgba(120,40,10,.6)'); g.addColorStop(.25, 'transparent'); g.addColorStop(.7, 'transparent'); g.addColorStop(1, 'rgba(120,40,10,.6)'); }
      else { g.addColorStop(0, 'rgba(57,155,142,.55)'); g.addColorStop(.25, 'transparent'); g.addColorStop(.7, 'transparent'); g.addColorStop(1, 'rgba(57,155,142,.55)'); }
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }));
    this.fallTexture = falling;
    const fall = this._mesh(this.world, new THREE.PlaneGeometry(4.6, waterfallHeight, 8, 1), this._mat({ map: falling, color: isVolcano ? '#ffd0a0' : '#d3efe5', side: THREE.DoubleSide, roughness: .32, emissive: isVolcano ? '#ff5522' : '#315e53', emissiveIntensity: isVolcano ? .9 : .22 }), false);
    fall.position.set(wp.x, -2.8 + waterfallHeight / 2, wp.z); fall.rotation.y = wp.angle - Math.PI / 2; fall.name = isVolcano ? 'Cascading lava fall' : 'Scrolling waterfall';
    accents.ball([wp.x, -2.74, wp.z], [3.9, .18, 3.0], isVolcano ? '#ffb066' : '#d3efdc');
    if (isBoardwalk && !isSky) {
      // A few little coastal sailboats beyond the outer bank.
      for (let i = 0; i < 4; i++) {
        const p = sampleTrack(track, track.length * (.26 + i * .15), -(half + 24));
        wood.ball([p.x, -2.9, p.z], [1.1, .5, 2.6], '#a35e3d');
        wood.rod([p.x, -2.8, p.z], [p.x, 3.2, p.z], .09, '#ab8356');
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 5, 0, 0, .3, 2.6], 3)); g.setIndex([0, 1, 2]); g.computeVertexNormals();
        accents.add(g, [p.x, -2.3, p.z], undefined, [0, .5, 0], i % 2 ? '#e78862' : '#f4e4b9');
      }
    }
    if (isNight) {
      // Bioluminescent lanterns along the marsh banks.
      for (let n = 0; n < 18; n++) {
        const s = track.length * (n + .5) / 18, side = n % 2 ? 1 : -1;
        const p = sampleTrack(track, s, side * (half + 2.6));
        const base = this._landHeight(p, half + 2.6);
        wood.rod([p.x, base, p.z], [p.x, base + 2.1, p.z], .075, '#3d4d3f');
        accents.ball([p.x, base + 2.32, p.z], [.22, .26, .22], '#bdf5c2');
        accents.ball([p.x, base + 2.32, p.z], [.4, .42, .4], '#7fd8a4');
      }
    }
    if (isVolcano) {
      // Glowing ember vents on the inner verge.
      for (let n = 0; n < 14; n++) {
        const s = track.length * (n + .25) / 14, side = n % 2 ? 1 : -1;
        const p = sampleTrack(track, s, side * (half + 3.2));
        const base = this._landHeight(p, half + 3.2);
        stone.cone([p.x, base + .55, p.z], [1.1, 1.4, 1.1], '#3b2b25', [0, rng() * TAU, 0]);
        accents.ball([p.x, base + 1.22, p.z], [.36, .2, .36], '#ffae55');
        accents.ball([p.x, base + 1.3, p.z], [.18, .12, .18], '#fff0a8');
      }
    }
    if (isSky) {
      // Floating sky-vines connecting distant platforms.
      for (let n = 0; n < 8; n++) {
        const s = track.length * (n + .5) / 8;
        const p = sampleTrack(track, s, half + 18);
        const base = this._landHeight(p, half + 18);
        stone.box([p.x, base + 6, p.z], [3.4, .55, 3.4], '#9aa0b4', [0, p.angle, 0]);
        stone.box([p.x, base + 4.2, p.z], [2.6, .4, 2.6], '#848a9e', [0, p.angle, 0]);
        accents.rod([p.x, base + 6.4, p.z], [p.x, base + 11.5, p.z], .09, '#7fae8a');
        for (let leaf = 0; leaf < 4; leaf++) accents.ball([p.x + Math.sin(leaf) * .55, base + 8.4 + leaf * .55, p.z + Math.cos(leaf) * .55], [.55, .25, .55], '#9ed4a8');
      }
    }
    this._mesh(this.world, wood.geometry(), this.barkMaterial).name = 'Baked timber railings and piers';
    this._mesh(this.world, stone.geometry(), this.mossMaterial).name = 'Mountain islands and temple stone';
    this._mesh(this.world, accents.geometry(), this.leafMaterial).name = 'Wayfinding, island foliage and carved details';
    // Distant low-poly jungle is a single instanced draw and remains behind the fog.
    const distant = this._instances(this.world, new Baker().add(new THREE.IcosahedronGeometry(1, 1), undefined, undefined, undefined, '#729878').geometry(), this.mossMaterial, 24);
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, radius = 107 + rng() * 20; this._place(distant, i, [Math.sin(a) * radius, -4, Math.cos(a) * radius], [18 + rng() * 15, 13 + rng() * 28, 19 + rng() * 12], [0, a, 0]); }
    distant.castShadow = false; this._finishInstances(distant);
  }

  _makeStart() {
    const track = this.track, half = track.roadWidth / 2, p = sampleTrack(track, 0), arch = new THREE.Group();
    arch.name = 'Start finish at s=0, aligned to track tangent'; arch.position.set(p.x, p.y, p.z); arch.rotation.y = p.angle; this.world.add(arch);
    const wood = new Baker(), details = new Baker();
    for (const side of [-1, 1]) {
      const x = (half + .85) * side;
      wood.rod([x, 0, 0], [x, 5.95, 0], .22, '#aa8957');
      wood.rod([x, 3.6, 0], [x - side * 1.5, 5.65, 0], .13, '#ba9965');
      details.cylinder([x, .24, 0], [.44, .48, .44], '#e6c38b');
      for (const y of [1.3, 1.42, 4.6, 4.73]) details.torus([x, y, 0], .245, .045, '#e8d7a2', [Math.PI / 2, 0, 0]);
      details.ball([x, 6.12, 0], [.35, .38, .35], '#e3ac55');
      details.cone([x, 6.65, 0], [.55, .7, .24], '#548d55', [0, 0, -side * .4]);
    }
    wood.rod([-half - 1.1, 5.82, 0], [half + 1.1, 5.82, 0], .2, '#b48d54');
    this._mesh(arch, wood.geometry(), this.barkMaterial);
    this._mesh(arch, details.geometry(), this.bodyMaterial);
    const signTexture = this._texture('original-start-sign', () => canvasTexture(2048, 256, (c, w, h) => {
      c.fillStyle = '#234f42'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e8bd6d'; c.lineWidth = 13; c.strokeRect(10, 10, w - 20, h - 20);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff0c8';
      c.font = '900 136px Trebuchet MS, sans-serif'; c.fillText('JUNGLE KART', w / 2, 109);
      c.fillStyle = '#efbd76'; c.font = 'bold 36px Trebuchet MS, sans-serif'; c.fillText('W I L D   C I R C U I T', w / 2, 204);
      for (const x of [100, w - 100]) { c.save(); c.translate(x, 122); c.rotate(-.5); c.fillStyle = '#82b571'; c.beginPath(); c.ellipse(0, 0, 33, 63, 0, 0, TAU); c.fill(); c.restore(); }
    }, false));
    const sign = this._mesh(arch, new THREE.BoxGeometry(track.roadWidth + .9, 1.4, .23), this._mat({ map: signTexture, roughness: .8, vertexColors: false }));
    sign.position.y = 5.54;
    const paint = new Baker(), columns = Math.round(track.roadWidth / .55);
    for (let row = 0; row < 2; row++) for (let col = 0; col < columns; col++) {
      const left = mix(-half + .12, half - .12, col / columns), right = mix(-half + .12, half - .12, (col + 1) / columns);
      paint.add(makeRibbon(track, [left, right], q => q.y + .045, 1, () => WHITE, -.6 + row * .6, row * .6, 2), undefined, undefined, undefined, (row + col) % 2 ? '#364f47' : '#fff4dc');
    }
    this._mesh(this.world, paint.geometry(), this.bodyMaterial, false).name = 'Checkered start finish paint';
    const bunting = new Baker();
    for (let i = 0; i < 18; i++) {
      const x = mix(-half, half, i / 17), y = 4.55 - .25 * Math.sin(i / 17 * Math.PI);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-.22, 0, 0, .22, 0, 0, 0, -.46, .06], 3)); g.setIndex([0, 1, 2]); g.computeVertexNormals();
      bunting.add(g, [x, y, .05], undefined, undefined, ['#f0b459', '#dc7952', '#84bd94'][i % 3]);
    }
    this._mesh(arch, bunting.geometry(), this.leafMaterial, false);
  }

  _wheelGeometry(hover = false) {
    const key = hover ? '_hoverWheel' : '_wheel';
    if (this[key]) return this[key];
    const b = new Baker();
    if (hover) {
      b.cylinder([0, 0, 0], [.34, .14, .34], '#344f50');
      b.torus([0, .08, 0], .25, .055, '#a3eddb', [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) b.box([0, .08, 0], [.07, .04, .46], '#a4bdb4', [0, i / 6 * Math.PI, 0]);
    } else {
      b.cylinder([0, 0, 0], [.34, .24, .34], '#293538', [0, 0, Math.PI / 2], 18);
      for (const side of [-1, 1]) {
        b.cylinder([side * .125, 0, 0], [.22, .02, .22], '#c9d6ce', [0, 0, Math.PI / 2], 14);
        b.cylinder([side * .145, 0, 0], [.095, .035, .095], '#65746e', [0, 0, Math.PI / 2], 12);
        for (let j = 0; j < 5; j++) { const a = j / 5 * TAU; b.ball([side * .16, Math.sin(a) * .145, Math.cos(a) * .145], [.018, .025, .025], '#59665e', 6); }
      }
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * TAU;
        b.box([0, Math.sin(a) * .34, Math.cos(a) * .34], [.23, .035, .043], '#424b46', [-a, 0, .16 * (i % 2 ? 1 : -1)]);
      }
    }
    this[key] = this._geo(b.geometry(), true); return this[key];
  }

  _vehicleGeometry(vehicle, color, slot) {
    const b = new Baker(), chrome = new Baker(), dark = '#334743', rubber = '#303d38', cream = '#f2e8cb', metal = '#b1bbb0';
    // Shared footprint and wheel contact points are visual only; no vehicle-specific physics.
    // Painted panels go into `b`; polished trim, exhaust tips, hub caps and light rings go into `chrome`.
    b.box([0, .46, 0], [1.34, .2, 2.05], dark);
    b.ball([0, .65, -.3], [.46, .22, .47], '#6b5946');
    b.box([0, .91, -.65], [.78, .65, .19], '#695643', [-.15, 0, 0]);
    b.box([0, .88, -.76], [.55, .40, .07], color, [-.15, 0, 0]);
    if (vehicle === 'jeep') {
      b.box([0, .84, .65], [1.28, .51, .91], color);
      b.box([0, .86, 1.13], [1.12, .28, .08], cream);
      for (let i = -2; i <= 2; i++) b.box([i * .13, .84, 1.181], [.055, .19, .035], dark);
      for (const side of [-1, 1]) {
        b.box([side * .63, .83, -.3], [.12, .47, 1.3], color);
        for (const z of [-.76, .76]) b.box([side * .68, .78, z], [.37, .1, .74], color);
        b.ball([side * .43, .91, 1.18], [.12, .12, .04], '#fff0b6');
        b.rod([side * .61, .94, -.78], [side * .61, 1.87, -.83], .06, dark);
        b.rod([side * .61, 1.87, -.83], [side * .61, 1.87, .12], .06, dark);
        b.rod([side * .6, 1.08, .26], [side * .6, 1.45, .44], .045, cream);
      }
      b.rod([-.6, 1.45, .44], [.6, 1.45, .44], .045, cream);
      b.torus([0, .95, -1.13], .27, .1, rubber); chrome.cylinder([0, .95, -1.14], [.17, .08, .17], metal, [Math.PI / 2, 0, 0]);
    } else if (vehicle === 'buggy') {
      b.ball([0, .65, .65], [.57, .24, .60], color);
      for (const side of [-1, 1]) {
        b.rod([side * .62, .5, 1.01], [side * .65, .8, -.9], .08, color);
        b.rod([side * .6, .72, -.83], [side * .6, 1.83, -.55], .055, cream);
        b.rod([side * .6, 1.83, -.55], [side * .6, 1.53, .53], .055, cream);
        b.rod([side * .6, 1.53, .53], [side * .6, .65, 1], .055, cream);
        b.rod([side * .35, .49, .7], [side * .77, .4, .79], .05, metal);
        b.rod([side * .35, .49, -.7], [side * .77, .4, -.79], .05, metal);
        b.ball([side * .4, .8, 1], [.13, .1, .06], '#fff0bf');
      }
      b.rod([-.6, 1.83, -.55], [.6, 1.83, -.55], .055, cream);
      for (const x of [-.31, 0, .31]) chrome.cylinder([x, .75, -.95], [.12, .29, .12], metal);
    } else if (vehicle === 'coupe') {
      b.ball([0, .61, 0], [.79, .3, 1.19], color, 18);
      b.box([0, .81, .62], [1.28, .18, .87], color);
      b.box([0, .77, -.93], [1.25, .23, .35], color);
      for (const x of [-.16, .16]) b.box([x, .91, .7], [.13, .014, .72], cream);
      for (const side of [-1, 1]) {
        b.box([side * .48, .71, 1.1], [.26, .12, .055], '#fff0c6');
        b.box([side * .54, .71, -1.14], [.2, .11, .05], '#d95840');
        b.rod([side * .58, .86, .31], [side * .51, 1.31, .15], .045, cream);
        b.box([side * .67, .85, -.2], [.11, .32, 1.09], color);
      }
      b.rod([-.51, 1.31, .15], [.51, 1.31, .15], .04, cream);
      b.box([0, 1.06, -1.04], [1.47, .075, .23], dark);
    } else if (vehicle === 'hover') {
      b.ball([0, .58, 0], [.8, .23, 1.17], color, 18);
      b.ball([0, .76, .66], [.46, .18, .47], cream);
      for (const side of [-1, 1]) {
        b.ball([side * .63, .53, -.05], [.22, .24, 1.02], color);
        b.box([side * .78, .51, -.03], [.035, .065, 1.36], '#a9f6df');
        b.cone([side * .58, .92, -.86], [.075, .6, .34], dark, [-.3, 0, 0]);
        b.torus([side * .43, .63, -1.1], .14, .055, '#a4efd7');
      }
      b.box([0, .63, 1.14], [.64, .065, .03], '#d2ffe8');
    } else if (vehicle === 'tuktuk') {
      b.box([0, .73, -.5], [1.4, .40, 1.08], color);
      b.ball([0, .72, .73], [.39, .36, .49], color);
      b.ball([0, .97, 1.01], [.19, .18, .06], '#fff0b7');
      b.box([0, .67, 1.16], [.49, .17, .07], cream);
      for (const side of [-1, 1]) {
        b.rod([side * .64, .79, -.99], [side * .64, 2.32, -.99], .05, cream);
        b.rod([side * .64, .78, .35], [side * .64, 2.32, .35], .05, cream);
        b.box([side * .67, .92, -.52], [.12, .22, .9], color);
      }
      // The tuk-tuk has an open sunroof, so even the rabbit's ears remain unobscured.
      for (const side of [-1, 1]) b.ball([side * .65, 2.35, -.34], [.18, .14, .86], color);
      b.box([0, 2.34, -.98], [1.58, .17, .38], color);
      b.box([0, 2.32, .42], [1.58, .14, .18], cream);
      b.box([0, .92, -1.08], [.9, .24, .06], cream);
    } else {
      b.ball([0, .58, .15], [.76, .23, 1.05], color, 18);
      b.ball([0, .72, .71], [.49, .2, .48], color);
      b.box([0, .38, 1.14], [1.5, .13, .22], cream);
      for (const side of [-1, 1]) {
        b.box([side * .67, .6, -.17], [.24, .21, 1.13], color);
        b.rod([side * .75, .43, .67], [side * .75, .43, -.64], .065, dark);
        b.ball([side * .39, .69, .99], [.15, .07, .055], '#fbe7aa');
      }
      b.box([0, .92, -1.05], [1.38, .09, .24], color);
      for (let i = -2; i <= 2; i++) chrome.box([i * .13, .62, -.92], [.065, .19, .31], metal);
    }
    // A shield-shaped number badge made from geometry, visible without a downloaded font.
    b.ball([0, .90, .67], [.2, .027, .22], cream);
    const dots = clamp(finite(slot) + 1, 1, 6);
    for (let i = 0; i < dots; i++) b.ball([-.075 + (i % 3) * .075, .934, .64 + Math.floor(i / 3) * .075], [.024, .012, .024], '#365847', 6);
    b.rod([0, .66, .25], [0, 1.13, .46], .04, dark);
    b.torus([0, 1.14, .47], .23, .035, dark, [-.55, 0, 0]);
    chrome.rod([-.18, 1.14, .47], [.18, 1.14, .47], .025, metal);
    for (const side of [-1, 1]) {
      chrome.rod([side * .5, .46, -.84], [side * .52, .52, -1.22], .085, metal);
      chrome.cylinder([side * .52, .52, -1.235], [.065, .015, .065], '#e6f2ef', [Math.PI / 2, 0, 0]);
      b.box([side * .53, .74, -1.08], [.14, .09, .05], '#f07852');
    }
    // Polished chrome accents shared by every body style: hub caps, bumper trim, headlight rings, exhaust collar.
    for (const [x, z] of [[-.74, .77], [.74, .77], [-.74, -.77], [.74, -.77]]) {
      if (vehicle === 'tuktuk' && Math.abs(x) < .1 && z > 0) continue;
      chrome.cylinder([x * .99, .35, z], [.11, .04, .11], '#eef4f1', [0, 0, Math.PI / 2], 12);
    }
    chrome.box([0, .47, 1.03], [1.36, .055, .05], '#dfe8e4');
    chrome.box([0, .47, -1.03], [1.36, .055, .05], '#dfe8e4');
    for (const side of [-1, 1]) {
      chrome.torus([side * .43, .82, 1.06], .085, .018, '#f2f7f4', [Math.PI / 2, 0, 0]);
      chrome.torus([side * .53, .78, -1.10], .07, .016, '#f2f7f4', [Math.PI / 2, 0, 0]);
    }
    chrome.cylinder([0, .55, -1.16], [.09, .06, .09], '#e8eeeb', [Math.PI / 2, 0, 0], 12);
    return { paint: b.geometry(), chrome: chrome.geometry() };
  }

  _animalGeometry(animal, scarf) {
    const spec = ANIMALS.find(a => a.id === animal) || ANIMALS[0], fur = new Baker(), detail = new Baker();
    const main = spec.color, secondary = spec.secondary, cream = '#f4e5c5', dark = '#303e35', pink = '#ce9685';
    const headY = 1.73, headZ = -.12;
    fur.ball([0, 1.14, -.22], [.35, .43, .31], animal === 'panda' ? dark : main);
    fur.ball([0, 1.18, .032], [.23, .29, .095], ['panda', 'raccoon'].includes(animal) ? cream : secondary);
    fur.ball([0, headY, headZ], animal === 'capybara' ? [.45, .42, .45] : animal === 'crocodile' ? [.44, .36, .43] : [.48, .46, .43], main, 18);
    const pointed = ['fox', 'tiger', 'leopard', 'redpanda', 'raccoon'].includes(animal);
    if (pointed) {
      for (const side of [-1, 1]) {
        fur.cone([side * .34, 2.12, -.17], [.20, .42, .18], main, [0, 0, -side * .2]);
        detail.cone([side * .34, 2.14, -.027], [.115, .25, .045], animal === 'fox' ? dark : pink, [0, 0, -side * .2]);
      }
    } else if (animal === 'rabbit') {
      for (const side of [-1, 1]) {
        fur.add(new THREE.SphereGeometry(1, 12, 10), [side * .22, 2.42, -.15], [.145, .63, .16], [0, 0, -side * .17], main);
        detail.add(new THREE.SphereGeometry(1, 10, 8), [side * .22, 2.45, -.005], [.078, .44, .033], [0, 0, -side * .17], pink);
      }
    } else if (animal === 'elephant') {
      for (const side of [-1, 1]) {
        fur.ball([side * .52, 1.76, -.19], [.36, .43, .16], main);
        detail.ball([side * .55, 1.76, -.05], [.245, .31, .035], secondary);
      }
    } else if (animal !== 'frog' && animal !== 'crocodile') {
      for (const side of [-1, 1]) {
        const big = animal === 'koala' ? .29 : animal === 'monkey' ? .24 : .17;
        const y = animal === 'monkey' ? 1.82 : animal === 'capybara' ? 2.04 : 2.07;
        fur.ball([side * .41, y, -.19], [big, big, .15], animal === 'panda' ? dark : main);
        detail.ball([side * .43, y, -.052], [big * .63, big * .64, .032], animal === 'panda' ? '#596254' : secondary);
      }
    }
    if (animal === 'monkey') {
      fur.ball([-.18, 1.77, .233], [.25, .30, .13], secondary); fur.ball([.18, 1.77, .233], [.25, .30, .13], secondary);
      fur.ball([0, 1.52, .23], [.32, .2, .22], secondary);
    } else if (animal === 'crocodile') {
      fur.ball([0, 1.57, .48], [.37, .20, .64], main);
      fur.ball([0, 1.44, .49], [.33, .085, .57], secondary);
      for (const side of [-1, 1]) {
        detail.ball([side * .21, 1.76, .82], [.043, .018, .045], dark, 8);
        for (const z of [.4, .65, .86]) detail.cone([side * .3, 1.46, z], [.04, .10, .04], cream, [Math.PI, 0, 0], 6);
      }
      for (let i = 0; i < 4; i++) fur.cone([0, 2.05 - i * .025, -.36 + i * .15], [.08, .15, .08], '#416e4b');
    } else if (animal === 'elephant') {
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        fur.ball([Math.sin(t * 2.7) * .075, 1.67 - t * .62, .3 + t * .27], [.125 - t * .035, .135, .14 - t * .045], main);
      }
      for (const side of [-1, 1]) detail.cone([side * .22, 1.5, .42], [.065, .26, .065], cream, [-.8, 0, side * .25]);
    } else if (animal === 'frog') {
      fur.ball([0, 1.5, .13], [.4, .15, .30], secondary);
      detail.rod([-.25, 1.52, .354], [0, 1.48, .40], .018, '#4f7042'); detail.rod([0, 1.48, .40], [.25, 1.52, .354], .018, '#4f7042');
      for (const side of [-1, 1]) fur.ball([side * .29, 2.04, .075], [.23, .24, .21], main);
    } else {
      const long = animal === 'capybara', fox = animal === 'fox';
      const muzzleColor = ['tiger', 'leopard', 'panda', 'redpanda', 'raccoon', 'otter', 'rabbit'].includes(animal) ? cream : secondary;
      if (long) fur.ball([0, 1.57, .29], [.36, .24, .37], secondary);
      else if (fox) {
        fur.ball([0, 1.54, .26], [.32, .23, .26], cream);
        fur.ball([0, 1.59, .41], [.17, .13, .25], main);
      } else for (const side of [-1, 1]) fur.ball([side * .13, 1.56, .265], [.21, .16, .19], muzzleColor);
      detail.ball([0, animal === 'koala' ? 1.69 : 1.62, animal === 'fox' ? .635 : long ? .62 : .425], animal === 'koala' ? [.15, .23, .105] : long ? [.15, .07, .04] : [.085, .057, .052], animal === 'rabbit' ? pink : dark, 12);
      if (animal === 'rabbit') for (const side of [-1, 1]) detail.box([side * .045, 1.40, .385], [.07, .105, .045], WHITE);
      if (animal !== 'koala') detail.rod([0, 1.55, .423], [0, 1.49, .424], .012, '#725442');
    }
    // Species-specific patterns are real geometry over textured fur, visible from the chase camera too.
    if (animal === 'tiger') {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          detail.add(new THREE.SphereGeometry(1, 8, 6), [side * (.40 - i * .02), 1.88 - i * .16, .045], [.10, .035, .25], [0, side * .45, side * .3], secondary);
          detail.add(new THREE.SphereGeometry(1, 8, 6), [side * (.2 + i * .065), 1.98 - i * .15, -.463], [.045, .14, .026], [0, 0, side * .55], secondary);
        }
        detail.ball([side * .17, 2.115, -.02], [.037, .035, .15], secondary);
      }
    } else if (animal === 'leopard') {
      const rng = randomSeed(118);
      for (let i = 0; i < 34; i++) {
        const a = rng() * TAU, y = rng() * 1.45 - .52, radius = Math.sqrt(Math.max(.1, 1 - y * y));
        const x = Math.sin(a) * .477 * radius, z = headZ + Math.cos(a) * .43 * radius;
        if (z > .15 && Math.abs(x) < .32 && y < .25) continue;
        detail.ball([x, headY + y * .45, z], [.045, .049, .043], secondary, 7);
        if (i % 2) detail.ball([x * 1.01, headY + y * .45 + .015, headZ + (z - headZ) * 1.012], [.020, .021, .022], main, 6);
      }
    } else if (animal === 'raccoon' || animal === 'panda' || animal === 'redpanda') {
      for (const side of [-1, 1]) {
        const patch = animal === 'redpanda' ? cream : secondary;
        detail.add(new THREE.SphereGeometry(1, 14, 10), [side * .23, 1.82, .225], [.21, animal === 'panda' ? .22 : .14, .105], [0, side * .35, side * -.23], patch);
        if (animal === 'redpanda') detail.ball([side * .4, 1.58, .13], [.13, .17, .15], cream);
      }
    } else if (animal === 'otter') {
      detail.ball([0, 1.34, .06], [.17, .10, .045], cream);
    }
    // Big wet eyes, dark pupils and two pinprick highlights; eyes sit above facial masks.
    for (const side of [-1, 1]) {
      const x = side * (animal === 'frog' ? .29 : animal === 'crocodile' ? .26 : .215);
      const y = animal === 'frog' ? 2.07 : animal === 'crocodile' ? 1.94 : 1.83;
      const z = animal === 'frog' ? .25 : animal === 'crocodile' ? .20 : .325;
      detail.ball([x, y, z], [.119, .143, .077], '#fffbee', 14);
      detail.ball([x + side * .009, y - .006, z + .061], [.068, .088, .032], dark, 12);
      detail.ball([x - .020, y + .036, z + .087], [.022, .028, .012], WHITE, 8);
      detail.ball([x + .025, y - .036, z + .09], [.009, .012, .009], '#e1f1d3', 6);
      if (animal !== 'frog') detail.add(new THREE.SphereGeometry(1, 8, 6), [x, y + .165, z - .018], [.13, .023, .031], [0, 0, -side * .12], animal === 'panda' ? '#454d3d' : secondary);
      if (['tiger', 'leopard', 'otter', 'rabbit', 'fox', 'raccoon'].includes(animal)) {
        for (let k = 0; k < 3; k++) detail.ball([side * (.14 + k * .045), 1.55 + (k % 2) * .05, .405 - k * .02], [.009, .009, .008], '#7f725a', 6);
      }
    }
    // Tails are intentionally on the rear of the kart, where a chase camera can read them.
    if (['tiger', 'raccoon', 'redpanda', 'fox', 'leopard', 'monkey', 'otter', 'crocodile'].includes(animal)) {
      const bushy = ['fox', 'redpanda', 'raccoon'].includes(animal), count = 8;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1), radius = bushy ? .19 * (1 - t * .4) : animal === 'crocodile' ? .18 * (1 - t * .8) : .085;
        let color = main;
        if (['tiger', 'raccoon', 'redpanda'].includes(animal) && i % 2) color = animal === 'redpanda' ? '#e6b480' : secondary;
        if (animal === 'fox' && i > 4) color = cream;
        fur.ball([Math.sin(t * 2.2) * .36, .91 + (animal === 'monkey' ? Math.sin(t * 4) * .28 : -.22 * t), -.47 - t * .76], [radius, radius, radius * 1.45], color, 10);
      }
    } else fur.ball([0, 1.01, -.51], [.14, .15, .16], animal === 'rabbit' ? cream : main);
    detail.torus([0, 1.36, -.2], .275, .07, scarf, [Math.PI / 2, 0, 0]);
    detail.box([.15, 1.15, -.5], [.16, .37, .045], scarf, [.2, 0, -.23]);
    detail.box([-.04, 1.19, -.52], [.12, .31, .04], scarf, [.1, 0, .13]);
    for (const side of [-1, 1]) fur.ball([side * .23, .84, .13], [.15, .13, .20], animal === 'panda' ? dark : main);
    return { fur: fur.geometry(), details: detail.geometry(), armColor: ['panda', 'redpanda'].includes(animal) ? dark : main };
  }

  _makeRacer(player) {
    const animal = ANIMALS.some(a => a.id === player.animal) ? player.animal : ANIMALS[0].id;
    const vehicle = VEHICLES.some(v => v.id === player.vehicle) ? player.vehicle : VEHICLES[0].id;
    const color = typeof player.color === 'string' ? player.color : '#ed8b57';
    const root = new THREE.Group(); root.name = `${animal} / ${vehicle} / ${String(player.id)}`; this.racers.add(root);
    const body = new THREE.Group(); root.add(body);
    const vehicleGeometry = this._vehicleGeometry(vehicle, color, player.slot);
    this._mesh(body, vehicleGeometry.paint, this.paintMaterial);
    this._mesh(body, vehicleGeometry.chrome, this.chromeMaterial);
    const driver = new THREE.Group(); body.add(driver);
    const animalGeometry = this._animalGeometry(animal, color);
    this._mesh(driver, animalGeometry.fur, this.furMaterial);
    this._mesh(driver, animalGeometry.details, this.bodyMaterial);
    const arms = this._instances(driver, new Baker().cylinder([0, 0, 0], [.10, 1, .10], animalGeometry.armColor).ball([0, -.5, 0], [.12, .11, .12], animalGeometry.armColor).geometry(), this.furMaterial, 2);
    const wheelPositions = vehicle === 'tuktuk' ? [[0, .35, .89], [-.73, .35, -.75], [.73, .35, -.75]] : [[-.74, .35, .77], [.74, .35, .77], [-.74, .35, -.77], [.74, .35, -.77]];
    const wheels = this._instances(root, this._wheelGeometry(vehicle === 'hover'), this.bodyMaterial, wheelPositions.length, true);
    const model = { root, body, driver, arms, wheels, wheelPositions, animal, vehicle, color, slot: player.slot, spin: 0, id: player.id };
    this._models.set(player.id, model); return model;
  }

  _makeEffects() {
    const crystalMap = this._texture('item-crystal', () => canvasTexture(512, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.3, 'rgba(220,255,240,.55)');
      g.addColorStop(.6, 'rgba(160,230,255,.35)'); g.addColorStop(1, 'rgba(255,220,255,.6)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const rng = randomSeed(317);
      for (let i = 0; i < 70; i++) {
        const x = rng() * w, y = rng() * h, len = 30 + rng() * 180, angle = rng() * Math.PI;
        c.strokeStyle = `rgba(255,255,255,${.08 + rng() * .35})`; c.lineWidth = .7 + rng() * 2.2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len); c.stroke();
      }
      for (let i = 0; i < 220; i++) {
        const x = rng() * w, y = rng() * h, size = .6 + rng() * 2.4;
        c.fillStyle = `rgba(255,255,255,${.4 + rng() * .55})`; c.fillRect(x, y, size, size);
      }
    }));
    // A faceted diamond/octahedron — reads instantly as "power crystal" and tints per-box.
    const crystalGeometry = new THREE.OctahedronGeometry(.62, 0);
    const crystalMaterial = this._mat({
      map: crystalMap, vertexColors: false, transparent: true, opacity: .92,
      emissive: '#ffffff', emissiveIntensity: .9, roughness: .12, metalness: .25,
      side: THREE.DoubleSide, depthWrite: true
    }, true);
    this.crates = this._instances(this.effects, crystalGeometry, crystalMaterial, 48);
    this.crates.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.crates.frustumCulled = false; this.crates.count = 0;
    // Inner glowing core so the crystal reads from a distance even when the shell is transparent.
    const coreGeometry = new THREE.OctahedronGeometry(.34, 0);
    const coreMaterial = this._mat({ vertexColors: false, emissive: '#ffffff', emissiveIntensity: 2.4, transparent: true, opacity: .95, roughness: .2, depthWrite: false }, true);
    this.crateCores = this._instances(this.effects, coreGeometry, coreMaterial, 48);
    this.crateCores.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.crateCores.frustumCulled = false; this.crateCores.count = 0;
    this.crateCores.renderOrder = 3;
    const coconut = new Baker().ball([0, 0, 0], [.31, .34, .3], '#9b7651');
    coconut.torus([0, 0, 0], .295, .018, '#d9bc80', [Math.PI / 2, 0, .25]);
    for (const x of [-.09, .09]) coconut.ball([x, .08, .279], [.028, .03, .012], '#453c2d', 6);
    coconut.cone([.11, .37, 0], [.12, .34, .045], '#79a753', [0, 0, -.7]);
    this.coconuts = this._instances(this.effects, coconut.geometry(), this.bodyMaterial, 48);
    const rocket = new Baker();
    rocket.cone([0, .55, 0], [.28, .55, .28], '#ff7a59');
    rocket.cylinder([0, .12, 0], [.22, .58, .22], '#f5e2c8');
    rocket.cylinder([0, -.22, 0], [.18, .18, .18], '#caa47a');
    for (let i = 0; i < 4; i++) rocket.box([Math.sin(i / 4 * TAU) * .25, -.18, Math.cos(i / 4 * TAU) * .25], [.06, .3, .18], '#e7c46b', [0, i / 4 * TAU, 0]);
    rocket.ball([0, -.35, 0], [.16, .12, .16], '#fff0a8');
    this.rockets = this._instances(this.effects, rocket.geometry(), this.bodyMaterial, 24);
    const shell = new Baker();
    shell.ball([0, 0, 0], [.36, .32, .36], '#7ed5d2', 18);
    shell.torus([0, 0, 0], .34, .045, '#5aa9b3', [Math.PI / 2, 0, 0]);
    shell.torus([0, 0, 0], .34, .04, '#a8e8e3', [0, 0, Math.PI / 2]);
    for (let i = 0; i < 6; i++) shell.ball([Math.sin(i / 6 * TAU) * .22, .12, Math.cos(i / 6 * TAU) * .22], [.07, .05, .07], '#e3f7f3', 6);
    this.shells = this._instances(this.effects, shell.geometry(), this.bodyMaterial, 24);
    const banana = new Baker();
    banana.torus([0, .04, 0], .26, .085, '#ffd966', [Math.PI / 2.6, .3, 0]);
    banana.ball([-.2, .12, .04], [.06, .05, .06], '#7a5b2a', 6);
    banana.ball([.21, .11, -.04], [.06, .05, .06], '#7a5b2a', 6);
    this.bananas = this._instances(this.effects, banana.geometry(), this.bodyMaterial, 32);
    this.mud = this._instances(this.effects, new Baker().ball([0, 0, 0], [1.05, .065, .87], '#74583b').ball([.4, .008, .45], [.56, .07, .47], '#8d6b42').ball([-.54, .005, -.19], [.52, .068, .53], '#806445').geometry(), this._mat({ roughness: .3 }, true), 64);
    const shadowMap = this._texture('contact-shadow', () => canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 9, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(20,39,28,.42)'); g.addColorStop(.5, 'rgba(20,39,28,.25)'); g.addColorStop(1, 'rgba(20,39,28,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, false));
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }); this._materials.add(shadowMaterial);
    this.contacts = this._instances(this.effects, new THREE.PlaneGeometry(1, 1), shadowMaterial, 6); this.contacts.renderOrder = 1;
    const shieldMap = this._texture('vine-shield', () => canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = 'rgba(122,227,167,.09)'; c.fillRect(0, 0, w, h);
      for (let i = -2; i < 7; i++) {
        c.strokeStyle = 'rgba(165,250,151,.68)'; c.lineWidth = 6; c.beginPath();
        for (let y = 0; y <= h; y += 4) { const x = i * 128 + Math.sin(y / h * TAU) * 48; if (y === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
        for (let y = 32; y < h; y += 85) { const x = i * 128 + Math.sin(y / h * TAU) * 48; c.fillStyle = 'rgba(193,255,158,.8)'; c.beginPath(); c.ellipse(x + 10, y, 18, 7, -.65, 0, TAU); c.fill(); }
      }
    }));
    this.shields = this._instances(this.effects, new THREE.SphereGeometry(1, 24, 16), this._mat({ map: shieldMap, vertexColors: false, transparent: true, opacity: .66, depthWrite: false, side: THREE.FrontSide, emissive: '#8cd66f', emissiveIntensity: .5, roughness: .35 }, true), 6);
    this.shields.renderOrder = 4;
    const starMap = this._texture('sun-star', () => canvasTexture(256, 256, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,242,176,.95)'); g.addColorStop(.45, 'rgba(255,206,90,.55)'); g.addColorStop(1, 'rgba(255,180,40,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, false));
    this.starAuras = this._instances(this.effects, new THREE.SphereGeometry(1, 18, 12), this._mat({ map: starMap, vertexColors: false, transparent: true, opacity: .8, depthWrite: false, emissive: '#ffcc55', emissiveIntensity: 1.2, roughness: .3 }, true), 6);
    this.starAuras.renderOrder = 5;
    const sparkMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); this._materials.add(sparkMaterial);
    this.sparks = this._instances(this.effects, new Baker().add(new THREE.IcosahedronGeometry(1, 0)).geometry(), sparkMaterial, 256);
    this.stars = this._instances(this.effects, new Baker().add(starGeometry(), undefined, undefined, undefined, '#ffe187').geometry(), this._mat({ emissive: '#ffd070', emissiveIntensity: .8 }, true), 30);
    const flameMap = this._texture('boost-fire', () => canvasTexture(64, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,94,33,0)'); g.addColorStop(.4, '#ff9c37'); g.addColorStop(.78, '#ffe79c'); g.addColorStop(1, '#fffbe1'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, false));
    this.flames = this._instances(this.effects, new THREE.ConeGeometry(1, 1, 8), this._mat({ map: flameMap, vertexColors: false, transparent: true, depthWrite: false, emissive: '#ffab49', emissiveIntensity: 2, roughness: 1 }, true), 12);
    for (const mesh of [this.coconuts, this.rockets, this.shells, this.bananas, this.mud, this.contacts, this.shields, this.sparks, this.stars, this.flames]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false; mesh.receiveShadow = false;
    }
  }

  _demoPlayers(players) {
    const entries = players.slice(0, 6).map(p => ({ ...p }));
    const animals = ['tiger', 'panda', 'rabbit', 'crocodile', 'elephant'];
    const colors = ['#ed8b57', '#66bcb4', '#b59bd2', '#eac264', '#8fab76'];
    while (entries.length < 5) {
      const index = entries.length;
      entries.push({ id: `__showcase_${index}`, slot: index, animal: animals[index], vehicle: VEHICLES[index].id, color: colors[index], name: ANIMALS.find(a => a.id === animals[index]).name });
    }
    return entries.map((p, i) => {
      const distance = this._demoClock * 7.4 + 9 - [0, 10, 17, 26, 35, 42][i];
      const offset = [-.45, 2.3, -2.15, 1.7, -1.65, 2.2][i] + Math.sin(this._clock * .5 + i) * .27;
      const point = sampleTrack(this.track, distance, offset);
      return { ...p, x: point.x, y: point.y, z: point.z, angle: point.angle, speed: 7.4, steer: Math.sin(this._clock + i) * .12, drifting: false, boost: 0, shield: 0, stun: 0, progress: distance };
    });
  }
  _syncRacers(players, dt, lobby) {
    const ids = new Set(players.map(p => p.id));
    for (const [id, model] of this._models) if (!ids.has(id)) { this._release(model.root); this._models.delete(id); }
    players.forEach((p, index) => {
      let model = this._models.get(p.id);
      const animal = ANIMALS.some(a => a.id === p.animal) ? p.animal : ANIMALS[0].id;
      const vehicle = VEHICLES.some(v => v.id === p.vehicle) ? p.vehicle : VEHICLES[0].id;
      const color = typeof p.color === 'string' ? p.color : '#ed8b57';
      if (model && (model.animal !== animal || model.vehicle !== vehicle || model.color !== color || model.slot !== p.slot)) { this._release(model.root); this._models.delete(p.id); model = null; }
      if (!model) model = this._makeRacer(p);
      const angle = finite(p.angle), speed = finite(p.speed), steer = clamp(finite(p.steer), -1, 1);
      const ground = projectTrack(this.track, finite(p.x), finite(p.z));
      const slope = (sampleTrack(this.track, ground.distance + 1.2).y - sampleTrack(this.track, ground.distance - 1.2).y) / 2.4;
      const headingSlope = slope * (Math.sin(angle) * ground.tx + Math.cos(angle) * ground.tz);
      const pitch = Math.atan(headingSlope * (1 - smooth((Math.abs(ground.lateral) - this.track.roadWidth / 2) / 14)));
      model.root.position.set(finite(p.x), finite(p.y), finite(p.z)); model.root.rotation.set(-pitch, angle, 0, 'YXZ');
      // Wheels follow the local grade; only the sprung body/driver bobs above it.
      model.body.position.y = Math.sin(this._clock * (vehicle === 'hover' ? 3 : 12) + index) * (vehicle === 'hover' ? .055 : Math.min(.025, Math.abs(speed) * .001));
      model.body.rotation.z = -steer * Math.min(.07, Math.abs(speed) * .0035);
      model.driver.rotation.y = lobby ? Math.sin(this._clock * .7 + index) * .14 : steer * .1;
      model.driver.rotation.z = Math.sin(this._clock * 4 + index) * .015;
      model.spin = (model.spin + speed * dt / .35) % TAU;
      model.wheelPositions.forEach((position, i) => {
        const front = vehicle === 'tuktuk' ? i === 0 : i < 2;
        if (vehicle === 'hover') this._place(model.wheels, i, [position[0], .29, position[2]], [1, 1, 1], [0, model.spin, 0]);
        else {
          this._dummy.position.set(...position); this._dummy.scale.set(1, 1, 1);
          this._dummy.rotation.set(model.spin, front ? steer * .42 : 0, 0, 'YXZ'); this._dummy.updateMatrix(); model.wheels.setMatrixAt(i, this._dummy.matrix);
        }
      });
      model.wheels.instanceMatrix.needsUpdate = true;
      if (!model.wheels.boundingSphere) model.wheels.computeBoundingSphere();
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1, a = new THREE.Vector3(side * .29, 1.29, -.12), b = new THREE.Vector3(side * .20 + steer * .06, 1.16 + side * steer * .045, .43);
        const direction = a.clone().sub(b), midpoint = a.clone().add(b).multiplyScalar(.5);
        this._dummy.position.copy(midpoint); this._dummy.quaternion.setFromUnitVectors(UP, direction.clone().normalize()); this._dummy.scale.set(1, direction.length(), 1); this._dummy.updateMatrix(); model.arms.setMatrixAt(i, this._dummy.matrix);
      }
      model.arms.instanceMatrix.needsUpdate = true; if (!model.arms.boundingSphere) model.arms.computeBoundingSphere();
    });
  }

  _syncEffects(state, players, lobby, dt) {
    const time = this._clock;
    let boxes = Array.isArray(state.boxes) ? state.boxes : [];
    if (lobby) boxes = [.10, .31, .52, .72, .89].flatMap((fraction, i) => [-2.6, 2.6].map((offset, j) => ({ ...sampleTrack(this.track, this.track.length * fraction, offset), id: `demo-box-${i}-${j}`, available: true })));
    let count = 0;
    const palette = ['#ff7ad9', '#7af6ff', '#b6ff7a', '#ffd76a', '#c79bff', '#ff9a6a', '#7affc4', '#ffe86a'];
    for (const box of boxes) {
      if (!box.available || count >= 48) continue;
      const hue = palette[(count + Math.floor(time * .6)) % palette.length];
      const pulse = .92 + Math.sin(time * 3.1 + count) * .08;
      this._place(this.crates, count, [finite(box.x), finite(box.y) + .95 + Math.sin(time * 2.3 + count) * .16, finite(box.z)], [pulse, pulse * 1.25, pulse], [.18 * Math.sin(time * .8 + count), time * .85 + count, .18 * Math.cos(time * .6 + count)], hue);
      const corePulse = .85 + Math.sin(time * 5.4 + count * 1.7) * .25;
      this._place(this.crateCores, count, [finite(box.x), finite(box.y) + .95 + Math.sin(time * 2.3 + count) * .16, finite(box.z)], [corePulse, corePulse * 1.2, corePulse], [0, -time * 1.6 + count, 0], '#ffffff');
      count++;
    }
    this.crates.count = count; this.crates.instanceMatrix.needsUpdate = true; if (this.crates.instanceColor) this.crates.instanceColor.needsUpdate = true;
    this.crateCores.count = count; this.crateCores.instanceMatrix.needsUpdate = true;
    let coconuts = 0, mud = 0, rockets = 0, shells = 0, bananas = 0;
    if (!lobby) {
      for (const p of state.projectiles || []) {
        if (p.type === 'coconut' && coconuts < 48) this._place(this.coconuts, coconuts++, [finite(p.x), finite(p.y) + .4, finite(p.z)], [1, 1, 1], [time * 6, finite(p.angle) + time * 3, time]);
        else if (p.type === 'rocket' && rockets < 24) this._place(this.rockets, rockets++, [finite(p.x), finite(p.y) + .35, finite(p.z)], [1, 1, 1], [Math.PI / 2 + Math.cos(time * 8) * .08, finite(p.angle), 0]);
        else if (p.type === 'shell' && shells < 24) this._place(this.shells, shells++, [finite(p.x), finite(p.y) + .35, finite(p.z)], [1, 1, 1], [time * 4, finite(p.angle), time * 2.4]);
      }
      for (const h of state.hazards || []) {
        if (h.type === 'mud' && mud < 64) this._place(this.mud, mud++, [finite(h.x), finite(h.y) + .05, finite(h.z)], [1, 1, 1], [0, finite(h.angle), 0]);
        else if (h.type === 'banana' && bananas < 32) this._place(this.bananas, bananas++, [finite(h.x), finite(h.y) + .12, finite(h.z)], [1, 1, 1], [0, finite(h.angle), 0]);
      }
    }
    this.coconuts.count = coconuts; this.mud.count = mud; this.rockets.count = rockets; this.shells.count = shells; this.bananas.count = bananas;
    for (const mesh of [this.coconuts, this.mud, this.rockets, this.shells, this.bananas]) mesh.instanceMatrix.needsUpdate = true;
    let shields = 0, stars = 0, flames = 0, sparks = 0, starAuras = 0;
    const addSpark = (position, scale, color, rotation = [0, 0, 0]) => {
      if (sparks < 256) this._place(this.sparks, sparks++, position, scale, rotation, color);
    };
    players.forEach((p, index) => {
      const x = finite(p.x), y = finite(p.y), z = finite(p.z), angle = finite(p.angle), sin = Math.sin(angle), cos = Math.cos(angle);
      const local = (sx, sy, sz) => [x + cos * sx + sin * sz, y + sy, z - sin * sx + cos * sz];
      const contactRotation = this._models.get(p.id).root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      this._place(this.contacts, index, [x, y + .052, z], [2.35, 3.15, 1], contactRotation);
      if (p.shield > 0) this._place(this.shields, shields++, local(0, 1.1, 0), [1.43, 1.55, 1.7], [0, time * .38, 0]);
      if (p.star > 0 && starAuras < 6) this._place(this.starAuras, starAuras++, local(0, 1.15, 0), [1.55 + Math.sin(time * 7 + index) * .07, 1.6, 1.85], [0, time * 1.4, 0]);
      if (p.stun > 0) for (let j = 0; j < 4; j++) {
        const a = time * 3 + j * TAU / 4; this._place(this.stars, stars++, local(Math.cos(a) * .69, 2.58 + Math.sin(a * 2) * .1, Math.sin(a) * .69), [.16, .16, .16], [0, -angle - a, .1]);
      }
      if (p.boost > 0) {
        for (const side of [-1, 1]) {
          const length = .65 + (.5 + Math.sin(time * 37 + side + index) * .5) * .65;
          this._place(this.flames, flames++, local(side * .52, .5, -1.25 - length / 2), [.17, length, .17], [-Math.PI / 2, angle, 0]);
        }
        for (let j = 0; j < 9; j++) {
          const t = ((time * 3 + j / 9) % 1), side = j % 2 ? 1 : -1;
          addSpark(local(side * (.7 + t * .4), .3 + (j % 3) * .12, -1.2 - t * 3.1), [.025 * (1 - t), .027, .18 + t * .3], j % 2 ? '#ffba55' : '#fff0b8', [0, angle, 0]);
        }
      }
      if (p.drifting) for (let j = 0; j < 8; j++) {
        const t = (time * 4 + j / 8) % 1, side = j % 2 ? 1 : -1;
        addSpark(local(side * (.75 + t * .38), .18 + Math.sin(t * Math.PI) * .4, -.8 - t * 1.5), [.04 * (1 - t), .07 * (1 - t), .13], finite(p.driftCharge) > 1 ? '#72e8e4' : '#ffd67d', [t, angle, t]);
      }
    });
    if (!lobby) for (const event of state.events || []) {
      if (event.id == null || this._seenEvents.has(event.id)) continue;
      this._seenEvents.set(event.id, time);
      if (Number.isFinite(event.x) && Number.isFinite(event.z)) this._bursts.push({ x: event.x, y: finite(event.y), z: event.z, color: event.color || ({ boost: '#ffbc65', hit: '#ffe4a1', rocket: '#ff8a55', banana: '#ffe066', lightning: '#cdb4ff', magnet: '#9ee5a4', swap: '#f6b8d6', star: '#ffe27a', shell: '#7ed5d2', spin: '#ffd06a', blocked: '#a6e0a1', mudtrap: '#c39a6b' }[event.type] || '#a6e0a1'), born: time });
    }
    this._bursts = this._bursts.filter(b => time - b.born < .7).slice(-12);
    for (const burst of this._bursts) {
      const t = (time - burst.born) / .7;
      for (let j = 0; j < 10; j++) {
        const a = j / 10 * TAU, radius = .3 + t * 2;
        addSpark([burst.x + Math.sin(a) * radius, burst.y + .3 + Math.sin(t * Math.PI) * (j % 3 + 1) * .42, burst.z + Math.cos(a) * radius], [.065 * (1 - t), .10 * (1 - t), .065 * (1 - t)], burst.color, [t * 3, a, t]);
      }
    }
    if (this._seenEvents.size > 512) for (const [id, born] of this._seenEvents) if (time - born > 10 || this._seenEvents.size > 512) this._seenEvents.delete(id);
    this.contacts.count = players.length; this.shields.count = shields; this.starAuras.count = starAuras; this.stars.count = stars; this.flames.count = flames; this.sparks.count = sparks;
    for (const mesh of [this.contacts, this.shields, this.starAuras, this.stars, this.flames, this.sparks]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    if (this.waterMaterial) this.waterMaterial.uniforms.time.value = time;
    if (this.fallTexture) this.fallTexture.offset.y = (time * .45) % 1;
  }

  _follow(camera, index, player, dt, lobby, rect, phase) {
    const key = `${String(player.id)}:${this.track.id}:${lobby ? 'showcase' : 'race'}`;
    let follow = this._cameraStates[index];
    const x = finite(player.x), y = finite(player.y), z = finite(player.z), angle = finite(player.angle);
    // Front three-quarter tracking in the lobby shows faces, with the hero to the title's right.
    // Racing always uses an unobstructed forward-looking chase camera behind the kart.
    const sin = Math.sin(angle), cos = Math.cos(angle), behind = lobby ? -6.7 : 7.2, lateral = lobby ? -3.5 : 0;
    const desired = new THREE.Vector3(x - sin * behind + cos * lateral, y + (lobby ? 3.35 : 3.3), z - cos * behind - sin * lateral);
    // Sample the viewed road elevation to avoid staring into tarmac on crests and climbs.
    const projection = projectTrack(this.track, x, z), ahead = sampleTrack(this.track, projection.distance + (lobby ? -7 : 7));
    const lookAhead = lobby ? -4.8 : 7, lookSide = lobby ? -1.6 : 0;
    const target = new THREE.Vector3(x + sin * lookAhead + cos * lookSide, mix(y, ahead.y, .65) + 1.0, z + cos * lookAhead - sin * lookSide);
    if (!follow || follow.key !== key || follow.position.distanceToSquared(desired) > 700) {
      follow = { key, position: desired.clone(), target: target.clone() }; this._cameraStates[index] = follow;
    } else {
      follow.position.lerp(desired, 1 - Math.exp(-dt * (lobby ? 4 : 8)));
      follow.target.lerp(target, 1 - Math.exp(-dt * 10));
    }
    const underCamera = projectTrack(this.track, follow.position.x, follow.position.z);
    if (Math.abs(underCamera.lateral) < this.track.roadWidth / 2 + 13) follow.position.y = Math.max(follow.position.y, this._landHeight(underCamera, underCamera.lateral) + .95);
    camera.position.copy(follow.position); camera.up.set(0, 1, 0); camera.lookAt(follow.target);
    const aspect = rect.w / rect.h, fov = lobby ? 55 : aspect > 2.5 ? 57 : 64;
    if (camera.aspect !== aspect || camera.fov !== fov) { camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.userData.playerId = player.id; camera.userData.phase = phase;
  }

  update(state, dt, viewPlayerIds = []) {
    if (this._disposed || this._podium || !state) return;
    dt = clamp(finite(dt, 1 / 60), 0, .1); this._clock += dt;
    const lobby = state.phase === 'lobby';
    let trackId = lobby && state.previewTrack != null ? state.previewTrack : state.trackId;
    if (trackId && typeof trackId === 'object') trackId = trackId.id;
    trackId = Number(trackId); trackId = Number.isInteger(trackId) && TRACKS[trackId] ? trackId : 0;
    this._buildTrack(trackId);
    if (lobby) this._demoClock += dt;
    const incoming = Array.isArray(state.players) ? state.players.slice(0, 6) : [];
    const players = lobby || incoming.length === 0 ? this._demoPlayers(incoming) : incoming;
    let hero = players[0];
    if (lobby) {
      const local = Array.isArray(viewPlayerIds) ? viewPlayerIds.map(id => players.find(p => p.id === id)).find(Boolean) : null;
      const hasPreview = state.previewAnimal != null || state.previewVehicle != null;
      hero = players.find(p => p.id === state.previewPlayerId) || local
        || (hasPreview && players.find(p => !incoming.some(original => original.id === p.id))) || hero;
      // Only _demoPlayers' copies are customised. Never rewrite the authoritative roster or positions.
      if (ANIMALS.some(a => a.id === state.previewAnimal)) hero.animal = state.previewAnimal;
      if (VEHICLES.some(v => v.id === state.previewVehicle)) hero.vehicle = state.previewVehicle;
    }
    // Networked positions arrive at ~30 Hz; ease toward them so karts glide between
    // updates instead of snapping. Teleports (reset, spirit swap) snap instead of sliding.
    if (!lobby) {
      const own = new Set(Array.isArray(viewPlayerIds) ? viewPlayerIds : []), keep = new Set();
      for (const p of players) {
        keep.add(p.id);
        const tx = finite(p.x), ty = finite(p.y), tz = finite(p.z), ta = finite(p.angle);
        let s = this._smooth.get(p.id);
        if (!s || Math.hypot(tx - s.x, tz - s.z) > 6) s = { x: tx, y: ty, z: tz, angle: ta };
        const rate = 1 - Math.exp(-dt * (own.has(p.id) ? 24 : 14));
        s.x += (tx - s.x) * rate; s.y += (ty - s.y) * rate; s.z += (tz - s.z) * rate;
        const da = Math.atan2(Math.sin(ta - s.angle), Math.cos(ta - s.angle)); s.angle += da * rate;
        this._smooth.set(p.id, s);
        p.x = s.x; p.y = s.y; p.z = s.z; p.angle = s.angle;
      }
      for (const id of [...this._smooth.keys()]) if (!keep.has(id)) this._smooth.delete(id);
    }
    this._syncRacers(players, dt, lobby);
    this._syncEffects(state, players, lobby, dt);
    const leader = [...players].sort((a, b) => {
      if (finite(a.rank, 99) !== finite(b.rank, 99)) return finite(a.rank, 99) - finite(b.rank, 99);
      return finite(b.progress) - finite(a.progress);
    })[0];
    // Explicit view IDs are the sole ownership authority. LAN players are not added implicitly.
    let views = lobby ? [hero] : (Array.isArray(viewPlayerIds) ? viewPlayerIds.slice(0, 6).map(id => players.find(p => p.id === id)).filter(Boolean) : []);
    if (!views.length) views = [leader];
    if (this._viewCount !== views.length) { this._viewCount = views.length; this._cameraStates = []; this.resize(); }
    while (this.cameras.length < views.length) this.cameras.push(new THREE.PerspectiveCamera(64, 1, .16, 240));
    this.cameras.length = views.length;
    if (this._contextLost) { this.renderedViews = []; return; }
    if (!this._drawable) this.resize();
    if (!this._drawable) { this.renderedViews = []; return; }
    const rects = splitRects(views.length, this._width, this._height);
    this.renderedViews = rects.map((rect, i) => ({ id: views[i].id, ...rect }));
    const renderer = this.renderer;
    renderer.info.reset();
    renderer.setScissorTest(false); renderer.setViewport(0, 0, this._width, this._height); renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    // A single world shadow pass is shared by all viewports. There is no full-canvas render per player.
    renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;
    for (let i = 0; i < views.length; i++) {
      const rect = rects[i], camera = this.cameras[i];
      this._follow(camera, i, views[i], dt, lobby, rect, state.phase);
      const left = Math.round(rect.x), right = Math.round(rect.x + rect.w);
      const bottom = this._height - Math.round(rect.y + rect.h), top = this._height - Math.round(rect.y);
      renderer.setViewport(left, bottom, right - left, top - bottom);
      renderer.setScissor(left, bottom, right - left, top - bottom);
      renderer.render(this.scene, camera);
      renderer.shadowMap.needsUpdate = false;
    }
    renderer.setScissorTest(false); renderer.setViewport(0, 0, this._width, this._height);
    this.scene.userData.drawCalls = renderer.info.render.calls;
  }

  resize() {
    if (this._disposed || this._contextLost) return false;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.round(this.canvas.clientWidth || rect.width), height = Math.round(this.canvas.clientHeight || rect.height);
    if (width < 1 || height < 1) { this._drawable = false; this.renderedViews = []; return false; }
    const crowded = this._viewCount >= 4, budget = this._low ? 1000000 : crowded ? 1500000 : 2400000;
    const ratio = Math.max(.5, Math.min(window.devicePixelRatio || 1, this._low ? .85 : crowded ? 1 : 1.5, Math.sqrt(budget / (width * height))));
    const shadows = !this._low && !crowded;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      for (const material of this._materials) material.needsUpdate = true;
    }
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    if (this._width !== width || this._height !== height || !this._drawable) this.renderer.setSize(width, height, false);
    this._width = width; this._height = height; this._drawable = true;
    this.renderer.shadowMap.needsUpdate = shadows;
    const rects = splitRects(this._viewCount, width, height);
    this.cameras.forEach((camera, index) => {
      const r = rects[index]; if (!r) return;
      camera.aspect = r.w / r.h; camera.updateProjectionMatrix();
    });
    return true;
  }

  setQuality(low) {
    if (this._disposed) return;
    this._low = Boolean(low);
    this.resize();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._observer?.disconnect();
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('webglcontextlost', this._onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored, false);
    this.scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    for (const texture of this._textures) texture.dispose();
    this.sun.shadow.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.scene.clear(); this._models.clear(); this._textureCache.clear();
    this._geometries.clear(); this._materials.clear(); this._textures.clear();
    this._sharedGeometries.clear(); this._sharedMaterials.clear();
    this._seenEvents.clear(); this._bursts = []; this._cameraStates = [];
    this.cameras.length = 0; this.renderedViews = []; this._drawable = false;
    this.canvas.setAttribute('data-render-status', 'disposed');
  }
}

export class PodiumScene extends RacingScene {
  constructor(canvas) {
    super(canvas, { podium: true });
    this.world.name = 'Forest trophy stage';
    this.scene.background = new THREE.Color('#193f35');
    this.scene.fog = new THREE.Fog('#193f35', 24, 48);
    this.scene.userData.podiumEntries = [];
    this._podiumEntries = []; this._podiumModels = []; this._labelTextures = new Set();
    this._labels = new THREE.Group(); this._labels.name = 'Podium nameplates'; this.scene.add(this._labels);
    this._podiumCamera = new THREE.OrthographicCamera(-6, 6, 3.4, -3.4, .1, 65);
    this._podiumCamera.position.set(0, 7.5, 18);
    this._podiumCamera.lookAt(0, 1.38, 0);
    this.cameras.push(this._podiumCamera);
    this.sun.position.set(-6, 12, 9); this.sun.target.position.set(0, 1, 0);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 1, far: 35 });
    this.sun.shadow.camera.updateProjectionMatrix(); this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.normalBias = .025;
    const rim = new THREE.DirectionalLight('#b8edd6', 1.4); rim.position.set(5, 6, -5); this.scene.add(rim);
    this._makePodiumStage();
    this.resize();
    this.update([], 0);
  }

  _podiumTexture(width, height, paint) {
    // Entry-specific artwork deliberately bypasses the permanent shared texture cache.
    const texture = canvasTexture(width, height, paint, false);
    this._textures.add(texture); return texture;
  }

  _podiumSign(parent, texture, width, height, sprite = false) {
    const options = { map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false };
    const material = sprite ? new THREE.SpriteMaterial({ ...options, depthTest: false }) : new THREE.MeshBasicMaterial(options);
    this._materials.add(material);
    if (!sprite) return this._mesh(parent, new THREE.PlaneGeometry(width, height), material, false, false);
    const sign = new THREE.Sprite(material); sign.scale.set(width, height, 1); sign.renderOrder = 10;
    parent.add(sign); return sign;
  }

  _makePodiumStage() {
    const ivory = this._mat({ color: '#f4eedb', vertexColors: false, roughness: .65 });
    const gold = this._mat({ color: '#e5b85e', vertexColors: false, metalness: .62, roughness: .28 });
    const forest = this._mat({ color: '#275648', vertexColors: false, roughness: .75 });
    const floor = this._mesh(this.world, new THREE.PlaneGeometry(80, 80), forest, false);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.28;
    this._plinth = new THREE.Group(); this.world.add(this._plinth);
    for (const [y, radius, height, material] of [[-.04, 5.15, .4, forest], [.16, 5.08, .08, gold], [.24, 4.98, .1, ivory]]) {
      const step = this._mesh(this._plinth, new THREE.CylinderGeometry(radius, radius, height, 64), material);
      step.position.y = y; step.scale.z = .5;
    }
    // Rounded rectangular blocks, with the front toward the camera (+Z).
    const blockGeometry = height => {
      const shape = new THREE.Shape(), x = 1.3, z = 1.16, r = .14;
      shape.moveTo(-x + r, -z); shape.lineTo(x - r, -z); shape.quadraticCurveTo(x, -z, x, -z + r);
      shape.lineTo(x, z - r); shape.quadraticCurveTo(x, z, x - r, z);
      shape.lineTo(-x + r, z); shape.quadraticCurveTo(-x, z, -x, z - r);
      shape.lineTo(-x, -z + r); shape.quadraticCurveTo(-x, -z, -x + r, -z);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
      return geometry.rotateX(-Math.PI / 2);
    };
    this._podiumSlots = [1.48, .94, .66].map((height, index) => {
      const group = new THREE.Group(); group.name = `Place ${index + 1}`; this.world.add(group);
      const block = this._mesh(group, blockGeometry(height), index === 0 ? ivory : forest); block.position.y = .29;
      const trim = this._mesh(group, blockGeometry(.065), gold); trim.position.y = .29 + height;
      const top = this._mesh(group, blockGeometry(.035), ivory); top.scale.set(.94, 1, .94); top.position.y = .355 + height;
      const texture = this._podiumTexture(128, 128, (c, w, h) => {
        c.fillStyle = index === 0 ? '#285448' : '#f8ebc9'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = 'bold 108px Trebuchet MS, sans-serif'; c.fillText(String(index + 1), w / 2, h * .54);
      });
      const number = this._podiumSign(group, texture, .5, .5); number.position.set(0, .29 + height * .48, 1.17);
      return { group, height: height + .39, x: 0 };
    });

    this._trophy = new THREE.Group(); this._trophy.name = 'Golden jungle trophy'; this.world.add(this._trophy);
    const cup = new Baker();
    cup.cylinder([0, .1, 0], [.37, .2, .3], WHITE, [0, 0, 0], 24);
    cup.cylinder([0, .3, 0], [.19, .18, .19], WHITE);
    cup.rod([0, .34, 0], [0, .73, 0], .07, WHITE);
    cup.add(new THREE.SphereGeometry(.43, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2), [0, 1.08, 0]);
    cup.torus([0, 1.08, 0], .43, .045, WHITE, [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) cup.torus([side * .43, .94, 0], .21, .045, WHITE);
    const trophyMaterial = this._mat({ color: '#f3c65d', vertexColors: false, metalness: .7, roughness: .22, side: THREE.DoubleSide });
    this._mesh(this._trophy, cup.geometry(), trophyMaterial);
    const badge = this._mesh(this._trophy, starGeometry(), gold); badge.scale.setScalar(.13); badge.position.set(0, .9, .37);
    this._trophy.position.set(1.52, .31, 1.65); this._trophy.scale.setScalar(.78);

    // A few instanced, existing procedural plants frame the stage without building a circuit.
    const palms = this._palmGeometry();
    const trunks = this._instances(this.world, palms.trunk, this.barkMaterial, 6);
    const leaves = this._instances(this.world, palms.leaves, this.leafMaterial, 6);
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, size = .64 + Math.floor(i / 2) * .16;
      const position = [side * (5.4 + Math.floor(i / 2) * 2), -.25, -2.8 - Math.floor(i / 2) * 2.5];
      this._place(trunks, i, position, [size, size, size], [0, i * 1.7, 0]);
      this._place(leaves, i, position, [size, size, size], [0, i * 1.7, 0]);
    }
    this._finishInstances(trunks); this._finishInstances(leaves);
    const ferns = this._instances(this.world, this._fernGeometry(), this.leafMaterial, 10);
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1, size = .42 + (i % 3) * .13;
      this._place(ferns, i, [side * (4.3 + (i % 5) * .75), .04, -1.5 + (i % 3) * 1.3], [size, size, size], [0, i, 0]);
    }
    this._finishInstances(ferns);
    const motesMaterial = new THREE.MeshBasicMaterial({ color: '#f9df93', toneMapped: false }); this._materials.add(motesMaterial);
    this._podiumMotes = this._instances(this.world, new THREE.IcosahedronGeometry(1, 0), motesMaterial, 18);
    this._podiumMotes.castShadow = false; this._podiumMotes.receiveShadow = false; this._podiumMotes.frustumCulled = false;
  }

  _clearPodiumEntries() {
    for (const model of this._podiumModels) this._release(model.root);
    this._podiumModels.length = 0; this._models.clear();
    this._release(this._labels);
    // _release handles geometry/materials; label maps are owned here, not by the shared cache.
    for (const texture of this._labelTextures) { texture.dispose(); this._textures.delete(texture); }
    this._labelTextures.clear();
  }

  _setPodiumEntries(entries) {
    this._clearPodiumEntries(); this.scene.add(this._labels);
    this._podiumEntries = entries;
    this.scene.userData.podiumEntries = entries.map((entry, index) => ({ ...entry, placement: index + 1 }));
    entries.forEach((entry, index) => {
      const model = this._makeRacer({ ...entry, slot: index }); this._podiumModels.push(model);
      model.root.scale.setScalar(.86);
      model.root.userData.podiumEntry = { ...entry, placement: index + 1 };
      model.wheelPositions.forEach((position, i) => this._place(model.wheels, i, position));
      this._finishInstances(model.wheels);
      // Parked drivers hold the steering wheel. Never call the track-dependent racer synchronizer.
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1, a = new THREE.Vector3(side * .29, 1.29, -.12), b = new THREE.Vector3(side * .2, 1.16, .43);
        const direction = a.clone().sub(b), midpoint = a.clone().add(b).multiplyScalar(.5);
        this._place(model.arms, i, midpoint.toArray(), [1, direction.length(), 1], new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
      }
      this._finishInstances(model.arms);
      const texture = this._podiumTexture(512, 256, (c, w, h) => {
        c.fillStyle = '#f8f1df'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#d4b470'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
        c.fillStyle = '#204d40'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const name = entry.name, available = w - 32;
        c.font = 'bold 80px Trebuchet MS, sans-serif';
        if (c.measureText(name).width <= available) c.fillText(name, w / 2, 88);
        else {
          // Wrap long actual names rather than substituting animal names or invented winners.
          const chars = Array.from(name); let split = Math.ceil(chars.length / 2);
          const spaces = chars.map((char, i) => char === ' ' ? i : -1).filter(i => i > 0 && i < chars.length - 1);
          if (spaces.length) split = spaces.reduce((best, i) => Math.abs(i - chars.length / 2) < Math.abs(best - chars.length / 2) ? i : best);
          const lines = [chars.slice(0, split).join('').trim(), chars.slice(split).join('').trim()];
          let size = 68;
          c.font = `bold ${size}px Trebuchet MS, sans-serif`;
          while (size > 24 && lines.some(line => c.measureText(line).width > available)) { size -= 2; c.font = `bold ${size}px Trebuchet MS, sans-serif`; }
          lines.forEach((line, i) => c.fillText(line, w / 2, 58 + i * 73, available));
        }
        c.fillStyle = '#536346'; c.font = 'bold 64px Trebuchet MS, sans-serif';
        c.fillText(`${entry.points} pts`, w / 2, 212, available);
      });
      this._labelTextures.add(texture);
      const label = this._podiumSign(this._labels, texture, 2.9, 1.45, true);
      label.name = `${entry.name} / ${entry.points} pts`; label.userData.placement = index + 1;
    });
    this._layoutPodium();
  }

  _layoutPodium() {
    if (!this._podiumSlots) return;
    const aspect = this._width / Math.max(1, this._height), gap = clamp(aspect * 1.55, 2.95, 4.4);
    this._plinth.scale.x = (gap + 2.15) / 5.15;
    this._podiumSlots.forEach((slot, index) => {
      slot.x = index === 0 ? 0 : index === 1 ? -gap : gap;
      slot.group.position.x = slot.x;
      const model = this._podiumModels[index];
      if (model) model.root.position.set(slot.x, slot.height, -.12);
      const label = this._labels.children[index];
      if (label) label.position.set(slot.x, -.48, 2.45);
    });
    this._trophy.position.x = gap / 2;
  }

  update(entries, dt) {
    if (this._disposed) return;
    // The caller's order is authoritative; rank may still describe an older cup result.
    const next = (Array.isArray(entries) ? entries.slice(0, 3) : []).filter(entry => entry && typeof entry === 'object').map(entry => ({
      id: entry.id, name: String(entry.name ?? ''), animal: entry.animal, vehicle: entry.vehicle,
      color: entry.color, points: finite(entry.points), rank: entry.rank
    }));
    const keys = ['id', 'name', 'animal', 'vehicle', 'color', 'points', 'rank'];
    if (next.length !== this._podiumEntries.length || next.some((entry, index) => keys.some(key => !Object.is(entry[key], this._podiumEntries[index]?.[key])))) this._setPodiumEntries(next);
    this._clock += clamp(finite(dt, 1 / 60), 0, .1);
    this._podiumModels.forEach((model, index) => {
      model.root.rotation.y = [ -.12, .22, -.22 ][index] + Math.sin(this._clock * .45 + index) * .035;
      model.body.position.y = .012 + Math.sin(this._clock * 1.7 + index) * .012;
      model.driver.rotation.y = Math.sin(this._clock * .8 + index) * .075;
      model.driver.rotation.z = Math.sin(this._clock * 1.3 + index) * .012;
    });
    this._trophy.rotation.y = Math.sin(this._clock * .65) * .16;
    for (let i = 0; i < this._podiumMotes.count; i++) {
      const x = Math.sin(i * 4.13) * 6.5, y = 1.2 + (i % 5) * .7 + Math.sin(this._clock * .7 + i) * .18;
      const size = .016 + (.5 + Math.sin(this._clock * 1.3 + i) * .5) * .013;
      this._place(this._podiumMotes, i, [x, y, -2.6 - (i % 3)], [size, size, size]);
    }
    this._podiumMotes.instanceMatrix.needsUpdate = true;
    if (this._contextLost) return;
    if (!this._drawable) this.resize();
    if (!this._drawable) return;
    const renderer = this.renderer;
    renderer.info.reset(); renderer.setScissorTest(false); renderer.setViewport(0, 0, this._width, this._height);
    renderer.clear(true, true, true); renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;
    renderer.render(this.scene, this._podiumCamera); renderer.shadowMap.needsUpdate = false;
    this.scene.userData.drawCalls = renderer.info.render.calls;
  }

  resize() {
    const drawable = super.resize();
    // RacingScene calls resize virtually before our camera and stage have been initialized.
    if (!drawable || !this._podiumCamera) return drawable;
    const aspect = this._width / this._height, height = Math.max(7.1, 10.8 / aspect);
    Object.assign(this._podiumCamera, { left: -height * aspect / 2, right: height * aspect / 2, top: height / 2, bottom: -height / 2 });
    this._podiumCamera.updateProjectionMatrix(); this._layoutPodium();
    return true;
  }

  setQuality(low) {
    if (this._disposed) return;
    super.setQuality(low);
    if (this._podiumMotes) this._podiumMotes.count = this._low ? 8 : 18;
  }

  dispose() {
    if (this._disposed) return;
    this._clearPodiumEntries(); this._podiumEntries = []; this.scene.userData.podiumEntries = [];
    super.dispose();
  }
}
