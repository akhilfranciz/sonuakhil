const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Socket reconnected after', attemptNumber, 'attempts');
  if (roomId && localStream) {
    socket.emit('join-room', roomId, socket.id);
  }
});

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

if (!roomId) {
  window.location.href = '/';
}

document.getElementById('roomNumber').textContent = roomId;

const localVideo = document.getElementById('localVideo');
const videosGrid = document.getElementById('videosGrid');
const toggleVideoBtn = document.getElementById('toggleVideo');
const toggleAudioBtn = document.getElementById('toggleAudio');
const leaveCallBtn = document.getElementById('leaveCall');

let localStream;
let peers = {};
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// Initialize media
async function initMedia() {
  try {
    console.log('Requesting media access...');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    });
    
    console.log('Media access granted');
    localVideo.srcObject = localStream;
    console.log('Joining room:', roomId, 'with socket ID:', socket.id);
    socket.emit('join-room', roomId, socket.id);
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Please allow camera and microphone access to join the video chat');
  }
}

// Create peer connection
function createPeer(userId, initiator = false) {
  console.log(`Creating peer connection for ${userId}, initiator: ${initiator}`);
  const peer = new RTCPeerConnection(configuration);
  
  localStream.getTracks().forEach(track => {
    peer.addTrack(track, localStream);
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate to ${userId}`);
      socket.emit('signal', {
        to: userId,
        signal: { candidate: event.candidate }
      });
    }
  };

  peer.ontrack = (event) => {
    console.log(`Received track from ${userId}`);
    addVideoStream(userId, event.streams[0]);
  };

  peer.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${userId}: ${peer.iceConnectionState}`);
    if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
      console.log(`Connection issue with ${userId}, attempting to restart ICE`);
      peer.restartIce();
    }
  };

  peer.onnegotiationneeded = async () => {
    try {
      if (initiator) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit('signal', {
          to: userId,
          signal: { sdp: peer.localDescription }
        });
      }
    } catch (error) {
      console.error('Error during negotiation:', error);
    }
  };

  return peer;
}

// Add video stream to grid
function addVideoStream(userId, stream) {
  if (document.getElementById(`video-${userId}`)) {
    return;
  }

  const videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';
  videoWrapper.id = `wrapper-${userId}`;

  const video = document.createElement('video');
  video.id = `video-${userId}`;
  video.srcObject = stream;
  video.autoplay = true;
  video.playsinline = true;

  const label = document.createElement('span');
  label.className = 'video-label';
  label.textContent = `User ${userId.substring(0, 6)}`;

  videoWrapper.appendChild(video);
  videoWrapper.appendChild(label);
  videosGrid.appendChild(videoWrapper);
}

// Socket events
socket.on('existing-users', (users) => {
  console.log('Existing users in room:', users);
  users.forEach(userId => {
    const peer = createPeer(userId, true);
    peers[userId] = peer;
  });
});

socket.on('user-connected', async (userId) => {
  console.log('User connected:', userId);
  const peer = createPeer(userId, false);
  peers[userId] = peer;
});

socket.on('signal', async (data) => {
  const peer = peers[data.from];
  if (!peer) {
    console.warn(`Received signal from unknown peer: ${data.from}`);
    return;
  }

  try {
    if (data.signal.sdp) {
      // Check signaling state before setting remote description
      if (peer.signalingState !== 'stable' && data.signal.sdp.type === 'offer') {
        console.log('Collision detected, handling offer in non-stable state');
        await Promise.all([
          peer.setLocalDescription({ type: 'rollback' }),
          peer.setRemoteDescription(new RTCSessionDescription(data.signal.sdp))
        ]);
      } else {
        await peer.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
      }
      
      if (data.signal.sdp.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('signal', {
          to: data.from,
          signal: { sdp: peer.localDescription }
        });
      }
    } else if (data.signal.candidate) {
      if (peer.remoteDescription) {
        await peer.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
      } else {
        console.log('Queuing ICE candidate until remote description is set');
      }
    }
  } catch (error) {
    console.error('Error handling signal:', error, data);
  }
});

socket.on('user-disconnected', (userId) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  
  const videoWrapper = document.getElementById(`wrapper-${userId}`);
  if (videoWrapper) {
    videoWrapper.remove();
  }
});

// Controls
toggleVideoBtn.addEventListener('click', () => {
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    toggleVideoBtn.classList.toggle('active');
  }
});

toggleAudioBtn.addEventListener('click', () => {
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    toggleAudioBtn.classList.toggle('active');
  }
});

leaveCallBtn.addEventListener('click', () => {
  localStream.getTracks().forEach(track => track.stop());
  window.location.href = '/';
});

// Initialize
initMedia();
