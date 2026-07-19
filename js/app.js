/* ===========================================================================
   Cell Counter — app logic   (v7: boundary-clamp + reset, reliability hint,
   per-profile Trypan/dilution memory, limiting-dilution calc, faster CV)
   Phase 1 (boundary) + 1.5 (storage/profiles) + 2 (count + correct + Trypan)
   + Phase 3 (named per-profile CELL-LINE classifiers + Training mode)
     - photo (camera/gallery) -> canvas + draggable 4-corner box + magnifier
     - SNAP to real grid-line crossings; GRID +/- to resize the box (re-snaps)
     - FLATTEN with a margin; COUNT cells; adjustable detection SENSITIVITY
     - Trypan live/dead (Yes/No also sets dilution); +/- manual nudge (signed)
     - PROFILES + sessions (IndexedDB, on the phone) + Past sessions
     - CELL LINES: train a named classifier by tapping real cells; it then
       auto-hides look-alike debris. Default = plain counting, NO learning.
   =========================================================================== */

// --- Page elements ----------------------------------------------------------
const cameraInput  = document.getElementById('cameraInput');
const galleryInput = document.getElementById('galleryInput');
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const meta         = document.getElementById('meta');
const controls     = document.getElementById('controls');
const cropBtn      = document.getElementById('cropBtn');
const cropActions  = document.getElementById('cropActions');
const cropConfirm  = document.getElementById('cropConfirm');
const cropCancel   = document.getElementById('cropCancel');
const flattenBtn   = document.getElementById('flattenBtn');
const cvStatus     = document.getElementById('cvStatus');
const cvRetryBtn   = document.getElementById('cvRetryBtn');
const detectStatus = document.getElementById('detectStatus');
const flatSection  = document.getElementById('flatSection');
const flatCanvas   = document.getElementById('flatCanvas');
const profileSelect= document.getElementById('profileSelect');
const newProfileBtn= document.getElementById('newProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');
const saveBtn      = document.getElementById('saveBtn');
const saveStatus   = document.getElementById('saveStatus');
const sampleList   = document.getElementById('sampleList');
const sampleSummary= document.getElementById('sampleSummary');
const debugLog     = document.getElementById('debugLog');
const debugCopy    = document.getElementById('debugCopy');
const debugClear   = document.getElementById('debugClear');
const resetBtn     = document.getElementById('resetBtn');
const toggleOverlayBtn = document.getElementById('toggleOverlayBtn');
const countStatus  = document.getElementById('countStatus');
const countTools   = document.getElementById('countTools');
const countReadout = document.getElementById('countReadout');
const trypanYes    = document.getElementById('trypanYes');
const trypanNo     = document.getElementById('trypanNo');
const dilutionInput= document.getElementById('dilutionInput');
const blueSlider   = document.getElementById('blueSlider');
const blueLabel    = document.getElementById('blueLabel');
const sensSlider   = document.getElementById('sensSlider');
const sensLabel    = document.getElementById('sensLabel');
const sensGroup    = document.getElementById('sensGroup');
const manualMinus  = document.getElementById('manualMinus');
const manualPlus   = document.getElementById('manualPlus');
const manualLiveBtn= document.getElementById('manualLiveBtn');
const manualDeadBtn= document.getElementById('manualDeadBtn');
const manualLabel  = document.getElementById('manualLabel');
const manualRow    = document.getElementById('manualRow');
const sliderGroup  = document.getElementById('sliderGroup');
const newSessionBtn= document.getElementById('newSessionBtn');
const undoBtn      = document.getElementById('undoBtn');
const historyList  = document.getElementById('historyList');
const busy         = document.getElementById('busy');
const busyMsg      = document.getElementById('busyMsg');
// Phase 3 — cell-line UI
const celllineRow  = document.getElementById('celllineRow');
const cellLineSelect = document.getElementById('cellLineSelect');
const trainBtn     = document.getElementById('trainBtn');
const retrainBtn   = document.getElementById('retrainBtn');
const deleteCellLineBtn = document.getElementById('deleteCellLineBtn');
const trainBar     = document.getElementById('trainBar');
const trainHint    = document.getElementById('trainHint');
const trainCount   = document.getElementById('trainCount');
const trainDone    = document.getElementById('trainDone');
const trainCancel  = document.getElementById('trainCancel');
// (the cells/dead/debris marking buttons were removed — tapping now cycles state like counting)
// new (export + extra undo + save image)
const exportCsvBtn = document.getElementById('exportCsvBtn');
const undoSessionBtn = document.getElementById('undoSessionBtn');
const saveImgBtn   = document.getElementById('saveImgBtn');
// concentration unit toggle + dilution calculator
const concMlBtn    = document.getElementById('concMlBtn');
const concUlBtn    = document.getElementById('concUlBtn');
const calcBox      = document.getElementById('calcBox');
const calcBasis    = document.getElementById('calcBasis');
const calcCells    = document.getElementById('calcCells');
const calcFinal    = document.getElementById('calcFinal');
const calcOut      = document.getElementById('calcOut');
const calcRecent   = document.getElementById('calcRecent');
// new: reset-box recovery, count-reliability hint, limiting-dilution calculator
const resetBoxBtn  = document.getElementById('resetBoxBtn');
const countHint    = document.getElementById('countHint');
const ldCells      = document.getElementById('ldCells');
const ldVol        = document.getElementById('ldVol');
const ldWells      = document.getElementById('ldWells');
const ldOut        = document.getElementById('ldOut');

/* ---- tiny debug log (defined EARLY so the OpenCV loader below can log during boot;
        the buffer used to live at the bottom, which caused a temporal-dead-zone crash
        when the loader logged before it was initialised). Collapsed <details> in the UI;
        window error/rejection hooks + Copy/Clear are wired at the very bottom. ---- */
const _logLines = [];
function dlog(msg) {
  const t = new Date().toLocaleTimeString();
  _logLines.push(`[${t}] ${msg}`);
  if (_logLines.length > 200) _logLines.shift();
  if (debugLog) debugLog.textContent = _logLines.join('\n');
}

// --- State ------------------------------------------------------------------
let img = null;
let corners = [];           // [TL, TR, BR, BL] in canvas pixels
let activeCorner = -1;
let currentURL = null;
let snapTargetsImg = [];    // grid-line crossings, in IMAGE pixels
let snappedNow = false;
let lastFlatClean = null;   // clean flattened image (data URL) for saving
let flatCleanData = null;   // clean flattened pixels (ImageData) for re-render + counting
let cells = [];             // detected cells on the flattened square (Phase 2)
let overlayVisible = true;  // show/hide the rings + numbers (manual-count mode)
let concUnit = 'mL';        // 'mL' or 'uL' — how the concentration readout is shown

// crop / zoom mode (frame the big square in the photo, then zoom into it)
let cropMode = false;
let cropRect = null;        // { x, y, w, h } in CANVAS pixels
let cropActive = null;      // 'tl'|'tr'|'br'|'bl'|'move' while dragging the crop box
let cropGrab = { dx: 0, dy: 0 };
const CROP_MIN = 60;        // smallest crop box side (canvas px)

const HANDLE_RADIUS = 8;
const GRAB_RADIUS   = 30;
const SNAP_RADIUS   = 18;
const LOUPE_RADIUS  = 58;
const LOUPE_ZOOM    = 2.6;
const LOUPE_OFFSET  = 46;

// Flatten output geometry: the boundary square sits inside a margin so the
// boundary line + cells just outside it are kept (not cropped).
const FLAT_OUT = 900;
const FLAT_MARGIN = 100;     // boundary square = [100..800] inside a 900px image

/* ---- small loading screen (photo detection / counting can take a moment) ---- */
function showBusy(msg) { if (!busy) return; if (busyMsg) busyMsg.textContent = msg || 'Processing…'; busy.hidden = false; }
function hideBusy() { if (busy) busy.hidden = true; }

/* ===========================================================================
   Load a photo (camera OR gallery)
   =========================================================================== */
function handleFile(file) {
  if (!file) return;
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => loadPhoto(image);
  image.src = currentURL;
}
cameraInput.addEventListener('change',  (e) => handleFile(e.target.files[0]));
galleryInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

function computeFitSize() {
  const maxW = canvas.parentElement.clientWidth;
  const maxH = window.innerHeight * 0.70;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  return { w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) };
}
function setCanvasSize(w, h) {
  canvas.width = w; canvas.height = h;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
}
function loadPhoto(image) {
  img = image;
  const { w, h } = computeFitSize();
  setCanvasSize(w, h);
  const ix = w * 0.15, iy = h * 0.15;
  corners = [{ x: ix, y: iy }, { x: w - ix, y: iy }, { x: w - ix, y: h - iy }, { x: ix, y: h - iy }];

  canvas.style.display = 'block';
  meta.style.display = 'block';
  controls.style.display = 'flex';
  flatSection.style.display = 'none';
  lastFlatClean = null;
  flatCleanData = null;
  freeSegCache();                 // new photo -> drop the cached preprocessing
  cells = [];
  overlayVisible = true;
  hasCount = false; savedThisCount = false;
  manualLive = 0; manualDead = 0; manualMode = 'live';
  showCountTools(false);
  updateSaveButton();
  meta.textContent = `photo ${img.naturalWidth}\u00D7${img.naturalHeight}px`;

  draw();
  if (cvReady) {
    showBusy('Finding the grid…');
    setTimeout(() => { try { analyzeAndDetect(); } finally { hideBusy(); } }, 30);
  } else {
    setDetectStatus('Preparing detection…');
  }
}

/* ===========================================================================
   Drawing the boundary box + magnifier loupe
   =========================================================================== */
function draw() {
  if (!img) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (cropMode) { drawCropOverlay(); return; }   // framing the square to zoom in

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(47, 158, 143, 0.05)';
  ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(47, 158, 143, 0.75)'; ctx.stroke();

  for (let i = 0; i < corners.length; i++) drawCorner(corners[i], i === activeCorner && snappedNow);
  if (activeCorner !== -1) drawLoupe(corners[activeCorner]);
}
function drawCropOverlay() {
  const r = cropRect; if (!r) return;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, r.y);                                  // top
  ctx.fillRect(0, r.y + r.h, canvas.width, canvas.height - (r.y + r.h));  // bottom
  ctx.fillRect(0, r.y, r.x, r.h);                                         // left
  ctx.fillRect(r.x + r.w, r.y, canvas.width - (r.x + r.w), r.h);          // right
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(47,158,143,0.95)';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  const hs = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  for (const [hx, hy] of hs) {
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(47,158,143,0.85)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
  }
}
function drawCorner(c, isSnapped) {
  ctx.beginPath(); ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = isSnapped ? 'rgba(80, 230, 140, 0.65)' : 'rgba(47, 158, 143, 0.45)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = isSnapped ? 'rgba(140, 255, 190, 0.9)' : 'rgba(255, 255, 255, 0.55)'; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x - 5, c.y); ctx.lineTo(c.x + 5, c.y);
  ctx.moveTo(c.x, c.y - 5); ctx.lineTo(c.x, c.y + 5);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255, 70, 70, 0.9)'; ctx.stroke();
}
function drawLoupe(corner) {
  const R = LOUPE_RADIUS, M = LOUPE_ZOOM;
  let lx = corner.x, ly = corner.y - (R + LOUPE_OFFSET);
  if (ly - R < 0) ly = corner.y + (R + LOUPE_OFFSET);
  lx = Math.max(R + 2, Math.min(canvas.width - R - 2, lx));
  ly = Math.max(R + 2, Math.min(canvas.height - R - 2, ly));
  const s = canvas.width / img.naturalWidth;

  ctx.save();
  ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
  const srcSideImg = ((2 * R) / M) / s;
  ctx.drawImage(img, corner.x / s - srcSideImg / 2, corner.y / s - srcSideImg / 2, srcSideImg, srcSideImg,
                lx - R, ly - R, 2 * R, 2 * R);

  const prev = corners[(activeCorner + 3) % 4], next = corners[(activeCorner + 1) % 4];
  const toLoupe = (p) => ({ x: lx + (p.x - corner.x) * M, y: ly + (p.y - corner.y) * M });
  const pL = toLoupe(prev), nL = toLoupe(next);
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(47, 158, 143, 0.9)';
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(pL.x, pL.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(nL.x, nL.y); ctx.stroke();

  for (const t of snapTargetsImg) {
    const px = lx + (t.x * s - corner.x) * M, py = ly + (t.y * s - corner.y) * M;
    if (Math.hypot(px - lx, py - ly) <= R) {
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80, 230, 140, 0.95)'; ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255, 70, 70, 0.95)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx - 11, ly); ctx.lineTo(lx + 11, ly); ctx.moveTo(lx, ly - 11); ctx.lineTo(lx, ly + 11); ctx.stroke();
  ctx.restore();

  ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.stroke();
}

/* ===========================================================================
   Dragging the boundary corners (snap to crossings) + CROP/ZOOM framing
   =========================================================================== */
function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (canvas.width / rect.width),
           y: (event.clientY - rect.top) * (canvas.height / rect.height) };
}
// Keep a corner fully inside the canvas so its handle is always visible AND grabbable.
// BUG FIX: after auto-detect, a detected (or edge-snapped) corner could land outside the
// picture and become impossible to drag. Clamp every corner into a touchable inset.
function clampCornerToCanvas(c) {
  const m = HANDLE_RADIUS + 4;
  return { x: clamp(c.x, m, canvas.width - m), y: clamp(c.y, m, canvas.height - m) };
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' && !event.isPrimary) return;   // let 2-finger pinch zoom the photo
  const p = getCanvasPoint(event);
  if (cropMode) { cropPointerDown(p, event); return; }
  for (let i = 0; i < corners.length; i++) {
    if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= GRAB_RADIUS) {
      activeCorner = i; snappedNow = false; canvas.setPointerCapture(event.pointerId); draw(); break;
    }
  }
});
canvas.addEventListener('pointermove', (event) => {
  const p = getCanvasPoint(event);
  if (cropMode) { cropPointerMove(p); return; }
  if (activeCorner === -1) return;
  let rx = Math.max(0, Math.min(canvas.width, p.x)), ry = Math.max(0, Math.min(canvas.height, p.y));
  const s = canvas.width / img.naturalWidth;
  let best = null, bestD = SNAP_RADIUS;
  for (const t of snapTargetsImg) {
    const d = Math.hypot(rx - t.x * s, ry - t.y * s);
    if (d < bestD) { bestD = d; best = { x: t.x * s, y: t.y * s }; }
  }
  snappedNow = !!best;
  corners[activeCorner] = clampCornerToCanvas(best || { x: rx, y: ry });
  draw();
});
function endDrag() { if (cropMode) { cropActive = null; return; } if (activeCorner === -1) return; activeCorner = -1; snappedNow = false; draw(); }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
// while actively dragging a corner or the crop box, stop the browser from panning the (zoomed) page
canvas.addEventListener('touchmove', (e) => { if (activeCorner !== -1 || (cropMode && cropActive)) e.preventDefault(); }, { passive: false });

window.addEventListener('resize', () => {
  if (!img || cropMode) return;
  const oldW = canvas.width, oldH = canvas.height;
  const { w, h } = computeFitSize();
  const sx = w / oldW, sy = h / oldH;
  setCanvasSize(w, h);
  corners = corners.map((c) => clampCornerToCanvas({ x: c.x * sx, y: c.y * sy }));
  draw();
});

