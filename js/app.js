/* Cell Counter: photo capture, boundary review, counting and on-device sessions. */

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

const boundaryPanel=document.getElementById('boundary');
const photoError=document.getElementById('photoError');
const cornerNames=['top left','top right','bottom right','bottom left'];
let marking=false, marked=[], manualBoundary=false, visionStarted=false;
let frameSquare=false;
const fullPhotoBtn=document.getElementById('fullPhotoBtn');
function frameBoundary() {
  const wrap=canvas.parentElement;
  wrap.style.height=''; canvas.style.marginTop='';
  const ys=corners.map(p=>p.y);
  const top=Math.min(...ys), bottom=Math.max(...ys), pad=Math.max(30,(bottom-top)*0.22);
  const start=Math.max(0,top-pad), end=Math.min(canvas.height,bottom+pad);
  const canFit=ys.length===4 && !marking && !cropMode && end-start<canvas.height*.83;
  fullPhotoBtn.hidden=!canFit;
  if (canFit && frameSquare) {
    wrap.style.height=Math.ceil(end-start)+'px'; canvas.style.marginTop=-Math.floor(start)+'px';
  }
  fullPhotoBtn.textContent=frameSquare?'Full photo':'Fit square';
}
fullPhotoBtn.addEventListener('click',()=>{frameSquare=!frameSquare;frameBoundary()});
function setStage(stage) {
  document.body.dataset.stage=stage;
  const stainPanel = document.getElementById('stainPanel');
  const anchor = stage === 'count' ? document.getElementById('reviewTitle').parentElement
    : stage === 'boundary' ? document.getElementById('boundaryTitle').parentElement : document.querySelector('.intro');
  anchor.after(stainPanel);
  document.querySelector('.intro').hidden=stage!=='photo';
  boundaryPanel.hidden=stage!=='boundary';
  flatSection.style.display=stage==='count'?'block':'none';
  document.getElementById('changePhoto').hidden=stage==='photo';
  document.getElementById('changePhoto').open=false;
  document.querySelector('#changePhoto summary').textContent='Change photo';
  document.querySelectorAll('.steps li').forEach((el,i)=>{
    if (['photo','boundary','count'][i]===stage) el.setAttribute('aria-current','step');
    else el.removeAttribute('aria-current');
  });
}
function reportPhotoError(message) {
  photoError.textContent=message;
  photoError.hidden=!message;
  if (message) photoError.scrollIntoView({block:'nearest'});
}
document.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>{
  (button.dataset.pick==='camera'?cameraInput:galleryInput).click();
}));
function handleFile(event) {
  const input=event.target, file=input.files[0];
  if (!file) return;
  input.value='';
  reportPhotoError('');
  showBusy('Opening photo…');
  const url=URL.createObjectURL(file), image=new Image();
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL=url;
  image.onload=()=>{
    if (currentURL!==url) return;
    hideBusy();
    loadPhoto(image);
    if (!visionStarted) { visionStarted=true; loadOpenCv(); }
  };
  image.onerror=()=>{
    if (currentURL===url) {
      hideBusy();
      URL.revokeObjectURL(url); currentURL=null;
      reportPhotoError('This photo could not be opened. Choose a JPEG, PNG or another image supported by this browser.');
    }
  };
  image.src=url;
}
cameraInput.addEventListener('change',handleFile);
galleryInput.addEventListener('change',handleFile);

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
function clearReview() {
  lastFlatClean = null;
  flatCleanData = null;
  freeSegCache();
  cells = [];
  overlayVisible = true;
  hasCount = false; savedThisCount = false;
  manualLive = 0; manualDead = 0; manualMode = 'live';
  showCountTools(false);
  updateSaveButton();
  toggleOverlayBtn.textContent = 'Hide circles';
  countStatus.textContent = '';
  saveStatus.textContent = '';
}
function resetPhoto() {
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL = null;
  img = null;
  corners = []; marked = []; snapTargetsImg = [];
  activeCorner = -1; marking = false; manualBoundary = false; snappedNow = false;
  cropMode = false; cropRect = null; cropActive = null; frameSquare = false;
  _tapStart = null; _activePtrs.clear();
  clearTimeout(sensTimer);
  cameraInput.value = galleryInput.value = '';
  canvas.width = canvas.height = flatCanvas.width = flatCanvas.height = 1;
  cropActions.style.display = 'none';
  flattenBtn.disabled = true;
  meta.textContent = detectStatus.textContent = '';
  clearReview();
  countReadout.textContent = countHint.textContent = '';
  document.getElementById('totalCells').textContent = '0';
  document.getElementById('countSettings').open = false;
  document.getElementById('cellContrast').value = 'auto';
  calcBox.open = false;
  calcCells.value = calcFinal.value = '';
  for (const field of [ldCells, ldVol, ldWells]) field.value = field.defaultValue;
  reportPhotoError('');
  hideBusy();
  setStage('photo');
  document.getElementById('introTitle').focus({preventScroll:true});
  window.scrollTo(0,0);
}
function laterForPhoto(callback, delay = 30) {
  const photo = img;
  setTimeout(() => { if (photo && img === photo) callback(); }, delay);
}
function loadPhoto(image) {
  img = image;
  setStage('boundary');
  marking=false; marked=[]; manualBoundary=false; activeCorner=-1;
  cropMode=false; cropActive=null; cropActions.style.display='none';
  snapTargetsImg=[]; resetBoxBtn.textContent='Mark four corners';
  flattenBtn.disabled=true;
  const { w, h } = computeFitSize();
  setCanvasSize(w, h);
  corners=[];
  frameSquare=false; frameBoundary();

  canvas.style.display = 'block';
  meta.style.display = 'block';
  controls.style.display = 'flex';
  flatSection.style.display = 'none';
  clearReview();
  meta.textContent = `photo ${img.naturalWidth}\u00D7${img.naturalHeight}px`;

  draw();
  if (cvReady) {
    showBusy('Finding the grid…');
    laterForPhoto(() => { try { analyzeAndDetect(); } finally { hideBusy(); } });
  } else {
    setDetectStatus('Loading the grid detector. You can mark the four corners now.');
  }
}

