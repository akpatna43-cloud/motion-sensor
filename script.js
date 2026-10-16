const ALERT_DELAY_SECONDS = 5;

const statusTitle = document.getElementById('statusTitle');
const statusDetail = document.getElementById('statusDetail');
const statusIcon = document.getElementById('statusIcon');
const activityDot = document.getElementById('activityDot');
const activityText = document.getElementById('activityText');
const activityTime = document.getElementById('activityTime');
const timerCopy = document.getElementById('timerCopy');
const timerDisplay = document.getElementById('timerDisplay');
const progressFill = document.getElementById('progressFill');
const sensorState = document.getElementById('sensorState');
const ledState = document.getElementById('ledState');
const buzzerState = document.getElementById('buzzerState');

let state = 'safe';
let sensorConnected = true;
let fallDetectedAt = 0;
let countdownInterval = null;
let audioContext = null;
let buzzerInterval = null;
let webcamStream = null;
let webcamVideo = null;
let webcamCanvas = null;
let webcamContext = null;
let webcamFrameId = null;
let previousFrame = null;
let lastMotionNotificationAt = 0;
let lastFrameSampleAt = 0;
const MOTION_NOTIFICATION_COOLDOWN_MS = 10000;
const MOTION_SAMPLE_INTERVAL_MS = 80;
const MOTION_PIXEL_THRESHOLD = 22;
const MOTION_RATIO_THRESHOLD = 0.01;

function setDeviceState(element, label, active = false) {
  element.innerHTML = `<span></span> ${label}`;
  element.classList.toggle('device-on', active);
  element.querySelector('span').style.background = active ? '#e65f61' : '';
}

function updateActivity(label) {
  activityText.textContent = label;
  activityTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stopBuzzer() {
  if (buzzerInterval) {
    clearInterval(buzzerInterval);
    buzzerInterval = null;
  }
  setDeviceState(buzzerState, 'Off');
}

function prepareAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = audioContext || new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playCameraAlarm() {
  prepareAudio();
  if (!audioContext) return;

  const play = () => {
    for (let index = 0; index < 3; index++) {
      const startAt = audioContext.currentTime + index * 0.42;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = index === 1 ? 660 : 880;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.2);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.21);
    }
  };

  if (audioContext.state === 'suspended') audioContext.resume().then(play);
  else play();
}

function soundConnectionChime() {
  prepareAudio();
  if (!audioContext) return;

  const play = () => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.05, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.18);
  };

  if (audioContext.state === 'suspended') audioContext.resume().then(play);
  else play();
}

function soundBuzzer() {
  if (buzzerInterval) return;
  setDeviceState(buzzerState, 'Alert active', true);

  const beep = () => {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.055, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.22);
  };

  beep();
  buzzerInterval = setInterval(beep, 650);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function setSafeState(message = 'System active hai. Movement ka intezaar hai.') {
  clearCountdown();
  stopBuzzer();
  state = 'safe';
  document.body.classList.remove('is-fall', 'is-alert', 'is-moving', 'is-disconnected');
  statusTitle.textContent = 'Sab theek hai';
  statusDetail.textContent = message;
  statusIcon.textContent = '✓';
  setDeviceState(sensorState, 'Ready');
  setDeviceState(ledState, 'Off');
  timerCopy.textContent = 'Possible fall simulate karne ke liye button dabayein.';
  timerDisplay.innerHTML = '—<span> SEC</span>';
  progressFill.style.width = '0%';
}

function registerMovement() {
  if (!sensorConnected || state === 'alert') return;
  const wasFall = state === 'fall';
  setSafeState(wasFall ? 'Movement dobara detect hui. Alert cancel kar diya gaya.' : 'Movement detect hui. User active hai.');
  state = 'moving';
  document.body.classList.add('is-moving');
  statusTitle.textContent = 'Movement detected';
  statusDetail.textContent = wasFall
    ? 'Alert cancel hua — movement dobara detect hui.'
    : 'Motion sensor ne activity detect ki hai.';
  statusIcon.textContent = '⌁';
  setDeviceState(sensorState, 'Active');
  activityDot.style.background = '';
  updateActivity('Movement detect hui');
  window.setTimeout(() => {
    if (state === 'moving') {
      state = 'safe';
      document.body.classList.remove('is-moving');
      statusTitle.textContent = 'Sab theek hai';
      statusDetail.textContent = 'System active hai. Movement ka intezaar hai.';
      statusIcon.textContent = '✓';
      setDeviceState(sensorState, 'Ready');
    }
  }, 2500);
}

