import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import TWEEN from "three/addons/libs/tween.module.js";

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
 * 2. DATA — load from the published Google Sheet CSV.
 * ==========================================================================*/
function parseCsv(text) {
  // Minimal RFC4180-ish CSV parser (handles quoted fields with commas).
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((f) => f.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] || "").trim()));
    return obj;
  });
}

function normalizeRecord(raw) {
  const nwRaw = raw["net worth"] ?? raw[" net worth "] ?? "";
  const netWorth =
    raw.networth !== undefined
      ? Number(raw.networth)
      : parseFloat(String(nwRaw).replace(/[^0-9.-]/g, "")) || 0;
  return {
    name: raw.name || "",
    photo: raw.photo || "",
    age: raw.age || "",
    country: raw.country || "",
    interest: raw.interest || "",
    netWorth,
    netWorthDisplay: raw.networthdisplay || nwRaw || `$${netWorth.toLocaleString()}`,
  };
}

async function loadData() {
  const statusEl = document.getElementById("status");
  try {
    if (CONFIG.SHEET_CSV_URL) {
      statusEl.textContent = "Loading data from Google Sheet…";
      const res = await fetch(CONFIG.SHEET_CSV_URL);
      if (!res.ok) throw new Error("Sheet fetch failed: " + res.status);
      const text = await res.text();
      return parseCsv(text).map(normalizeRecord);
    }
  } finally {
    statusEl.style.display = "none";
  }
}

/* ============================================================================
 * 3. TILE COLOR — Red < $100K, Orange $100K–$200K, Green > $200K
 * ==========================================================================*/
function colorForNetWorth(v) {
  if (v < 100000) return "#e53935"; // red
  if (v < 200000) return "#fb8c00"; // orange
  return "#43a047"; // green
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
  // A small default elevation so Sphere, Helix and Grid read as 3D shapes immediately, without requiring the
  // viewer to drag-rotate first. Table/Grid still look correct at this angle.
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

  loadData().then((people) => {
    createObjects(people);
    computeTargets(people.length);
    transform(targets.table, 1500);
  });

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

/* ---- DOUBLE HELIX : two interleaved strands 180deg apart --*/
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
