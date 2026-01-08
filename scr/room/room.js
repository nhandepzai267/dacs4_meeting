const API_URL = 'http://localhost:5000';

// Get room code from URL
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('code');

// Check authentication
const token = localStorage.getItem('token');
const userEmail = localStorage.getItem('userEmail');

if (!token || !userEmail) {
  window.location.href = '../auth/login.html';
}

if (!roomCode) {
  alert('Không tìm thấy mã phòng!');
  window.location.href = '../../index.html';
}

// Display room info
document.getElementById('roomCode').textContent = roomCode;
document.getElementById('shareCode').textContent = roomCode;
document.getElementById('userEmail').textContent = userEmail;

// WebRTC variables
let localStream = null;
let isMicOn = true;
let isCamOn = true;
let isScreenSharing = false;
let meetingStartTime = Date.now();

// DOM elements
const localVideo = document.getElementById('localVideo');
const micToggle = document.getElementById('micToggle');
const camToggle = document.getElementById('camToggle');
const screenToggle = document.getElementById('screenToggle');
const chatToggle = document.getElementById('chatToggle');
const endCall = document.getElementById('endCall');
const leaveBtn = document.getElementById('leaveBtn');
const chatSidebar = document.getElementById('chatSidebar');
const closeChat = document.getElementById('closeChat');
const chatInput = document.getElementById('chatInput');
const sendMessage = document.getElementById('sendMessage');
const chatMessages = document.getElementById('chatMessages');
const fileInput = document.getElementById('fileInput');
const attachFileBtn = document.getElementById('attachFileBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const shareCopyBtn = document.getElementById('shareCopyBtn');
const participantsToggle = document.getElementById('participantsToggle');
const participantsSidebar = document.getElementById('participantsSidebar');
const closeParticipants = document.getElementById('closeParticipants');
const participantsList = document.getElementById('participantsList');
const recordToggle = document.getElementById('recordToggle');

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
    
    // Update mic status
    updateMicStatus();
    
    // Set local avatar text
    const localAvatarText = document.getElementById('localAvatarText');
    if (localAvatarText && userEmail) {
      const name = userEmail.split('@')[0];
      localAvatarText.textContent = getInitials(name);
    }
    
    // Không tắt waiting message ở đây nữa - chỉ tắt khi có người khác tham gia
  } catch (error) {
    console.error('Lỗi truy cập media:', error);
    alert('Không thể truy cập camera/microphone. Vui lòng cho phép quyền truy cập.');
  }
}

// Hide waiting message
function hideWaitingMessage() {
  const waitingMsg = document.getElementById('waitingMessage');
  if (waitingMsg) {
    waitingMsg.classList.add('hidden');
  }
}

// Check if should hide waiting message based on participant count
function checkWaitingMessage() {
  if (participants.length >= 2) {
    hideWaitingMessage();
  }
}

// Toggle microphone
micToggle.onclick = () => {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isMicOn = audioTrack.enabled;
      micToggle.classList.toggle('active', isMicOn);
      updateMicStatus();
    }
  }
};

// Toggle camera
camToggle.onclick = () => {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isCamOn = videoTrack.enabled;
      camToggle.classList.toggle('active', isCamOn);
    }
  }
};

// Screen share
let screenStream = null;

// Screen recording
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

screenToggle.onclick = async () => {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always'
        },
        audio: true
      });
      
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // Replace video track in peer connections with screen
      peerConnections.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
      });
      
      // Show screen share layout
      isScreenSharing = true;
      screenToggle.classList.add('active');
      enableScreenShareLayout(screenStream);
      
      // Notify others
      if (socket && socket.connected) {
        socket.emit('screen-share-started', { roomCode });
      }
      
      // Stop sharing when user stops from browser
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (error) {
      console.error('Lỗi chia sẻ màn hình:', error);
    }
  } else {
    stopScreenShare();
  }
};

function stopScreenShare() {
  if (isScreenSharing) {
    // Stop screen stream
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    
    // Restore camera track in peer connections
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      peerConnections.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      });
    }
    
    isScreenSharing = false;
    screenToggle.classList.remove('active');
    disableScreenShareLayout();
    
    // Notify others
    if (socket && socket.connected) {
      socket.emit('screen-share-stopped', { roomCode });
    }
  }
}