/* ===========================================================================
   Drawing the boundary box + magnifier loupe
   =========================================================================== */
function draw() {
  if (!img) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (cropMode) { drawCropOverlay(); return; }
  if (marking) {
    if (marked.length) {
      ctx.beginPath(); marked.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.strokeStyle='#e1ff7d'; ctx.lineWidth=2; ctx.stroke();
      marked.forEach(p=>drawCorner(p,false));
    }
    return;
  }
  if (!corners.length) return;   // framing the square to zoom in

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.strokeStyle='#142922'; ctx.lineWidth=4; ctx.stroke();
  ctx.strokeStyle='#e6ff8a'; ctx.lineWidth=2; ctx.stroke();
  ctx.rect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='rgba(9,21,16,0.28)'; ctx.fill('evenodd');

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
  ctx.fillStyle = isSnapped ? '#e6ff8a' : '#fff'; ctx.fill();
  ctx.lineWidth=2; ctx.strokeStyle='#173d2f'; ctx.stroke();
  ctx.beginPath(); ctx.arc(c.x,c.y,2.2,0,Math.PI*2); ctx.fillStyle='#173d2f'; ctx.fill();
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
  return {x:clamp(c.x,0,canvas.width),y:clamp(c.y,0,canvas.height)};
}
function nearestCrossing(p, radius) {
  const scale=canvas.width/img.naturalWidth;
  let best=p, limit=radius;
  for (const t of snapTargetsImg) {
    const point={x:t.x*scale,y:t.y*scale},d=Math.hypot(p.x-point.x,p.y-point.y);
    if (d<limit) { best=point; limit=d; }
  }
  return clampCornerToCanvas(best);
}
function updateBoundaryAction() {
  const valid=!marking && ChamberGrid.validCorners(corners,Math.min(24,canvas.width*.09));
  flattenBtn.disabled=!cvReady || !valid;
  return valid;
}
function markNext(p) {
  manualBoundary=true;
  marked.push(nearestCrossing(p,8));
  if (marked.length===4) {
    if (ChamberGrid.validCorners(marked,Math.min(24,canvas.width*.09))) {
      corners=marked.slice(); marking=false; marked=[];
      resetBoxBtn.textContent='Mark four corners';
      frameBoundary();
      setDetectStatus('Check the outline around all 16 subdivisions. Drag any corner to adjust it.');
    } else {
      marked=[]; setDetectStatus('The corners crossed or were too close. Start again at the top left.');
    }
  } else setDetectStatus('Tap the '+cornerNames[marked.length]+' corner ('+(marked.length+1)+' of 4).');
  updateBoundaryAction(); draw();
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' && !event.isPrimary) return;   // let 2-finger pinch zoom the photo
  const p = getCanvasPoint(event);
  if (cropMode) { cropPointerDown(p, event); return; }
  if (marking) { markNext(p); return; }
  for (let i = 0; i < corners.length; i++) {
    if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= GRAB_RADIUS) {
      activeCorner = i; manualBoundary=true; snappedNow = false; canvas.setPointerCapture(event.pointerId); draw(); break;
    }
  }
});
canvas.addEventListener('pointermove', (event) => {
  const p = getCanvasPoint(event);
  if (cropMode) { cropPointerMove(p); return; }
  if (activeCorner === -1) return;
  let rx = Math.max(0, Math.min(canvas.width, p.x)), ry = Math.max(0, Math.min(canvas.height, p.y));
  const s = canvas.width / img.naturalWidth;
  let best = null, bestD = Math.min(SNAP_RADIUS,canvas.width*0.022);
  for (const t of snapTargetsImg) {
    const d = Math.hypot(rx - t.x * s, ry - t.y * s);
    if (d < bestD) { bestD = d; best = { x: t.x * s, y: t.y * s }; }
  }
  snappedNow = !!best;
  corners[activeCorner] = clampCornerToCanvas(best || { x: rx, y: ry });
  updateBoundaryAction();
  draw();
});
function endDrag() { if (cropMode) { cropActive = null; return; } if (activeCorner === -1) return; activeCorner = -1; snappedNow = false; draw(); }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
// while actively dragging a corner or the crop box, stop the browser from panning the (zoomed) page
canvas.addEventListener('touchmove', (e) => { if (activeCorner !== -1 || (cropMode && cropActive)) e.preventDefault(); }, { passive: false });

window.addEventListener('resize', () => {
  if (!img || boundaryPanel.hidden) return;
  const oldW = canvas.width, oldH = canvas.height;
  const { w, h } = computeFitSize();
  const sx = w / oldW, sy = h / oldH;
  setCanvasSize(w, h);
  corners = corners.map((c) => clampCornerToCanvas({ x: c.x * sx, y: c.y * sy }));
  marked=marked.map(p=>({x:p.x*sx,y:p.y*sy}));
  if (cropMode && cropRect) cropRect={x:cropRect.x*sx,y:cropRect.y*sy,w:cropRect.w*sx,h:cropRect.h*sy};
  frameBoundary();
  draw();
});

/* ---- CROP / ZOOM: frame the big square, then zoom into it (re-detects grid) ----
   Fixes "the square is too small to snap onto" when the photo was taken far away.
   The suggested box is auto-placed around the densest cluster of grid crossings. */
function suggestCropRect() {
  const xs = [], ys = [];
  if (!marking && corners.length === 4) { corners.forEach((c) => { xs.push(c.x); ys.push(c.y); }); }
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
  frameBoundary();
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
function cancelCrop() { leaveCrop(); frameBoundary(); detectStatus.style.display='block'; hideBusy(); draw(); }
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
    const original = img;
    im.onload = () => { if (img === original) { leaveCrop(); hideBusy(); loadPhoto(im); } };      // loadPhoto re-fits + re-detects the grid on the zoomed crop
    im.onerror = () => { if (img !== original) return; cancelCrop(); setDetectStatus('Could not crop this photo. Try a smaller frame.'); };
    im.src = url;
  } catch (e) { dlog('crop FAILED: ' + e.message); cancelCrop(); }
}
if (cropBtn) cropBtn.addEventListener('click', enterCrop);
if (resetBoxBtn) resetBoxBtn.addEventListener('click', resetBox);
if (cropConfirm) cropConfirm.addEventListener('click', () => { showBusy('Zooming in…'); laterForPhoto(confirmCrop); });
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

