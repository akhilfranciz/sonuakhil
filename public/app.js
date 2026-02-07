// --- Config ---
const roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) window.location.href = '/';
document.getElementById('roomId').textContent = roomId;

const socket = io();
const peers = {};
let localStream = null;
let isSwapped = false;

const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:relay1.expressturn.com:443',
      username: 'efCZCUAFI7KIQFHIUO',
      credential: 'XhKxIrNHnMPMlkFt'
    },
    {
      urls: 'turn:relay.metered.ca:80',
      username: 'c420cc96b4dc264abfdd',
      credential: 'nZB0PfXtL4fBdULy'
    },
    {
      urls: 'turn:relay.metered.ca:443',
      username: 'c420cc96b4dc264abfdd',
      credential: 'nZB0PfXtL4fBdULy'
    },
    {
      urls: 'turn:relay.metered.ca:443?transport=tcp',
      username: 'c420cc96b4dc264abfdd',
      credential: 'nZB0PfXtL4fBdULy'
    }
  ]
};

// --- DOM ---
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const waitingText = document.getElementById('waitingText');
const callScreen = document.querySelector('.call-screen');

// --- Status ---
function setStatus(text, color) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = color || '#8696a0';
}

// --- Swap videos ---
function swapVideos() {
  isSwapped = !isSwapped;
  callScreen.classList.toggle('swapped', isSwapped);
}

// --- Start ---
async function start() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert('Camera/mic access is required.');
    return;
  }
  socket.emit('join-room', roomId);
}

// --- Create peer connection ---
function createPeer(remoteId) {
  const pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { to: remoteId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    waitingText.classList.add('hidden');
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE [${remoteId}]: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'connected') {
      setStatus('Connected ✓', '#00a884');
    } else if (pc.iceConnectionState === 'failed') {
      pc.restartIce();
    } else if (pc.iceConnectionState === 'disconnected') {
      setStatus('Reconnecting...', '#f59f00');
    }
  };

  peers[remoteId] = pc;
  return pc;
}

// --- Remove peer ---
function removePeer(id) {
  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }
  // If no peers left, show waiting text & clear remote video
  if (Object.keys(peers).length === 0) {
    remoteVideo.srcObject = null;
    waitingText.classList.remove('hidden');
    setStatus('Waiting...', '#8696a0');
    // Reset swap
    isSwapped = false;
    callScreen.classList.remove('swapped');
  }
}

// =====================
// Socket Events
// =====================

socket.on('connect', () => {
  setStatus('Connected', '#00a884');
});

socket.on('connect_error', () => {
  setStatus('Connection error ✗', '#ea0038');
});

socket.on('all-users', async (userIds) => {
  for (const id of userIds) {
    const pc = createPeer(id);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: id, sdp: pc.localDescription });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }
});

socket.on('offer', async (data) => {
  const pc = createPeer(data.from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: data.from, sdp: pc.localDescription });
  } catch (err) {
    console.error('Error handling offer:', err);
  }
});

socket.on('answer', async (data) => {
  const pc = peers[data.from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (err) {
      console.error('Error setting answer:', err);
    }
  }
});

socket.on('ice-candidate', async (data) => {
  const pc = peers[data.from];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

socket.on('user-left', (id) => {
  removePeer(id);
});

// =====================
// Controls
// =====================

// Swap button
document.getElementById('swapBtn').addEventListener('click', swapVideos);

// Tap small video to swap
document.getElementById('smallVideoWrap').addEventListener('click', swapVideos);

// In swapped mode, tapping the big video (now in PiP position) also swaps back
document.getElementById('bigVideoWrap').addEventListener('click', () => {
  if (isSwapped) swapVideos();
});

// Toggle video
document.getElementById('toggleVideo').addEventListener('click', (e) => {
  const track = localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle('active', track.enabled);
  }
});

// Toggle audio
document.getElementById('toggleAudio').addEventListener('click', (e) => {
  const track = localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle('active', track.enabled);
  }
});

// Leave / End call
function leaveCall() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  Object.values(peers).forEach((pc) => pc.close());
  socket.disconnect();
  window.location.href = '/';
}

document.getElementById('endCall').addEventListener('click', leaveCall);
document.getElementById('leaveCall').addEventListener('click', leaveCall);

// Start
start();
