// --- Config ---
const roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) window.location.href = '/';
document.getElementById('roomId').textContent = roomId;

const socket = io();
const peers = {};       // { oderId: RTCPeerConnection }
let localStream = null;

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

// --- Status ---
function setStatus(text, color) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = color || '#fff';
}

// --- Start ---
async function start() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
  } catch (err) {
    alert('Camera/mic access is required.');
    return;
  }

  socket.emit('join-room', roomId);
}

// --- Create a peer connection to a remote user ---
function createPeer(remoteId) {
  const pc = new RTCPeerConnection(iceConfig);

  // Add our tracks
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Send ICE candidates to remote
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { to: remoteId, candidate: e.candidate });
    }
  };

  // When we receive remote tracks, show them
  pc.ontrack = (e) => {
    if (!document.getElementById(`video-${remoteId}`)) {
      addRemoteVideo(remoteId, e.streams[0]);
    }
  };

  // Connection state logging
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE [${remoteId}]: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'connected') {
      setStatus('Connected ✓', '#4caf50');
    } else if (pc.iceConnectionState === 'failed') {
      console.log('ICE failed, restarting...');
      pc.restartIce();
    }
  };

  peers[remoteId] = pc;
  return pc;
}

// --- Add remote video element ---
function addRemoteVideo(id, stream) {
  const box = document.createElement('div');
  box.className = 'video-box';
  box.id = `box-${id}`;

  const video = document.createElement('video');
  video.id = `video-${id}`;
  video.srcObject = stream;
  video.autoplay = true;
  video.playsinline = true;

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = `User ${id.slice(0, 5)}`;

  box.appendChild(video);
  box.appendChild(label);
  document.getElementById('videos').appendChild(box);
}

// --- Remove remote video ---
function removeRemoteVideo(id) {
  const box = document.getElementById(`box-${id}`);
  if (box) box.remove();
  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }
}

// =====================
// Socket Events
// =====================

socket.on('connect', () => {
  setStatus('Connected to server', '#4caf50');
});

socket.on('connect_error', () => {
  setStatus('Connection error ✗', '#f44336');
});

// When we join, server sends list of existing users → we call each of them
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

// Someone sent us an offer → answer it
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

// We get an answer to our offer
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

// ICE candidate from remote
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

// User left
socket.on('user-left', (id) => {
  removeRemoteVideo(id);
});

// =====================
// Controls
// =====================

document.getElementById('toggleVideo').addEventListener('click', (e) => {
  const track = localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle('active', track.enabled);
    e.currentTarget.textContent = track.enabled ? '📹 Video' : '🚫 Video';
  }
});

document.getElementById('toggleAudio').addEventListener('click', (e) => {
  const track = localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle('active', track.enabled);
    e.currentTarget.textContent = track.enabled ? '🎤 Audio' : '🔇 Audio';
  }
});

document.getElementById('leaveCall').addEventListener('click', () => {
  localStream.getTracks().forEach((t) => t.stop());
  Object.values(peers).forEach((pc) => pc.close());
  socket.disconnect();
  window.location.href = '/';
});

// Start everything
start();