/* ---- CROP / ZOOM: frame the big square, then zoom into it (re-detects grid) ----
   Fixes "the square is too small to snap onto" when the photo was taken far away.
   The suggested box is auto-placed around the densest cluster of grid crossings. */
function suggestCropRect() {
  const s = canvas.width / img.naturalWidth;
  const xs = [], ys = [];
  if (snapTargetsImg.length >= 4) { snapTargetsImg.forEach((t) => { xs.push(t.x * s); ys.push(t.y * s); }); }
  else if (corners.length === 4) { corners.forEach((c) => { xs.push(c.x); ys.push(c.y); }); }
  if (xs.length) {
    let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const mx = Math.max(24, (maxX - minX) * 0.18), my = Math.max(24, (maxY - minY) * 0.18);
    minX = clamp(minX - mx, 0, canvas.width);  maxX = clamp(maxX + mx, 0, canvas.width);
    minY = clamp(minY - my, 0, canvas.height); maxY = clamp(maxY + my, 0, canvas.height);
    if (maxX - minX >= CROP_MIN && maxY - minY >= CROP_MIN) return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const w = canvas.width * 0.64, h = canvas.height * 0.64;     // fallback: centre of the photo
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}
function enterCrop() {
  if (!img) return;
  cropMode = true; activeCorner = -1; cropActive = null;
  cropRect = suggestCropRect();
  controls.style.display = 'none';
  if (cropActions) cropActions.style.display = 'flex';
  detectStatus.style.display = 'none';
  draw();
}
function leaveCrop() {
  cropMode = false; cropActive = null;
  controls.style.display = 'flex';
  if (cropActions) cropActions.style.display = 'none';
}
function cancelCrop() { leaveCrop(); draw(); }
function cropPointerDown(p, event) {
  const r = cropRect; if (!r) return;
  const hs = { tl: { x: r.x, y: r.y }, tr: { x: r.x + r.w, y: r.y }, br: { x: r.x + r.w, y: r.y + r.h }, bl: { x: r.x, y: r.y + r.h } };
  for (const name in hs) {
    if (Math.hypot(p.x - hs[name].x, p.y - hs[name].y) <= GRAB_RADIUS) { cropActive = name; canvas.setPointerCapture(event.pointerId); return; }
  }
  if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) {
    cropActive = 'move'; cropGrab = { dx: p.x - r.x, dy: p.y - r.y }; canvas.setPointerCapture(event.pointerId);
  }
}
function cropPointerMove(p) {
  if (!cropActive || !cropRect) return;
  const r = cropRect, W = canvas.width, H = canvas.height;
  let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  const px = clamp(p.x, 0, W), py = clamp(p.y, 0, H);
  if (cropActive === 'move') {
    let nx = clamp(px - cropGrab.dx, 0, W - r.w), ny = clamp(py - cropGrab.dy, 0, H - r.h);
    r.x = nx; r.y = ny; draw(); return;
  }
  if (cropActive === 'tl') { x1 = Math.min(px, x2 - CROP_MIN); y1 = Math.min(py, y2 - CROP_MIN); }
  if (cropActive === 'tr') { x2 = Math.max(px, x1 + CROP_MIN); y1 = Math.min(py, y2 - CROP_MIN); }
  if (cropActive === 'br') { x2 = Math.max(px, x1 + CROP_MIN); y2 = Math.max(py, y1 + CROP_MIN); }
  if (cropActive === 'bl') { x1 = Math.min(px, x2 - CROP_MIN); y2 = Math.max(py, y1 + CROP_MIN); }
  r.x = x1; r.y = y1; r.w = x2 - x1; r.h = y2 - y1;
  draw();
}
function confirmCrop() {
  if (!img || !cropRect) { cancelCrop(); return; }
  const s = canvas.width / img.naturalWidth;
  let ix = cropRect.x / s, iy = cropRect.y / s, iw = cropRect.w / s, ih = cropRect.h / s;
  ix = clamp(ix, 0, img.naturalWidth - 1); iy = clamp(iy, 0, img.naturalHeight - 1);
  iw = clamp(iw, 1, img.naturalWidth - ix); ih = clamp(ih, 1, img.naturalHeight - iy);
  try {
    const oc = document.createElement('canvas');
    oc.width = Math.round(iw); oc.height = Math.round(ih);
    oc.getContext('2d').drawImage(img, ix, iy, iw, ih, 0, 0, oc.width, oc.height);
    const url = oc.toDataURL('image/jpeg', 0.92);
    const im = new Image();
    im.onload = () => { leaveCrop(); loadPhoto(im); };      // loadPhoto re-fits + re-detects the grid on the zoomed crop
    im.src = url;
  } catch (e) { dlog('crop FAILED: ' + e.message); cancelCrop(); }
}
if (cropBtn) cropBtn.addEventListener('click', enterCrop);
if (resetBoxBtn) resetBoxBtn.addEventListener('click', resetBox);
if (cropConfirm) cropConfirm.addEventListener('click', () => { showBusy('Zooming in…'); setTimeout(confirmCrop, 30); });
if (cropCancel) cropCancel.addEventListener('click', cancelCrop);

/* ===========================================================================
   OpenCV readiness — robust, FAIL-LOUD loader   (rewritten for reliability)
   ---------------------------------------------------------------------------
   THE BUG THIS FIXES: the app used to sit on "Preparing tools…" forever — most
   visibly on MOBILE, in INCOGNITO, or on a fresh phone. Those all have NO cache,
   so the ~10 MB opencv.js must download fresh every time; if that download is
   slow, blocked (lab wi-fi), or the rolling build changes its load contract, the
   old loader just polled silently with no timeout, no error, and no way to retry.
   Desktop "worked" only because it had an OLD opencv.js cached.

   What this loader does differently:
     1) PINNED version first (docs.opencv.org/<ver>) instead of the rolling 4.x —
        a pinned URL can't silently change its load contract and caches properly.
        Falls back to other pinned versions, then the rolling build.
     2) Injects each source itself, so it can catch <script> ONERROR and move on.
     3) A per-source TIMEOUT — a stalled download no longer hangs the app; it
        advances to the next source.
     4) Contract-agnostic ready detection (ready module / Promise / MODULARIZE
        factory), and only ever marks ready once a REAL cv.Mat exists.
     5) When every source fails, it shows a clear message + a RETRY button
        (#cvRetryBtn) instead of a frozen "Preparing tools…".
   Note: docs.opencv.org ships a SINGLE-FILE build (wasm inlined), so injecting
   the <script> is enough — there is no separate .wasm to locate.
   =========================================================================== */
let cvReady = false;

// Try a same-origin VENDORED copy first (fully offline, no CDN, no contract drift);
// if js/opencv.js isn't there it 404s instantly and we fall through. Then PINNED,
// stable CDN builds (no drift, good caching); the rolling build is the last resort.
// >> To make this app independent of the CDN and lab wi-fi: download
//    https://docs.opencv.org/4.11.0/opencv.js and save it as js/opencv.js. <<
const CV_SOURCES = [
  'js/opencv.js',                               // optional same-origin vendor (offline)
  'https://docs.opencv.org/4.11.0/opencv.js',   // pinned stable — primary CDN
  'https://docs.opencv.org/4.10.0/opencv.js',   // pinned stable — fallback CDN
  'https://docs.opencv.org/4.x/opencv.js'       // rolling latest — last resort
];
const CV_SOURCE_TIMEOUT = 45000;   // ms to wait on one source before trying the next

(function loadOpenCv() {
  let sourceIdx = -1;
  let started = false;      // MODULARIZE factory already invoked for the current source
  let mod = null;           // a module object we're waiting on (poll re-checks mod.Mat)
  let curScript = null, curTimer = null, msgTimer = null, polling = false;

  function onReady(m) {
    if (cvReady || !m || !m.Mat) return;   // never go "ready" on a half-loaded stub
    window.cv = m;
    cvReady = true;
    clearTimeout(curTimer); clearTimeout(msgTimer);
    if (cvStatus) cvStatus.style.display = 'none';
    if (typeof cvRetryBtn !== 'undefined' && cvRetryBtn) cvRetryBtn.style.display = 'none';
    if (flattenBtn) flattenBtn.disabled = false;
    if (typeof dlog === 'function') dlog('OpenCV ready (' + (window.__cvSrc || '?') + ').');
    if (img) { showBusy('Finding the grid…'); setTimeout(() => { try { analyzeAndDetect(); } finally { hideBusy(); } }, 30); }
  }

  // Resolve whatever shape this build hands us into a ready cv.Mat module.
  function adopt(candidate) {
    if (cvReady) return;
    const c = candidate || window.cv;
    if (!c) return;
    if (c.Mat) { onReady(c); return; }                       // already-initialised module
    if (typeof c.then === 'function') {                      // a Promise of the module
      mod = mod || c; c.then(adopt).catch(() => {}); return;
    }
    if (typeof c === 'function') {                           // a MODULARIZE factory -> CALL once
      if (started) return; started = true;
      try {
        const M = (typeof window.Module === 'object' && window.Module) ? window.Module : {};
        const prev = M.onRuntimeInitialized;
        M.onRuntimeInitialized = function () {
          if (typeof prev === 'function') { try { prev(); } catch (_) {} }
          onReady(M.Mat ? M : (window.cv && window.cv.Mat ? window.cv : M));
        };
        const r = c(M);
        if (r && typeof r.then === 'function') r.then(adopt).catch(() => {});
        else adopt(r || M);
      } catch (e) { started = false; if (typeof dlog === 'function') dlog('OpenCV init error: ' + e); }
      return;
    }
    // a plain module object still initialising -> hook its ready callback + let poll re-check .Mat
    mod = c;
    if (!c.__cvHook) {
      c.__cvHook = true;
      const prev = c.onRuntimeInitialized;
      c.onRuntimeInitialized = function () { if (typeof prev === 'function') { try { prev(); } catch (_) {} } onReady(c); };
    }
  }

  function poll() {                                          // backstop: independent of any callback firing
    if (cvReady) return;
    if (mod && mod.Mat) { onReady(mod); return; }
    if (window.cv) adopt(window.cv);
    if (!cvReady) setTimeout(poll, 120);
  }

  function allFailed() {
    if (cvReady) return;
    if (cvStatus) { cvStatus.textContent = 'Couldn’t load the vision tools — check your connection, then tap Retry.'; cvStatus.style.display = 'inline'; }
    if (typeof cvRetryBtn !== 'undefined' && cvRetryBtn) cvRetryBtn.style.display = 'inline-block';
    if (typeof dlog === 'function') dlog('OpenCV: all sources failed.');
  }

  function tryNextSource() {
    if (cvReady) return;
    clearTimeout(curTimer); clearTimeout(msgTimer);
    sourceIdx++;
    if (sourceIdx >= CV_SOURCES.length) { allFailed(); return; }

    started = false; mod = null;
    const url = CV_SOURCES[sourceIdx];
    window.__cvSrc = url;
    if (typeof dlog === 'function') dlog('Loading OpenCV: ' + url);
    if (cvStatus) { cvStatus.textContent = 'Preparing tools…'; cvStatus.style.display = 'inline'; }
    if (typeof cvRetryBtn !== 'undefined' && cvRetryBtn) cvRetryBtn.style.display = 'none';
    // reassure on slow/mobile networks that it isn't frozen (first load fetches ~10 MB once)
    msgTimer = setTimeout(() => { if (!cvReady && cvStatus) cvStatus.textContent = 'Still preparing tools… (first load downloads ~10 MB once)'; }, 6000);

    // Classic emscripten builds read a PRE-SET global Module — define its ready hook before the
    // script runs so we catch readiness even if polling somehow misses it.
    if (typeof window.Module !== 'object' || !window.Module) window.Module = {};
    const userInit = window.Module.onRuntimeInitialized;
    window.Module.onRuntimeInitialized = function () {
      if (typeof userInit === 'function') { try { userInit(); } catch (_) {} }
      adopt(window.cv || window.Module);
    };

    if (curScript && curScript.parentNode) curScript.parentNode.removeChild(curScript);
    const sc = document.createElement('script');
    sc.async = true; sc.src = url;
    sc.onload = function () { adopt(window.cv); };            // may be ready now, or resolve async
    sc.onerror = function () {                                // hard network/CDN error -> next source now
      if (typeof dlog === 'function') dlog('OpenCV source failed to load: ' + url);
      tryNextSource();
    };
    curScript = sc;
    (document.head || document.documentElement).appendChild(sc);

    curTimer = setTimeout(function () {                       // stalled (no error, no ready) -> next source
      if (cvReady) return;
      if (typeof dlog === 'function') dlog('OpenCV source timed out: ' + url);
      tryNextSource();
    }, CV_SOURCE_TIMEOUT);

    if (!polling) { polling = true; poll(); }
  }

  function retry() {
    if (cvReady) return;
    sourceIdx = -1; started = false; mod = null;             // start over from the primary source
    tryNextSource();
  }
  if (typeof cvRetryBtn !== 'undefined' && cvRetryBtn) cvRetryBtn.addEventListener('click', retry);

  tryNextSource();
})();

/* ===========================================================================
   GRID ANALYSIS — line extraction (snap crossings) + top-hat detection
   =========================================================================== */
function orderCorners(p) {
  const bySum = [...p].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}
function rotatedRectCorners(rr) {
  const cx = rr.center.x, cy = rr.center.y, hw = rr.size.width / 2, hh = rr.size.height / 2;
  const a = rr.angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
}

// PERF: read the photo into a Mat at a capped size so big phone photos stay fast and we
// never allocate a huge full-res Mat. Returns { mat, scale } (scale = capped/natural, ≤1).
// Mapping stays correct because callers express natural-image coords via img.naturalWidth,
// NOT mat.cols — so the cap never changes the coordinate maths (see analyzeGrid's toImage).
const DET_MAX = 1400;        // detection input cap (grid lines stay crisp at this size)
const FLAT_SRC_MAX = 2400;   // flatten source cap (900px straightened output stays sharp)
function imreadScaled(maxDim) {
  const nW = img.naturalWidth, nH = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(nW, nH));
  if (scale >= 1) return { mat: cv.imread(img), scale: 1 };
  const oc = document.createElement('canvas');
  oc.width = Math.max(1, Math.round(nW * scale));
  oc.height = Math.max(1, Math.round(nH * scale));
  oc.getContext('2d').drawImage(img, 0, 0, oc.width, oc.height);
  return { mat: cv.imread(oc), scale };
}

