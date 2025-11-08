// --- Webcam elements & state ---
const video  = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx    = canvas.getContext('2d');

let webcamStream = null;
// --- Microphone audio state ---
let micStream = null, audioContext = null, analyser = null, timeBuf = null, volRAF = null;
// --- Pose state ---
let poseLandmarker = null, drawing = null, poseRAF = null;

// Element references
const logBox = document.getElementById('log');
const tiltEl = document.getElementById('tilt');
const volumeEl = document.getElementById('volume');
const lastTip = document.getElementById('last-tip');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const timerEl = document.getElementById('timer');
const voiceToggle = document.getElementById('voiceToggle');
const themeToggle = document.getElementById('themeToggle');
const tipCard = document.getElementById('tipCard');
const breathViz = document.getElementById('breathViz');

// Minimal log helper
function log(msg) {
  const t = new Date().toLocaleTimeString();
  logBox.innerHTML = `[${t}] ${msg}<br>` + logBox.innerHTML;
}

// Status helper
function setStatus(text) {
  statusEl.textContent = text;
}
async function startCamera() {
  // Request user-facing camera
  webcamStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: false
  });

  video.srcObject = webcamStream;
  await video.play();

  // Sync canvas size to video
  const resize = () => {
    canvas.width  = video.videoWidth  || canvas.width;
    canvas.height = video.videoHeight || canvas.height;
  };
  if (video.readyState >= 2) resize();
  else video.addEventListener('loadedmetadata', resize, { once: true });

  log('🎥 Camera started.');
}

function stopCamera() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  log('🛑 Camera stopped.');
}
// ===== Phase 3: Load MediaPipe Pose (on-demand) =====
async function loadPose() {
  if (poseLandmarker) return; // already loaded

  // Dynamic import (keeps index.html unchanged)
  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");

  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });

  // Drawing utils share your existing canvas ctx
  drawing = new vision.DrawingUtils(ctx);

  log("🤖 Pose model loaded.");
}
// Compute torso tilt angle in degrees using mid-shoulder ↕ mid-hip
function torsoTiltDeg(lm) {
  const LS=11, RS=12, LH=23, RH=24;
  if (!lm?.[LS] || !lm?.[RS] || !lm?.[LH] || !lm?.[RH]) return null;
  const mid = (a,b)=>({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
  const shoulder = mid(lm[LS], lm[RS]);
  const hip      = mid(lm[LH], lm[RH]);
  const v = { x: hip.x - shoulder.x, y: hip.y - shoulder.y }; // y-down image coords
  const angleFromVertical = Math.abs(Math.atan2(v.x, v.y));   // radians
  return +(angleFromVertical * 180 / Math.PI).toFixed(1);
}

let lastPoseTipAt = 0;
const TIP_COOLDOWN_MS = 6000;

async function tickPose() {
  if (!poseLandmarker || !video || video.readyState < 2) {
    poseRAF = requestAnimationFrame(tickPose);
    return;
  }

  const t = performance.now();
  const res = await poseLandmarker.detectForVideo(video, t);

  // Draw
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (res?.landmarks?.length) {
    const lm = res.landmarks[0];
    drawing.drawLandmarks(lm, { radius: 2.2, color: "#a0c4ff" });
    // POSE_CONNECTIONS is on the class:
    drawing.drawConnectors(lm, poseLandmarker.constructor.POSE_CONNECTIONS, { lineWidth: 2, color: "#64dfdf" });

    // Tilt + coaching
    const tilt = torsoTiltDeg(lm);
    tiltEl.textContent = tilt ?? "–";

    const now = performance.now();
    if (tilt !== null) {
      if (tilt > 18 && now - lastPoseTipAt > TIP_COOLDOWN_MS) {
        showTip("Straighten your back. Think tall.");
        lastPoseTipAt = now;
      } else if (tilt <= 10) {
        // optional: light status message (no speech)
        // log("Good posture");
      }
    }
  }

  poseRAF = requestAnimationFrame(tickPose);
}

// ===== Phase 2B: REAL MIC VOLUME =====
async function startMic() {
  // Request microphone
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  // Audio graph: mic -> analyser
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(micStream);

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  timeBuf = new Uint8Array(analyser.fftSize);
  source.connect(analyser);

  tickVolume(); // start the RAF loop
  log('🎙️ Mic started.');
}

function stopMic() {
  if (volRAF) cancelAnimationFrame(volRAF);

  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }

  analyser = null;
  timeBuf = null;

  log('🛑 Mic stopped.');
}

function measureRMS() {
  if (!analyser || !timeBuf) return 0;
  analyser.getByteTimeDomainData(timeBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128; // center to [-1, 1]
    sum += v * v;
  }
  return Math.sqrt(sum / timeBuf.length); // ~0..0.5 typical
}

function tickVolume() {
  const rms = measureRMS();
  const pct = Math.min(100, Math.round(rms * 200)); // map 0..0.5 → 0..100
  volumeEl.textContent = (rms || 0).toFixed(2);
  updateBreath(pct);
  volRAF = requestAnimationFrame(tickVolume);
}


// Tip display with animation
function showTip(text) {
  lastTip.textContent = text;
  tipCard.textContent = text;
  tipCard.classList.add('show');
  setTimeout(() => tipCard.classList.remove('show'), 4000);
  speakTip(text);
}

// Voice synthesis
function speakTip(text) {
  if (voiceToggle.checked) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}

// Timer logic
let timerInterval;
let seconds = 0;
function updateTimer() {
  seconds++;
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  timerEl.textContent = `${mins}:${secs}`;
}

// Theme toggle
themeToggle.addEventListener('click', () => {
  const current = document.body.getAttribute('data-theme');
  document.body.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
  log(`Theme switched to ${current === 'light' ? 'dark' : 'light'} mode`);
});

// Breathing visualizer (simulated volume)
function updateBreath(volume) {
  const scale = 1 + Math.min(volume / 100, 0.5);
  breathViz.style.transform = `scale(${scale})`;
  volumeEl.textContent = volume;
}

// Simulate breathing volume every 2 seconds
//setInterval(() => {
 // const fakeVolume = Math.floor(Math.random() * 100);
 // updateBreath(fakeVolume);
//}, 2000);

// Button behavior
startBtn.addEventListener('click', async () => {
  setStatus("Starting (camera and mic will be enabled later)...");
  log("Start button pressed (camera starting...)");
  showTip("Sit upright and breathe deeply.");

  seconds = 0;
  timerEl.textContent = "00:00";
  timerInterval = setInterval(updateTimer, 1000);

  // camera
  try { await startCamera(); } catch (e) { log("Camera error: " + e.message); }

  // ⭐ mic
  try { await startMic(); } catch (e) { log("Mic error: " + e.message + " (Needs HTTPS/permission)"); }

  stopBtn.disabled = false;
  startBtn.disabled = true;
});

stopBtn.addEventListener('click', () => {
  setStatus("Idle");
  log("Stop button pressed.");
  showTip("Session ended. Great job!");

  clearInterval(timerInterval);

  // camera
  stopCamera();

  // ⭐ mic
  stopMic();

  stopBtn.disabled = true;
  startBtn.disabled = false;
});



// Initial message
log("UI ready. Next → Webcam setup in Phase 2.");