// Enable screen share layout
function enableScreenShareLayout(stream) {
  const videoGrid = document.getElementById('videoGrid');
  
  // Save current video wrappers
  const videoWrappers = Array.from(videoGrid.querySelectorAll('.video-wrapper'));
  
  // Clear and add screen-sharing class
  videoGrid.innerHTML = '';
  videoGrid.classList.add('screen-sharing');
  
  // Create screen share container (LEFT SIDE) - Shows SCREEN content
  const screenShareMain = document.createElement('div');
  screenShareMain.className = 'screen-share-main';
  screenShareMain.id = 'screenShareMain';
  screenShareMain.innerHTML = `
    <div class="screen-share-indicator">
      <span class="material-symbols-outlined">screen_share</span>
      Đang chia sẻ màn hình
    </div>
    <video id="screenShareVideo" autoplay playsinline muted></video>
  `;
  
  // Create sidebar for participant videos (RIGHT SIDE) - Shows CAMERA
  const sidebar = document.createElement('div');
  sidebar.className = 'screen-share-sidebar';
  sidebar.id = 'screenShareSidebar';
  
  // Move all video wrappers to sidebar (including your camera)
  videoWrappers.forEach(wrapper => {
    sidebar.appendChild(wrapper);
  });
  
  // Add participant count class for dynamic sizing
  const participantCount = videoWrappers.length;
  sidebar.classList.add(`participants-${Math.min(participantCount, 9)}`);
  
  // Add to grid: MAIN (left) then SIDEBAR (right)
  videoGrid.appendChild(screenShareMain);
  videoGrid.appendChild(sidebar);
  
  // Set screen share video source to SCREEN stream (not camera)
  setTimeout(() => {
    const screenShareVideo = document.getElementById('screenShareVideo');
    if (screenShareVideo && stream) {
      screenShareVideo.srcObject = stream;
      console.log('Screen share video set to screen stream');
    }
  }, 100);
}

// Disable screen share layout
function disableScreenShareLayout() {
  const videoGrid = document.getElementById('videoGrid');
  videoGrid.classList.remove('screen-sharing');
  
  // Get all video wrappers from sidebar
  const sidebar = document.getElementById('screenShareSidebar');
  if (sidebar) {
    const videoWrappers = Array.from(sidebar.querySelectorAll('.video-wrapper'));
    
    // Clear grid and restore normal layout
    videoGrid.innerHTML = '';
    videoWrappers.forEach(wrapper => {
      videoGrid.appendChild(wrapper);
    });
  }
  
  updateVideoGridLayout();
}

// Update mic status icon
function updateMicStatus() {
  const micStatus = document.getElementById('localMicStatus');
  if (micStatus) {
    micStatus.innerHTML = isMicOn ? 
      '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' : 
      '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>';
  }
}

// Participants management
let participants = [
  {
    id: 'local',
    name: 'Bạn',
    email: userEmail,
    isMicOn: true,
    isCamOn: true,
    isLocal: true
  }
];

// Participants toggle
participantsToggle.onclick = () => {
  // Close chat if open
  chatSidebar.classList.remove('open');
  participantsSidebar.classList.toggle('open');
};

closeParticipants.onclick = () => {
  participantsSidebar.classList.remove('open');
};

// Update participants list UI
function updateParticipantsList() {
  participantsList.innerHTML = '';
  
  participants.forEach(participant => {
    const item = document.createElement('div');
    item.className = 'participant-item';
    
    // Get first letter for avatar
    const initial = participant.name.charAt(0).toUpperCase();
    
    item.innerHTML = `
      <div class="participant-avatar">${initial}</div>
      <div class="participant-info">
        <div class="name">${participant.name}</div>
        <div class="email">${participant.email}</div>
      </div>
      <div class="participant-actions">
        <div class="participant-status">
          ${!participant.isLocal ? `<span class="chat-icon-wrapper"><button class="private-chat-btn" data-id="${participant.id}" data-name="${participant.name}" title="Chat riêng"><svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg></button></span>` : '<span class="chat-icon-wrapper"></span>'}
          <span class="mic-icon-wrapper">${participant.isMicOn ? 
            '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' : 
            '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>'
          }</span>
          <span class="cam-icon-wrapper">${participant.isCamOn ? 
            '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>' : 
            '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82l-3.28-3.28c.46-.17.96-.27 1.46-.27h8c1.1 0 2 .9 2 2v.5l4-4v11zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>'
          }</span>
        </div>
      </div>
    `;
    
    participantsList.appendChild(item);
  });
  
  // Add event listeners for private chat buttons
  document.querySelectorAll('.private-chat-btn').forEach(btn => {
    btn.onclick = () => {
      const userId = btn.getAttribute('data-id');
      const userName = btn.getAttribute('data-name');
      openPrivateChat(userId, userName);
    };
  });
  
  // Update participant count
  const count = participants.length;
  document.getElementById('participantCount').textContent = count;
  document.getElementById('participantCountText').textContent = count;
  
  // Check if should hide waiting message
  checkWaitingMessage();
}

// Chat toggle
chatToggle.onclick = () => {
  // Close participants if open
  participantsSidebar.classList.remove('open');
  chatSidebar.classList.toggle('open');
};

closeChat.onclick = () => {
  chatSidebar.classList.remove('open');
};

// Send message function (will be overridden later with Socket.IO)

// Add chat message to UI
function addChatMessage(sender, message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  const time = new Date().toLocaleTimeString('vi-VN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  messageDiv.innerHTML = `
    <div class="message-sender">${sender}</div>
    <div class="message-content">${message}</div>
    <div class="message-time">${time}</div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Copy room code
function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    alert('Đã copy mã phòng!');
  }).catch(err => {
    console.error('Lỗi copy:', err);
  });
}