function analyzeGrid() {
  const out = { snaps: [], detect: null };
  let src=null, work=null, gray=null, kTop=null, tophat=null, bin=null, kSmall=null, binD=null,
      hK=null, vK=null, hL=null, vL=null, grid=null, gridD=null, inter=null, interD=null,
      c1=null, h1=null, c2=null, h2=null;
  try {
    src = imreadScaled(DET_MAX).mat;                 // PERF: cap the detection input size
    const workW = Math.min(1100, src.cols), sd = workW / src.cols;
    work = new cv.Mat();
    cv.resize(src, work, new cv.Size(workW, Math.round(src.rows * sd)), 0, 0, cv.INTER_AREA);
    // work is always a uniformly-scaled copy of the WHOLE photo, so work->natural = naturalWidth/W
    // and work->canvas = canvas.width/W, regardless of the imread cap above.
    const W = work.cols, H = work.rows, toCanvas = canvas.width / W, toImage = img.naturalWidth / W;

    gray = new cv.Mat(); cv.cvtColor(work, gray, cv.COLOR_RGBA2GRAY);

    // TOP-HAT: keep thin bright structures (grid lines, cells), REMOVE big bright
    // regions (the wall / equipment in the background).
    kTop = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25));
    tophat = new cv.Mat(); cv.morphologyEx(gray, tophat, cv.MORPH_TOPHAT, kTop);
    bin = new cv.Mat(); cv.threshold(tophat, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

    kSmall = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    binD = new cv.Mat(); cv.dilate(bin, binD, kSmall, new cv.Point(-1, -1), 1);

    // Extract long horizontal & vertical lines (this drops the small cell blobs).
    const len = Math.max(22, Math.round(W / 30));
    hK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(len, 1));
    vK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, len));
    hL = new cv.Mat(); cv.morphologyEx(binD, hL, cv.MORPH_OPEN, hK);
    vL = new cv.Mat(); cv.morphologyEx(binD, vL, cv.MORPH_OPEN, vK);

    grid = new cv.Mat(); cv.bitwise_or(hL, vL, grid);
    inter = new cv.Mat(); cv.bitwise_and(hL, vL, inter);   // crossings only

    // SNAP TARGETS = centres of the crossing blobs
    interD = new cv.Mat(); cv.dilate(inter, interD, kSmall, new cv.Point(-1, -1), 2);
    c1 = new cv.MatVector(); h1 = new cv.Mat();
    cv.findContours(interD, c1, h1, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < c1.size(); i++) {
      const c = c1.get(i);
      // Use the blob CENTROID (image moments) rather than the bounding-box midpoint — it sits more
      // exactly on the true line crossing when a crossing blob is slightly irregular/asymmetric.
      let px, py;
      const mm = cv.moments(c, false);
      if (mm.m00 > 0) { px = mm.m10 / mm.m00; py = mm.m01 / mm.m00; }
      else { const r = cv.boundingRect(c); px = r.x + r.width / 2; py = r.y + r.height / 2; }
      c.delete();
      out.snaps.push({ x: px * toImage, y: py * toImage });
    }

    // DETECT = extent of the connected grid lines (no wall, since top-hat removed it)
    gridD = new cv.Mat(); cv.dilate(grid, gridD, kSmall, new cv.Point(-1, -1), 2);
    c2 = new cv.MatVector(); h2 = new cv.Mat();
    cv.findContours(gridD, c2, h2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bi = -1, ba = 0;
    for (let i = 0; i < c2.size(); i++) { const c = c2.get(i); const a = cv.contourArea(c); c.delete(); if (a > ba) { ba = a; bi = i; } }
    if (bi >= 0 && ba > W * H * 0.04) {
      const c = c2.get(bi); const rr = cv.minAreaRect(c); c.delete();
      let pts = orderCorners(rotatedRectCorners(rr));
      out.detect = pts.map((p) => ({ x: p.x * toCanvas, y: p.y * toCanvas }));
    }
    return out;
  } catch (e) {
    console.error('grid analysis error:', e); return out;
  } finally {
    [src, work, gray, kTop, tophat, bin, kSmall, binD, hK, vK, hL, vL, grid, gridD, inter, interD, c1, h1, c2, h2]
      .forEach((m) => { if (m) { try { m.delete(); } catch (_) {} } });
  }
}

// The big square is a regular 4x4 grid, so true crossings are evenly spaced.
// Drop isolated/spurious crossings (no neighbour within ~1.7x the median spacing)
// for cleaner snapping. Falls back to the raw set if that would remove too many.
function refineSnaps(pts) {
  if (pts.length < 12) return pts;
  const nn = pts.map((p, i) => {
    let m = Infinity;
    for (let j = 0; j < pts.length; j++) { if (j === i) continue; const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y); if (d < m) m = d; }
    return m;
  });
  const sorted = [...nn].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  if (!isFinite(med) || med <= 0) return pts;
  const keep = pts.filter((_, i) => nn[i] <= med * 2.2);   // gentle: only drop clearly isolated outliers
  return keep.length >= Math.max(8, pts.length * 0.5) ? keep : pts;
}
function analyzeAndDetect() {
  if (!cvReady || !img) return;
  const res = analyzeGrid();
  snapTargetsImg = res.snaps;                       // show EVERY crossing — each corner needs its green dot
  const refined = refineSnaps(res.snaps);           // pruned set only for seeding a sensible box
  const seed = refined.length >= 4 ? refined : snapTargetsImg;
  const s = canvas.width / img.naturalWidth;
  if (res.detect) {
    corners = res.detect.map(clampCornerToCanvas); draw();   // clamp so no corner lands off-screen
    setDetectStatus('Grid found — drag each corner onto the large square; it snaps to the crossings. If the square looks small, tap Crop / zoom. Then Flatten.');
  } else if (seed.length >= 4) {
    const xs = seed.map((t) => t.x * s), ys = seed.map((t) => t.y * s);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }].map(clampCornerToCanvas);
    draw();
    setDetectStatus('Grid crossings found — drag each corner onto the square (they snap). If it looks small, tap Crop / zoom. Then Flatten.');
  } else {
    setDetectStatus('Place the four corners on the large square (they snap to grid crossings). If the square looks small, tap Crop / zoom. Then Flatten.');
  }
}
function setDetectStatus(t) { detectStatus.textContent = t; detectStatus.style.display = 'block'; }

// Guaranteed recovery: drop the four corners back to the default inset box, fully on-screen.
// (Use this if a detected corner ever ends up hard to reach.)
function resetBox() {
  if (!img || cropMode) return;
  const w = canvas.width, h = canvas.height, ix = w * 0.15, iy = h * 0.15;
  corners = [{ x: ix, y: iy }, { x: w - ix, y: iy }, { x: w - ix, y: h - iy }, { x: ix, y: h - iy }];
  activeCorner = -1; snappedNow = false;
  draw();
  setDetectStatus('Box reset — drag each corner onto the large square; corners snap to the grid crossings. Then Flatten & count.');
}

/* ===========================================================================
   FLATTEN — perspective transform WITH a margin around the boundary
   =========================================================================== */
flattenBtn.addEventListener('click', () => {
  if (!cvReady || !img) return;
  showBusy('Flattening…');
  setTimeout(doFlatten, 30);
});
function doFlatten() {
  try {
    const s = canvas.width / img.naturalWidth;
    const pts = corners.map((c) => ({ x: c.x / s, y: c.y / s }));
    const O = FLAT_OUT, M = FLAT_MARGIN;

    const { mat: src, scale: g } = imreadScaled(FLAT_SRC_MAX);   // PERF: cap the warp source size
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2,
      [pts[0].x * g, pts[0].y * g, pts[1].x * g, pts[1].y * g, pts[2].x * g, pts[2].y * g, pts[3].x * g, pts[3].y * g]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [M, M, O - M, M, O - M, O - M, M, O - M]); // inset by margin
    const Mtx = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    // BORDER_REPLICATE (not CONSTANT/black): the margin corners of a tilted photo map outside the
    // source; replicating the edge pixel avoids ugly black triangles there (this is only the analysis
    // margin OUTSIDE the magenta boundary, so it never affects the count).
    cv.warpPerspective(src, dst, Mtx, new cv.Size(O, O), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    cv.imshow('flatCanvas', dst);

    const fctx = flatCanvas.getContext('2d');
    flatCleanData = fctx.getImageData(0, 0, O, O);             // clean pixels (for re-render + counting)
    freeSegCache();                                           // fresh flatten -> rebuild the seg cache
    lastFlatClean = flatCanvas.toDataURL('image/jpeg', 0.7);   // clean copy for saving

    cells = [];                                                // reset any previous count
    overlayVisible = true;
    hasCount = false; savedThisCount = false;
    manualLive = 0; manualDead = 0; manualMode = 'live';
    countStatus.style.display = 'none';
    showCountTools(false);
    updateSaveButton();
    renderFlat();                                              // clean image + magenta boundary marker

    flatSection.style.display = 'block';
    saveStatus.textContent = '';
    src.delete(); dst.delete(); Mtx.delete(); srcTri.delete(); dstTri.delete();
    flatCanvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    countCells();                                              // go straight to counting (handles hideBusy)
  } catch (e) {
    console.error('flatten error:', e); dlog('flatten FAILED: ' + e.message); hideBusy();
  }
}

/* ===========================================================================
   PHASE 2 — COUNT THE CELLS inside the flattened square
   The boundary is always mapped to [100..800] (700px = 1mm), so px sizes are
   STABLE across photos. SENSITIVITY (1..10, default 5) scales the detection
   threshold + DIST_MIN + MIN_R: higher = MORE blobs treated as cells.
   Dead (Trypan) detection is RELATIVE to the (bluish) background: a cell is
   "dead" when its blueness exceeds the field's median blueness by a margin set
   by the 1..10 "Dead (blue) sensitivity" slider. Wide range, higher = MORE cells
   dead: k = 6 − level ramps +5σ (level 1, almost all live) to −4σ (level 10, almost all dead).
   Tuning knobs (change on the user's symptom): BG_K, LINE_LEN, PEAK_SEP
   (RAISE if one cell splits into two; LOWER if a clump stays merged),
   DIST_MIN / MIN_R / MAX_R.
   =========================================================================== */
const BG_K = 25, LINE_LEN = 60, PEAK_SEP = 11, DIST_MIN = 2.0;
const MIN_R = 2.5, MAX_R = 22;        // cell radius bounds (px in the 900 image)
const RING_GAP = 6;                   // ring sits this far OUTSIDE the cell edge
const ROW_BAND = 38;                  // reading-order row height for numbering
const TAP_TOL = 16;                   // finger tolerance (screen px) beyond a ring
const ADD_ROI = 46;                   // window (px) searched when you tap to add a cell
const ONECLASS_T = 3.0;               // cell-line one-class outlier cutoff (normalized dist)

let trypanOn = true;                  // DEFAULT: Trypan blue added (user can press No)
let dilution = 2;                     // dilution factor (0/1 = none; 2 = diluted half)
let deadLevel = 5;                    // dead (blue) sensitivity 1..10 (higher = more dead); saved per profile
let sensitivity = 5;                  // detection sensitivity 1..10; saved per profile
let bgBlue = 0, bgSpread = 8;         // background blueness reference (set each count)

// manual count nudge (for cells the detector misses or over-counts; CAN go negative)
let manualLive = 0, manualDead = 0;
let manualMode = 'live';

function setCountStatus(t) { countStatus.textContent = t; countStatus.style.display = 'block'; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function grayAt(d, W, x, y) { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
function isCounted(c) { return c.state === 'in' && !c.dismissed && !c.autoHidden; }

// dead detection RELATIVE to background: a cell is dead when its blueness exceeds the field
// by margin = k(level)·spread. Level is now the DEAD SENSITIVITY (req 5): low level = strict
// (only very-blue cells dead), high level = lenient (almost all dead). Wide range so 1 ≈ none,
// 10 ≈ all. k ramps +5σ (level 1) down to −4σ (level 10), i.e. k = 6 − level.
function deadMarginK() { const lv = clamp(deadLevel, 1, 10); return 6 - lv; }
function computeBackgroundBlueness() {
  if (!flatCleanData) { bgBlue = 0; bgSpread = 8; return; }
  const d = flatCleanData.data, W = FLAT_OUT, lo = FLAT_MARGIN, hi = FLAT_OUT - FLAT_MARGIN, vals = [];
  for (let y = lo; y < hi; y += 9) for (let x = lo; x < hi; x += 9) {
    const i = (y * W + x) * 4; vals.push(d[i + 2] - (d[i] + d[i + 1]) / 2);   // B - (R+G)/2
  }
  vals.sort((a, b) => a - b);
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = dev.length ? dev[Math.floor(dev.length / 2)] : 0;
  bgBlue = med; bgSpread = Math.max(6, mad * 1.4826);   // robust spread (MAD->σ), floored
}
function recomputeDead() {
  // If the active cell line has enough trained dead/live examples, classify dead by the learned
  // model (req 7); otherwise fall back to the relative blueness slider. Guarded so it never breaks.
  let useModel = false;
  try { useModel = (typeof deadModelReady === 'function') && deadModelReady(); } catch (_) { useModel = false; }
  const margin = deadMarginK() * bgSpread;
  cells.forEach((c) => {
    if (useModel) {
      try { c.deadBase = predictDeadTrained(c); }
      catch (_) { c.deadBase = (c.blueness - bgBlue) > margin; }
    } else {
      c.deadBase = (c.blueness - bgBlue) > margin;
    }
  });
}

// sensitivity -> effective detection parameters (monotonic; default = the constants above)
function sensParams(sv) {
  const k = (clamp(sv, 1, 10) - 5) / 5;             // -0.8 .. +1.0
  return {
    thrMul:  clamp(1 - k * 0.45, 0.45, 1.6),        // higher sens -> lower threshold -> fainter cells in
    distMin: clamp(DIST_MIN * (1 - k * 0.55), 0.5, 4),
    minR:    clamp(MIN_R * (1 - k * 0.45), 1.2, 6)
  };
}

// boundary two-edges rule: count cells touching TOP+LEFT; exclude BOTTOM+RIGHT.
function classifyCell(cx, cy, r, O, M) {
  const lo = M, hi = O - M;
  const inSpanX = cx >= lo - r && cx <= hi + r;
  const inSpanY = cy >= lo - r && cy <= hi + r;
  const onTop    = Math.abs(cy - lo) <= r && inSpanX;
  const onLeft   = Math.abs(cx - lo) <= r && inSpanY;
  const onBottom = Math.abs(cy - hi) <= r && inSpanX;
  const onRight  = Math.abs(cx - hi) <= r && inSpanY;
  if (onBottom || onRight) return 'out';
  const inside = cx > lo && cx < hi && cy > lo && cy < hi;
  if (inside || onTop || onLeft) return 'in';
  return 'drop';
}

// small per-cell "fingerprint" (the cell-line classifier learns from these).
function featuresAt(cx, cy, r) {
  const data = flatCleanData.data, W = FLAT_OUT, r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(W - 1, Math.ceil(cy + r));
  let n = 0, sG = 0, sG2 = 0, sR = 0, sGr = 0, sB = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy > r2) continue;
      const i = (y * W + x) * 4, R = data[i], G = data[i + 1], B = data[i + 2];
      const g = 0.299 * R + 0.587 * G + 0.114 * B;
      sG += g; sG2 += g * g; sR += R; sGr += G; sB += B; n++;
    }
  }
  if (!n) return { meanI: 0, varI: 0, blueness: 0 };
  const meanI = sG / n, varI = Math.max(0, sG2 / n - meanI * meanI);
  const blueness = (sB / n) - ((sR / n) + (sGr / n)) / 2;
  return { meanI: Math.round(meanI), varI: Math.round(varI), blueness: Math.round(blueness) };
}

/* ---- numbering: counted cells, reading order top-left -> bottom-right ---- */
function assignNumbers() {
  const counted = cells.filter(isCounted);
  counted.sort((a, b) => {
    const ra = Math.round(a.y / ROW_BAND), rb = Math.round(b.y / ROW_BAND);
    return ra !== rb ? ra - rb : a.x - b.x;
  });
  cells.forEach((c) => { c.num = null; });
  counted.forEach((c, i) => { c.num = i + 1; });
}

