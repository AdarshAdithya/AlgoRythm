// --- Webcam elements & state ---
const video  = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx    = canvas.getContext('2d');

let webcamStream = null;
// --- Microphone audio state ---
let micStream = null, audioContext = null, analyser = null, timeBuf = null, volRAF = null;

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