function triggerEmergencyAlert() {
  state = 'alert';
  clearCountdown();
  document.body.classList.remove('is-fall');
  document.body.classList.add('is-alert');
  statusTitle.textContent = 'Possible fall alert!';
  statusDetail.textContent = '5 seconds tak movement nahi mili — buzzer aur LED alert active hain.';
  statusIcon.textContent = '!';
  setDeviceState(sensorState, 'No movement');
  setDeviceState(ledState, 'Alert active', true);
  timerCopy.textContent = 'Possible-fall alert trigger ho gaya.';
  timerDisplay.innerHTML = 'SOS<span> ALERT</span>';
  progressFill.style.width = '100%';
  updateActivity('Fall ke baad inactivity');
  soundBuzzer();
}

function startFallDetection() {
  if (!sensorConnected) return;
  clearCountdown();
  stopBuzzer();
  prepareAudio();
  state = 'fall';
  fallDetectedAt = Date.now();
  document.body.classList.remove('is-moving', 'is-alert');
  document.body.classList.add('is-fall');
  statusTitle.textContent = 'Fall detect hua';
  statusDetail.textContent = 'Sudden movement detect hui. Ab inactivity monitor ho rahi hai.';
  statusIcon.textContent = '!';
  setDeviceState(sensorState, 'Fall detected', true);
  setDeviceState(ledState, 'Standby');
  updateActivity('Sudden movement / fall');
  timerCopy.textContent = 'Movement wapas aaye to countdown cancel ho jayega.';

  const updateCountdown = () => {
    if (state !== 'fall') return;
    const elapsed = Math.floor((Date.now() - fallDetectedAt) / 1000);
    const remaining = Math.max(0, ALERT_DELAY_SECONDS - elapsed);
    timerDisplay.innerHTML = `${remaining}<span> SEC</span>`;
    progressFill.style.width = `${(elapsed / ALERT_DELAY_SECONDS) * 100}%`;
    if (remaining === 0) triggerEmergencyAlert();
  };

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 200);
}

function disconnectSensor() {
  if (!sensorConnected) return;
  sensorConnected = false;
  clearCountdown();
  stopBuzzer();
  state = 'disconnected';
  document.body.classList.remove('is-fall', 'is-alert', 'is-moving');
  document.body.classList.add('is-disconnected');
  statusTitle.textContent = 'Sensor disconnected!';
  statusDetail.textContent = 'Sensor connection lost — monitoring unavailable. Buzzer alert active hai.';
  statusIcon.textContent = '!';
  setDeviceState(sensorState, 'Disconnected', true);
  setDeviceState(ledState, 'Connection lost', true);
  timerCopy.textContent = 'Sensor reconnect hone tak monitoring ruk gayi hai.';
  timerDisplay.innerHTML = 'ERR<span> SENSOR</span>';
  progressFill.style.width = '100%';
  updateActivity('Sensor disconnected');
  soundBuzzer();
}

function connectSensor() {
  if (sensorConnected) return;
  sensorConnected = true;
  setSafeState('Sensor dobara connect hua — monitoring resume ho gayi.');
  statusTitle.textContent = 'Sensor connected';
  statusDetail.textContent = 'Sensor connection restore hui. System monitoring ke liye ready hai.';
  statusIcon.textContent = '✓';
  updateActivity('Sensor connected');
  soundConnectionChime();
}

const cameraButton = document.getElementById('cameraButton');
const cameraStatus = document.getElementById('cameraStatus');
const webcamPreview = document.getElementById('webcamPreview');
const cameraPreview = document.getElementById('cameraPreview');