/* ---- drawing the overlay ---- */
function renderFlat() {
  if (!flatCleanData) return;
  const fctx = flatCanvas.getContext('2d');
  fctx.putImageData(flatCleanData, 0, 0);
  drawBoundaryMarker(fctx);
  if (trainingMode) { drawTrainCandidates(fctx); return; }
  if (overlayVisible) drawCells(fctx);
}
function drawBoundaryMarker(fctx) {
  const O = FLAT_OUT, M = FLAT_MARGIN, side = O - 2 * M;
  fctx.setLineDash([]);
  fctx.lineWidth = 5; fctx.strokeStyle = 'rgba(0,0,0,0.55)';
  fctx.strokeRect(M, M, side, side);
  fctx.lineWidth = 2.5; fctx.strokeStyle = '#ff2d95';
  fctx.strokeRect(M, M, side, side);
}
function drawCells(fctx) {
  fctx.textAlign = 'center'; fctx.textBaseline = 'middle';
  fctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
  for (const c of cells) {
    const R = c.r + RING_GAP;
    let stroke, dashed = false, faint = false, num = c.num;
    if (c.dismissed)            { stroke = 'rgba(150,160,170,0.75)'; dashed = true; faint = true; num = null; }
    else if (c.autoHidden)      { stroke = 'rgba(150,170,200,0.7)';  dashed = true; faint = true; num = null; } // hidden by the cell-line classifier
    else if (c.state === 'in')  { stroke = isDead(c) ? 'rgba(80,150,255,0.98)' : 'rgba(60,220,130,0.98)'; }
    else if (c.state === 'out') { stroke = 'rgba(255,170,60,0.96)'; num = null; }
    else if (c.added)           { stroke = 'rgba(150,160,170,0.85)'; faint = true; num = null; }
    else { continue; }

    fctx.setLineDash(dashed ? [5, 5] : []);
    if (!faint) {
      fctx.beginPath(); fctx.arc(c.x, c.y, R, 0, Math.PI * 2);
      fctx.lineWidth = 4.5; fctx.strokeStyle = 'rgba(0,0,0,0.5)'; fctx.stroke();
    }
    fctx.beginPath(); fctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    fctx.lineWidth = faint ? 1.5 : 2.6; fctx.strokeStyle = stroke; fctx.stroke();
    fctx.setLineDash([]);

    if (num != null) {
      const off = R + 9;
      const nx = clamp(c.x + off * 0.707, 9, FLAT_OUT - 9), ny = clamp(c.y - off * 0.707, 9, FLAT_OUT - 9);
      const t = String(num);
      fctx.lineWidth = 3.5; fctx.strokeStyle = 'rgba(0,0,0,0.7)'; fctx.strokeText(t, nx, ny);
      fctx.fillStyle = '#eafff2'; fctx.fillText(t, nx, ny);
    }
  }
}

/* ---- segmentation: returns candidate blobs {x,y,r,area,meanI,varI,blueness} ---- */
// ---- cached preprocessing (does NOT depend on sensitivity) ------------------
// The grayscale + top-hat + Otsu base only depend on the flattened photo, not on the
// sensitivity slider. Computing them once per flatten (instead of every recount) makes
// dragging the sensitivity slider fast. Rebuilt on each new flatten/photo (freeSegCache).
let segTophat = null;   // cached top-hat Mat (kept alive between recounts)
let segOtsu = 0;        // cached Otsu base threshold
function freeSegCache() { if (segTophat) { try { segTophat.delete(); } catch (_) {} } segTophat = null; segOtsu = 0; }
function ensureSegCache() {
  if (segTophat) return true;
  if (!flatCleanData) return false;
  let rgba = null, gray = null, kBg = null, tmp = null;
  try {
    rgba = cv.matFromImageData(flatCleanData);
    gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    kBg = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(BG_K, BG_K));
    const th = new cv.Mat(); cv.morphologyEx(gray, th, cv.MORPH_TOPHAT, kBg);
    tmp = new cv.Mat();
    segOtsu = cv.threshold(th, tmp, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    segTophat = th;                                // keep (freed by freeSegCache)
    return true;
  } catch (e) { dlog('seg-cache FAILED: ' + e.message); freeSegCache(); return false; }
  finally { [rgba, gray, kBg, tmp].forEach((m) => { if (m) { try { m.delete(); } catch (_) {} } }); }
}

function segmentBlobs(sv) {
  const O = FLAT_OUT, out = [];
  const sp = sensParams(sv);
  if (!ensureSegCache() || !segTophat) return out;
  let bin=null, hK=null, vK=null,
      hL=null, vL=null, lines=null, noLines=null, kOpen=null, dist=null, distB=null,
      sep=null, maxd=null, isMax=null, strongF=null, strong8=null, seeds=null,
      lbl=null, stats=null, cent=null;
  try {
    // sensitivity-adjusted threshold on the CACHED top-hat (+ cached Otsu base)
    bin = new cv.Mat();
    cv.threshold(segTophat, bin, clamp(segOtsu * sp.thrMul, 1, 254), 255, cv.THRESH_BINARY);

    // remove grid LINES (long thin) so they aren't counted and don't merge cells
    hK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(LINE_LEN, 1));
    vK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, LINE_LEN));
    hL = new cv.Mat(); cv.morphologyEx(bin, hL, cv.MORPH_OPEN, hK);
    vL = new cv.Mat(); cv.morphologyEx(bin, vL, cv.MORPH_OPEN, vK);
    lines = new cv.Mat(); cv.bitwise_or(hL, vL, lines);
    noLines = new cv.Mat(); cv.subtract(bin, lines, noLines);
    kOpen = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.morphologyEx(noLines, noLines, cv.MORPH_OPEN, kOpen);

    // distance transform -> each cell becomes a "hill"; its peak marks the centre.
    dist = new cv.Mat(); cv.distanceTransform(noLines, dist, cv.DIST_L2, 5);
    distB = new cv.Mat(); cv.GaussianBlur(dist, distB, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

    // LOCAL MAXIMA = peaks (PEAK_SEP ~ one cell diameter -> splits touching cells)
    sep = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(PEAK_SEP, PEAK_SEP));
    maxd = new cv.Mat(); cv.dilate(distB, maxd, sep);
    isMax = new cv.Mat(); cv.compare(distB, maxd, isMax, cv.CMP_GE);
    strongF = new cv.Mat(); cv.threshold(distB, strongF, sp.distMin, 255, cv.THRESH_BINARY);
    strong8 = new cv.Mat(); strongF.convertTo(strong8, cv.CV_8U);
    seeds = new cv.Mat(); cv.bitwise_and(isMax, strong8, seeds);

    lbl = new cv.Mat(); stats = new cv.Mat(); cent = new cv.Mat();
    const nLab = cv.connectedComponentsWithStats(seeds, lbl, stats, cent, 8, cv.CV_32S);
    for (let i = 1; i < nLab; i++) {
      const cx = cent.doubleAt(i, 0), cy = cent.doubleAt(i, 1);
      const xx = clamp(Math.round(cx), 0, O - 1), yy = clamp(Math.round(cy), 0, O - 1);
      const r = dist.floatAt(yy, xx);
      if (r < sp.minR || r > MAX_R) continue;
      const fp = featuresAt(cx, cy, r);
      out.push({ x: cx, y: cy, r, area: Math.round(Math.PI * r * r), ...fp });
    }
    return out;
  } catch (e) {
    console.error('segment error:', e); dlog('segment FAILED: ' + e.message); return out;
  } finally {
    [bin,hK,vK,hL,vL,lines,noLines,kOpen,dist,distB,sep,maxd,isMax,strongF,strong8,seeds,lbl,stats,cent]
      .forEach((m) => { if (m) { try { m.delete(); } catch (_) {} } });
  }
}

/* ---- the count ---- */
// quiet = true: recount WITHOUT the full-screen overlay (used by the sensitivity slider so
// repeated tweaks feel instant). The cached preprocessing keeps each recount fast.
function countCells(quiet) {
  if (!cvReady || !flatCleanData) { setCountStatus('Flatten a square first.'); hideBusy(); return; }
  if (!quiet) { setCountStatus('Counting…'); showBusy('Counting cells…'); }
  setTimeout(() => { try { runCount(); } finally { if (!quiet) hideBusy(); } }, quiet ? 0 : 30);
}
function runCount() {
  cells = [];
  try {
    computeBackgroundBlueness();                          // field reference for RELATIVE dead detection
    const blobs = segmentBlobs(sensitivity);
    blobs.forEach((b) => {
      const state = classifyCell(b.x, b.y, b.r, FLAT_OUT, FLAT_MARGIN);
      if (state === 'drop') return;
      cells.push({ x: b.x, y: b.y, r: b.r, area: b.area, state,
        dismissed: false, added: false, autoHidden: false, userLabeled: false,
        flip: false, cyc: 0, deadBase: false,
        meanI: b.meanI, varI: b.varI, blueness: b.blueness });
    });
    recomputeDead();                                      // set deadBase relative to background

    manualLive = 0; manualDead = 0; manualMode = 'live';
    // Trypan + dilution are remembered per profile (loaded on profile open, persisted on change),
    // so we keep them across photos rather than resetting every count. Just reflect them in the field.
    if (dilutionInput) dilutionInput.value = String(dilution);
    applyTrypan();
    applyClassifier();                // Phase 3: auto-hide debris if a trained line is active
    hasCount = true; savedThisCount = false;
    showCountTools(true);
    updateCellLineButtons();
    redrawCount();

    const inN = cells.filter(isCounted).length;
    const hidden = cells.filter((c) => c.autoHidden).length;
    dlog(`counted: ${inN} in, trypan ${trypanOn ? 'on' : 'off'}, sens ${sensitivity}, dead ${deadLevel}` + (hidden ? `, hid ${hidden}` : ''));
    let msg = cells.length === 0
      ? 'No cells found. Raise "Detection sensitivity", or say "too few / none".'
      : 'Tap a ring to cycle it' + (trypanOn ? ' (live\u2194dead \u2192 remove \u2192 back)' : ' (remove \u2192 restore)') + '. Tap a missed cell to add it.';
    if (activeCellLineId != null && classifierReady() && hidden > 0)
      msg += ` \u00B7 learning hid ${hidden} look-alike${hidden === 1 ? '' : 's'} (tap to keep).`;
    setCountStatus(msg);
  } catch (e) {
    console.error('count error:', e); dlog('count FAILED: ' + e.message); setCountStatus('Counting failed \u2014 see debug log.');
  }
}

/* ---- Trypan blue (live/dead) + dilution + readout ---- */
function isDead(c) { return trypanOn && (c.flip ? !c.deadBase : c.deadBase); }
function applyTrypan() {
  recomputeDead();
  trypanYes.classList.toggle('active', trypanOn);
  trypanNo.classList.toggle('active', !trypanOn);
}
function setTrypan(on) { trypanOn = on; applyTrypan(); setDilutionForTrypan(on); updateToolsVisibility(); redrawCount(); saveProfilePref(); }
function setDeadLevel(v) {                 // 1..10 dead sensitivity (higher = MORE cells dead)
  deadLevel = clamp(v, 1, 10);
  if (blueLabel) blueLabel.textContent = deadLevel;
  recomputeDead();
  redrawCount();
  saveProfilePref();
}

// Dilution field: Yes -> 2 (diluted half); No -> 0 (no dilution). 0 and 1 both
// mean "no dilution" (factor 1); 2 means the sample was diluted by half.
function setDilutionField(displayVal) {
  if (dilutionInput) dilutionInput.value = String(displayVal);
  const v = parseFloat(displayVal);
  dilution = (isFinite(v) && v > 1) ? v : 1;   // 0 or 1 -> factor 1
  if (typeof updateReadout === 'function') updateReadout();
  if (typeof updateCalc === 'function') updateCalc();
  savedThisCount = false; updateSaveButton();
}
function setDilutionForTrypan(on) { setDilutionField(on ? 2 : 1); }   // No -> factor 1 (shown as "1")

function formatConc(v) {
  v = Math.max(0, v);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + '\u00D710\u2076';
  if (v >= 1e3) return Math.round(v).toLocaleString();
  return String(Math.round(v));
}
// format a per-mL value in the user's chosen unit (mL or µL)
function fmtConcUnit(perML) {
  if (concUnit === 'uL') return formatConc(perML / 1000) + ' cells/\u00B5L';
  return formatConc(perML) + ' cells/mL';
}
function setConcUnit(u) {
  concUnit = (u === 'uL') ? 'uL' : 'mL';
  if (concMlBtn) concMlBtn.classList.toggle('active', concUnit === 'mL');
  if (concUlBtn) concUlBtn.classList.toggle('active', concUnit === 'uL');
  updateReadout(); updateCalc();
  saveProfilePref();
}

/* ---- dilution / seeding calculator (request 3) ----
   Basis = concentration of the ORIGINAL stock (cells/mL). concPerML() already
   multiplies each square by its dilution factor, so it recovers the undiluted
   stock. Prefer the session mean (steadier); else use the current square. */