function loadOpenCv() {
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
    updateBoundaryAction();
    if (typeof dlog === 'function') dlog('OpenCV ready (' + (window.__cvSrc || '?') + ').');
    if (img && !cropMode) { showBusy('Finding the grid…'); laterForPhoto(() => { try { analyzeAndDetect(); } finally { hideBusy(); } }); }
  }

  // Resolve whatever shape this build hands us into a ready cv.Mat module.
  function adopt(candidate) {
    if (cvReady) return;
    const c = candidate || window.cv;
    if (!c) return;
    if (c.Mat) { onReady(c); return; }                       // already-initialised module
    if (typeof c.then === 'function') {                      // a Promise of the module
      if (mod === c) return;
      mod = c;
      c.then(value=>{ if (value && value.Mat) onReady(value); else if (value!==c) adopt(value); },()=>{});
      return;
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
}

/* ===========================================================================
   GRID ANALYSIS — line extraction (snap crossings) + top-hat detection
   =========================================================================== */
const DET_MAX = 1200;
const FLAT_SRC_MAX = 2400;
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

function analyzeAndDetect() {
  if (!cvReady || !img) return;
  let src;
  try {
    src=imreadScaled(DET_MAX).mat;
    const result=ChamberGrid.detect(cv,src);
    const toImage=img.naturalWidth/src.cols, toCanvas=canvas.width/src.cols;
    snapTargetsImg=result.snaps.map(p=>({x:p.x*toImage,y:p.y*toImage}));
    if (manualBoundary) { updateBoundaryAction(); return; }
    if (result.corners) {
      marking=false;
      corners=result.corners.map(p=>({x:p.x*toCanvas,y:p.y*toCanvas}));
      frameSquare=true; frameBoundary();
      setDetectStatus('Check that the outline encloses all 16 subdivisions. Drag a corner if it needs adjusting.');
    } else {
      resetBox(result.ambiguous?'Several squares fit. ':'The outer boundary is unclear. ');
    }
  } catch (e) {
    dlog('Grid detection failed: '+e);
    if (!manualBoundary) resetBox('The grid could not be read. ');
  } finally { if (src) src.delete(); updateBoundaryAction(); draw(); }
}
function setDetectStatus(t) { detectStatus.textContent = t; detectStatus.style.display = 'block'; }

// Guaranteed recovery: drop the four corners back to the default inset box, fully on-screen.
// (Use this if a detected corner ever ends up hard to reach.)
function resetBox(prefix='') {
  if (!img || cropMode) return;
  manualBoundary=true; marking=true; marked=[]; corners=[];
  frameSquare=false; frameBoundary();
  activeCorner=-1; snappedNow=false;
  setDetectStatus((typeof prefix==='string'?prefix:'')+'Tap the top left corner of the large square (1 of 4).');
  resetBoxBtn.textContent='Start corners again';
  updateBoundaryAction(); draw();
}
document.getElementById('editBoundaryBtn').addEventListener('click',()=>{
  const oldW=canvas.width,oldH=canvas.height;
  setStage('boundary');
  const {w,h}=computeFitSize();
  setCanvasSize(w,h); corners=corners.map(p=>({x:p.x*w/oldW,y:p.y*h/oldH}));
  frameBoundary();
  updateBoundaryAction(); draw(); document.getElementById('boundaryTitle').focus();
});

/* ===========================================================================
   FLATTEN — perspective transform WITH a margin around the boundary
   =========================================================================== */
flattenBtn.addEventListener('click', () => {
  if (!cvReady || !img || !updateBoundaryAction()) return;
  showBusy('Straightening the square…');
  laterForPhoto(doFlatten);
});
function doFlatten() {
  let src, dst, srcTri, dstTri, Mtx;
  try {
    const s = canvas.width / img.naturalWidth;
    const pts = corners.map((c) => ({ x: c.x / s, y: c.y / s }));
    const O = FLAT_OUT, M = FLAT_MARGIN;

    const scaled=imreadScaled(FLAT_SRC_MAX); src=scaled.mat; const g=scaled.scale;   // PERF: cap the warp source size
    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2,
      [pts[0].x * g, pts[0].y * g, pts[1].x * g, pts[1].y * g, pts[2].x * g, pts[2].y * g, pts[3].x * g, pts[3].y * g]);
    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [M, M, O - M, M, O - M, O - M, M, O - M]); // inset by margin
    Mtx = cv.getPerspectiveTransform(srcTri, dstTri);
    dst = new cv.Mat();
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

    setStage('count');
    saveStatus.textContent = '';

    document.getElementById('reviewTitle').focus();
    countCells();                                              // go straight to counting (handles hideBusy)
  } catch (e) {
    console.error('flatten error:', e); dlog('flatten FAILED: ' + e.message); setDetectStatus('Could not straighten this square. Check the four corners and try again.'); hideBusy();
  } finally { [src,dst,Mtx,srcTri,dstTri].forEach(m=>{if(m)m.delete()}); }
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
const TAP_TOL = 7;                   // finger tolerance (screen px) beyond a ring
const ADD_ROI = 46;                   // window (px) searched when you tap to add a cell

let trypanOn = true;                  // DEFAULT: Trypan blue added (user can press No)
let dilution = 2;                     // dilution factor (0/1 = none; 2 = diluted half)
let deadLevel = 5;                    // dead (blue) sensitivity 1..10 (higher = more dead); saved on this device
let sensitivity = 5;                  // detection sensitivity 1..10; saved on this device
let bgBlue = 0, bgSpread = 8;         // background blueness reference (set each count)

// manual count nudge (for cells the detector misses or over-counts; CAN go negative)
let manualLive = 0, manualDead = 0;
let manualMode = 'live';

