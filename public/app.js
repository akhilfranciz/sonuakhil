const socket = io();
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
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize media
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    });
    
    localVideo.srcObject = localStream;
    socket.emit('join-room', roomId, socket.id);
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Please allow camera and microphone access to join the video chat');
  }
}

// Create peer connection
function createPeer(userId, initiator = false) {
  const peer = new RTCPeerConnection(configuration);
  
  localStream.getTracks().forEach(track => {
    peer.addTrack(track, localStream);
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        to: userId,
        signal: { candidate: event.candidate }
      });
    }
  };

  peer.ontrack = (event) => {
    addVideoStream(userId, event.streams[0]);
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
  users.forEach(userId => {
    const peer = createPeer(userId, true);
    peers[userId] = peer;
  });
});

socket.on('user-connected', async (userId) => {
  const peer = createPeer(userId, false);
  peers[userId] = peer;
});

socket.on('signal', async (data) => {
  const peer = peers[data.from];
  if (!peer) return;

  try {
    if (data.signal.sdp) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
      
      if (data.signal.sdp.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('signal', {
          to: data.from,
          signal: { sdp: peer.localDescription }
        });
      }
    } else if (data.signal.candidate) {
      await peer.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
    }
  } catch (error) {
    console.error('Error handling signal:', error);
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
