import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadSailShape } from './sailImage.js';
import { loadBoardShape } from './boardImage.js';
import { loadBoomShape } from './boomImage.js';
import { createSail } from './sail.js';
import { createHardware } from './hardware.js';
import { createBoard, DECK_AT_TRACK, LEN } from './board.js';

async function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 6, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  // Kit: board floating, rig raked slightly aft, pivoting at the mast base.
  const [shape, boardShape, boomShape] = await Promise.all([
    loadSailShape(), loadBoardShape(LEN), loadBoomShape(),
  ]);
  const FLOAT = 0.5;
  const kit = new THREE.Group();
  kit.add(createBoard(boardShape));
  const sail = createSail(shape);
  const rig = new THREE.Group();
  rig.add(sail.mesh, createHardware(shape, boomShape));
  rig.position.y = 0.015; // tack rides just off the deck
  const rigPivot = new THREE.Group();
  rigPivot.rotation.z = -0.34; // sailing rake, ~19deg aft
  rigPivot.position.set(0.02, DECK_AT_TRACK, 0); // mast track sits 2cm aft
  rigPivot.add(rig);
  kit.add(rigPivot);
  kit.position.y = FLOAT;
  scene.add(kit);

  // Fake contact shadow.
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sctx = sc.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 16, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.3, 0.001, 0);
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(5.4, 3, 6.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.6, 2.3, 0);
  // Pull the camera back until the whole kit fits the viewport.
  const frameKit = () => {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d = Math.max(5.2 / (2 * half), 5.4 / (2 * half * camera.aspect));
    camera.position.sub(controls.target).setLength(d).add(controls.target);
  };
  frameKit();
  controls.enableDamping = true;
  controls.minDistance = 2.5;
  controls.maxDistance = 14;
  controls.maxPolarAngle = 1.62;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.9;
  let idleTimer;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener('end', () => { idleTimer = setTimeout(() => (controls.autoRotate = true), 3000); });

  if (import.meta.env.DEV) {
    scene.traverse((o) => {
      const a = o.geometry?.attributes.position;
      if (!a) return;
      for (let i = 0; i < a.array.length; i++)
        if (!Number.isFinite(a.array[i])) throw new Error(`non-finite position in ${o.name || o.type}`);
    });
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    frameKit();
  });

  renderer.setAnimationLoop((t) => {
    sail.update(t / 1000);
    controls.update();
    renderer.render(scene, camera);
  });
}

init().catch(console.error);
