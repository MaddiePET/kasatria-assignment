import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import TWEEN from "three/addons/libs/tween.module.js";
import { parseCsv, normalizeRecord, colorForNetWorth } from "./utils.js";

const CONFIG = window.APP_CONFIG || {};

/* ============================================================================
 * 1. AUTH — "Sign in with Google" 
 * ==========================================================================*/
const loginScreen = document.getElementById("login-screen");
const appEl = document.getElementById("app");
const whoami = document.getElementById("whoami");

function decodeJwt(token) {
  const payload = token.split(".")[1];
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

function enterApp(user) {
  loginScreen.style.display = "none";
  appEl.style.display = "block";
  if (user) {
    whoami.innerHTML = `<img src="${user.picture}" referrerpolicy="no-referrer"/><span>${user.name}</span>`;
  }
  initScene();
}

function onGoogleCredential(response) {
  const profile = decodeJwt(response.credential);
  enterApp({ name: profile.name, picture: profile.picture });
}
window.onGoogleCredential = onGoogleCredential;

if (CONFIG.GOOGLE_CLIENT_ID) {
  window.addEventListener("load", () => {
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
    });
    google.accounts.id.renderButton(
      document.getElementById("g_id_signin_container"),
      { theme: "outline", size: "large", shape: "pill", text: "signin_with" }
    );
  });
} else {
  const btn = document.getElementById("login-fallback-btn");
  btn.style.display = "inline-flex";
  btn.addEventListener("click", () => enterApp(null));
}

/* ============================================================================
 * 2. DATA — load from the published Google Sheet CSV
 * ==========================================================================*/
function showFatalError(message) {
  const statusEl = document.getElementById("status");
  statusEl.style.display = "flex";
  statusEl.style.color = "#ff6b6b";
  statusEl.style.pointerEvents = "auto";
  statusEl.style.flexDirection = "column";
  statusEl.style.gap = "10px";
  statusEl.style.textAlign = "center";
  statusEl.style.padding = "0 20px";
  statusEl.innerHTML = `
    <div style="font-size:14px; max-width:420px;">⚠ Couldn't load the data.<br/>${message}</div>
    <button id="retry-load-btn" style="background:#222;color:#fff;border:1px solid #444;border-radius:16px;padding:8px 18px;font-size:12px;cursor:pointer;">Retry</button>
  `;
  document.getElementById("retry-load-btn").addEventListener("click", () => {
    statusEl.style.color = "";
    statusEl.style.pointerEvents = "none";
    populateFromData();
  });
}

/**
 * Loads the data, builds the CSS3D tiles, and animates
 * them into the Table layout. Split out from initScene() so the "Retry"
 * button on a failed load can re-run just this part without recreating the
 * whole three.js scene/camera/controls.
 */
function populateFromData() {
  loadData()
    .then((people) => {
      // Clear out any tiles from a previous failed/retried attempt before
      // rebuilding, so retrying never duplicates tiles.
      objects.forEach((obj) => scene.remove(obj));
      objects.length = 0;

      createObjects(people);
      computeTargets(people.length);
      transform(targets.table, 1500);
    })
    .catch((err) => {
      console.error("Failed to load people data:", err);
      showFatalError(err.message || String(err));
    });
}

async function loadData() {
  const statusEl = document.getElementById("status");
  statusEl.style.display = "flex";
  try {
    if (CONFIG.SHEET_CSV_URL) {
      statusEl.textContent = "Loading data from Google Sheet…";
      const res = await fetch(CONFIG.SHEET_CSV_URL);
      if (!res.ok) {
        throw new Error(
          `Google Sheet returned HTTP ${res.status}. Double-check SHEET_CSV_URL in config.js is the ` +
          `"Publish to web" CSV link and that the sheet is still published.`
        );
      }
      const text = await res.text();
      const rows = parseCsv(text).map(normalizeRecord);
      if (rows.length === 0) {
        throw new Error("The Sheet returned 0 rows — check the published tab has data in it.");
      }
      return rows;
    }
    
    statusEl.textContent = "SHEET_CSV_URL not set — loading bundled data.json…";
    const res = await fetch("./data.json");
    if (!res.ok) throw new Error("data.json fallback failed to load (HTTP " + res.status + ").");
    return await res.json();
  } finally {

    statusEl.style.display = "none";
  }
}

function buildTileElement(person) {
  const el = document.createElement("div");
  el.className = "element";
  el.style.backgroundColor = colorForNetWorth(person.netWorth);

  const photoWrap = document.createElement("div");
  photoWrap.className = "photo-wrap";
  if (person.photo) {
    const img = document.createElement("img");
    img.src = person.photo;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      img.remove();
      photoWrap.innerHTML = '<span class="no-photo">&#128100;</span>';
    };
    photoWrap.appendChild(img);
  } else {
    photoWrap.innerHTML = '<span class="no-photo">&#128100;</span>';
  }
  el.appendChild(photoWrap);

  const details = document.createElement("div");
  details.className = "details";
  details.innerHTML = `
    <div class="country-age">${person.country} · ${person.age}</div>
    <div class="name">${person.name}</div>
    <div class="interest">${person.interest}</div>
    <div class="networth">${person.netWorthDisplay}</div>
  `;
  el.appendChild(details);
  return el;
}