function setCountStatus(t) { countStatus.textContent = t; countStatus.style.display = 'block'; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isCounted(c) { return c.state === 'in' && !c.dismissed; }

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
  const margin = deadMarginK() * bgSpread;
  cells.forEach(c => { c.deadBase = c.blueness - bgBlue > margin; });
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

// Average blue excess inside the cell relative to red and green.
function bluenessAt(cx, cy, r) {
  const data = flatCleanData.data, width = FLAT_OUT;
  const left = Math.max(0, Math.floor(cx-r)), right = Math.min(width-1, Math.ceil(cx+r));
  const top = Math.max(0, Math.floor(cy-r)), bottom = Math.min(width-1, Math.ceil(cy+r));
  let sum = 0, pixels = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if ((x-cx)**2 + (y-cy)**2 > r*r) continue;
      const i = (y*width+x)*4;
      sum += data[i+2] - (data[i]+data[i+1])/2;
      pixels++;
    }
  }
  return pixels ? Math.round(sum/pixels) : 0;
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

/* ---- segmentation: returns candidate blobs {x,y,r,blueness} ---- */
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
  let rgba, gray, kBg, th, horizontal, vertical, hKernel, vKernel, roi, tmp;
  try {
    rgba = cv.matFromImageData(flatCleanData);
    gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const samples=[];
    for(let y=FLAT_MARGIN+8;y<FLAT_OUT-FLAT_MARGIN;y+=19) {
      for(let x=FLAT_MARGIN+8;x<FLAT_OUT-FLAT_MARGIN;x+=19) samples.push(gray.data[y*gray.cols+x]);
    }
    samples.sort((a,b)=>a-b);
    const appearance=document.getElementById('cellContrast').value;
    if (appearance==='dark' || (appearance==='auto' && samples[Math.floor(samples.length/2)]>150)) {
      cv.bitwise_not(gray,gray);
    }
    kBg = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(BG_K, BG_K));
    th = new cv.Mat(); cv.morphologyEx(gray, th, cv.MORPH_TOPHAT, kBg);
    // Subtract the intensity of long rulings before thresholding. A bright cell
    // touching a ruling can still have a local peak above the ruling itself.
    hKernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(LINE_LEN,1));
    vKernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,LINE_LEN));
    horizontal=new cv.Mat(); vertical=new cv.Mat();
    cv.morphologyEx(th,horizontal,cv.MORPH_OPEN,hKernel);
    cv.morphologyEx(th,vertical,cv.MORPH_OPEN,vKernel);
    cv.max(horizontal,vertical,horizontal);
    cv.subtract(th,horizontal,th);
    const side=FLAT_OUT-2*FLAT_MARGIN;
    roi=th.roi(new cv.Rect(FLAT_MARGIN,FLAT_MARGIN,side,side));
    tmp = new cv.Mat();
    segOtsu = cv.threshold(roi, tmp, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    segTophat = th; th=null;
    return true;
  } catch (e) { dlog('seg-cache FAILED: ' + e.message); freeSegCache(); return false; }
  finally { [rgba,gray,kBg,th,horizontal,vertical,hKernel,vKernel,roi,tmp].forEach(m=>{if(m)m.delete()}); }
}

function segmentBlobs(sv) {
  const O = FLAT_OUT, out = [];
  const sp = sensParams(sv);
  if (!ensureSegCache()) throw new Error('Could not read the counting square');
  let bin=null, core=null, grown=null, vicinity=null, kOpen=null, dist=null, distB=null,
      sep=null, maxd=null, isMax=null, strongF=null, strong8=null, seeds=null,
      lbl=null, stats=null, cent=null;
  try {
    // sensitivity-adjusted threshold on the CACHED top-hat (+ cached Otsu base)
    bin = new cv.Mat();
    const threshold=clamp(segOtsu*sp.thrMul,7,254);
    core=new cv.Mat();
    cv.threshold(segTophat,core,threshold,255,cv.THRESH_BINARY);
    // Grow strong cell cores into their dimmer edges. This reconnects lobes of
    // a cell over a grid crossing without admitting isolated dim field noise.
    vicinity=cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(9,9));
    grown=new cv.Mat(); cv.dilate(core,grown,vicinity);
    cv.threshold(segTophat,bin,Math.max(5,threshold*0.55),255,cv.THRESH_BINARY);
    cv.bitwise_and(bin,grown,bin);
    kOpen = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kOpen);

    // distance transform -> each cell becomes a "hill"; its peak marks the centre.
    dist = new cv.Mat(); cv.distanceTransform(bin, dist, cv.DIST_L2, 5);
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
    const strongPixels=core.data;
    for (let i = 1; i < nLab; i++) {
      const cx = cent.doubleAt(i, 0), cy = cent.doubleAt(i, 1);
      const xx = clamp(Math.round(cx), 0, O - 1), yy = clamp(Math.round(cy), 0, O - 1);
      const r = dist.floatAt(yy, xx);
      if (r < sp.minR || r > MAX_R) continue;
      // Expansion may expose several weak bumps beside one bright object.
      // Each centre needs at least a small patch of the original strong signal.
      let strong=0;
      const reach=Math.max(2,Math.min(4,Math.round(r*0.7)));
      for (let y=Math.max(0,yy-reach); y<=Math.min(O-1,yy+reach); y++) {
        for (let x=Math.max(0,xx-reach); x<=Math.min(O-1,xx+reach); x++) {
          if (strongPixels[y*O+x]) strong++;
        }
      }
      if (strong < Math.max(3,(2*reach+1)**2*0.14)) continue;
      out.push({ x: cx, y: cy, r, blueness: bluenessAt(cx, cy, r) });
    }
    return out;
  } catch (e) {
    dlog('segment FAILED: ' + e.message); throw e;
  } finally {
    [bin,core,grown,vicinity,kOpen,dist,distB,sep,maxd,isMax,strongF,strong8,seeds,lbl,stats,cent]
      .forEach((m) => { if (m) { try { m.delete(); } catch (_) {} } });
  }
}