function formatCount(n) {                      // human cell counts: commas, or ×10^x when huge
  n = Math.max(0, Math.round(n));
  if (n >= 1e6) return (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' million';
  return n.toLocaleString();
}
function fmtVol(ml) {                           // show µL when < 1 mL, else mL
  if (!isFinite(ml) || ml < 0) ml = 0;
  if (ml < 1) return (ml * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' µL';
  return ml.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' mL';
}
function calcBasisPerML() {                      // -> { perML, note }
  if (sessionSquares && sessionSquares.length) {
    const n = sessionSquares.length;
    return { perML: concPerML(sessionSquares),
             note: `using the session mean of ${n} square${n === 1 ? '' : 's'}` };
  }
  const { total, live } = liveDeadTotals();
  const base = Math.max(0, trypanOn ? live : total);          // live stock if staining, else total
  return { perML: base * (dilution > 1 ? dilution : 1) * 1e4,
           note: 'using the current square — add squares to the session for a steadier average' };
}
function updateCalc() {
  if (!calcOut) return;                          // calculator UI absent
  try {
    updateLimitDil();                            // keep the limiting-dilution block in sync too
    const { perML, note } = calcBasisPerML();
    if (calcBasis) {
      calcBasis.textContent = perML > 0
        ? `Stock ≈ ${fmtConcUnit(perML)} (${note}).`
        : 'Count a square first — then this uses your measured concentration.';
    }
    const cellsNeeded = parseFloat(String(calcCells ? calcCells.value : '').replace(/[, ]/g, ''));
    if (!isFinite(cellsNeeded) || cellsNeeded <= 0) { calcOut.style.display = 'none'; calcOut.textContent = ''; return; }
    if (perML <= 0) { calcOut.textContent = 'Count a square first so the stock concentration is known.'; calcOut.style.display = 'block'; return; }

    const stockML = cellsNeeded / perML;                       // volume of stock to pipette (mL)
    let out = `Pipette ${fmtVol(stockML)} of stock for ${formatCount(cellsNeeded)} cells.`;

    const finalML = parseFloat(String(calcFinal ? calcFinal.value : '').replace(/[, ]/g, ''));   // make-up volume in mL
    if (isFinite(finalML) && finalML > 0) {
      if (finalML >= stockML) {
        out += `\nThen add ${fmtVol(finalML - stockML)} of medium → ${fmtVol(finalML)} total at ≈ ${fmtConcUnit(cellsNeeded / finalML)}.`;
      } else {
        out += `\nYour make-up volume (${fmtVol(finalML)}) is smaller than the stock needed (${fmtVol(stockML)}) — raise it or use a denser stock.`;
      }
    }
    calcOut.textContent = out; calcOut.style.display = 'block';
  } catch (e) { dlog('calc failed: ' + e.message); }
}

/* ---- limiting-dilution (single-cell cloning) calculator ----
   Dilute the measured stock so each well receives ~lambda cells, prepare a plate's worth of
   suspension (with overage), and show the Poisson clonality odds. Basis = the same stock
   concentration the seeding calculator uses. Pure maths, guarded so it can never break a count. */
function limitDilution(perML, lambda, wellUl, wells) {
  const OVER = 1.2;                                 // 20% spare for pipetting dead-volume
  const seedPerML = lambda / (wellUl / 1000);       // seeding concentration to average lambda cells/well
  const totalMl   = wells * (wellUl / 1000) * OVER; // suspension to prepare
  const stockMl   = perML > 0 ? (seedPerML * totalMl) / perML : Infinity;  // = total cells / stock conc
  const mediumMl  = Math.max(0, totalMl - stockMl);
  const pGrow     = 1 - Math.exp(-lambda);          // P(well seeded with >=1 cell)
  const pClonal   = pGrow > 0 ? (lambda * Math.exp(-lambda)) / pGrow : 0;   // P(exactly 1 | >=1)
  const singleWells = wells * lambda * Math.exp(-lambda);
  return { seedPerML, totalMl, stockMl, mediumMl, pGrow, pClonal, singleWells };
}
function updateLimitDil() {
  if (!ldOut) return;
  try {
    const lambda = parseFloat(ldCells ? ldCells.value : '');
    const wellUl = parseFloat(ldVol ? ldVol.value : '');
    const wells  = parseFloat(ldWells ? ldWells.value : '');
    if (!isFinite(lambda) || lambda <= 0 || !isFinite(wellUl) || wellUl <= 0 || !isFinite(wells) || wells < 1) {
      ldOut.style.display = 'none'; ldOut.textContent = ''; return;
    }
    const { perML } = calcBasisPerML();
    if (!(perML > 0)) { ldOut.textContent = 'Count a square first so the stock concentration is known.'; ldOut.style.display = 'block'; return; }
    const r = limitDilution(perML, lambda, wellUl, wells);
    let out = `Target ${lambda} cell/well · ${wells} wells · ${wellUl} µL each.`;
    if (r.stockMl > r.totalMl) {
      out += `\nStock (${fmtConcUnit(perML)}) is too dilute for ${lambda} cell/well at this volume — concentrate the cells first (you'd need ${fmtVol(r.stockMl)} of stock but only have ${fmtVol(r.totalMl)} total).`;
    } else {
      out += `\nMake ${fmtVol(r.totalMl)} at ≈ ${fmtConcUnit(r.seedPerML)}: ${fmtVol(r.stockMl)} stock + ${fmtVol(r.mediumMl)} medium (incl. 20% spare).`;
      out += `\n≈ ${Math.round(r.pGrow * 100)}% of wells grow; ≈ ${Math.round(r.pClonal * 100)}% of those are single clones (~${Math.round(r.singleWells)} wells with exactly 1 cell).`;
      if (lambda > 1) out += `\nTip: use ≤ 1 cell/well (0.5 is common) for confident single-cell clones.`;
    }
    ldOut.textContent = out; ldOut.style.display = 'block';
  } catch (e) { dlog('limit-dilution calc failed: ' + e.message); }
}

/* recent / preset "cells needed" values, saved per profile so the user rarely retypes (req 4) */
let profileRecentCounts = [];                 // most-recent first
const CALC_DEFAULT_PRESETS = [1000000, 500000, 250000, 100000];
function fmtChip(n) {                          // compact chip label: 1M, 250k, 5,000
  if (n >= 1e6) return (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'M';
  if (n >= 1e3) return (n / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k';
  return String(n);
}
function renderCalcRecent() {
  if (!calcRecent) return;
  calcRecent.innerHTML = '';
  const list = profileRecentCounts.length ? profileRecentCounts : CALC_DEFAULT_PRESETS;
  const lead = document.createElement('span'); lead.className = 'calc-recent-label';
  lead.textContent = profileRecentCounts.length ? 'Recent:' : 'Quick:';
  calcRecent.appendChild(lead);
  list.slice(0, 8).forEach((n) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = fmtChip(n);
    b.title = n.toLocaleString() + ' cells';
    b.addEventListener('click', () => {
      if (calcCells) calcCells.value = n.toLocaleString();
      if (calcBox && !calcBox.open) calcBox.open = true;
      updateCalc();
      rememberCount(n);                        // bumps it to the front
    });
    calcRecent.appendChild(b);
  });
}
function rememberCount(n) {
  n = Math.round(n);
  if (!isFinite(n) || n <= 0) return;
  profileRecentCounts = [n, ...profileRecentCounts.filter((x) => x !== n)].slice(0, 8);
  renderCalcRecent();
  saveRecentCounts();
}
async function saveRecentCounts() {
  if (!storageOK || activeProfileId == null) return;
  try {
    const p = await pGet('profiles', Number(activeProfileId));
    if (!p) return;
    p.recentCounts = profileRecentCounts;
    await pPut('profiles', p);
  } catch (e) { dlog('recent-counts save failed: ' + e.message); }
}
function liveDeadTotals() {                          // detector counts + manual nudge (manual can be negative)
  const counted = cells.filter(isCounted);
  const detDead = trypanOn ? counted.filter((c) => isDead(c)).length : 0;
  const detLive = counted.length - detDead;
  const dead = (trypanOn ? detDead + manualDead : 0);
  const live = (trypanOn ? detLive : counted.length) + manualLive;
  return { total: live + dead, live, dead };
}
function updateReadout() {
  const { total, live, dead } = liveDeadTotals();
  let txt = `Total ${total}`;
  if (trypanOn) {
    const v = total > 0 ? Math.round((live / total) * 100) : 0;
    txt += `  \u00B7  Live ${live}  \u00B7  Dead ${dead}  \u00B7  Viability ${v}%`;
  }
  const liveConc  = Math.max(0, trypanOn ? live : total) * dilution * 1e4;
  const totalConc = Math.max(0, total) * dilution * 1e4;
  if (trypanOn) {
    txt += `\nLive \u2248 ${fmtConcUnit(liveConc)}  \u00B7  Total \u2248 ${fmtConcUnit(totalConc)}  (this square)`;
  } else {
    txt += `\n\u2248 ${fmtConcUnit(totalConc)}  (this square)`;
  }
  countReadout.textContent = txt;
  countReadout.style.display = 'block';
  updateCountHint(total);
}
// Gentle reliability hint: a Neubauer large square reads best at roughly 15–100 cells.
// Too few -> statistically noisy; too many -> cells overlap and get under-counted.
// We nudge toward a better dilution instead of silently giving a shaky number.
function updateCountHint(total) {
  if (!countHint) return;
  let msg = '';
  if (total > 0 && total < 15)
    msg = `Only ${total} cells in this square — under ~15 is statistically noisy. Use a more concentrated sample (lower the dilution), and count several squares to average.`;
  else if (total > 100)
    msg = `${total} cells in this square — over ~100 is hard to count cleanly (cells overlap). Dilute the sample more (raise the dilution factor) for a more reliable result.`;
  countHint.textContent = msg;
  countHint.style.display = msg ? 'block' : 'none';
}
function redrawCount() { assignNumbers(); renderFlat(); updateReadout(); updateCalc(); savedThisCount = false; updateSaveButton(); }

/* ---- manual count nudge (+/-) — CAN go negative (subtract over-counted debris) ---- */
function adjustManual(delta) {
  if (manualMode === 'dead' && trypanOn) manualDead += delta;
  else manualLive += delta;
  updateManualUI();
  redrawCount();
}
function setManualMode(m) {
  manualMode = (m === 'dead' && trypanOn) ? 'dead' : 'live';
  updateManualUI();
}
function updateManualUI() {
  const showDeadToggle = trypanOn;
  manualLiveBtn.style.display = showDeadToggle ? '' : 'none';
  manualDeadBtn.style.display = showDeadToggle ? '' : 'none';
  if (!trypanOn) manualMode = 'live';
  manualLiveBtn.classList.toggle('active', manualMode === 'live');
  manualDeadBtn.classList.toggle('active', manualMode === 'dead');
  const n = manualMode === 'dead' ? manualDead : manualLive;
  const what = !trypanOn ? 'cells' : manualMode;
  const sign = n > 0 ? '+' : '';                  // negatives already carry '-'
  manualLabel.textContent = `${sign}${n} ${what}`;
}
// Slider visibility. A trained cell line replaces the manual knobs, so when one is
// active we hide BOTH the detection-sensitivity and the dead-(blue)-sensitivity sliders.
// Under Default (no learning): detection sensitivity always shows; dead-blue only when Trypan is on.
function updateToolsVisibility() {
  const trained = activeCellLineId != null;        // a named cell line is doing the counting/dead call
  if (sensGroup) sensGroup.style.display = trained ? 'none' : '';
  if (sliderGroup) sliderGroup.style.display = (trypanOn && !trained) ? '' : 'none';
  updateManualUI();
}

/* ---- tap to correct: cycle state / remove / add (+ teach the active cell line) ----
   Called only on a confirmed single-finger TAP (see the tap-gating below), so a
   two-finger pinch-zoom no longer toggles a cell, and a one-finger drag pans. */
function flatTapAt(clientX, clientY) {
  if (!flatCleanData) return;
  const rect = flatCanvas.getBoundingClientRect();
  const sx = flatCanvas.width / rect.width;                 // displayed -> 900-space
  const x = (clientX - rect.left) * sx, y = (clientY - rect.top) * sx;

  if (trainingMode) { toggleCandidate(x, y); return; }      // Phase 3 training: tap = mark a cell/debris
  if (!overlayVisible) return;                              // circles hidden for manual counting

  let hit = -1, hd = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i], d = Math.hypot(x - c.x, y - c.y);
    const grab = c.r + RING_GAP + TAP_TOL * sx;
    if (d <= grab && d < hd) { hd = d; hit = i; }
  }
  if (hit >= 0) {
    const c = cells[hit];
    if (c.autoHidden) {                                     // restore a cell the classifier hid -> teach "cell"
      c.autoHidden = false; c.userLabeled = true; appendLabel(c, 1);
    } else {
      if (trypanOn) c.cyc = (c.cyc + 1) % 3; else c.cyc = (c.cyc === 2 ? 0 : 2);
      c.flip = (c.cyc === 1);
      c.dismissed = (c.cyc === 2);
      if (c.dismissed) { c.userLabeled = true; appendLabel(c, 0); }  // removed -> teach "debris"
    }
  } else {
    const added = addCellAt(x, y);                          // tap empty space -> add a missed cell
    if (added) appendLabel(added, 1);
  }
  redrawCount();
}
function medianR() {
  const rs = cells.filter((c) => c.state === 'in' && !c.added).map((c) => c.r).sort((a, b) => a - b);
  return rs.length ? rs[Math.floor(rs.length / 2)] : 6;
}
function addCellAt(x, y) {
  const found = detectBlobNear(x, y);
  const cx = found ? found.cx : x, cy = found ? found.cy : y;
  const r = found ? found.r : medianR();
  const state = classifyCell(cx, cy, r, FLAT_OUT, FLAT_MARGIN);
  const fp = featuresAt(cx, cy, r);
  const c = { x: cx, y: cy, r, area: Math.round(Math.PI * r * r), state,
    dismissed: false, added: true, autoHidden: false, userLabeled: true,
    flip: false, cyc: 0, deadBase: (fp.blueness - bgBlue) > deadMarginK() * bgSpread, ...fp };
  cells.push(c);
  return c;
}
// find the bright blob under/near a tap (pure JS on the clean pixels — no cv, no leaks)
function detectBlobNear(tx, ty) {
  const data = flatCleanData.data, W = FLAT_OUT, half = Math.floor(ADD_ROI / 2);
  const x0 = clamp(Math.round(tx) - half, 1, W - 2), x1 = clamp(Math.round(tx) + half, 1, W - 2);
  const y0 = clamp(Math.round(ty) - half, 1, W - 2), y1 = clamp(Math.round(ty) + half, 1, W - 2);
  if (x1 <= x0 || y1 <= y0) return null;
  let mean = 0, mx = 0, cnt = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const g = grayAt(data, W, x, y); mean += g; if (g > mx) mx = g; cnt++; }
  mean /= cnt;
  const thr = Math.max(mean + 12, mx * 0.55);
  let sx = -1, sy = -1, sb = -1;
  for (let y = clamp(Math.round(ty) - 10, y0, y1); y <= clamp(Math.round(ty) + 10, y0, y1); y++)
    for (let x = clamp(Math.round(tx) - 10, x0, x1); x <= clamp(Math.round(tx) + 10, x0, x1); x++) {
      const g = grayAt(data, W, x, y); if (g > sb) { sb = g; sx = x; sy = y; }
    }
  if (sb < thr) return null;
  const seen = new Set(), stack = [[sx, sy]]; let n = 0, cxs = 0, cys = 0;
  while (stack.length) {
    const p = stack.pop(), x = p[0], y = p[1];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const k = y * W + x; if (seen.has(k)) continue;
    if (grayAt(data, W, x, y) < thr) continue;
    seen.add(k); n++; cxs += x; cys += y;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    if (n > 4000) break;
  }
  if (n < 4) return null;
  const r = Math.sqrt(n / Math.PI);
  if (r > MAX_R * 1.6) return null;
  const cx = cxs / n, cy = cys / n;
  if (Math.hypot(cx - tx, cy - ty) > ADD_ROI) return null;
  return { cx, cy, r: clamp(r, 3, MAX_R) };
}

/* ---- show/hide the counting tools ---- */
function showCountTools(on) {
  countTools.style.display = on ? 'block' : 'none';
  if (!on) countReadout.style.display = 'none';
  if (!on && countHint) countHint.style.display = 'none';
  if (on) {
    if (sensSlider) sensSlider.value = sensitivity;
    if (sensLabel) sensLabel.textContent = sensitivity;
    if (celllineRow) celllineRow.style.display = storageOK ? '' : 'none';
    updateToolsVisibility();
  }
}

/* ---- Reset to defaults / Show-hide circles (replace the old "Count again") ---- */
function resetCountDefaults() {
  sensitivity = 5;
  if (sensSlider) sensSlider.value = 5;
  if (sensLabel) sensLabel.textContent = 5;
  deadLevel = 5;                                   // also reset dead (blue) sensitivity to the default
  if (blueSlider) blueSlider.value = 5;
  if (blueLabel) blueLabel.textContent = 5;
  saveProfilePref();
  overlayVisible = true;
  if (toggleOverlayBtn) toggleOverlayBtn.textContent = 'Hide circles';
  countCells();                       // fresh recount clears manual edits + re-auto-detects
}
function toggleOverlay() {
  overlayVisible = !overlayVisible;
  if (toggleOverlayBtn) toggleOverlayBtn.textContent = overlayVisible ? 'Hide circles' : 'Show circles';
  renderFlat();
}