/* ============================================================================
 * 4. THREE.js SCENE (CSS3DRenderer) + four layout algorithms
 * ==========================================================================*/
let camera, scene, renderer, controls;
const objects = [];
const targets = { table: [], sphere: [], helix: [], grid: [] };

function initScene() {
  const container = document.getElementById("container");

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
  // A small default elevation so Sphere, Helix and Grid read as 3D shapes immediately, 
  // Table/Grid still look correct at this angle.
  camera.position.set(0, 650, 2850);
  camera.lookAt(0, 0, 0);

  scene = new THREE.Scene();

  renderer = new CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  controls = new TrackballControls(camera, renderer.domElement);
  controls.minDistance = 500;
  controls.maxDistance = 8000;
  controls.addEventListener("change", render);

  populateFromData();

  document.querySelectorAll("#menu button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#menu button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      transform(targets[btn.dataset.mode], 1500);
    });
  });

  window.addEventListener("resize", onWindowResize);
  animate();
}

function createObjects(people) {
  people.forEach((person) => {
    const el = buildTileElement(person);
    const object = new CSS3DObject(el);
    // scatter starting position randomly in a sphere shell so the first
    // "table" transform reads as an assembly animation
    object.position.x = Math.random() * 4000 - 2000;
    object.position.y = Math.random() * 4000 - 2000;
    object.position.z = Math.random() * 4000 - 2000;
    scene.add(object);
    objects.push(object);
  });
}

/* ---- TABLE : 20 columns x 10 rows ---- */
function computeTableTargets(count) {
  const COLS = 20, ROWS = 10;
  const spacingX = 140, spacingY = 180;
  const offsetX = ((COLS - 1) * spacingX) / 2;
  const offsetY = ((ROWS - 1) * spacingY) / 2;
  const list = [];
  for (let i = 0; i < count; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const object = new THREE.Object3D();
    object.position.x = col * spacingX - offsetX;
    object.position.y = -(row * spacingY - offsetY);
    object.position.z = 0;
    list.push(object);
  }
  return list;
}

/* ---- SPHERE : Fibonacci sphere distribution, tiles face outward ---- */
function computeSphereTargets(count) {
  const list = [];
  const radius = 1100;
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // 1..-1
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;

    const vector = new THREE.Vector3(x, y, z).multiplyScalar(radius);
    const object = new THREE.Object3D();
    object.position.copy(vector);
    const lookTarget = vector.clone().multiplyScalar(2);
    object.lookAt(lookTarget);
    list.push(object);
  }
  return list;
}

/* ---- DOUBLE HELIX : two interleaved strands 180deg apart ---- */
function computeHelixTargets(count) {
  const list = [];
  const radius = 1400; // wider tube so 120px-wide tiles don't crowd each other around the circumference
  const strandCount = 2;
  const perStrand = Math.ceil(count / strandCount);
  const angleStep = 0.22; // ~3.5 turns total
  const ySpacing = 42; // taller pitch so successive turns don't visually stack on top of each other

  for (let i = 0; i < count; i++) {
    const strand = i % strandCount; // 0 or 1
    const stepIndex = Math.floor(i / strandCount);
    const angle = stepIndex * angleStep + strand * Math.PI; // 180deg offset

    const object = new THREE.Object3D();
    object.position.x = radius * Math.cos(angle);
    object.position.z = radius * Math.sin(angle);
    object.position.y = -(stepIndex * ySpacing) + (perStrand * ySpacing) / 2;

    const vector = new THREE.Vector3(object.position.x * 2, object.position.y, object.position.z * 2);
    object.lookAt(vector);
    list.push(object);
  }
  return list;
}

/* ---- GRID : 5 x 4 x 10 ---- */
function computeGridTargets(count) {
  const X = 5, Y = 4, Z = 10;
  const spacing = 260;
  const offsetX = ((X - 1) * spacing) / 2;
  const offsetY = ((Y - 1) * spacing) / 2;
  const offsetZ = ((Z - 1) * spacing) / 2;
  const list = [];
  for (let i = 0; i < count; i++) {
    // fill order: x fastest, then y, then z (5*4*10 = 200)
    const x = i % X;
    const y = Math.floor(i / X) % Y;
    const z = Math.floor(i / (X * Y)) % Z;

    const object = new THREE.Object3D();
    object.position.x = x * spacing - offsetX;
    object.position.y = -(y * spacing - offsetY);
    object.position.z = z * spacing - offsetZ;
    list.push(object);
  }
  return list;
}

function computeTargets(count) {
  targets.table = computeTableTargets(count);
  targets.sphere = computeSphereTargets(count);
  targets.helix = computeHelixTargets(count);
  targets.grid = computeGridTargets(count);
}

/* ---- Tween each object from its current transform to the target ---- */
function transform(targetList, duration) {
  TWEEN.removeAll();
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    const target = targetList[i];
    if (!target) continue;

    new TWEEN.Tween(object.position)
      .to({ x: target.position.x, y: target.position.y, z: target.position.z }, duration)
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to({ x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, duration)
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();
  }
  new TWEEN.Tween({}).to({}, duration).onUpdate(render).start();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
}

function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  controls.update();
  render();
}

function render() {
  renderer.render(scene, camera);
}