copyCodeBtn.onclick = copyRoomCode;
shareCopyBtn.onclick = copyRoomCode;

// End call / Leave room
function leaveRoom() {
  if (confirm('Bạn có chắc muốn rời phòng?')) {
    // Stop all tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    // Clear room from localStorage
    localStorage.removeItem('currentRoom');
    
    // Clear private messages for this room
    clearPrivateMessages();
    console.log('🗑️ Private messages cleared');
    
    // Redirect to home
    window.location.href = '../../index.html';
  }
}

endCall.onclick = leaveRoom;
leaveBtn.onclick = leaveRoom;

// Meeting timer
function updateMeetingTime() {
  const elapsed = Date.now() - meetingStartTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('meetingTime').textContent = timeStr;
}

setInterval(updateMeetingTime, 1000);

// Update video grid layout based on participant count
function updateVideoGridLayout() {
  const videoGrid = document.querySelector('.video-grid');
  const participantCount = videoGrid.querySelectorAll('.video-wrapper').length;
  
  // Remove all participant classes
  videoGrid.className = 'video-grid';
  
  // Add appropriate class based on count
  if (participantCount <= 9) {
    videoGrid.classList.add(`participants-${participantCount}`);
  }
}

// Update mic/cam status in participants list
function updateLocalParticipantStatus() {
  const localParticipant = participants.find(p => p.isLocal);
  if (localParticipant) {
    localParticipant.isMicOn = isMicOn;
    localParticipant.isCamOn = isCamOn;
    updateParticipantsList();
  }
}

// Override mic toggle to update participants
const originalMicToggle = micToggle.onclick;
micToggle.onclick = () => {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isMicOn = audioTrack.enabled;
      micToggle.classList.toggle('active', isMicOn);
      updateMicStatus();
      updateLocalParticipantStatus();
      
      // Notify other users about media status change
      if (socket && socket.connected) {
        socket.emit('media-status-change', {
          roomCode,
          isMicOn,
          isCamOn
        });
      }
    }
  }
};

// Override cam toggle to update participants
const originalCamToggle = camToggle.onclick;
camToggle.onclick = () => {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isCamOn = videoTrack.enabled;
      camToggle.classList.toggle('active', isCamOn);
      updateLocalParticipantStatus();
      
      // Toggle local video placeholder
      const localPlaceholder = document.getElementById('localPlaceholder');
      if (isCamOn) {
        localVideo.style.display = 'block';
        localPlaceholder.style.display = 'none';
      } else {
        localVideo.style.display = 'none';
        localPlaceholder.style.display = 'flex';
      }
      
      // Notify other users about media status change
      if (socket && socket.connected) {
        socket.emit('media-status-change', {
          roomCode,
          isMicOn,
          isCamOn
        });
      }
    }
  }
};

// Socket.IO connection
let socket = null;
const peerConnections = new Map(); // socketId -> RTCPeerConnection

