import './style.css';
import firebase from 'firebase/app';
import 'firebase/firestore';

let username = '';

const usernameInput = document.getElementById('usernameInput');
const chatSection = document.getElementById('chatSection');
const hangupButton = document.getElementById('hangupButton');

hangupButton.style.display = 'none';
chatSection.style.display = 'none';

const firebaseConfig = {
  apiKey: "AIzaSyCJk5RsDhpkTJVFfKP1LiqVaCnH295tXHc",
  authDomain: "webrtc-4ac03.firebaseapp.com",
  projectId: "webrtc-4ac03",
  storageBucket: "webrtc-4ac03.appspot.com",
  messagingSenderId: "1095839280132",
  appId: "1:1095839280132:web:422cabbe9d031142895951",
  measurementId: "G-6EFE5HK484"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
};

let localStream = null;
const peerConnections = {};
const pendingCandidates = {};

const videosContainer = document.querySelector('.videos');

const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const answerButton = document.getElementById('answerButton');
const callInput = document.getElementById('callInput');


let userId = crypto.randomUUID();
let callRef = null;


async function init() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  webcamVideo.srcObject = localStream;

  callButton.disabled = false;
  answerButton.disabled = false;
}

init();

function hidePreJoinUI() {
  usernameInput.style.display = 'none';
  callButton.style.display = 'none';
  answerButton.style.display = 'none';
}
function showPreJoinUI() {
  usernameInput.style.display = 'inline-block';
  callButton.style.display = 'inline-block';
  answerButton.style.display = 'inline-block';
}


callButton.onclick = async () => {
  if (!username) {
    username = usernameInput.value.trim();
    if (!username) return alert("Please enter your name first.");
  }

  const roomId = crypto.randomUUID();
  callInput.value = roomId;
  
  callRef = firestore.collection('calls').doc(roomId);
  await callRef.set({});
  await joinRoom(roomId);

  hidePreJoinUI();
};

answerButton.onclick = async () => {
  if (!username) {
    username = usernameInput.value.trim();
    if (!username) return alert("Please enter your name first.");
  }

  const roomId = callInput.value;
  if (!roomId) return alert("Enter a Room ID");

  callRef = firestore.collection('calls').doc(roomId);
  await joinRoom(roomId);

  hidePreJoinUI();
};


async function joinRoom(roomId) {
  hangupButton.style.display = 'inline-block';
  chatSection.style.display = 'block';
  
  
  while (!username) {
    username = prompt("Enter your name:");
  }
  const peersRef = callRef.collection('peers');
  const candidatesRef = callRef.collection('candidates');

  await peersRef.doc(userId).set({ name: username, joined: firebase.firestore.FieldValue.serverTimestamp() });

  const peerNames = {};

  peersRef.onSnapshot(async snapshot => {
    snapshot.docChanges().forEach(async change => {
      const peerId = change.doc.id;
      const peerName = change.doc.data().name || peerId;
      peerNames[peerId] = peerName;

      if (peerId === userId || peerConnections[peerId]) return;

      const pc = new RTCPeerConnection(servers);
      peerConnections[peerId] = pc;

      let dataChannel;
      if (userId < peerId) {
        dataChannel = pc.createDataChannel('chat');
        setupDataChannel(dataChannel, peerId, peerName);
        peerConnections[peerId].dataChannel = dataChannel;
      } else {
        pc.ondatachannel = event => {
          dataChannel = event.channel;
          setupDataChannel(dataChannel, peerId, peerName);
          peerConnections[peerId].dataChannel = dataChannel;
        };
      }

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      const wrapper = document.createElement('div');
      wrapper.style.display = 'inline-block';
      wrapper.style.textAlign = 'center';

      const remoteVideo = document.createElement('video');
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.setAttribute('data-peer', peerId);
      remoteVideo.style.width = "300px";
      remoteVideo.style.margin = "10px";

      const label = document.createElement('div');
      label.textContent = peerName;
      label.style.fontWeight = 'bold';

      wrapper.appendChild(remoteVideo);
      wrapper.appendChild(label);
      videosContainer.appendChild(wrapper);

      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        remoteVideo.srcObject = remoteStream;
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidatesRef.add({ from: userId, to: peerId, candidate: event.candidate.toJSON() });
        }
      };

      if (userId < peerId) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        candidatesRef.add({ from: userId, to: peerId, offer });
      }
    });
  });

  candidatesRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      const data = change.doc.data();
      const { from, to, offer, answer, candidate } = data;
      if (to !== userId || from === userId) return;
      const pc = peerConnections[from];
      if (!pc) return;

      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (pendingCandidates[from]) {
          for (const c of pendingCandidates[from]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.error("Error adding buffered ICE candidate:", e);
            }
          }
          delete pendingCandidates[from];
        }
        const answerDesc = await pc.createAnswer();
        await pc.setLocalDescription(answerDesc);
        candidatesRef.add({ from: userId, to: from, answer: answerDesc });
      }

      if (answer) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (pendingCandidates[from]) {
          for (const c of pendingCandidates[from]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.error("Error adding buffered ICE candidate:", e);
            }
          }
          delete pendingCandidates[from];
        }
      }

      if (candidate) {
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          if (!pendingCandidates[from]) pendingCandidates[from] = [];
          pendingCandidates[from].push(candidate);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Error adding ICE candidate:", e);
          }
        }
      }
    });
  });

  hangupButton.disabled = false;
}

hangupButton.onclick = async () => {
  for (const peerId in peerConnections) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
    const video = document.querySelector(`video[data-peer="${peerId}"]`);
    video?.parentElement?.remove();
  }
  if (callRef) {
    await callRef.collection('peers').doc(userId).delete();
  }
  showPreJoinUI()
  hangupButton.style.display = 'none';
  chatSection.style.display = 'none';
};

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');

let audioEnabled = true;
let videoEnabled = true;

toggleAudioBtn.textContent = 'Mute Audio';
toggleVideoBtn.textContent = 'Disable Video';

toggleAudioBtn.onclick = () => {
  audioEnabled = !audioEnabled;
  localStream.getAudioTracks().forEach(track => (track.enabled = audioEnabled));
  toggleAudioBtn.textContent = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
};

toggleVideoBtn.onclick = () => {
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(track => (track.enabled = videoEnabled));
  toggleVideoBtn.textContent = videoEnabled ? 'Disable Video' : 'Enable Video';
};

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesContainer = document.getElementById('messages');

function setupDataChannel(channel, peerId, peerName) {
  channel.onopen = () => {
    console.log(`Data channel opened with ${peerId}`);
  };

  channel.onmessage = (event) => {
    const msg = document.createElement('div');
    msg.textContent = `[${peerName}]: ${event.data}`;
    messagesContainer.appendChild(msg);
  };

  channel.onerror = (error) => {
    console.error("DataChannel error:", error);
  };
}

sendButton.onclick = () => {
  const message = messageInput.value.trim();
  if (!message) return;

  Object.keys(peerConnections).forEach(peerId => {
    const dataChannel = peerConnections[peerId].dataChannel;
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(message);
    }
  });

  const msg = document.createElement('div');
  msg.textContent = `[You - ${username}]: ${message}`;
  messagesContainer.appendChild(msg);
  messageInput.value = '';
};

usernameInput.addEventListener('input', (event) => {
  username = event.target.value.trim();
});