/* ---- wire the count-tool controls ---- */
// TAP-GATING: only fire a tap when it's a clean single-finger tap (no 2nd finger,
// little movement, quick). This stops a pinch-zoom from toggling cells, and lets a
// one-finger drag pan the (zoomed) page. Works the same in training mode.
let _tapStart = null, _tapCancelled = false;
const _activePtrs = new Set();
flatCanvas.addEventListener('pointerdown', (e) => {
  _activePtrs.add(e.pointerId);
  if (_activePtrs.size > 1) { _tapCancelled = true; _tapStart = null; return; }   // pinch -> not a tap
  _tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
  _tapCancelled = false;
});
flatCanvas.addEventListener('pointermove', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) return;
  if (Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y) > 12) { _tapCancelled = true; _tapStart = null; }
});
function _endFlatPtr(e) {
  const isTap = _tapStart && e.pointerId === _tapStart.id && !_tapCancelled &&
                _activePtrs.size === 1 && (Date.now() - _tapStart.t) < 500;
  const cx = e.clientX, cy = e.clientY;
  _activePtrs.delete(e.pointerId);
  if (_tapStart && e.pointerId === _tapStart.id) _tapStart = null;
  if (_activePtrs.size === 0) _tapCancelled = false;
  if (isTap) flatTapAt(cx, cy);
}
flatCanvas.addEventListener('pointerup', _endFlatPtr);
flatCanvas.addEventListener('pointercancel', (e) => { _activePtrs.delete(e.pointerId); _tapStart = null; _tapCancelled = true; });

resetBtn.addEventListener('click', resetCountDefaults);
toggleOverlayBtn.addEventListener('click', toggleOverlay);
trypanYes.addEventListener('click', () => setTrypan(true));
trypanNo.addEventListener('click', () => setTrypan(false));
dilutionInput.addEventListener('input', () => {
  const v = parseFloat(dilutionInput.value);
  dilution = (isFinite(v) && v > 1) ? v : 1;     // 0 or 1 -> no dilution
  updateReadout(); updateCalc();
  savedThisCount = false; updateSaveButton();
  saveProfilePref();                              // remember the user's dilution for this profile
});
blueSlider.addEventListener('input', () => setDeadLevel(parseInt(blueSlider.value, 10)));
if (concMlBtn) concMlBtn.addEventListener('click', () => setConcUnit('mL'));
if (concUlBtn) concUlBtn.addEventListener('click', () => setConcUnit('uL'));
let sensTimer = null;
sensSlider.addEventListener('input', () => {
  sensitivity = parseInt(sensSlider.value, 10);
  if (sensLabel) sensLabel.textContent = sensitivity;
  clearTimeout(sensTimer);
  // debounce + QUIET recount (no full-screen spinner) so you can drag the slider and watch it update
  sensTimer = setTimeout(() => { saveProfilePref(); if (flatCleanData) countCells(true); }, 160);
});
manualMinus.addEventListener('click', () => adjustManual(-1));
manualPlus.addEventListener('click', () => adjustManual(1));
manualLiveBtn.addEventListener('click', () => setManualMode('live'));
manualDeadBtn.addEventListener('click', () => setManualMode('dead'));
// dilution / seeding calculator inputs
if (calcCells) calcCells.addEventListener('input', updateCalc);
if (calcCells) calcCells.addEventListener('change', () => {       // commit (blur/Enter) -> save to recents
  const n = parseFloat(String(calcCells.value).replace(/[, ]/g, ''));
  if (isFinite(n) && n > 0) rememberCount(n);
});
if (calcFinal) calcFinal.addEventListener('input', updateCalc);
// limiting-dilution (cloning) inputs
[ldCells, ldVol, ldWells].forEach((el) => { if (el) el.addEventListener('input', updateLimitDil); });

/* ===========================================================================
   PHASE 3 — NAMED CELL-LINE CLASSIFIERS + TRAINING MODE
   Default (activeCellLineId = null) = plain counting, NO learning (unchanged).
   "Train new" -> name it -> tap the REAL CELLS on the current flatten. Each tap CYCLES
   that blob's mark the same way counting does: cell -> dead -> not-a-cell -> back (Trypan
   off skips "dead"). Tap empty space to add a missed cell. Untapped candidates are NOT saved.
   Two classifier modes (auto-selected):
     * k-NN  — when you labelled both cells AND debris (>=2 each): a blob is hidden
               if most of its nearest labelled neighbours are debris.
     * one-class — when you labelled CELLS ONLY (>=5): a blob is hidden if it's an
               OUTLIER (far from the learned cell cluster). No debris taps needed.
   Auto-hidden debris is faint + restorable by tapping. Wrapped so counting never breaks.
   =========================================================================== */
let cellLines = [];            // [{id, profileId, name, createdAt}] for the active profile
let activeCellLineId = null;   // null = Default (no learning)
let labelStore = [];           // labels for the active line: [{label:1|0, f:{meanI,varI,blueness,r}}]
let trainingMode = false;
let trainCandidates = [];      // [{x,y,r,...fp, mark:null|'cell'|'dead'|'debris', orig}]  (tap cycles the mark)
let pendingLineId = null;      // line being trained (deleted if training is cancelled)
let isRetrain = false;         // true = improving an existing line from the counted photo (Improve)

function featVec(f) { return [f.meanI, f.varI, f.blueness, f.r]; }
function posLabels() { return labelStore.filter((l) => l.label === 1); }
// kind of a label: explicit when trained in Phase-this; inferred for older records.
function labelKind(l) { return l.kind || (l.label === 1 ? 'cell' : 'debris'); }
function deadExamples() { return labelStore.filter((l) => labelKind(l) === 'dead'); }     // real cells, stained
function liveExamples() { return labelStore.filter((l) => labelKind(l) === 'cell'); }     // real cells, unstained
function featScaleFrom(list) {
  const n = list.length; if (n < 2) return [1, 1, 1, 1];
  const mean = [0, 0, 0, 0], v = [0, 0, 0, 0];
  list.forEach((l) => { const f = featVec(l.f); for (let d = 0; d < 4; d++) mean[d] += f[d]; });
  for (let d = 0; d < 4; d++) mean[d] /= n;
  list.forEach((l) => { const f = featVec(l.f); for (let d = 0; d < 4; d++) { const e = f[d] - mean[d]; v[d] += e * e; } });
  return v.map((s) => Math.sqrt(s / n) || 1);
}
// ---- trained live/dead (Trypan) model: only when the user labelled enough of BOTH (req 7) ----
function deadModelReady() { return activeCellLineId != null && deadExamples().length >= 3 && liveExamples().length >= 3; }
function predictDeadTrained(o) {                          // true => dead (blue). k-NN over dead vs live examples.
  const dead = deadExamples(), live = liveExamples();
  const all = dead.map((l) => ({ f: l.f, dead: true })).concat(live.map((l) => ({ f: l.f, dead: false })));
  const scale = featScaleFrom(dead.concat(live));
  const f = featVec(o);
  const dists = all.map((e) => {
    const ef = featVec(e.f); let s = 0;
    for (let d = 0; d < 4; d++) { const z = (f[d] - ef[d]) / (scale[d] || 1); s += z * z; }
    return { d: Math.sqrt(s), dead: e.dead };
  }).sort((a, b) => a.d - b.d);
  const k = Math.min(5, dists.length); let nd = 0, nl = 0;
  for (let i = 0; i < k; i++) { if (dists[i].dead) nd++; else nl++; }
  return nd > nl;
}
function classifierMode() {
  if (activeCellLineId == null) return 'off';
  const pos = posLabels().length, neg = labelStore.length - pos;
  if (pos >= 2 && neg >= 2 && labelStore.length >= 6) return 'knn';
  if (pos >= 5) return 'oneclass';
  return 'off';
}
function classifierReady() { return activeCellLineId != null && classifierMode() !== 'off'; }
function predictDebris(o) {                              // true => predicted debris (hide it)
  const mode = classifierMode();
  const f = featVec(o);
  if (mode === 'knn') {
    const scale = featScaleFrom(labelStore);
    const dists = labelStore.map((l) => {
      const lf = featVec(l.f); let s = 0;
      for (let d = 0; d < 4; d++) { const e = (f[d] - lf[d]) / (scale[d] || 1); s += e * e; }
      return { d: Math.sqrt(s), label: l.label };
    }).sort((a, b) => a.d - b.d);
    const k = Math.min(5, dists.length);
    let pos = 0, neg = 0;
    for (let i = 0; i < k; i++) { if (dists[i].label === 1) pos++; else neg++; }
    return neg > pos;
  }
  if (mode === 'oneclass') {                             // outlier vs the labelled cell cluster
    const pos = posLabels(), scale = featScaleFrom(pos);
    const dists = pos.map((l) => {
      const lf = featVec(l.f); let s = 0;
      for (let d = 0; d < 4; d++) { const e = (f[d] - lf[d]) / (scale[d] || 1); s += e * e; }
      return Math.sqrt(s);
    }).sort((a, b) => a - b);
    const k = Math.min(3, dists.length); if (!k) return false;
    let avg = 0; for (let i = 0; i < k; i++) avg += dists[i]; avg /= k;
    return avg > ONECLASS_T;
  }
  return false;
}
function applyClassifier() {                             // hide look-alike debris on the current count
  if (!classifierReady()) return;
  try {
    cells.forEach((c) => {
      if (c.state !== 'in' || c.userLabeled) return;     // only auto-hide counted, non-user-touched cells
      if (predictDebris(c)) c.autoHidden = true;
    });
  } catch (e) { dlog('classifier error: ' + e.message); }
}
function appendLabel(c, label) {                         // a tap-correction teaches the active line
  if (activeCellLineId == null || !storageOK) return;
  const rec = { cellLineId: activeCellLineId, label, f: { meanI: c.meanI, varI: c.varI, blueness: c.blueness, r: c.r }, createdAt: Date.now() };
  labelStore.push(rec);
  pAdd('labels', rec).catch((e) => dlog('label save failed: ' + e.message));
}

/* ---- cell-line list + selector ---- */
async function loadCellLines() {
  try { cellLines = activeProfileId != null ? await pByIndex('cellLines', 'profileId', Number(activeProfileId)) : []; }
  catch (e) { cellLines = []; dlog('cellLines load failed: ' + e.message); }
  populateCellLineSelect();
}
function populateCellLineSelect() {
  if (!cellLineSelect) return;
  cellLineSelect.innerHTML = '';
  const def = document.createElement('option'); def.value = ''; def.textContent = 'Default — no learning';
  cellLineSelect.appendChild(def);
  cellLines.forEach((cl) => { const o = document.createElement('option'); o.value = cl.id; o.textContent = cl.name; cellLineSelect.appendChild(o); });
  cellLineSelect.value = activeCellLineId == null ? '' : String(activeCellLineId);
  updateCellLineButtons();
}
// Retrain/Improve + delete show only for a real (non-Default) trained line; Improve needs a current count.
function updateCellLineButtons() {
  const active = activeCellLineId != null && !trainingMode;
  if (deleteCellLineBtn) deleteCellLineBtn.style.display = active ? '' : 'none';
  if (retrainBtn) { retrainBtn.style.display = active ? '' : 'none'; retrainBtn.disabled = !hasCount; }
  if (typeof updateToolsVisibility === 'function') updateToolsVisibility();   // show/hide sliders for the active line
}
async function loadLabels() {
  try { labelStore = activeCellLineId != null ? await pByIndex('labels', 'cellLineId', activeCellLineId) : []; }
  catch (e) { labelStore = []; dlog('labels load failed: ' + e.message); }
}
// delete a cell line and all of its labels (delete the line even if the label lookup fails)
async function deleteLineCascade(lineId) {
  let labs = [];
  try { labs = await pByIndex('labels', 'cellLineId', lineId); }
  catch (e) { dlog('delete line: label lookup failed (' + e.message + ') — deleting the line anyway'); }
  for (const l of labs) { try { await pDelete('labels', l.id); } catch (_) {} }
  try { await pDelete('cellLines', lineId); }
  catch (e) { dlog('delete cellLine failed: ' + e.message); }
}
async function deleteActiveCellLine() {
  if (activeCellLineId == null) return;
  const nm = (cellLines.find((l) => l.id === activeCellLineId) || {}).name || 'this cell line';
  if (!confirm(`Delete "${nm}" and everything it learned? This cannot be undone. (Your counts and profiles are kept.)`)) return;
  const gone = activeCellLineId;
  await deleteLineCascade(gone);
  dlog(`deleted cell line ${gone}`);
  activeCellLineId = null;
  await loadCellLines();
  await loadLabels();
  if (cellLineSelect) cellLineSelect.value = '';
  if (hasCount) { cells.forEach((c) => { if (!c.userLabeled) c.autoHidden = false; }); recomputeDead(); redrawCount(); }
  setCountStatus(`Deleted "${nm}". Back to Default — no learning.`);
}
async function setActiveCellLine(id) {
  activeCellLineId = (id === '' || id == null) ? null : Number(id);
  await loadLabels();
  updateCellLineButtons();
  if (!hasCount) return;
  showBusy('Recounting…');                                // brief indicator that it re-evaluated (request 6)
  setTimeout(() => {
    try {
      cells.forEach((c) => { if (!c.userLabeled) c.autoHidden = false; });
      recomputeDead();                                    // dead model may differ per line (req 7)
      applyClassifier();
      redrawCount();
      const nm = activeCellLineId == null ? 'Default (no learning)' : (cellLines.find((l) => l.id === activeCellLineId) || {}).name || 'cell line';
      const hidden = cells.filter((c) => c.autoHidden).length;
      let note = `Recounted with ${nm}`;
      if (activeCellLineId != null && classifierReady() && hidden > 0) note += ` · hid ${hidden} look-alike${hidden === 1 ? '' : 's'}`;
      if (activeCellLineId != null && deadModelReady()) note += ' · using trained live/dead';
      setCountStatus(note + '.');
    } finally { hideBusy(); }
  }, 60);
}