// ICE servers configuration
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize Socket.IO connection
function initSocketIO() {
  console.log('Connecting to Socket.IO server...');
  socket = io(API_URL);
  
  socket.on('connect', () => {
    console.log('Socket.IO connected! Socket ID:', socket.id);
    // Join room after connection
    socket.emit('join-room', { roomCode, userEmail });
    console.log('Joining room:', roomCode, 'as', userEmail);
  });
  
  socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error);
  });
  
  socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
  });

  // Handle existing users in room
  socket.on('room-users', (users) => {
    console.log('Users in room:', users);
    users.forEach(user => {
      if (user.socketId !== socket.id) {
        addRemoteParticipant(user.socketId, user.email);
      }
    });
  });
  // Three-way handsake
  // Handle new user joined
  socket.on('user-joined', async ({ socketId, email }) => {
    console.log('User joined:', email);
    addRemoteParticipant(socketId, email);
    
    // Create offer for new user
    const pc = createPeerConnection(socketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', { offer, to: socketId });
  });

  // Handle user left
  socket.on('user-left', ({ socketId, email }) => {
    console.log('User left:', email);
    removeRemoteParticipant(socketId);
  });

  // Handle WebRTC offer
  socket.on('offer', async ({ offer, from }) => {
    const pc = createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', { answer, to: from });
  });

  // Handle WebRTC answer
  socket.on('answer', async ({ answer, from }) => {
    const pc = peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  // Handle ICE candidate
  socket.on('ice-candidate', async ({ candidate, from }) => {
    const pc = peerConnections.get(from);
    if (pc && candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  // Handle moderation warning from server
  socket.on('moderation-warning', ({ message, timestamp }) => {
    console.log('🚫 Moderation warning received:', message);
    showModerationWarning(message);
    
    // Add to chat as system message
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system-message';
    
    const time = new Date(timestamp).toLocaleTimeString('vi-VN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
      <div class="message-sender">🛡️ Hệ thống</div>
      <div class="message-content system-warning">${message}</div>
      <div class="message-time">${time}</div>
    `;
    
    messageDiv.style.cssText = `
      border-left: 4px solid #ff4444;
      background: rgba(255, 68, 68, 0.1);
      margin: 8px 0;
      padding: 8px 12px;
      border-radius: 4px;
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // Handle chat message from server
  socket.on('chat-message', ({ message, sender, timestamp }) => {
    if (sender !== userEmail) {
      addChatMessage(sender, message);
      
      // Show notification if chat is not open
      if (!chatSidebar.classList.contains('open')) {
        showNotification('💬', sender, message, 'chat');
      }
    }
  });

  // Handle file message from server
  socket.on('file-message', ({ fileName, fileSize, fileData, fileType, sender }) => {
    console.log('📎 File message received!');
    console.log('  File:', fileName);
    console.log('  Size:', fileSize);
    console.log('  Sender:', sender);
    console.log('  My email:', userEmail);
    
    if (sender !== userEmail) {
      console.log('✅ Adding file to chat');
      addFileMessage(sender, fileName, fileSize, fileData, fileType);
      
      // Show notification if chat is not open
      if (!chatSidebar.classList.contains('open')) {
        showNotification('📎', sender, `Đã gửi file: ${fileName}`, 'file');
      }
    } else {
      console.log('⏭️ Skipping (own file)');
    }
  });

  // Handle private message
  socket.on('private-message', ({ from, message, sender }) => {
    console.log('📩 Private message received!');
    console.log('  From socketId:', from);
    console.log('  Sender:', sender);
    console.log('  Message:', message);
    console.log('  Current private chat user:', currentPrivateChatUser);
    
    // If private chat with this user is open, add to private chat
    if (currentPrivateChatUser && currentPrivateChatUser.id === from) {
      console.log('✅ Adding to open private chat');
      addPrivateChatMessage(sender, message, false, true);
    } else {
      // Show notification
      const senderName = sender.split('@')[0];
      showNotification('💬', `${senderName} (riêng)`, message, 'private');
      
      // Show notification in main chat
      console.log('📢 Showing in main chat');
      addChatMessage('� o' + sender, message);
      
      // Auto-open private chat if not open
      console.log('🔔 Auto-opening private chat with:', senderName);
      openPrivateChat(from, senderName);
      addPrivateChatMessage(sender, message, false, true);
    }
  });

  // Handle media status change from other users
  socket.on('media-status-changed', ({ socketId, isMicOn, isCamOn }) => {
    console.log('Media status changed:', socketId, 'mic:', isMicOn, 'cam:', isCamOn);
    
    // Update video visibility
    const videoElement = document.getElementById(`video-element-${socketId}`);
    const placeholder = document.getElementById(`placeholder-${socketId}`);
    
    if (videoElement && placeholder) {
      if (isCamOn) {
        videoElement.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        videoElement.style.display = 'none';
        placeholder.style.display = 'flex';
      }
    }
    
    // Update participant list
    const participant = participants.find(p => p.id === socketId);
    if (participant) {
      participant.isMicOn = isMicOn;
      participant.isCamOn = isCamOn;
      updateParticipantsList();
    }
  });

  // Handle screen share started by other user
  socket.on('screen-share-started', ({ socketId }) => {
    console.log('🖥️ Screen share started by:', socketId);
    console.log('Current video wrappers:', document.querySelectorAll('.video-wrapper'));
    enableRemoteScreenShareLayout(socketId);
  });

  // Handle screen share stopped by other user
  socket.on('screen-share-stopped', ({ socketId }) => {
    console.log('Screen share stopped by:', socketId);
    disableScreenShareLayout();
  });
}

// Enable screen share layout for remote user
function enableRemoteScreenShareLayout(socketId) {
  console.log('Enabling remote screen share layout for:', socketId);
  const videoGrid = document.getElementById('videoGrid');
  
  // Find the video wrapper of the sharing user
  const sharingWrapper = document.getElementById(`video-${socketId}`);
  console.log('Sharing wrapper found:', sharingWrapper);
  
  if (!sharingWrapper) {
    console.error('Sharing wrapper not found for socketId:', socketId);
    return;
  }
  
  // Save current video wrappers
  const videoWrappers = Array.from(videoGrid.querySelectorAll('.video-wrapper'));
  
  // Sort wrappers: sharing user first, then others
  const sortedWrappers = [];
  const sharingIndex = videoWrappers.indexOf(sharingWrapper);
  if (sharingIndex !== -1) {
    sortedWrappers.push(sharingWrapper);
    videoWrappers.forEach((wrapper, index) => {
      if (index !== sharingIndex) {
        sortedWrappers.push(wrapper);
      }
    });
  } else {
    sortedWrappers.push(...videoWrappers);
  }
  
  // Clear and add screen-sharing class
  videoGrid.innerHTML = '';
  videoGrid.classList.add('screen-sharing');
  
  // Create screen share container (LEFT SIDE)
  const screenShareMain = document.createElement('div');
  screenShareMain.className = 'screen-share-main';
  screenShareMain.id = 'screenShareMain';
  
  const participant = participants.find(p => p.id === socketId);
  const name = participant ? participant.name : 'User';
  
  screenShareMain.innerHTML = `
    <div class="screen-share-indicator">
      <span class="material-symbols-outlined">screen_share</span>
      ${name} đang chia sẻ màn hình
    </div>
    <video id="screenShareVideo" autoplay playsinline></video>
  `;
  
  // Create sidebar for participant videos (RIGHT SIDE)
  const sidebar = document.createElement('div');
  sidebar.className = 'screen-share-sidebar';
  sidebar.id = 'screenShareSidebar';
  
  // Move sorted video wrappers to sidebar (sharing user first)
  sortedWrappers.forEach(wrapper => {
    sidebar.appendChild(wrapper);
  });
  
  // Add participant count class for dynamic sizing
  const participantCount = sortedWrappers.length;
  sidebar.classList.add(`participants-${Math.min(participantCount, 9)}`);
  
  // Add to grid: MAIN (left) then SIDEBAR (right)
  videoGrid.appendChild(screenShareMain);
  videoGrid.appendChild(sidebar);
  
  // Set screen share video source (SCREEN content, not camera)
  setTimeout(() => {
    const screenShareVideo = document.getElementById('screenShareVideo');
    const sharingVideo = sharingWrapper.querySelector('video');
    console.log('Setting screen share video:', screenShareVideo, sharingVideo);
    
    if (screenShareVideo && sharingVideo && sharingVideo.srcObject) {
      // Clone the stream to show screen in main area
      screenShareVideo.srcObject = sharingVideo.srcObject;
      console.log('✅ Screen share video source set successfully');
      
      // Note: The camera video in sidebar will show screen too because
      // the peer connection replaced the video track with screen track.
      // This is expected behavior - we can't separate them without
      // sending 2 separate streams (which requires more complex setup)
    } else {
      console.error('❌ Failed to set screen share video source');
    }
  }, 100);
}

// Create peer connection
function createPeerConnection(socketId) {
  const pc = new RTCPeerConnection(iceServers);
  
  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        to: socketId
      });
    }
  };
  
  // Handle remote stream
  pc.ontrack = (event) => {
    console.log('Received remote track from:', socketId);
    addRemoteVideo(socketId, event.streams[0]);
  };
  
  peerConnections.set(socketId, pc);
  return pc;
}

// Add remote participant to list
function addRemoteParticipant(socketId, email) {
  const existing = participants.find(p => p.id === socketId);
  if (!existing) {
    participants.push({
      id: socketId,
      name: email.split('@')[0],
      email: email,
      isMicOn: true,
      isCamOn: true,
      isLocal: false
    });
    updateParticipantsList();
    
    // Check if should hide waiting message
    checkWaitingMessage();
  }
}

// Remove remote participant
function removeRemoteParticipant(socketId) {
  // Remove from participants list
  participants = participants.filter(p => p.id !== socketId);
  updateParticipantsList();
  
  // Close peer connection
  const pc = peerConnections.get(socketId);
  if (pc) {
    pc.close();
    peerConnections.delete(socketId);
  }
  
  // Remove video element
  const videoWrapper = document.getElementById(`video-${socketId}`);
  if (videoWrapper) {
    videoWrapper.remove();
    updateVideoGridLayout();
  }
}

// Add remote video to grid
function addRemoteVideo(socketId, stream) {
  // Check if video already exists
  let videoWrapper = document.getElementById(`video-${socketId}`);
  
  if (!videoWrapper) {
    const videoGrid = document.getElementById('videoGrid');
    videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.id = `video-${socketId}`;
    
    const participant = participants.find(p => p.id === socketId);
    const name = participant ? participant.name : 'User';
    const initials = getInitials(name);
    
    videoWrapper.innerHTML = `
      <video autoplay playsinline id="video-element-${socketId}"></video>
      <div class="video-placeholder" id="placeholder-${socketId}">
        <div class="avatar-circle">
          <span class="avatar-text">${initials}</span>
        </div>
      </div>
      <div class="video-overlay">
        <span class="participant-name">${name}</span>
        <div class="video-status">
          <span class="mic-status">
            <svg width="16" height="16" fill="white" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </span>
        </div>
      </div>
    `;
    
    videoGrid.appendChild(videoWrapper);
    updateVideoGridLayout();
  }
  
  const video = videoWrapper.querySelector('video');
  const placeholder = videoWrapper.querySelector('.video-placeholder');
  
  video.srcObject = stream;
  
  // Function to check and update video visibility
  function updateVideoVisibility() {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && videoTrack.enabled && videoTrack.readyState === 'live') {
      video.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      video.style.display = 'none';
      placeholder.style.display = 'flex';
    }
  }
  
  // Initial check
  updateVideoVisibility();
  
  // Monitor video track changes
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    // Check when video starts playing
    video.onloadedmetadata = () => {
      updateVideoVisibility();
    };
    
    // Monitor track enabled/disabled
    const checkInterval = setInterval(() => {
      if (!document.getElementById(`video-${socketId}`)) {
        clearInterval(checkInterval);
        return;
      }
      updateVideoVisibility();
    }, 500);
    
    videoTrack.onended = () => {
      video.style.display = 'none';
      placeholder.style.display = 'flex';
    };
    
    videoTrack.onmute = () => {
      video.style.display = 'none';
      placeholder.style.display = 'flex';
    };
    
    videoTrack.onunmute = () => {
      updateVideoVisibility();
    };
  } else {
    // No video track, show placeholder
    video.style.display = 'none';
    placeholder.style.display = 'flex';
  }
}

// Get initials from name (3 characters)
function getInitials(name) {
  if (!name) return 'USR';
  const cleaned = name.trim().toUpperCase();
  if (cleaned.length <= 3) return cleaned;
  
  // If has spaces, take first letter of each word
  const words = cleaned.split(' ');
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => w[0]).join('');
  }
  
  // Otherwise take first 3 characters
  return cleaned.substring(0, 3);
}