/* ---- the count ---- */
// quiet = true: recount WITHOUT the full-screen overlay (used by the sensitivity slider so
// repeated tweaks feel instant). The cached preprocessing keeps each recount fast.
function countCells(quiet) {
  if (!cvReady || !flatCleanData) { setCountStatus('Flatten a square first.'); hideBusy(); return; }
  if (!quiet) { setCountStatus('Counting…'); showBusy('Counting cells…'); }
  const source = flatCleanData;
  laterForPhoto(() => {
    if (flatCleanData !== source) return;
    try { runCount(); } finally { if (!quiet) hideBusy(); }
  }, quiet ? 0 : 30);
}
function runCount() {
  cells = []; hasCount=false; updateSaveButton();
  try {
    computeBackgroundBlueness();                          // field reference for RELATIVE dead detection
    const blobs = segmentBlobs(sensitivity);
    blobs.forEach((b) => {
      const state = classifyCell(b.x, b.y, b.r, FLAT_OUT, FLAT_MARGIN);
      if (state === 'drop') return;
      cells.push({ x: b.x, y: b.y, r: b.r, state,
        dismissed: false, added: false,
        flip: false, cyc: 0, deadBase: false,
        blueness: b.blueness });
    });
    recomputeDead();                                      // set deadBase relative to background

    manualLive = 0; manualDead = 0; manualMode = 'live';
    if (dilutionInput) dilutionInput.value = String(dilution);
    applyTrypan();
    hasCount = true; savedThisCount = false;
    showCountTools(true);
    redrawCount();

    const inN = cells.filter(isCounted).length;
    dlog('Counted '+inN+' cells; detection sensitivity '+sensitivity);
    const msg = cells.length === 0
      ? 'No cells found. Tap a missed cell to add it, or adjust detection sensitivity in Count settings.'
      : tapHint();
    setCountStatus(msg);
  } catch (e) {
    console.error('count error:', e); dlog('count FAILED: ' + e.message); setCountStatus('Counting failed \u2014 see debug log.');
  }
}

/* ---- Trypan blue (live/dead) + dilution + readout ---- */
function isDead(c) { return trypanOn && (c.flip ? !c.deadBase : c.deadBase); }
function tapHint() {
  return trypanOn
    ? 'Tap a ring to change live/dead, remove it, then restore it. Tap a missed cell to add it.'
    : 'Tap a ring to remove or restore it. Tap a missed cell to add it.';
}
function applyTrypan() {
  recomputeDead();
  document.getElementById('includedLabel').textContent = trypanOn ? 'Live' : 'Counted';
  document.getElementById('deadLegend').hidden = !trypanOn;
  trypanYes.classList.toggle('active', trypanOn);
  trypanNo.classList.toggle('active', !trypanOn);
  trypanYes.setAttribute('aria-pressed', String(trypanOn));
  trypanNo.setAttribute('aria-pressed', String(!trypanOn));
}
function setTrypan(on) {
  if (trypanOn === on) return;
  trypanOn = on;
  applyTrypan();
  setDilutionForTrypan(on);
  updateToolsVisibility();
  if (hasCount) {
    redrawCount();
    if (cells.length) setCountStatus(tapHint());
  }
  savePreferences();
}
function setDeadLevel(v) {                 // 1..10 dead sensitivity (higher = MORE cells dead)
  deadLevel = clamp(v, 1, 10);
  if (blueLabel) blueLabel.textContent = deadLevel;
  recomputeDead();
  redrawCount();
  savePreferences();
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
  savePreferences();
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

const QUICK_COUNTS = [20000, 70000, 120000, 240000, 600000, 1500000];
let lastUsedCount = null;
function renderCalcRecent() {
  const values = QUICK_COUNTS.slice();
  if (lastUsedCount && !values.includes(lastUsedCount)) values.push(lastUsedCount);
  // Keep existing buttons in place when committing typed input on blur so
  // a simultaneous tap on a shortcut still reaches its click handler.
  for (const button of [...calcRecent.children]) {
    if (!values.includes(Number(button.value))) button.remove();
  }
  for (const n of values) {
    let button = calcRecent.querySelector('button[value="'+n+'"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.value = String(n);
      button.append(n.toLocaleString('en-US'));
      const label = document.createElement('small');
      label.textContent = 'Last used';
      button.append(label);
      // A blur commits typed input and can replace the last-used button.
      // Apply the tapped value first, then move focus off the input.
      button.addEventListener('pointerdown', event => {
        if (document.activeElement === calcCells) event.preventDefault();
      });
      button.addEventListener('click', () => {
        calcCells.value = n.toLocaleString('en-US');
        updateCalc();
        rememberCount(n);
        button.focus({preventScroll:true});
      });
      calcRecent.append(button);
    }
    button.querySelector('small').hidden = n !== lastUsedCount;
  }
}
function rememberCount(n) {
  if (!Number.isSafeInteger(n) || n <= 0 || n === lastUsedCount) return;
  lastUsedCount = n;
  renderCalcRecent();
  savePreferences();
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
  document.getElementById('totalCells').textContent=total;
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
function updateToolsVisibility() {
  sliderGroup.style.display = trypanOn ? '' : 'none';
  updateManualUI();
}

/* ---- tap to correct: cycle state / remove / add ----
   Called only on a confirmed single-finger TAP (see the tap-gating below), so a
   two-finger pinch-zoom no longer toggles a cell, and a one-finger drag pans. */
function flatTapAt(clientX, clientY) {
  if (!flatCleanData) return;
  const rect = flatCanvas.getBoundingClientRect();
  const sx = flatCanvas.width / rect.width;                 // displayed -> 900-space
  const x = (clientX - rect.left) * sx, y = (clientY - rect.top) * sx;

  if (!overlayVisible) return;                              // circles hidden for manual counting

  let hit = -1, hd = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i], d = Math.hypot(x - c.x, y - c.y);
    const grab = c.r + RING_GAP + TAP_TOL * sx;
    if (d <= grab && d < hd) { hd = d; hit = i; }
  }
  if (hit >= 0) {
    const c = cells[hit];
    c.cyc = trypanOn ? (c.cyc + 1) % 3 : (c.cyc === 2 ? 0 : 2);
    c.flip = c.cyc === 1;
    c.dismissed = c.cyc === 2;
  } else {
    addCellAt(x, y);
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
  const blueness = bluenessAt(cx, cy, r);
  const c = { x: cx, y: cy, r, area: Math.round(Math.PI * r * r), state,
    dismissed: false, added: true,
    flip: false, cyc: 0, deadBase: (blueness - bgBlue) > deadMarginK() * bgSpread, blueness };
  cells.push(c);
  return c;
}
// find the bright blob under/near a tap (pure JS on the clean pixels — no cv, no leaks)
function detectBlobNear(tx, ty) {
  if (!segTophat) return null;
  const data=segTophat.data, W=FLAT_OUT, half=Math.floor(ADD_ROI/2);
  const x0 = clamp(Math.round(tx) - half, 1, W - 2), x1 = clamp(Math.round(tx) + half, 1, W - 2);
  const y0 = clamp(Math.round(ty) - half, 1, W - 2), y1 = clamp(Math.round(ty) + half, 1, W - 2);
  if (x1 <= x0 || y1 <= y0) return null;
  let mean = 0, mx = 0, cnt = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const g = data[y*W+x]; mean += g; if (g > mx) mx = g; cnt++; }
  mean /= cnt;
  const thr = Math.max(mean + 12, mx * 0.55);
  let sx = -1, sy = -1, sb = -1;
  for (let y = clamp(Math.round(ty) - 10, y0, y1); y <= clamp(Math.round(ty) + 10, y0, y1); y++)
    for (let x = clamp(Math.round(tx) - 10, x0, x1); x <= clamp(Math.round(tx) + 10, x0, x1); x++) {
      const g = data[y*W+x]; if (g > sb) { sb = g; sx = x; sy = y; }
    }
  if (sb < thr) return null;
  const seen = new Set(), stack = [[sx, sy]]; let n = 0, cxs = 0, cys = 0;
  while (stack.length) {
    const p = stack.pop(), x = p[0], y = p[1];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const k = y * W + x; if (seen.has(k)) continue;
    if (data[y*W+x] < thr) continue;
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
    updateToolsVisibility();
  }
}