/* ---- training mode ---- */
function showTrainBar(on) {
  if (trainBar) trainBar.style.display = on ? 'block' : 'none';
  if (countTools) countTools.style.display = on ? 'none' : (hasCount ? 'block' : 'none');
  if (resetBtn) resetBtn.disabled = on;
  if (toggleOverlayBtn) toggleOverlayBtn.disabled = on;
}
// Mark cycle for a candidate — mirrors the counting tap cycle so live/dead/remove feels identical.
// The FIRST tap flips live<->dead; the next marks "not-a-cell" (debris/remove); the next returns to start.
// New (just-added) candidates start unmarked, so they also have a "clear" step.
function trainRing(orig) {
  if (!trypanOn) {
    if (orig == null) return [null, 'cell', 'debris'];
    return orig === 'debris' ? ['debris', 'cell'] : ['cell', 'debris'];
  }
  if (orig == null) return [null, 'cell', 'dead', 'debris'];
  if (orig === 'cell') return ['cell', 'dead', 'debris'];
  if (orig === 'dead') return ['dead', 'cell', 'debris'];
  if (orig === 'debris') return ['debris', 'cell', 'dead'];
  return ['cell', 'dead', 'debris'];
}
function updateTrainCount() {
  const cellsN = trainCandidates.filter((c) => c.mark === 'cell').length;
  const deadN = trainCandidates.filter((c) => c.mark === 'dead').length;
  const debrisN = trainCandidates.filter((c) => c.mark === 'debris').length;
  if (trainCount) trainCount.textContent = `${cellsN} cells · ${deadN} dead · ${debrisN} debris`;
}
function drawTrainCandidates(fctx) {
  const fill = { cell: 'rgba(60,220,130,0.22)', dead: 'rgba(70,150,255,0.24)', debris: 'rgba(255,120,60,0.20)' };
  const line = { cell: 'rgba(60,220,130,0.98)', dead: 'rgba(80,160,255,0.98)', debris: 'rgba(255,120,60,0.98)' };
  for (const c of trainCandidates) {
    const R = c.r + RING_GAP;
    fctx.setLineDash([]);
    fctx.beginPath(); fctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    fctx.lineWidth = 4.5; fctx.strokeStyle = 'rgba(0,0,0,0.45)'; fctx.stroke();
    if (c.mark && fill[c.mark]) { fctx.beginPath(); fctx.arc(c.x, c.y, R, 0, Math.PI * 2); fctx.fillStyle = fill[c.mark]; fctx.fill(); }
    fctx.beginPath(); fctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    fctx.lineWidth = c.mark ? 3 : 1.6;
    fctx.strokeStyle = (c.mark && line[c.mark]) ? line[c.mark] : 'rgba(255,255,255,0.5)';
    fctx.stroke();
  }
}
function toggleCandidate(x, y) {
  const sx = flatCanvas.width / flatCanvas.getBoundingClientRect().width;
  let hit = -1, hd = Infinity;
  for (let i = 0; i < trainCandidates.length; i++) {
    const c = trainCandidates[i], d = Math.hypot(x - c.x, y - c.y);
    const grab = c.r + RING_GAP + TAP_TOL * sx;
    if (d <= grab && d < hd) { hd = d; hit = i; }
  }
  if (hit < 0) {                                   // tap empty space -> add a missed cell (snaps to a bright blob)
    const found = detectBlobNear(x, y);
    const cx = found ? found.cx : x, cy = found ? found.cy : y;
    const r = found ? found.r : medianR();
    const fp = featuresAt(cx, cy, r);
    trainCandidates.push({ x: cx, y: cy, r, meanI: fp.meanI, varI: fp.varI, blueness: fp.blueness, mark: 'cell', orig: null });
    updateTrainCount(); renderFlat();
    return;
  }
  const c = trainCandidates[hit];
  const ring = trainRing(c.orig == null ? null : c.orig);
  let idx = ring.indexOf(c.mark == null ? null : c.mark);
  if (idx < 0) idx = 0;
  c.mark = ring[(idx + 1) % ring.length];          // advance one step in the cycle
  updateTrainCount(); renderFlat();
}
function trainCandidateFrom(b) {
  return { x: b.x, y: b.y, r: b.r, meanI: b.meanI, varI: b.varI, blueness: b.blueness, mark: null, orig: null };
}
async function startTraining() {
  if (!flatCleanData) { setCountStatus('Flatten & count a square first.'); return; }
  if (!storageOK) { setCountStatus('On-device storage is unavailable, so cell lines can\u2019t be saved here.'); return; }
  const ok = confirm('Training is only needed for unusual cell shapes the normal counter struggles with. If the default counting already works, you don\u2019t need this.\n\nTrain a new cell line anyway?');
  if (!ok) return;
  const name = prompt('Name this cell line (e.g. "HeLa P12"):');
  if (!name || !name.trim()) return;
  let id;
  try { id = await pAdd('cellLines', { profileId: Number(activeProfileId), name: name.trim(), createdAt: Date.now() }); }
  catch (e) { dlog('cellLine create failed: ' + e.message); setCountStatus('Could not create the cell line.'); return; }
  pendingLineId = id; isRetrain = false;
  await loadCellLines();
  activeCellLineId = id; if (cellLineSelect) cellLineSelect.value = String(id);

  showBusy('Finding candidates…');
  setTimeout(() => {
    try {
      const blobs = segmentBlobs(10);      // train at MAX sensitivity so every shape is offered (req 6)
      trainCandidates = blobs
        .filter((b) => classifyCell(b.x, b.y, b.r, FLAT_OUT, FLAT_MARGIN) !== 'drop')
        .map(trainCandidateFrom);
      trainingMode = true; updateCellLineButtons();
      showTrainBar(true);
      updateTrainCount();
      renderFlat();
      if (trainHint) trainHint.textContent = trypanOn
        ? 'Tap each real cell — it turns green. Tap the same cell again to mark it dead (blue), again for not-a-cell, again to clear. ~15–25 cells is plenty; you needn\u2019t tap everything. Tap a missed cell to add it.'
        : 'Tap each real cell — it turns green. Tap it again to mark it not-a-cell, again to clear. ~15–25 cells is plenty; you needn\u2019t tap everything. Tap a missed cell to add it.';
    } finally { hideBusy(); }
  }, 30);
}
// Improve (was "Retrain"): refine the ACTIVE line using the cells as actually counted.
// Cells are pre-marked (live=green, dead=blue); tap to fix the same way you correct a count,
// and tap empty space to add a missed cell. Done saves only the changes.
async function startRetrain() {
  if (activeCellLineId == null) { setCountStatus('Pick a trained cell line first.'); return; }
  if (!hasCount || !flatCleanData) { setCountStatus('Count a square first, then Improve.'); return; }
  if (!storageOK) { setCountStatus('On-device storage is unavailable.'); return; }
  pendingLineId = null; isRetrain = true;
  // seed from the cells currently shown as counted; pre-mark from the live/dead call so the user only fixes mistakes
  trainCandidates = cells.filter(isCounted).map((c) => {
    const m = isDead(c) ? 'dead' : 'cell';
    return { x: c.x, y: c.y, r: c.r, meanI: c.meanI, varI: c.varI, blueness: c.blueness, mark: m, orig: m };
  });
  trainingMode = true; updateCellLineButtons();
  showTrainBar(true);
  updateTrainCount();
  renderFlat();
  const nm = (cellLines.find((l) => l.id === activeCellLineId) || {}).name || 'this cell line';
  if (trainHint) trainHint.textContent = trypanOn
    ? `Improving “${nm}”: tap a wrong cell to flip live\u2194dead, tap again to mark it not-a-cell, again to undo. Tap a missed cell to add it. Done saves your fixes.`
    : `Improving “${nm}”: tap a wrong cell to mark it not-a-cell, tap again to undo. Tap a missed cell to add it. Done saves your fixes.`;
}
function candToRec(c) {                       // cell/dead -> real cell (label 1); debris -> not-a-cell (label 0)
  return { cellLineId: activeCellLineId, label: c.mark === 'debris' ? 0 : 1, kind: c.mark,
           f: { meanI: c.meanI, varI: c.varI, blueness: c.blueness, r: c.r }, createdAt: Date.now() };
}
async function finishTraining() {
  // Train-new: save everything the user marked. Improve: save ONLY genuine changes (corrections +
  // newly-added cells), so re-improving the same square doesn't pile up duplicate/contradictory labels.
  const toSave = isRetrain
    ? trainCandidates.filter((c) => c.mark && (c.orig == null ? null : c.orig) !== c.mark)
    : trainCandidates.filter((c) => c.mark);
  const recs = toSave.map(candToRec);
  const nCells = recs.filter((r) => r.kind === 'cell').length;
  const nDead = recs.filter((r) => r.kind === 'dead').length;
  const nDebris = recs.filter((r) => r.kind === 'debris').length;
  if (!isRetrain && (nCells + nDead) < 3) {   // a brand-new line needs a few real cells to learn from
    setCountStatus('Tap at least a few real cells before pressing Done (or Cancel).');
    return;
  }
  if (isRetrain && recs.length === 0) { setCountStatus('No changes to save — tap a wrong cell to fix it, or press Cancel.'); return; }
  try { await pAddMany('labels', recs); dlog(`${isRetrain ? 'improved' : 'trained'} line ${activeCellLineId}: +${nCells} cells / +${nDead} dead / +${nDebris} not-a-cell`); }
  catch (e) { dlog('train save FAILED: ' + e.message); }
  pendingLineId = null; isRetrain = false;
  trainingMode = false; trainCandidates = [];
  showTrainBar(false); updateCellLineButtons();
  await loadLabels();
  countCells();                       // recount with the updated classifier active
}
async function cancelTraining() {
  const wasRetrain = isRetrain;
  trainingMode = false; trainCandidates = []; isRetrain = false;
  showTrainBar(false);
  if (!wasRetrain && pendingLineId != null) {   // remove the empty just-created line
    try { await pDelete('cellLines', pendingLineId); } catch (_) {}
    pendingLineId = null;
    activeCellLineId = null;
    if (cellLineSelect) cellLineSelect.value = '';
    await loadCellLines();
    await loadLabels();
  }
  updateCellLineButtons();
  cells.forEach((c) => { if (!c.userLabeled) c.autoHidden = false; });   // back to Default: unhide
  if (hasCount) redrawCount(); else renderFlat();
}

if (cellLineSelect) cellLineSelect.addEventListener('change', () => setActiveCellLine(cellLineSelect.value));
if (trainBtn) trainBtn.addEventListener('click', startTraining);
if (retrainBtn) retrainBtn.addEventListener('click', startRetrain);
if (deleteCellLineBtn) deleteCellLineBtn.addEventListener('click', deleteActiveCellLine);
if (trainDone) trainDone.addEventListener('click', finishTraining);
if (trainCancel) trainCancel.addEventListener('click', cancelTraining);

/* ===========================================================================
   STORAGE (IndexedDB) + PROFILES + SESSIONS — on the phone, no server
   A PROFILE = an equipment setup (scope + camera + zoom).
   A SESSION = the squares you count this time (e.g. the 4 corners of one load).
   v3 adds the Phase-3 stores: cellLines + labels.
   =========================================================================== */