// File attachment
attachFileBtn.onclick = () => {
  fileInput.click();
};

fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    alert('File quá lớn! Tối đa 10MB');
    return;
  }
  
  console.log('📎 Sending file:', file.name, file.size, 'bytes');
  
  // Read file as base64
  const reader = new FileReader();
  reader.onload = () => {
    const fileData = reader.result;
    
    // Add to UI
    addFileMessage('Bạn', file.name, file.size, fileData, file.type);
    
    // Send via Socket.IO
    if (socket && socket.connected) {
      socket.emit('file-message', {
        roomCode,
        fileName: file.name,
        fileSize: file.size,
        fileData: fileData,
        fileType: file.type,
        sender: userEmail
      });
      console.log('✅ File sent');
    }
  };
  reader.readAsDataURL(file);
  
  // Reset input
  fileInput.value = '';
};

// Add file message to chat
function addFileMessage(sender, fileName, fileSize, fileData, fileType) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  const time = new Date().toLocaleTimeString('vi-VN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  // Get file icon based on type
  let fileIcon = '📄';
  if (fileType.includes('image')) fileIcon = '🖼️';
  else if (fileType.includes('pdf')) fileIcon = '📕';
  else if (fileType.includes('word') || fileName.endsWith('.docx')) fileIcon = '📘';
  else if (fileType.includes('excel') || fileName.endsWith('.xlsx')) fileIcon = '📗';
  else if (fileType.includes('powerpoint') || fileName.endsWith('.pptx')) fileIcon = '📙';
  else if (fileType.includes('zip') || fileType.includes('rar')) fileIcon = '📦';
  
  // Format file size
  const sizeStr = fileSize < 1024 ? fileSize + ' B' :
                  fileSize < 1024 * 1024 ? (fileSize / 1024).toFixed(1) + ' KB' :
                  (fileSize / (1024 * 1024)).toFixed(1) + ' MB';
  
  messageDiv.innerHTML = `
    <div class="message-sender">${sender}</div>
    <div class="message-content">
      <div class="file-message" onclick="downloadFile('${fileData}', '${fileName}')">
        <div class="file-icon">${fileIcon}</div>
        <div class="file-info">
          <div class="file-name">${fileName}</div>
          <div class="file-size">${sizeStr}</div>
        </div>
        <div class="download-icon">⬇️</div>
      </div>
    </div>
    <div class="message-time">${time}</div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Download file
window.downloadFile = function(fileData, fileName) {
  const a = document.createElement('a');
  a.href = fileData;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  console.log('📥 Downloaded:', fileName);
};

// Toxic detect
const toxicWords = [
  // TIeng viet
  'ngu', 'đồ ngu', 'ngu ngốc', 'khốn nạn', 'khốn', 'đần', 'ngốc',
  'chết tiệt', 'đồ khốn', 'thằng ngu', 'con ngu', 'đồ ngốc',
  'ngu si', 'đần độn', 'khốn kiếp', 'đồ đần',
  
  // Tieng anh
  'stupid', 'idiot', 'fool', 'dumb', 'moron', 'hate', 'damn',
  
  // Leetspeak variations
  'n9u', 'ng0c', 'kh0n', 'd4n'
];

const toxicPatterns = [
  /\bn[u3]g[u0]\b/gi,           // ngu, n3g0, nugu, n3gu
  /\bkh[o0]n\b/gi,              // khon, kh0n
  /\bd[a4]n\b/gi,               // dan, d4n
  /\bng[o0]c\b/gi,              // ngoc, ng0c
  /\bst[u3]p[i1]d\b/gi,         // stupid, st3p1d
  /\b[i1]d[i1][o0]t\b/gi        // idiot, 1d10t
];

function isToxicMessage(message) {
  const lowerMessage = message.toLowerCase();
  
  // Kiem tra xem co tu nam trong cau hay khong
  const hasExactMatch = toxicWords.some(word => lowerMessage.includes(word));
  if (hasExactMatch) return true;
  
  // Kiem tra cac pattern 
  const hasPatternMatch = toxicPatterns.some(pattern => pattern.test(message));
  return hasPatternMatch;
}

function showModerationWarning(text) {
  const warning = document.createElement('div');
  warning.className = 'moderation-warning';
  warning.innerHTML = `
    <div class="warning-icon">⚠️</div>
    <div class="warning-text">${text}</div>
  `;
  warning.style.cssText = `
    background: linear-gradient(135deg, #ff4444, #cc3333);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    margin: 8px 0;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 2px 8px rgba(255, 68, 68, 0.3);
    animation: shake 0.5s ease-in-out;
  `;
  
  // Add shake animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-5px); }
      75% { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
  
  chatMessages.appendChild(warning);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (warning.parentElement) {
      warning.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => warning.remove(), 300);
    }
  }, 5000);
}

// Update send message to use Socket.IO with content moderation
sendMessage.onclick = () => {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Content moderation check
  if (isToxicMessage(message)) {
    showModerationWarning('Tin nhắn chứa từ ngữ không chuẩn mực. Vui lòng sử dụng ngôn từ phù hợp trong môi trường meeting.');
    
    // Add red border to input as visual feedback
    chatInput.style.border = '2px solid #ff4444';
    chatInput.style.animation = 'shake 0.5s ease-in-out';
    
    // Reset border after animation
    setTimeout(() => {
      chatInput.style.border = '2px solid transparent';
      chatInput.style.animation = '';
    }, 500);
    
    return; // Don't send the message
  }
  
  // Message is clean, proceed to send
  addChatMessage('Bạn', message);
  chatInput.value = '';
  
  // Send via Socket.IO
  if (socket && socket.connected) {
    console.log('Sending chat message:', message);
    socket.emit('chat-message', {
      roomCode,
      message,
      sender: userEmail
    });
  } else {
    console.error('Socket not connected!');
  }
};

// Also update Enter key handler
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage.click();
  }
});

// Screen Recording
recordToggle.onclick = () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
};

async function startRecording() {
  try {
    // 1. Yêu cầu user chọn cái gì để ghi
    const streamToRecord = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser', // Ưu tiên browser tab
        cursor: 'always',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: {
        echoCancellation: true, // Khử echo
        noiseSuppression: true, // Khử nhiễu
        sampleRate: 44100 // Tần số mẫu
      }
    });
    
    if (!streamToRecord) {
      alert('Không có stream để quay!');
      return;
    }
    
    // Create MediaRecorder with audio and video
    const options = { 
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 2500000 // 2.5 Mbps
    };
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }
    
    mediaRecorder = new MediaRecorder(streamToRecord, options);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('Recorded chunk:', event.data.size, 'bytes');
      }
    };
    
    mediaRecorder.onstop = () => {
      // Stop all tracks
      streamToRecord.getTracks().forEach(track => track.stop());
      downloadRecording();
    };
    
    // Handle when user stops sharing from browser
    streamToRecord.getVideoTracks()[0].onended = () => {
      if (isRecording) {
        stopRecording();
      }
    };
    
    mediaRecorder.start(1000); // Collect data every 1 second
    isRecording = true;
    recordToggle.classList.add('active');
    recordToggle.title = 'Dừng quay';
    
    console.log('Recording started');
    addChatMessage('System', 'Đã bắt đầu quay màn hình');
  } catch (error) {
    console.error('Lỗi khi bắt đầu quay:', error);
    if (error.name === 'NotAllowedError') {
      alert('Bạn đã từ chối quyền quay màn hình!');
    } else {
      alert('Không thể bắt đầu quay màn hình!');
    }
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    recordToggle.classList.remove('active');
    recordToggle.title = 'Quay màn hình';
    
    console.log('⏹️ Recording stopped');
    addChatMessage('System', 'Đã dừng quay. Đang tải xuống...');
  }
}

function downloadRecording() {
  if (recordedChunks.length === 0) {
    alert('Không có dữ liệu để tải xuống!');
    return;
  }
  
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  a.href = url;
  a.download = `meeting-recording-${timestamp}.webm`;
  
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  
  console.log('Recording downloaded');
  addChatMessage('System', 'Video đã được tải xuống!');
  
  // Clear recorded chunks
  recordedChunks = [];
}

// Private Chat
let currentPrivateChatUser = null;
const privateChatSidebar = document.getElementById('privateChatSidebar');
const closePrivateChat = document.getElementById('closePrivateChat');
const privateChatMessages = document.getElementById('privateChatMessages');
const privateChatInput = document.getElementById('privateChatInput');
const sendPrivateMessage = document.getElementById('sendPrivateMessage');

// Storage key for private messages
const PRIVATE_MESSAGES_KEY = `private_messages_${roomCode}`;

// Load private messages from localStorage
function loadPrivateMessages(userId) {
  const allMessages = JSON.parse(localStorage.getItem(PRIVATE_MESSAGES_KEY) || '{}');
  return allMessages[userId] || [];
}

// Save private message to localStorage
function savePrivateMessage(userId, sender, message, isOwn) {
  const allMessages = JSON.parse(localStorage.getItem(PRIVATE_MESSAGES_KEY) || '{}');
  
  if (!allMessages[userId]) {
    allMessages[userId] = [];
  }
  
  allMessages[userId].push({
    sender,
    message,
    isOwn,
    timestamp: new Date().toISOString()
  });
  
  localStorage.setItem(PRIVATE_MESSAGES_KEY, JSON.stringify(allMessages));
}

// Clear all private messages for this room
function clearPrivateMessages() {
  localStorage.removeItem(PRIVATE_MESSAGES_KEY);
}

function openPrivateChat(userId, userName) {
  currentPrivateChatUser = { id: userId, name: userName };
  
  // Update title
  document.getElementById('privateChatTitle').textContent = `Chat với ${userName}`;
  
  // Close other sidebars
  chatSidebar.classList.remove('open');
  participantsSidebar.classList.remove('open');
  
  // Open private chat
  privateChatSidebar.classList.add('open');
  
  // Clear and load saved messages
  privateChatMessages.innerHTML = '';
  
  const savedMessages = loadPrivateMessages(userId);
  savedMessages.forEach(msg => {
    addPrivateChatMessage(msg.sender, msg.message, msg.isOwn, false); // false = don't save again
  });
}

closePrivateChat.onclick = () => {
  privateChatSidebar.classList.remove('open');
  currentPrivateChatUser = null;
};

function sendPrivateChatMessage() {
  const message = privateChatInput.value.trim();
  if (!message || !currentPrivateChatUser) return;
  
  // Content moderation check for private chat
  if (isToxicMessage(message)) {
    showModerationWarning('Tin nhắn riêng chứa từ ngữ không chuẩn mực. Vui lòng sử dụng ngôn từ phù hợp.');
    
    // Add red border to private chat input
    privateChatInput.style.border = '2px solid #ff4444';
    privateChatInput.style.animation = 'shake 0.5s ease-in-out';
    
    // Reset border after animation
    setTimeout(() => {
      privateChatInput.style.border = '2px solid transparent';
      privateChatInput.style.animation = '';
    }, 500);
    
    return; // Don't send the message
  }
  
  console.log('📤 Sending private message to:', currentPrivateChatUser);
  
  // Add to UI and save
  addPrivateChatMessage('Bạn', message, true, true);
  privateChatInput.value = '';
  
  // Send via Socket.IO
  if (socket && socket.connected) {
    socket.emit('private-message', {
      to: currentPrivateChatUser.id,
      message,
      sender: userEmail
    });
    console.log('✅ Private message sent');
  } else {
    console.error('❌ Socket not connected');
  }
}

sendPrivateMessage.onclick = sendPrivateChatMessage;

privateChatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendPrivateChatMessage();
  }
});

function addPrivateChatMessage(sender, message, isOwn = false, shouldSave = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  if (isOwn) messageDiv.classList.add('own-message');
  
  const time = new Date().toLocaleTimeString('vi-VN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  messageDiv.innerHTML = `
    <div class="message-sender">${sender}</div>
    <div class="message-content">${message}</div>
    <div class="message-time">${time}</div>
  `;
  
  privateChatMessages.appendChild(messageDiv);
  privateChatMessages.scrollTop = privateChatMessages.scrollHeight;
  
  // Save to localStorage if needed
  if (shouldSave && currentPrivateChatUser) {
    savePrivateMessage(currentPrivateChatUser.id, sender, message, isOwn);
  }
}

// Notification System
function showNotification(icon, title, message, type = 'chat') {
  const container = document.getElementById('notificationContainer');
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  notification.innerHTML = `
    <div class="notification-icon">${icon}</div>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
    <button class="notification-close">✕</button>
  `;
  
  container.appendChild(notification);
  
  // Click to open chat
  notification.onclick = (e) => {
    if (e.target.classList.contains('notification-close')) {
      return;
    }
    
    if (type === 'private') {
      // Open private chat if possible
      privateChatSidebar.classList.add('open');
    } else {
      // Open main chat
      chatSidebar.classList.add('open');
    }
    
    notification.remove();
  };
  
  // Close button
  notification.querySelector('.notification-close').onclick = (e) => {
    e.stopPropagation();
    notification.remove();
  };
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = 'slideInRight 0.3s ease reverse';
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
}

// Initialize
async function initialize() {
  console.log('Initializing meeting room...');
  await initMedia();
  updateVideoGridLayout();
  updateParticipantsList();
  
  // Initialize Socket.IO after media is ready
  initSocketIO();
  
  // Welcome message
  setTimeout(() => {
    addChatMessage('Vờ Ku Mít', 'Chào mừng bạn đến phòng meeting!');
  }, 1000);
}

initialize();