/* ---- Reset to defaults / Show-hide circles (replace the old "Count again") ---- */
function resetCountDefaults() {
  document.getElementById('cellContrast').value='auto';
  freeSegCache();
  sensitivity = 5;
  if (sensSlider) sensSlider.value = 5;
  if (sensLabel) sensLabel.textContent = 5;
  deadLevel = 5;                                   // also reset dead (blue) sensitivity to the default
  if (blueSlider) blueSlider.value = 5;
  if (blueLabel) blueLabel.textContent = 5;
  savePreferences();
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
// one-finger drag pan the (zoomed) page.
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
document.getElementById('cellContrast').addEventListener('change',()=>{
  freeSegCache();
  countCells();
});
toggleOverlayBtn.addEventListener('click', toggleOverlay);
trypanYes.addEventListener('click', () => setTrypan(true));
trypanNo.addEventListener('click', () => setTrypan(false));
dilutionInput.addEventListener('input', () => {
  const v = parseFloat(dilutionInput.value);
  dilution = (isFinite(v) && v > 1) ? v : 1;     // 0 or 1 -> no dilution
  updateReadout(); updateCalc();
  savedThisCount = false; updateSaveButton();
  savePreferences();                              // remember the dilution on this device
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
  sensTimer = setTimeout(() => { savePreferences(); if (flatCleanData) countCells(true); }, 160);
});
manualMinus.addEventListener('click', () => adjustManual(-1));
manualPlus.addEventListener('click', () => adjustManual(1));
manualLiveBtn.addEventListener('click', () => setManualMode('live'));
manualDeadBtn.addEventListener('click', () => setManualMode('dead'));
// dilution / seeding calculator inputs
if (calcCells) calcCells.addEventListener('input', updateCalc);
if (calcCells) calcCells.addEventListener('change', () => {       // commit (blur/Enter) -> save to recents
  const n = Number(calcCells.value.replace(/[, ]/g, ''));
  rememberCount(n);
});
if (calcFinal) calcFinal.addEventListener('input', updateCalc);
// limiting-dilution (cloning) inputs
[ldCells, ldVol, ldWells].forEach((el) => { if (el) el.addEventListener('input', updateLimitDil); });

// On-device session history and workspace preferences.
const DB_NAME = 'cellCounterDB', DB_VER = 5;
let db = null, storageOK = false;
let currentSessionKey = null;          // squares saved now belong to this session
let hasCount = false;                // a count has been run on the current flatten
let savedThisCount = false;          // current count already added to the session
let deletedStack = [];               // squares removed with ✕ (stack — undo can step back many times)
let previousSessionKey = null;             // the session active before "New session" (so it can be undone)
let sessionSquares = [];             // saved squares in the current session (basis for the calculator)

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const database = req.result, tx = req.transaction;
      const existingSquares = database.objectStoreNames.contains('squares');
      const squares = existingSquares ? tx.objectStore('squares')
        : database.createObjectStore('squares', { keyPath: 'id', autoIncrement: true });
      squares.createIndex('sessionKey', 'sessionKey');
      const settings = database.createObjectStore('settings');
      // The upgrade is atomic. Identical timestamps from different equipment
      // setups retain separate histories. Preserve all other fields, including images.
      if (existingSquares) {
        const request = squares.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const row = cursor.value;
          row.sessionKey = row.sessionKey || (row.sampleId == null
            ? 'old-square/'+row.id : 'old-session/'+(row.profileId ?? '')+'/'+row.sampleId);
          cursor.update(row);
          cursor.continue();
        };
      }
      if (database.objectStoreNames.contains('profiles')) {
        const first = tx.objectStore('profiles').openCursor();
        first.onsuccess = () => {
          if (!first.result) return;
          const old = first.result.value;
          settings.put({
            deadLevel: old.deadLevel, sensitivity: old.sensitivity, concUnit: old.concUnit,
            trypanPref: old.trypanPref, dilutionPref: old.dilutionPref,
            lastUsedCount: old.recentCounts?.find(n => Number.isSafeInteger(n) && n > 0)
          }, 'workspace');
        };
      }
    };
    req.onblocked = () => {
      document.getElementById('stainPanel').disabled = false;
      sampleSummary.textContent = 'Close other Cell Counter tabs to finish updating saved sessions.';
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const oStore = (n, m) => db.transaction(n, m).objectStore(n);
const pAll = (n) => new Promise((res, rej) => { const r = oStore(n, 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
const pAdd = (n, rec) => new Promise((res, rej) => { const r = oStore(n, 'readwrite').add(rec); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function putRecord(store, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
}
const pDelete = (n, id) => new Promise((res, rej) => { const r = oStore(n, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const pGet = (n, id) => new Promise((res, rej) => { const r = oStore(n, 'readonly').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pByIndex = (store, idx, val) => new Promise((res, rej) => { const r = oStore(store, 'readonly').index(idx).getAll(IDBKeyRange.only(val)); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
function applyPreferences(settings = {}) {
  const p = settings || {};
  deadLevel = Number.isFinite(p.deadLevel) ? clamp(p.deadLevel, 1, 10) : 5;
  sensitivity = Number.isFinite(p.sensitivity) ? clamp(p.sensitivity, 1, 10) : 5;
  concUnit = p.concUnit === 'uL' ? 'uL' : 'mL';
  trypanOn = typeof p.trypanPref === 'boolean' ? p.trypanPref : true;
  dilution = Number.isFinite(p.dilutionPref) && p.dilutionPref >= 1 ? p.dilutionPref : (trypanOn ? 2 : 1);
  lastUsedCount = Number.isSafeInteger(p.lastUsedCount) && p.lastUsedCount > 0 ? p.lastUsedCount : null;
  blueSlider.value = blueLabel.textContent = deadLevel;
  sensSlider.value = sensLabel.textContent = sensitivity;
  dilutionInput.value = String(dilution);
  concMlBtn.classList.toggle('active', concUnit === 'mL');
  concUlBtn.classList.toggle('active', concUnit === 'uL');
  applyTrypan();
  updateToolsVisibility();
  renderCalcRecent();
}
async function savePreferences() {
  if (!storageOK) return;
  try {
    await putRecord('settings', {deadLevel, sensitivity, concUnit, trypanPref:trypanOn,
      dilutionPref:dilution, lastUsedCount}, 'workspace');
  } catch (e) { dlog('Could not save preferences: '+e.message); }
}
async function startNewSession(previous = null) {
  currentSessionKey = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  sessionSquares = [];
  savedThisCount = false; deletedStack = [];
  previousSessionKey = previous;
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
  const key = currentSessionKey;
  try { rows = await pByIndex('squares', 'sessionKey', key); } catch (e) { dlog('sample view failed: ' + e.message); rows = []; }
  if (key !== currentSessionKey) return;
  const all = rows.sort((a, b) => a.createdAt - b.createdAt);
  document.getElementById('squareTally').textContent=all.length+' square'+(all.length===1?'':'s');
  document.getElementById('session').dataset.empty=String(all.length===0 && previousSessionKey==null && !deletedStack.length);
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
    sampleSummary.textContent = 'Saved squares and their average appear here.';
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
    await putRecord('squares', d);
    dlog('undo: square restored');
  } catch (e) { dlog('undo failed: ' + e.message); }
  await refreshSampleView(); await refreshHistory();
}

/* ---- Bug 4: undo an accidental "New session" (switch back to the previous one) ----
   New session is non-destructive (it just points at a fresh sampleId; the old squares
   stay in history), so undo simply re-selects the previous session. */
function updateUndoSessionButton() {
  if (!undoSessionBtn) return;
  const can = storageOK && previousSessionKey != null && previousSessionKey !== currentSessionKey;
  undoSessionBtn.style.display = can ? '' : 'none';
  if (can) document.getElementById('session').dataset.empty='false';
}
async function undoNewSession() {
  if (previousSessionKey == null) return;
  currentSessionKey = previousSessionKey;
  previousSessionKey = null;
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
function exportSessionCsv() {
  if (!storageOK) { saveStatus.textContent = 'storage unavailable'; return; }
  const all = sessionSquares;
  if (!all.length) { saveStatus.textContent = 'no squares to export'; return; }

  const m = all.length;
  const avgTotal = all.reduce((a, s) => a + s.total, 0) / m;
  const anyTrypan = all.some((s) => s.trypanOn);
  const meanVia = Math.round(all.reduce((a, s) => a + (s.trypanOn ? s.viability : 100), 0) / m);
  const perML = concPerML(all);

  const L = [];
  L.push(['Cell Counter — session export']);
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
async function refreshHistory() {
  if (!storageOK) return;
  const squares = await pAll('squares');
  const groups = new Map();
  for (const square of squares) {
    if (square.sessionKey === currentSessionKey) continue;
    if (!groups.has(square.sessionKey)) groups.set(square.sessionKey, []);
    groups.get(square.sessionKey).push(square);
  }
  // getAll follows the primary key, but resumed sessions and restored rows
  // need sorting by the original count time.
  const sessions = [...groups.values()].map(rows => rows.sort((a,b)=>a.createdAt-b.createdAt))
    .sort((a,b)=>b[0].createdAt-a[0].createdAt);
  historyList.innerHTML = '';
  if (sessions.length === 0) { historyList.innerHTML = '<p class="muted-line">No past sessions yet.</p>'; return; }
  sessions.forEach(arr => {
    const id = arr[0].sessionKey, m = arr.length;
    const when = new Date(arr[0].createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const row = document.createElement('div'); row.className = 'sample-item';
    const span = document.createElement('span'); span.innerHTML = `${when} · ${m} sq · ≈ ${formatConc(concPerML(arr))}/mL`;
    const btn = document.createElement('button'); btn.className = 'mini-btn'; btn.textContent = 'Resume';
    btn.addEventListener('click', async () => {
      currentSessionKey = id; savedThisCount = false; deletedStack = []; previousSessionKey = null;
      await refreshSampleView(); await refreshHistory(); updateUndoSessionButton();
      saveStatus.textContent = 'resumed a past session';
    });
    row.appendChild(span); row.appendChild(btn); historyList.appendChild(row);
  });
}
function updateSaveButton() {
  saveBtn.disabled = !(storageOK && currentSessionKey && hasCount && !savedThisCount);
  saveBtn.textContent = savedThisCount ? 'Added to session ✓' : 'Add square to session';
}
async function initStorage() {
  try {
    db = await openDB();
    db.onversionchange = () => db.close();
    storageOK = true;
    applyPreferences(await pGet('settings','workspace'));
    await startNewSession();
    dlog('storage ready · fresh session');
  } catch (e) {
    console.error('storage init failed:', e); dlog('storage init FAILED: ' + e.message);
    storageOK = false;
    applyPreferences();
    sampleSummary.textContent = '(on-device storage unavailable here)'; sampleSummary.style.display = 'block';
  }
  document.getElementById('stainPanel').disabled = false;
  updateSaveButton();
}
newSessionBtn.addEventListener('click', async () => {
  const previous = sessionSquares.length ? currentSessionKey : null;
  resetPhoto();
  document.getElementById('historyBox').open = false;
  await startNewSession(previous);
});
undoBtn.addEventListener('click', doUndo);
if (undoSessionBtn) undoSessionBtn.addEventListener('click', undoNewSession);
if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportSessionCsv);
if (saveImgBtn) saveImgBtn.addEventListener('click', saveAnnotatedImage);
saveBtn.addEventListener('click', async () => {
  if (!storageOK) { saveStatus.textContent = 'storage unavailable'; return; }
  if (!hasCount) { saveStatus.textContent = 'count a square first'; return; }
  if (savedThisCount || saveBtn.disabled) return;
  saveBtn.disabled=true;
  const key = currentSessionKey, photo = img;
  try {
    const c = summarizeCounts();
    await pAdd('squares', {
      sessionKey: key, createdAt: Date.now(),
      total: c.total, live: c.live, dead: c.dead, viability: c.viability,
      trypanOn, dilution, thumb: lastFlatClean
    });
    if (key !== currentSessionKey || photo !== img) { await refreshHistory(); return; }
    savedThisCount = true;
    dlog(`added square: total ${c.total}, live ${c.live}, dead ${c.dead}, dil ${dilution}`);
    await refreshSampleView();
    if (key !== currentSessionKey || photo !== img) return;
    saveStatus.textContent = '';
    document.querySelector('#changePhoto summary').textContent='Photo for next square';
    document.getElementById('changePhoto').open=true;
  } catch (e) { console.error('save failed:', e); dlog('save FAILED: ' + e.message); saveStatus.textContent = 'Could not save this square. Try again.'; updateSaveButton(); }
});

/* ---- tiny debug log wiring (the _logLines/dlog definition was moved up near the top
        so the OpenCV loader can safely log during boot without a TDZ error) ---- */
window.addEventListener('error', (e) => dlog('JS ERROR: ' + (e.message || (e.error && e.error.message) || 'unknown')));
window.addEventListener('unhandledrejection', (e) => dlog('PROMISE REJECTED: ' + ((e.reason && e.reason.message) || e.reason)));
if (debugCopy) debugCopy.addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(_logLines.join('\n')); });
if (debugClear) debugClear.addEventListener('click', () => { _logLines.length = 0; debugLog.textContent = ''; });

applyPreferences();
initStorage();
/* The reference shows one entire corner square and the narrower neighboring rulings. */
function drawGridReference() {
  const el=document.getElementById('guide'), pen=el.getContext('2d');
  const w=el.width,h=el.height;
  pen.fillStyle='#173f34'; pen.fillRect(0,0,w,h);
  function line(ax,ay,bx,by,color,weight) {
    pen.strokeStyle=color; pen.lineWidth=weight; pen.beginPath(); pen.moveTo(ax,ay); pen.lineTo(bx,by); pen.stroke();
  }
  for (let x=12;x<w;x+=24) for(let y=12;y<h;y+=24) {
    pen.fillStyle='#325449'; pen.fillRect(x,y,1.5,1.5);
  }
  // Project a square at a slight angle, as it appears on a photographed display.
  function p(u,v) { return {x:208+359*u+27*v-12*u*v,y:51-21*u+268*v+8*u*v}; }
  function ruling(u,v,U,V,color,width) { const a=p(u,v),b=p(U,V);line(a.x,a.y,b.x,b.y,color,width); }
  const q=[p(0,0),p(1,0),p(1,1),p(0,1)];
  pen.beginPath(); q.forEach((k,i)=>i?pen.lineTo(k.x,k.y):pen.moveTo(k.x,k.y)); pen.closePath(); pen.fillStyle='#254d3d';pen.fill();
  for (const u of [-.52,-.29,-.017,0,.25,.5,.75,1,1.018,1.12,1.22,1.32,1.42,1.52,1.62]) {
    ruling(u,-.2,u,1.5,'#577564',1.6);
  }
  for (const v of [-.18,-.018,0,.25,.5,.75,1,1.018,1.26]) ruling(-.32,v,1.68,v,'#688270',1.6);
  for (const v of [.25,.5,.75]) {
    ruling(0,v,1,v,'#a6be9b',2); ruling(v,0,v,1,'#a6be9b',2);
  }
  for (let i=0;i<4;i++) {
    const a=q[i],b=q[(i+1)%4];line(a.x,a.y,b.x,b.y,'#c7ed89',3.5);
  }
  for (const a of q) {
    pen.fillStyle='#d7f39f';pen.fillRect(a.x-5,a.y-5,10,10);
  }
  const a=p(0,1.14),b=p(1,1.14);
  line(a.x,a.y,b.x,b.y,'#c2d4bc',1.5);
  for(const t of [a,b]) line(t.x,t.y-6,t.x,t.y+6,'#c2d4bc',1.5);
  pen.save();pen.translate((a.x+b.x)/2,(a.y+b.y)/2);pen.rotate(-.035);
  pen.fillStyle='#173f34';pen.fillRect(-42,-15,84,30);
  pen.fillStyle='#dce6d6';pen.font='22px Consolas, monospace';pen.textAlign='center';pen.fillText('1 mm',0,7);pen.restore();
}
drawGridReference();