const DB_NAME = 'cellCounterDB', DB_VER = 4;   // v4: back-fill cellLines/labels indexes that some older DBs lack
let db = null, activeProfileId = null, storageOK = false;
let currentSampleId = null;          // squares saved now belong to this session
let hasCount = false;                // a count has been run on the current flatten
let savedThisCount = false;          // current count already added to the session
let deletedStack = [];               // squares removed with ✕ (stack — undo can step back many times)
let prevSampleId = null;             // the session active before "New session" (so it can be undone)
let sessionSquares = [];             // saved squares in the current session (basis for the calculator)

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result, tx = e.target.transaction;
      if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('squares')) {
        const s = d.createObjectStore('squares', { keyPath: 'id', autoIncrement: true });
        s.createIndex('profileId', 'profileId', { unique: false });
      } else {                                   // harden: add the index if an old build lacked it
        try { const s = tx.objectStore('squares'); if (!s.indexNames.contains('profileId')) s.createIndex('profileId', 'profileId', { unique: false }); } catch (_) {}
      }
      if (!d.objectStoreNames.contains('cellLines')) {
        const c = d.createObjectStore('cellLines', { keyPath: 'id', autoIncrement: true });
        c.createIndex('profileId', 'profileId', { unique: false });
      } else {                                   // harden: add the index if an older build lacked it
        try { const c = tx.objectStore('cellLines'); if (!c.indexNames.contains('profileId')) c.createIndex('profileId', 'profileId', { unique: false }); } catch (_) {}
      }
      if (!d.objectStoreNames.contains('labels')) {
        const l = d.createObjectStore('labels', { keyPath: 'id', autoIncrement: true });
        l.createIndex('cellLineId', 'cellLineId', { unique: false });
      } else {                                   // harden: older 'labels' stores were created without this index
        try { const l = tx.objectStore('labels'); if (!l.indexNames.contains('cellLineId')) l.createIndex('cellLineId', 'cellLineId', { unique: false }); } catch (_) {}
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const oStore = (n, m) => db.transaction(n, m).objectStore(n);
const pAll = (n) => new Promise((res, rej) => { const r = oStore(n, 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
const pAdd = (n, rec) => new Promise((res, rej) => { const r = oStore(n, 'readwrite').add(rec); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pPut = (n, rec) => new Promise((res, rej) => { const r = oStore(n, 'readwrite').put(rec); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pDelete = (n, id) => new Promise((res, rej) => { const r = oStore(n, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const pGet = (n, id) => new Promise((res, rej) => { const r = oStore(n, 'readonly').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pByIndex = (store, idx, val) => new Promise((res, rej) => { const r = oStore(store, 'readonly').index(idx).getAll(IDBKeyRange.only(val)); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
const pByProfile = (store, pid) => pByIndex(store, 'profileId', pid);
function pAddMany(store, recs) {
  return new Promise((res, rej) => {
    if (!recs.length) return res();
    const tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
    recs.forEach((r) => os.add(r));
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}

async function populateProfiles(selectId) {
  const profiles = await pAll('profiles');
  profileSelect.innerHTML = '';
  profiles.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; profileSelect.appendChild(o); });
  activeProfileId = selectId || (profiles[0] && profiles[0].id) || null;
  if (activeProfileId != null) profileSelect.value = activeProfileId;
  if (deleteProfileBtn) deleteProfileBtn.disabled = !(storageOK && profiles.length > 1);   // keep at least one profile
  await loadProfilePref();
  activeCellLineId = null;                    // cell lines are per-profile; reset on profile load
  await loadCellLines();
  await loadLabels();
  await startNewSession();
}
// delete the active profile and EVERYTHING under it (its squares, cell lines, labels)
async function deleteProfile() {
  if (!storageOK || activeProfileId == null) return;
  const profiles = await pAll('profiles');
  if (profiles.length <= 1) { alert('This is your only profile — create another one before deleting this.'); return; }
  const nm = (profiles.find((p) => p.id === Number(activeProfileId)) || {}).name || 'this profile';
  if (!confirm(`Delete profile "${nm}" and all of its saved squares and cell lines? This cannot be undone.`)) return;
  const gone = Number(activeProfileId);
  try {
    const sq = await pByProfile('squares', gone);
    for (const s of sq) { try { await pDelete('squares', s.id); } catch (_) {} }
    const cls = await pByIndex('cellLines', 'profileId', gone);
    for (const cl of cls) { await deleteLineCascade(cl.id); }
    await pDelete('profiles', gone);
    dlog(`deleted profile ${gone} (+${sq.length} squares, +${cls.length} cell lines)`);
  } catch (e) { dlog('delete profile failed: ' + e.message); }
  deletedStack = [];
  await populateProfiles();          // falls back to the first remaining profile
}
// per-profile preferences: dead (blue) sensitivity 1..10 + detection sensitivity + unit + recent counts
async function loadProfilePref() {
  try {
    const p = await pGet('profiles', Number(activeProfileId));
    if (p && typeof p.deadLevel === 'number') deadLevel = clamp(p.deadLevel, 1, 10);
    else if (p && typeof p.blueThresh === 'number') deadLevel = 5;   // legacy absolute -> default strictness
    else deadLevel = 5;
    sensitivity = (p && typeof p.sensitivity === 'number') ? p.sensitivity : 5;
    concUnit = (p && p.concUnit === 'uL') ? 'uL' : 'mL';
    trypanOn = (p && typeof p.trypanPref === 'boolean') ? p.trypanPref : true;                       // remembered Trypan choice
    dilution = (p && typeof p.dilutionPref === 'number' && p.dilutionPref >= 1) ? p.dilutionPref : 2; // remembered dilution
    profileRecentCounts = (p && Array.isArray(p.recentCounts)) ? p.recentCounts.filter((n) => isFinite(n) && n > 0).slice(0, 8) : [];
  } catch (_) { deadLevel = 5; sensitivity = 5; concUnit = 'mL'; trypanOn = true; dilution = 2; profileRecentCounts = []; }
  if (blueSlider) blueSlider.value = deadLevel;
  if (blueLabel) blueLabel.textContent = deadLevel;
  if (sensSlider) sensSlider.value = sensitivity;
  if (sensLabel) sensLabel.textContent = sensitivity;
  if (concMlBtn) concMlBtn.classList.toggle('active', concUnit === 'mL');
  if (concUlBtn) concUlBtn.classList.toggle('active', concUnit === 'uL');
  if (dilutionInput) dilutionInput.value = String(dilution);
  if (trypanYes) trypanYes.classList.toggle('active', trypanOn);
  if (trypanNo) trypanNo.classList.toggle('active', !trypanOn);
  renderCalcRecent();
}
async function saveProfilePref() {
  if (!storageOK || activeProfileId == null) return;
  try {
    const p = await pGet('profiles', Number(activeProfileId));
    if (!p) return;
    p.deadLevel = deadLevel; p.sensitivity = sensitivity; p.concUnit = concUnit;
    p.trypanPref = trypanOn; p.dilutionPref = dilution;   // remember Trypan + dilution per profile
    await pPut('profiles', p);
  } catch (e) { dlog('pref save failed: ' + e.message); }
}
async function startNewSession() {
  if (!storageOK) return;
  currentSampleId = Date.now();
  savedThisCount = false; deletedStack = [];
  prevSampleId = null;                       // cleared here; the New-session button sets it so Undo can step back
  await refreshSampleView();
  await refreshHistory();
  updateUndoSessionButton();
}
function summarizeCounts() {
  const t = liveDeadTotals();
  const viability = t.total > 0 ? Math.round((t.live / t.total) * 100) : 0;
  return { total: t.total, live: t.live, dead: t.dead, viability };
}
function concPerML(arr) {
  const m = arr.length || 1;
  return arr.reduce((a, s) => a + Math.max(0, s.trypanOn ? s.live : s.total) * (s.dilution > 1 ? s.dilution : 1) * 1e4, 0) / m;
}
async function refreshSampleView() {
  if (!storageOK) return;
  let rows = [];
  try { rows = await pByProfile('squares', Number(activeProfileId)); } catch (e) { dlog('sample view failed: ' + e.message); rows = []; }
  const all = rows.filter((s) => s && s.sampleId === currentSampleId).sort((a, b) => a.createdAt - b.createdAt);
  sampleList.innerHTML = '';
  all.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'sample-item';
    const via = s.trypanOn ? ` · ${s.viability}% viable` : '';
    const span = document.createElement('span'); span.innerHTML = `Square ${i + 1}: <strong>${s.total}</strong> cells${via}`;
    const del = document.createElement('button'); del.className = 'x-btn'; del.textContent = '✕'; del.title = 'remove this square';
    del.addEventListener('click', async () => {
      deletedStack.push(Object.assign({}, s)); updateUndoButton();
      await pDelete('squares', s.id); dlog(`removed square id ${s.id}`);
      await refreshSampleView();
    });
    row.appendChild(span); row.appendChild(del); sampleList.appendChild(row);
  });
  updateUndoButton();
  if (exportCsvBtn) exportCsvBtn.disabled = !(storageOK && all.length);   // nothing to export until a square is added
  if (all.length === 0) {
    sessionSquares = [];
    sampleSummary.textContent = 'No squares yet — count a square, then “Add square to session”.';
    sampleSummary.style.display = 'block'; updateSaveButton(); updateCalc(); return;
  }
  const m = all.length;
  const avgTotal = all.reduce((a, s) => a + s.total, 0) / m;
  const anyTrypan = all.some((s) => s.trypanOn);
  const meanVia = Math.round(all.reduce((a, s) => a + (s.trypanOn ? s.viability : 100), 0) / m);
  const perML = concPerML(all);
  let txt = `${m} square${m === 1 ? '' : 's'} · avg ${avgTotal.toFixed(1)} cells/square`;
  if (anyTrypan) txt += ` · mean viability ${meanVia}%`;
  txt += `\n≈ ${formatConc(perML)} cells/mL   (${formatConc(perML / 1000)} cells/µL)`;
  sampleSummary.textContent = txt; sampleSummary.style.display = 'block';
  sessionSquares = all;
  updateSaveButton();
  updateCalc();
}
function updateUndoButton() {
  if (!undoBtn) return;
  const n = deletedStack.length;
  undoBtn.style.display = n ? '' : 'none';
  undoBtn.textContent = n > 1 ? `↶ Undo remove (${n})` : '↶ Undo remove';
}
async function doUndo() {
  if (!deletedStack.length) return;
  const d = deletedStack.pop(); updateUndoButton();
  try {
    await pAdd('squares', { profileId: d.profileId, sampleId: d.sampleId, createdAt: d.createdAt,
      total: d.total, live: d.live, dead: d.dead, viability: d.viability, trypanOn: d.trypanOn, dilution: d.dilution, thumb: d.thumb });
    dlog('undo: square restored');
  } catch (e) { dlog('undo failed: ' + e.message); }
  await refreshSampleView(); await refreshHistory();
}

/* ---- Bug 4: undo an accidental "New session" (switch back to the previous one) ----
   New session is non-destructive (it just points at a fresh sampleId; the old squares
   stay in history), so undo simply re-selects the previous session. */
function updateUndoSessionButton() {
  if (!undoSessionBtn) return;
  const can = storageOK && prevSampleId != null && prevSampleId !== currentSampleId;
  undoSessionBtn.style.display = can ? '' : 'none';
}
async function undoNewSession() {
  if (prevSampleId == null) return;
  currentSampleId = prevSampleId;
  prevSampleId = null;
  savedThisCount = false; deletedStack = [];
  await refreshSampleView(); await refreshHistory();
  updateUndoSessionButton();
  saveStatus.textContent = 'back to previous session';
}

/* ---- export: download helpers + session CSV + annotated image ---- */
function downloadFile(filename, mime, data) {
  try {
    const blob = (data instanceof Blob) ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} URL.revokeObjectURL(url); }, 1500);
    return true;
  } catch (e) { dlog('download failed: ' + e.message); return false; }
}
function tsStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function csvCell(v) {                                   // quote if needed (commas, quotes, newlines)
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function exportSessionCsv() {
  if (!storageOK) { saveStatus.textContent = 'storage unavailable'; return; }
  let rows = [];
  try { rows = await pByProfile('squares', Number(activeProfileId)); }
  catch (e) { dlog('csv load failed: ' + e.message); saveStatus.textContent = 'export failed'; return; }
  const all = rows.filter((s) => s && s.sampleId === currentSampleId).sort((a, b) => a.createdAt - b.createdAt);
  if (!all.length) { saveStatus.textContent = 'no squares to export'; return; }

  const profName = (profileSelect.options[profileSelect.selectedIndex] || {}).text || 'profile';
  const m = all.length;
  const avgTotal = all.reduce((a, s) => a + s.total, 0) / m;
  const anyTrypan = all.some((s) => s.trypanOn);
  const meanVia = Math.round(all.reduce((a, s) => a + (s.trypanOn ? s.viability : 100), 0) / m);
  const perML = concPerML(all);

  const L = [];
  L.push(['Cell Counter — session export']);
  L.push(['Profile', profName]);
  L.push(['Exported', new Date().toLocaleString()]);
  L.push([]);
  L.push(['Square', 'Total', 'Live', 'Dead', 'Viability %', 'Trypan', 'Dilution', 'Conc cells/mL', 'Conc cells/uL', 'Counted at']);
  all.forEach((s, i) => {
    const dil = (s.dilution > 1 ? s.dilution : 1);
    const sqML = Math.max(0, s.trypanOn ? s.live : s.total) * dil * 1e4;
    L.push([i + 1, s.total, s.live, s.dead, (s.trypanOn ? s.viability : ''), (s.trypanOn ? 'Yes' : 'No'),
            dil, Math.round(sqML), Math.round(sqML / 1000), new Date(s.createdAt).toLocaleString()]);
  });
  L.push([]);
  L.push(['Squares', m]);
  L.push(['Mean cells/square', avgTotal.toFixed(1)]);
  if (anyTrypan) L.push(['Mean viability %', meanVia]);
  L.push(['Concentration cells/mL', Math.round(perML)]);
  L.push(['Concentration cells/uL', Math.round(perML / 1000)]);

  const csv = '\uFEFF' + L.map((r) => r.map(csvCell).join(',')).join('\r\n');   // BOM so Excel reads UTF-8
  if (downloadFile(`cell-counter-session-${tsStamp()}.csv`, 'text/csv;charset=utf-8', csv)) {
    dlog(`exported CSV: ${m} squares`); saveStatus.textContent = 'CSV exported';
  }
}
function saveAnnotatedImage() {
  if (!flatCanvas || !flatCleanData) { setCountStatus('Count a square first, then Save image.'); return; }
  const name = `cell-counter-${tsStamp()}.png`;
  try {
    flatCanvas.toBlob((blob) => {
      if (blob) { downloadFile(name, 'image/png', blob); dlog('saved annotated image'); setCountStatus('Image saved.'); return; }
      // fallback: data URL straight onto the anchor (not wrapped in a Blob)
      const a = document.createElement('a');
      a.href = flatCanvas.toDataURL('image/png'); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 1500);
      dlog('saved annotated image (dataURL)'); setCountStatus('Image saved.');
    }, 'image/png');
  } catch (e) { dlog('image save failed: ' + e.message); setCountStatus('Could not save the image.'); }
}
// past sessions for this profile (everything except the current one)
// FIX (Bug #1): legacy squares saved before sessions existed have no numeric
// sampleId; skip them so grouping never yields groups[NaN] (which crashed init).
async function refreshHistory() {
  if (!storageOK || !historyList) return;
  let sq = [];
  try { sq = await pByProfile('squares', Number(activeProfileId)); } catch (e) { dlog('history load failed: ' + e.message); sq = []; }
  const groups = {};
  sq.forEach((s) => {
    if (!s || typeof s.sampleId !== 'number' || !isFinite(s.sampleId)) return;   // skip legacy/orphan squares
    (groups[s.sampleId] = groups[s.sampleId] || []).push(s);
  });
  const ids = Object.keys(groups).map(Number).filter((id) => id !== currentSampleId).sort((a, b) => b - a);
  historyList.innerHTML = '';
  if (ids.length === 0) { historyList.innerHTML = '<p class="muted-line">No past sessions yet.</p>'; return; }
  ids.forEach((id) => {
    const arr = (groups[id] || []).slice().sort((a, b) => a.createdAt - b.createdAt), m = arr.length;
    if (!m) return;
    const when = new Date(arr[0].createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const row = document.createElement('div'); row.className = 'sample-item';
    const span = document.createElement('span'); span.innerHTML = `${when} · ${m} sq · ≈ ${formatConc(concPerML(arr))}/mL`;
    const btn = document.createElement('button'); btn.className = 'mini-btn'; btn.textContent = 'Resume';
    btn.addEventListener('click', async () => {
      currentSampleId = id; savedThisCount = false; deletedStack = []; prevSampleId = null;
      await refreshSampleView(); await refreshHistory(); updateUndoSessionButton();
      saveStatus.textContent = 'resumed a past session';
    });
    row.appendChild(span); row.appendChild(btn); historyList.appendChild(row);
  });
}
function updateSaveButton() {
  const counted = cells.some(isCounted) || manualLive > 0 || manualDead > 0;
  saveBtn.disabled = !(storageOK && hasCount && counted && !savedThisCount);
  saveBtn.textContent = savedThisCount ? 'Added to session ✓' : 'Add square to session';
}
async function initStorage() {
  try {
    db = await openDB();
    const profiles = await pAll('profiles');
    if (profiles.length === 0) await pAdd('profiles', { name: 'Default', createdAt: Date.now() });
    storageOK = true;
    await populateProfiles();
    profileSelect.disabled = false; newProfileBtn.disabled = false;
    if (celllineRow) celllineRow.style.display = '';
    dlog('storage ready · fresh session');
  } catch (e) {
    console.error('storage init failed:', e); dlog('storage init FAILED: ' + e.message);
    storageOK = false;
    sampleSummary.textContent = '(on-device storage unavailable here)'; sampleSummary.style.display = 'block';
    if (celllineRow) celllineRow.style.display = 'none';
  }
  updateSaveButton();
}
profileSelect.addEventListener('change', async () => {
  activeProfileId = Number(profileSelect.value);
  await loadProfilePref();
  activeCellLineId = null;
  await loadCellLines();
  await loadLabels();
  await startNewSession();
});
newProfileBtn.addEventListener('click', async () => {
  const name = prompt('Name this equipment setup (e.g. "Scope A · 10x"):');
  if (!name || !name.trim()) return;
  const id = await pAdd('profiles', { name: name.trim(), createdAt: Date.now() });
  await populateProfiles(id);
});
if (deleteProfileBtn) deleteProfileBtn.addEventListener('click', deleteProfile);
newSessionBtn.addEventListener('click', async () => {
  const before = currentSampleId;                 // remember so an accidental New session can be undone
  await startNewSession();
  prevSampleId = before;
  updateUndoSessionButton();
  saveStatus.textContent = 'new session';
});
undoBtn.addEventListener('click', doUndo);
if (undoSessionBtn) undoSessionBtn.addEventListener('click', undoNewSession);
if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportSessionCsv);
if (saveImgBtn) saveImgBtn.addEventListener('click', saveAnnotatedImage);
saveBtn.addEventListener('click', async () => {
  if (!storageOK) { saveStatus.textContent = 'storage unavailable'; return; }
  if (!hasCount) { saveStatus.textContent = 'count a square first'; return; }
  if (savedThisCount) return;
  try {
    const c = summarizeCounts();
    await pAdd('squares', {
      profileId: Number(activeProfileId), sampleId: currentSampleId, createdAt: Date.now(),
      total: c.total, live: c.live, dead: c.dead, viability: c.viability,
      trypanOn, dilution, thumb: lastFlatClean
    });
    savedThisCount = true;
    dlog(`added square: total ${c.total}, live ${c.live}, dead ${c.dead}, dil ${dilution}`);
    await refreshSampleView();
    saveStatus.textContent = 'added ✓';
  } catch (e) { console.error('save failed:', e); dlog('save FAILED: ' + e.message); saveStatus.textContent = 'save failed'; }
});

/* ---- tiny debug log wiring (the _logLines/dlog definition was moved up near the top
        so the OpenCV loader can safely log during boot without a TDZ error) ---- */
window.addEventListener('error', (e) => dlog('JS ERROR: ' + (e.message || (e.error && e.error.message) || 'unknown')));
window.addEventListener('unhandledrejection', (e) => dlog('PROMISE REJECTED: ' + ((e.reason && e.reason.message) || e.reason)));
if (debugCopy) debugCopy.addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(_logLines.join('\n')); });
if (debugClear) debugClear.addEventListener('click', () => { _logLines.length = 0; debugLog.textContent = ''; });

initStorage();