async function startWebcamMonitor() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = 'Is browser mein webcam access available nahi hai. HTTPS ya localhost par kholen.';
    return;
  }

  prepareAudio();
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcamVideo = webcamPreview;
    webcamVideo.srcObject = webcamStream;
    await webcamVideo.play();
    cameraPreview.classList.add('camera-active');
    cameraButton.setAttribute('aria-pressed', 'true');

    webcamCanvas = document.createElement('canvas');
    webcamContext = webcamCanvas.getContext('2d', { willReadFrequently: true });
    previousFrame = null;
    lastFrameSampleAt = 0;
    cameraButton.querySelector('strong').textContent = 'Stop Camera';
    cameraStatus.textContent = 'Webcam active hai. Motion monitor ho rahi hai.';
    webcamFrameId = requestAnimationFrame(checkWebcamMotion);
  } catch (error) {
    stopWebcamMonitor();
    cameraStatus.textContent = error.name === 'NotAllowedError'
      ? 'Camera permission nahi mili. Browser settings mein camera access allow karein.'
      : 'Webcam start nahi ho paya. Camera connection aur permission check karein.';
  }
}

function stopWebcamMonitor() {
  if (webcamFrameId !== null) cancelAnimationFrame(webcamFrameId);
  webcamFrameId = null;
  if (webcamStream) webcamStream.getTracks().forEach((track) => track.stop());
  webcamStream = null;
  if (webcamPreview) webcamPreview.srcObject = null;
  webcamVideo = null;
  webcamCanvas = null;
  webcamContext = null;
  previousFrame = null;
  cameraPreview.classList.remove('camera-active');
  cameraButton.setAttribute('aria-pressed', 'false');
  cameraButton.querySelector('strong').textContent = 'Start Camera';
  cameraStatus.textContent = 'Webcam monitoring band hai.';
}

function checkWebcamMotion() {
  if (!webcamVideo || !webcamContext || webcamVideo.readyState < 2) {
    webcamFrameId = requestAnimationFrame(checkWebcamMotion);
    return;
  }

  const now = performance.now();
  if (now - lastFrameSampleAt < MOTION_SAMPLE_INTERVAL_MS) {
    webcamFrameId = requestAnimationFrame(checkWebcamMotion);
    return;
  }
  lastFrameSampleAt = now;

  const width = 96;
  const height = 72;
  webcamCanvas.width = width;
  webcamCanvas.height = height;
  webcamContext.drawImage(webcamVideo, 0, 0, width, height);
  const pixels = webcamContext.getImageData(0, 0, width, height).data;
  let changedPixels = 0;
  let sampledPixels = 0;

  if (previousFrame) {
    for (let i = 0; i < pixels.length; i += 4) {
      const currentGray = (pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114);
      const previousGray = (previousFrame[i] * 0.299) + (previousFrame[i + 1] * 0.587) + (previousFrame[i + 2] * 0.114);
      if (Math.abs(currentGray - previousGray) > MOTION_PIXEL_THRESHOLD) changedPixels++;
      sampledPixels++;
    }

    if (changedPixels / sampledPixels > MOTION_RATIO_THRESHOLD) {
      notifyWebcamMotion();
    }
  }

  previousFrame = new Uint8ClampedArray(pixels);
  webcamFrameId = requestAnimationFrame(checkWebcamMotion);
}

function notifyWebcamMotion() {
  const now = Date.now();
  if (now - lastMotionNotificationAt < MOTION_NOTIFICATION_COOLDOWN_MS) return;
  lastMotionNotificationAt = now;
  cameraStatus.textContent = '⚠️ FALL DETECTED! PLEASE CHECK THE PERSON. Camera motion detected — possible fall, please verify.';
  playCameraAlarm();

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('⚠️ FALL DETECTED! PLEASE CHECK THE PERSON.', {
      body: 'Camera motion detected. This demo cannot confirm whether a person fell; please check the live preview.',
      tag: 'care-sync-motion'
    });
  } else {
    cameraStatus.textContent += ' Browser notification permission allow nahi hai.';
  }
}

cameraButton.addEventListener('click', () => {
  if (webcamStream) stopWebcamMonitor();
  else startWebcamMonitor();
});
window.addEventListener('beforeunload', () => {
  if (webcamStream) webcamStream.getTracks().forEach((track) => track.stop());
});

document.getElementById('fallButton').addEventListener('click', startFallDetection);
document.getElementById('movementButton').addEventListener('click', registerMovement);
document.getElementById('connectSensorButton').addEventListener('click', connectSensor);
document.getElementById('disconnectSensorButton').addEventListener('click', disconnectSensor);
document.getElementById('resetButton').addEventListener('click', () => {
  sensorConnected = true;
  activityTime.textContent = '--:--';
  activityText.textContent = 'Koi movement detect nahi hui';
  setSafeState();
});

setSafeState();
