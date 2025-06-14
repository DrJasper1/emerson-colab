// public/room_script.js (for room.ejs)

let currentRoomUsersState = []; // Holds the latest user list from the server

// Determine the display name to be used from the server-provided session data, falling back to a random name.
const effectiveDisplayName = (typeof INITIAL_DISPLAY_NAME !== 'undefined' && INITIAL_DISPLAY_NAME.trim() !== '')
    ? INITIAL_DISPLAY_NAME
    : 'User' + Math.floor(Math.random() * 10000);

let IS_ADMIN = false;
let audioContext = null;
let currentUsersMap = new Map(); // To track users for connect/disconnect sounds


function playSynthSound(type) {
    if (!IS_HOST || !audioContext) {
        if (IS_HOST && !audioContext) console.warn("AudioContext not initialized for host. Sound will not play.");
        return;
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(err => {
            console.error("AudioContext resume failed:", err);
            return; 
        });
    }
    
    if (audioContext.state !== 'running') {
        console.warn("AudioContext is not running after resume attempt. Sound might not play.");
        // return; // Optionally return if still not running
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05); // Volume (0.0 to 1.0)

    if (type === 'connect') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(329.63, audioContext.currentTime); // E4
        oscillator.frequency.setValueAtTime(440.00, audioContext.currentTime + 0.12); // A4
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.25);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.25);
    } else if (type === 'disconnect') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(440.00, audioContext.currentTime); // A4
        oscillator.frequency.setValueAtTime(329.63, audioContext.currentTime + 0.12); // E4
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.25);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.25);
    }

    oscillator.onended = () => {
        if (oscillator.connected) oscillator.disconnect();
        if (gainNode.connected) gainNode.disconnect();
    };
}

// --- In-Page Debug Console System ---
let pageDebugConsoleContainer = null; // For host UI
let pageDebugLogArea = null;          // For host UI
let hostOwnLogsPanel = null;          // Panel for host's own logs
let clientLogsContainerPanel = null;  // Container for all client log panels

// Helper to format arguments for logging (handles objects)
function formatArgsForLog(args) {
    return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2); // Pretty print objects
            } catch (e) {
                return '[Unserializable Object]';
            }
        }
        return String(arg);
    }).join(' ');
}

// Core function to add messages to the debug system
// Phase 1: If host, displays in UI. If client, does nothing with UI yet.
// Phase 2: If client, will send to host.
function routeDebugMessage(message, type = 'log', originPeerId = null) {
    if (IS_HOST) {
        if (!pageDebugLogArea) {
            // UI not ready, or this is an early log. Fallback to browser console for host.
            // console.warn('Host Debug UI not ready for:', message); // Avoid infinite loop if console.warn is also overridden
            return;
        }

        const targetPanel = originPeerId ? getOrCreateClientLogPanel(originPeerId) : hostOwnLogsPanel;
        if (!targetPanel) return; // Should not happen if UI is initialized

        const messageElement = document.createElement('p');
        const timestamp = new Date().toLocaleTimeString();
        let fullMessage = `[${timestamp}] [${type.toUpperCase()}]`;
        if (originPeerId) {
            fullMessage += ` [Client ${originPeerId.substring(0,6)}]:`;
        }
        fullMessage += ` ${message}`;
        messageElement.textContent = fullMessage;
        messageElement.classList.add(`debug-message-${type}`);
        
        targetPanel.appendChild(messageElement);
        targetPanel.scrollTop = targetPanel.scrollHeight; // Auto-scroll
    } else {
        // Phase 2: Client sends this log to the host
        if (socket && MY_PEER_ID) { // Ensure socket and MY_PEER_ID are available
            socket.emit('forward-client-log', {
                roomId: ROOM_ID, // Server will need this to find the host
                peerId: MY_PEER_ID,
                logData: {
                    message: message,
                    type: type,
                    timestamp: new Date().toISOString()
                }
            });
        } else {
            // Fallback if socket or MY_PEER_ID isn't ready yet for some reason
            // This log will only appear in the client's own browser console.
            // console.warn('Cannot forward log: socket or MY_PEER_ID not ready.'); 
        }
    }
}

// Override console methods globally to capture all logs
(function() {
    const originalConsoleLog = console.log;
    console.log = function(...args) {
        originalConsoleLog.apply(console, args);
        routeDebugMessage(formatArgsForLog(args), 'log');
    };

    const originalConsoleError = console.error;
    console.error = function(...args) {
        originalConsoleError.apply(console, args);
        routeDebugMessage(formatArgsForLog(args), 'error');
    };

    const originalConsoleWarn = console.warn;
    console.warn = function(...args) {
        originalConsoleWarn.apply(console, args);
        routeDebugMessage(formatArgsForLog(args), 'warn');
    };

    const originalConsoleInfo = console.info;
    console.info = function(...args) {
        originalConsoleInfo.apply(console, args);
        routeDebugMessage(formatArgsForLog(args), 'info');
    };

    const originalConsoleDebug = console.debug;
    console.debug = function(...args) {
        originalConsoleDebug.apply(console, args);
        routeDebugMessage(formatArgsForLog(args), 'debug');
    };
})();

function attemptAdminStatusRestore() {
    if (localStorage.getItem('wildCherryAdminSessionRequested') === 'true') {
        console.log('[AdminRestore] Found admin session flag, checking status with server...');
        // Ensure socket is available and connected before emitting
        if (socket && socket.connected) {
            socket.emit('check-admin-status', (response) => {
                if (response.isAdmin) {
                    console.log('[AdminRestore] Server confirmed admin status. Enabling admin features.');
                    IS_ADMIN = true;
                    updateBodyHostViewClasses(); // Update UI based on admin status
                    // Potentially call other UI update functions specific to admin role here
                } else {
                    console.log('[AdminRestore] Server did NOT confirm admin status. Clearing flag.');
                    localStorage.removeItem('wildCherryAdminSessionRequested');
                    IS_ADMIN = false;
                    updateBodyHostViewClasses(); // Reflect that user is not admin
                }
            });
        } else {
            console.warn('[AdminRestore] Socket not connected when attempting to restore admin status.');
            // Could add a listener here: socket.once('connect', attemptAdminStatusRestore);
        }
    } else {
        // console.log('[AdminRestore] No admin session flag found in localStorage.');
        IS_ADMIN = false; // Default to false if no flag
    }
}

// Function to create/get a specific panel for a client's logs on the host UI
function getOrCreateClientLogPanel(peerId) {
    if (!clientLogsContainerPanel) return null;
    let clientPanel = document.getElementById(`client-log-panel-${peerId}`);
    if (!clientPanel) {
        // Find display name from currentRoomUsersState
        let displayName = 'Unknown';
        const userInfo = currentRoomUsersState.find(user => user.id === peerId);
        if (userInfo && userInfo.name) {
            displayName = userInfo.name;
        }
        
        const panelContainer = document.createElement('div');
        panelContainer.classList.add('client-log-container');
        
        const title = document.createElement('h4');
        title.textContent = `Logs from ${displayName} (${peerId.substring(0,6)})`;
        title.id = `client-log-title-${peerId}`; // Add ID for potential later updates
        panelContainer.appendChild(title);

        clientPanel = document.createElement('div');
        clientPanel.id = `client-log-panel-${peerId}`;
        clientPanel.classList.add('client-log-area');
        panelContainer.appendChild(clientPanel);

        clientLogsContainerPanel.appendChild(panelContainer);
    } else {
        // Update the title with current display name in case it changed
        const titleElement = document.getElementById(`client-log-title-${peerId}`);
        if (titleElement) {
            const userInfo = currentRoomUsersState.find(user => user.id === peerId);
            if (userInfo && userInfo.name) {
                titleElement.textContent = `Logs from ${userInfo.name} (${peerId.substring(0,6)})`;
            }
        }
    }
    return clientPanel;
}

// Initializes the visual debug console UI *only for the host*
function initializePageDebugConsole() {
    console.log('[DebugInit] Attempting to initialize Page Debug Console. IS_HOST:', IS_HOST);
    if (!IS_HOST) {
        // console.log('Not host, debug UI not initialized.'); // This would be sent to host in Phase 2
        return;
    }

    if (pageDebugConsoleContainer) {
        console.log('[DebugInit] Host debug UI already initialized. Skipping.');
        return; // Already initialized
    }

    const chatSection = document.querySelector('.chat-section');
    console.log('[DebugInit] Looked for .chat-section. Found:', chatSection);
    if (!chatSection) {
        console.error('Chat section not found, cannot initialize in-page debug console for host.');
        return;
    }

    pageDebugConsoleContainer = document.createElement('div');
    pageDebugConsoleContainer.id = 'pageDebugConsoleContainer';

    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.alignItems = 'center';

    const title = document.createElement('h3');
    title.textContent = 'Host Debug Area';
    title.style.margin = '0'; // Remove default margin for h3
    headerDiv.appendChild(title);

    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggleDebugConsoleBtn';
    toggleButton.textContent = 'Expand Logs'; // Initial text
    toggleButton.style.marginLeft = '10px';
    headerDiv.appendChild(toggleButton);

    const copyLogsBtn = document.createElement('button');
    copyLogsBtn.textContent = 'Copy All Logs';
    copyLogsBtn.id = 'copyLogsBtn';
    copyLogsBtn.style.marginLeft = '10px';
    headerDiv.appendChild(copyLogsBtn);

    pageDebugConsoleContainer.appendChild(headerDiv);

    copyLogsBtn.addEventListener('click', () => {
        let allLogs = '';
        document.querySelectorAll('#pageDebugConsoleContainer .client-log-area p, #pageDebugConsoleContainer .host-log-area p').forEach(p => {
            allLogs += p.textContent + '\n';
        });
        navigator.clipboard.writeText(allLogs).then(() => {
            alert('All logs copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy logs: ', err);
            alert('Failed to copy logs. See browser console for error.');
        });
    });

    const debugContentWrapper = document.createElement('div');
    debugContentWrapper.id = 'debugContentWrapper';
    debugContentWrapper.style.display = 'none'; // Start collapsed
    pageDebugConsoleContainer.appendChild(debugContentWrapper);
    console.log('[DebugInit] Created pageDebugConsoleContainer, headerDiv, toggleButton, debugContentWrapper. Toggle Button Text:', toggleButton.textContent);

    // Panel for Host's own logs
    const hostLogsTitle = document.createElement('h4');
    hostLogsTitle.textContent = 'My Local Logs';
    debugContentWrapper.appendChild(hostLogsTitle); // Append to wrapper
    hostOwnLogsPanel = document.createElement('div');
    hostOwnLogsPanel.id = 'hostOwnLogArea';
    hostOwnLogsPanel.classList.add('host-log-area');
    debugContentWrapper.appendChild(hostOwnLogsPanel); // Append to wrapper

    // Container for logs from other clients
    const clientLogsTitle = document.createElement('h4');
    clientLogsTitle.textContent = 'Connected Client Logs';
    debugContentWrapper.appendChild(clientLogsTitle); // Append to wrapper
    clientLogsContainerPanel = document.createElement('div');
    clientLogsContainerPanel.id = 'clientLogsContainerPanel';
    debugContentWrapper.appendChild(clientLogsContainerPanel); // Append to wrapper

    // Legacy pageDebugLogArea now points to hostOwnLogsPanel for initial compatibility
    pageDebugLogArea = hostOwnLogsPanel; 

    const chatMessagesDiv = document.getElementById('chatMessages');
    if (chatMessagesDiv && chatMessagesDiv.parentNode === chatSection) {
        chatSection.insertBefore(pageDebugConsoleContainer, chatMessagesDiv);
    } else {
        chatSection.appendChild(pageDebugConsoleContainer);
    }
    console.log('[DebugInit] Host in-page debug console UI fully initialized and appended to chatSection.');

    // Add event listener for the toggle button
    toggleButton.addEventListener('click', () => {
        const isHidden = debugContentWrapper.style.display === 'none';
        debugContentWrapper.style.display = isHidden ? 'block' : 'none';
        toggleButton.textContent = isHidden ? 'Collapse Logs' : 'Expand Logs';
    });
}

// Removed addMessageToPageDebugConsole as its logic is merged into routeDebugMessage

// Call initialization for host UI at appropriate times
// document.addEventListener('DOMContentLoaded', initializePageDebugConsole); // Too early, IS_HOST might not be set

// --- End In-Page Debug Console System ---


const socket = io();
const videoGrid = document.getElementById('videoGrid');
const localVideo = document.getElementById('localVideo');
const localDisplayNameElement = document.getElementById('localDisplayName');

// Sound effects
const connectSound = new Audio('/sounds/user-connect.mp3');
const disconnectSound = new Audio('/sounds/user-disconnect.mp3');
connectSound.preload = 'auto';
disconnectSound.preload = 'auto';
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const userListElement = document.getElementById('userList');
const participantCountElement = document.getElementById('participantCount');
const userCountElement = document.getElementById('userCount');
const roomCapacityDisplay = document.getElementById('roomCapacityDisplay');

let originalChatParent = null;
let originalChatNextSibling = null;

function updateBodyHostViewClasses() {
    const chatSection = document.querySelector('.chat-section');
    const participantsSection = document.querySelector('.participants-section');
    const videoChatWrapper = document.querySelector('.video-chat-wrapper');

    if (!chatSection || !participantsSection || !videoChatWrapper) {
        console.error('Chat/Participants/VideoChatWrapper section not found, cannot update layout.');
        // Apply body classes anyway
        if (IS_HOST) {
            document.body.classList.add('host-view');
            document.body.classList.remove('non-host-view');
        } else {
            document.body.classList.add('non-host-view');
            document.body.classList.remove('host-view');
        }
        return;
    }

    if (IS_HOST) {
        document.body.classList.add('host-view');
        document.body.classList.remove('non-host-view');

        // If chat is in participants section, move it back to video-chat-wrapper
        if (originalChatParent && chatSection.parentNode === participantsSection) {
            originalChatParent.insertBefore(chatSection, originalChatNextSibling);
            console.log('Chat moved back to video wrapper for host view.');
        }
    } else {
        document.body.classList.add('non-host-view');
        document.body.classList.remove('host-view');

        // If chat is in video-chat-wrapper, move it to participants-section
        if (chatSection.parentNode === videoChatWrapper) {
            if (!originalChatParent) { // Store only once
                originalChatParent = videoChatWrapper;
                originalChatNextSibling = chatSection.nextSibling;
            }
            participantsSection.appendChild(chatSection);
            console.log('Chat moved to participants section for non-host view.');
        }
    }
}

const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const cameraSelect = document.getElementById('cameraSelect');

const hostControlsDiv = document.getElementById('hostControls');
const newCapacityInput = document.getElementById('newCapacityInput');
const changeCapacityBtn = document.getElementById('changeCapacityBtn');
const savePaymentInfoBtn = document.getElementById('savePaymentInfoBtn');
const clearPaymentInfoBtn = document.getElementById('clearPaymentInfoBtn');
const cashappIdInput = document.getElementById('cashappId');
const paypalLinkInput = document.getElementById('paypalLink');
const venmoIdInput = document.getElementById('venmoId');
const cryptoAddressInput = document.getElementById('cryptoAddress');
const kickUserBtn = document.getElementById('kickUserBtn');
const banUserBtn = document.getElementById('banUserBtn');
const localFullscreenBtn = document.getElementById('localFullscreenBtn');
const pinnedPaymentInfoDisplay = document.getElementById('pinnedPaymentInfoDisplay');
const emojiPickerBtn = document.getElementById('emojiPickerBtn');
const emojiPanel = document.getElementById('emojiPanel');
let selectedPeerIdForModeration = null;

let localStream;
let myPeer;
const peers = {}; 
let selectedUserForHostAction = null;
let localUserHasVideo = false;

let hostPeerId = null; // Store the PeerJS ID of the host 

// Get display name from URL query params or localStorage
const urlParams = new URLSearchParams(window.location.search);
let rawDisplayName = urlParams.get('displayName') || localStorage.getItem('displayName') || 'Anonymous';
let displayName = rawDisplayName.split('?')[0];
if (localDisplayNameElement) localDisplayNameElement.textContent = displayName;

// Fullscreen toggle function
function toggleFullscreen(element) {
    if (!document.fullscreenElement) {
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) { /* Safari */
            element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) { /* IE11 */
            element.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Event listener for local video fullscreen
if (localVideo && localFullscreenBtn) {
    localFullscreenBtn.addEventListener('click', () => {
        toggleFullscreen(localVideo);
    });
}

// Old conditional structure was merged into the block above.

// Initialize PeerJS
function initializePeer() {
    myPeer = new Peer(undefined, {
        // For local testing, PeerServer on default port 9000 is usually fine.
        // For production, you'd configure host/port or a cloud PeerServer.
        // host: 'your-peerjs-server.com',
        // port: 443,
        // path: '/peerjs',
        // secure: true,
        // debug: 3 // for more verbose logging
    });

    myPeer.on('open', async (id) => { // Make the outer function async if needed, or handle promises
        MY_PEER_ID = id;
        updateBodyHostViewClasses(); 
        console.log('[PeerJS] My PeerJS ID:', MY_PEER_ID);
        
        try {
            await connectSound.play();
        } catch(e) {
            console.error("[Sound] Error playing connect sound for self:", e);
        }

        // Emit join-room immediately with a default media status (e.g., no video initially)
        // The server should associate this socket with MY_PEER_ID upon 'join-room'
        console.log(`[SocketIO] Emitting join-room with initial hasVideo: false for peer ${MY_PEER_ID}`);
        socket.emit('join-room', ROOM_ID, MY_PEER_ID, false);
    attemptAdminStatusRestore(); // Check for persistent admin status // Initially, claim no video

        // Now, attempt to get local media. This will likely show the browser permission prompt.
        console.log('[Media] Attempting to setup local media...');
        setupLocalMedia().then(() => {
            console.log(`[Media] setupLocalMedia completed. localUserHasVideo: ${localUserHasVideo}`);
            // localStream is now set (either real or dummy) by setupLocalMedia
            // localUserHasVideo is also set by setupLocalMedia

            // Inform other users about our true video status
            console.log(`[SocketIO] Emitting user-media-status-update with hasVideo: ${localUserHasVideo}`);
            socket.emit('user-media-status-update', { peerId: MY_PEER_ID, roomId: ROOM_ID, hasVideo: localUserHasVideo });

            // If localStream was successfully obtained (not a dummy one from failure),
            // and it has video, add it to the local video element.
            if (localStream && localUserHasVideo && localVideo) {
                console.log('[Media] Local stream has video. Setting srcObject for localVideo.');
                if (!localVideo.srcObject || localVideo.srcObject.id !== localStream.id) { 
                    localVideo.srcObject = localStream;
                    localVideo.muted = true; 
                    localVideo.play().catch(e => console.error("Error playing local video:", e));
                    if (localVideoContainerElement) {
                        localVideoContainerElement.classList.remove('hidden');
                        const avatarImg = localVideoContainerElement.querySelector('.participant-avatar-img');
                        if (avatarImg) avatarImg.remove();
                    }
                }
            } else if (localStream && localVideoContainerElement) { // Has stream, but no video tracks (audio only or dummy)
                console.log('[Media] Local stream is audio-only or dummy. Displaying avatar.');
                displayAvatar(localVideoContainerElement, localVideo, displayName, true);
            }
            updateMediaButtonStates(); // Reflect the actual media state

        }).catch(err => {
            console.error("[Media] Error in setupLocalMedia promise chain after join:", err);
            // Fallback to dummy stream is handled inside setupLocalMedia
            // Ensure UI reflects this (buttons disabled, avatar shown)
            updateMediaButtonStates();
            if (localVideoContainerElement) displayAvatar(localVideoContainerElement, localVideo, displayName, true);
            // Still emit status update if it failed, likely localUserHasVideo will be false
            socket.emit('user-media-status-update', { peerId: MY_PEER_ID, roomId: ROOM_ID, hasVideo: localUserHasVideo });
        });
        
        // If IS_HOST is already known here (e.g. from server on page load, though not current setup)
        // initializePageDebugConsole(); // This can be called when 'set-as-host' is received
    });

    myPeer.on('call', (call) => {
        const callerPeerId = call.peer;
        console.log(`[IncomingCall] Incoming call from ${callerPeerId}`);

        const callingUserData = currentRoomUsersState.find(user => user.id === callerPeerId);
        const callerDisplayName = callingUserData ? callingUserData.name : `User ${callerPeerId.substring(0,5)}`;
        const callerHasVideo = callingUserData ? callingUserData.hasVideo : false; // Default to false, will be updated by stream or peer-media-status-changed
        console.log(`[IncomingCall] Setting up container for caller: ${callerDisplayName} (${callerPeerId}), initialHasVideo: ${callerHasVideo}`);

        const { videoElement, videoContainerElement } = setupPeerVideoContainer(callerPeerId, callerDisplayName, callerHasVideo);

        // Check if we already have the media stream ready
        const answerCall = () => {
            console.log(`[IncomingCall] Answering call from ${callerPeerId} with local stream.`);
            if (localStream) {
                console.log(`[IncomingCall] Unmuting all tracks in localStream before answering call from ${callerPeerId}.`);
                localStream.getTracks().forEach(track => {
                    track.muted = false;
                });
            }
            call.answer(localStream);
        };
        
        if (localStream && localStream.active && localStream.getVideoTracks().length > 0) {
            // Media is already ready, answer immediately
            console.log(`[IncomingCall] Local media already ready, answering call from ${callerPeerId} immediately.`);
            answerCall();
        } else {
            // Media isn't ready yet, wait for setupLocalMedia to complete before answering
            console.log(`[IncomingCall] Local media not ready yet. Waiting before answering call from ${callerPeerId}.`);
            const checkStreamInterval = setInterval(() => {
                if (localStream && localStream.active) {
                    clearInterval(checkStreamInterval);
                    console.log(`[IncomingCall] Local media is now ready, answering call from ${callerPeerId}.`);
                    answerCall();
                }
            }, 200); // Check every 200ms
            
            // Safety timeout - don't wait forever (3 seconds max)
            setTimeout(() => {
                clearInterval(checkStreamInterval);
                if (!call.open) { // If the call hasn't been answered yet
                    console.log(`[IncomingCall] Answering call from ${callerPeerId} after timeout (media may not be fully ready).`);
                    answerCall();
                }
            }, 3000);
        }
        
        let streamAlreadyHandled = false; // Flag to ensure stream is processed only once

        call.on('stream', (remoteUserStream) => {
            if (streamAlreadyHandled) {
                console.warn(`[WebRTC] Stream event for call with ${call.peer} (displayName: ${callerDisplayName}) fired again, but already handled. Ignoring.`);
                return;
            }
            streamAlreadyHandled = true;
            
            console.log(`[IncomingCall] Received stream from ${callerDisplayName} (${callerPeerId}). Stream ID: ${remoteUserStream.id}, Active: ${remoteUserStream.active}`);
            const videoTracks = remoteUserStream.getVideoTracks();
            const audioTracks = remoteUserStream.getAudioTracks();
            console.log(`[IncomingCall] Stream from ${callerDisplayName} (${callerPeerId}) - Video Tracks: ${videoTracks.length}, Audio Tracks: ${audioTracks.length}`);

            videoTracks.forEach((track, i) => {
                console.log(`[IncomingCall]   Video Track ${i} (${callerDisplayName}): Label='${track.label}', Kind='${track.kind}', ReadyState='${track.readyState}', Muted='${track.muted}', Enabled='${track.enabled}'`);
            });
            audioTracks.forEach((track, i) => {
                console.log(`[IncomingCall]   Audio Track ${i} (${callerDisplayName}): Label='${track.label}', Kind='${track.kind}', ReadyState='${track.readyState}', Muted='${track.muted}', Enabled='${track.enabled}'`);
            });

            if (videoTracks.length === 0 && audioTracks.length === 0) {
                console.warn(`[IncomingCall] Stream from ${callerDisplayName} (${callerPeerId}) has NO video and NO audio tracks.`);
            }

            if (!videoElement) {
                console.error(`[WebRTC] Video element for remote peer ${callerPeerId} (displayName: ${callerDisplayName || 'N/A'}) not found. Cannot attach stream.`);
                return; 
            }
            
            videoElement.srcObject = remoteUserStream;

            console.log(`[IncomingCall] Remote stream from ${callerDisplayName} assigned to video element. Video element initially muted: ${videoElement.muted}`);
            const remoteAudioTracks = remoteUserStream.getAudioTracks();
            if (remoteAudioTracks.length > 0) {
                const audioTrack = remoteAudioTracks[0];
                console.log(`[IncomingCall] Remote audio track from ${callerDisplayName}: ID='${audioTrack.id}', Label='${audioTrack.label}', Kind='${audioTrack.kind}', Enabled='${audioTrack.enabled}', Muted='${audioTrack.muted}', ReadyState='${audioTrack.readyState}'`);
            } else {
                console.warn(`[IncomingCall] Remote stream from ${callerDisplayName} has NO audio tracks after assignment.`);
            }

            videoElement.addEventListener('loadedmetadata', () => {
                console.log(`[IncomingCall] 'loadedmetadata' for ${callerDisplayName}. Initial videoElement.muted: ${videoElement.muted}. Attempting to play (unmuted first attempt).`);
                videoElement.play()
                    .then(() => {
                        console.log(`[IncomingCall] Playback started successfully for ${callerDisplayName} (unmuted attempt). videoElement.muted: ${videoElement.muted}, videoElement.volume: ${videoElement.volume}`);
                        // If playback started and element was muted by browser, try unmuting.
                        if (videoElement.muted) {
                            console.log(`[IncomingCall] Playback started but element is muted for ${callerDisplayName}. Attempting to explicitly unmute.`);
                            videoElement.muted = false;
                            console.log(`[IncomingCall] After explicit unmute attempt for ${callerDisplayName}, videoElement.muted: ${videoElement.muted}`);
                        }
                    })
                    .catch(e => {
                        console.error(`[IncomingCall] Initial play() attempt for ${callerDisplayName} failed. Error: ${e.name} - ${e.message}`);
                        if (e.name === 'NotAllowedError') {
                            console.warn(`[IncomingCall] Autoplay with audio failed for ${callerDisplayName} due to NotAllowedError. Attempting to play muted.`);
                            videoElement.muted = true;
                            videoElement.play()
                                .then(() => {
                                    console.log(`[IncomingCall] Muted playback started for ${callerDisplayName}. User will see video but no audio initially. videoElement.muted: ${videoElement.muted}`);
                                    // Add UI notification for muted audio
                                    if (remoteAudioTracks.length > 0) {
                                        console.warn(`[IncomingCall] AUDIO MUTED for ${callerDisplayName}: Stream has audio, but playback is muted due to browser policy. User needs to interact to unmute.`);
                                        
                                        // Create unmute notification overlay
                                        const unmuteBanner = document.createElement('div');
                                        unmuteBanner.className = 'unmute-banner';
                                        unmuteBanner.innerHTML = '<i class="fas fa-volume-mute"></i> Click anywhere to unmute audio';
                                        unmuteBanner.style.position = 'absolute';
                                        unmuteBanner.style.bottom = '10px';
                                        unmuteBanner.style.left = '0';
                                        unmuteBanner.style.right = '0';
                                        unmuteBanner.style.backgroundColor = 'rgba(0,0,0,0.7)';
                                        unmuteBanner.style.color = 'white';
                                        unmuteBanner.style.padding = '5px';
                                        unmuteBanner.style.textAlign = 'center';
                                        unmuteBanner.style.zIndex = '10';
                                        unmuteBanner.style.borderRadius = '4px';
                                        
                                        // Find the video container for this peer
                                        const videoContainer = document.querySelector(`.video-participant[data-peer-id="${callerPeerId}"]`);
                                        console.log(`[IncomingCall] Attempting to find video container for unmute banner with selector: .video-participant[data-peer-id="${callerPeerId}"]`, videoContainer);
                                        if (videoContainer) {
                                            videoContainer.style.position = 'relative';
                                            videoContainer.appendChild(unmuteBanner);
                                            
                                            // Add click handler to unmute
                                            videoContainer.addEventListener('click', function unmuteFn() {
                                                if (videoElement.muted) {
                                                    videoElement.muted = false;
                                                    console.log(`[IncomingCall] User clicked to unmute ${callerDisplayName}. New muted state: ${videoElement.muted}`);
                                                    unmuteBanner.remove();
                                                    videoContainer.removeEventListener('click', unmuteFn);
                                                }
                                            });
                                        }
                                    }
                                })
                                .catch(mutePlayError => {
                                    console.error(`[IncomingCall] Muted play() attempt ALSO FAILED for ${callerDisplayName}. Error: ${mutePlayError.name} - ${mutePlayError.message}`);
                                });
                        } else {
                            console.error(`[IncomingCall] Playback failed for ${callerDisplayName} with an error other than NotAllowedError: ${e.name} - ${e.message}`);
                        }
                    });
            });

            updateVideoContainerBasedOnStream(callerPeerId, remoteUserStream, callerDisplayName);

            // If the user is the host, update the video container styles
            if (IS_HOST) {
                updateVideoContainerHostStyles(); 
            }
        });

        call.on('close', () => {
            console.log(`[IncomingCall] Call with ${callerDisplayName} (${callerPeerId}) closed. Removing video container.`);
            const containerToRemove = document.querySelector(`.video-participant[data-peer-id='${callerPeerId}']`);
            if (containerToRemove) containerToRemove.remove();
            else console.warn(`[IncomingCall] Could not find .video-participant[data-peer-id="${callerPeerId}"] to remove. This is unexpected as it should have been created by setupPeerVideoContainer.`);
            delete peers[callerPeerId];
            updateParticipantCount();
        });

        call.on('error', (err) => {
            console.error(`[IncomingCall] PeerJS call error with ${callerDisplayName} (${callerPeerId}):`, err);
            const containerToRemove = document.querySelector(`.video-participant[data-peer-id='${callerPeerId}']`);
            if (containerToRemove) containerToRemove.remove();
            else console.warn(`[IncomingCall] Could not find video container for errored call with ${callerPeerId}`);
            delete peers[callerPeerId];
            updateParticipantCount();
        });

        peers[callerPeerId] = call;
    });

    myPeer.on('error', (err) => {
        console.error('PeerJS error:', err);
        alert(`PeerJS connection error: ${err.message}. You might need to refresh or check network settings.`);
        // Could attempt to re-initialize or guide user
    });
}

async function setupLocalMedia() {
    const joinWithVideoOff = document.getElementById('joinWithVideoOff');
    const videoInitiallyRequested = !joinWithVideoOff.checked;
    let streamAttemptSuccessful = false;

    console.log(`[MediaSetup] Starting. Video requested by user: ${videoInitiallyRequested}`);

    try {
        const constraints = {
            video: videoInitiallyRequested,
            audio: true
        };
        console.log('[MediaSetup] Attempting to get media with constraints:', constraints);
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localUserHasVideo = videoInitiallyRequested && localStream.getVideoTracks().length > 0;
        streamAttemptSuccessful = true;
        console.log(`[MediaSetup] Successfully acquired stream. Has video: ${localUserHasVideo}`);

    } catch (err) {
        console.warn(`[MediaSetup] Initial media request failed:`, err.name, err.message);
        // If they wanted video but it failed, try audio-only as a fallback.
        if (videoInitiallyRequested) {
            console.log('[MediaSetup] Fallback: Attempting to acquire audio-only stream...');
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                localUserHasVideo = false;
                streamAttemptSuccessful = true;
                console.log('[MediaSetup] Fallback to audio-only successful.');
                if (toggleVideoBtn) {
                    toggleVideoBtn.innerHTML = '🚫&nbsp;Cam';
                    toggleVideoBtn.disabled = true;
                }
            } catch (audioErr) {
                console.error('[MediaSetup] Fallback to audio-only also failed:', audioErr.name, audioErr.message);
                // Dummy stream creation will happen below if streamAttemptSuccessful is false
            }
        }
    }

    // If all attempts failed, create a dummy stream.
    if (!streamAttemptSuccessful) {
        console.log('[MediaSetup] All media attempts failed. Creating dummy stream.');
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.fillRect(0, 0, 1, 1);
        localStream = canvas.captureStream ? canvas.captureStream() : new MediaStream(); 
        
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const audioContext = new AudioContext();
            const oscillator = audioContext.createOscillator();
            const dst = audioContext.createMediaStreamDestination();
            oscillator.connect(dst);
            oscillator.start(0);
            const dummyAudioTrack = dst.stream.getAudioTracks()[0];
            if (dummyAudioTrack) {
                localStream.addTrack(dummyAudioTrack);
            }
        } else {
            console.warn("AudioContext not supported, dummy stream might lack audio track.");
        }

        localUserHasVideo = false;
        if (toggleAudioBtn) {
            toggleAudioBtn.innerHTML = '🚫&nbsp;Mic';
            toggleAudioBtn.disabled = true;
        }
        if (toggleVideoBtn) {
            toggleVideoBtn.innerHTML = '🚫&nbsp;Cam';
            toggleVideoBtn.disabled = true;
        }
    }

    // Common setup for local video element, regardless of stream source
    if (localVideo && localStream) {
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Mute local video playback to prevent echo
        localVideo.play().catch(e => console.error("Error playing local video:", e));
    }
    updateMediaButtonStates(); // Update buttons based on final localStream state

    await populateCameraList(); // Populate camera list after any stream attempt

    // Handle alerts and local avatar display
    if (!streamAttemptSuccessful) {
        console.warn('Could not access camera or microphone. User will join without media, but can still chat.');
        const localVideoOuterContainer = document.getElementById('localVideoOuterContainer');
        if (localVideoOuterContainer && localVideo) {
             displayAvatar(localVideoOuterContainer, localVideo, displayName, true);
        }
    } else if (!localUserHasVideo && streamAttemptSuccessful) { // Has audio, but no video (either by choice or by fallback)
        console.warn('User is joining with audio only.');
        const localVideoOuterContainer = document.getElementById('localVideoOuterContainer');
        if (localVideoOuterContainer && localVideo) {
             displayAvatar(localVideoOuterContainer, localVideo, displayName, true);
        }
    } else if (localUserHasVideo) { // Has video, ensure no avatar is shown
        const localVideoOuterContainer = document.getElementById('localVideoOuterContainer');
        if (localVideoOuterContainer) {
            const existingAvatar = localVideoOuterContainer.querySelector('.participant-avatar-img');
            if (existingAvatar) existingAvatar.remove();
            if(localVideo) localVideo.classList.remove('audio-only-video');
        }
    }
}

async function populateCameraList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.log("enumerateDevices() not supported.");
        if (cameraSelect) cameraSelect.style.display = 'none';
        return;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        if (cameraSelect) {
            const currentSelectedValue = cameraSelect.value;
            cameraSelect.innerHTML = ''; // Clear existing options

            if (videoDevices.length > 1) {
                cameraSelect.style.display = 'inline-block'; // Show dropdown
                
                const currentVideoTrack = localStream && localStream.getVideoTracks().length > 0 ? localStream.getVideoTracks()[0] : null;
                let currentDeviceId = currentVideoTrack ? currentVideoTrack.getSettings().deviceId : null;

                videoDevices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.text = device.label || `Camera ${cameraSelect.options.length + 1}`;
                    cameraSelect.appendChild(option);
                });

                // Try to re-select the previously selected device, or the current stream's device, or the first device
                if (videoDevices.some(d => d.deviceId === currentSelectedValue)) {
                    cameraSelect.value = currentSelectedValue;
                } else if (currentDeviceId && videoDevices.some(d => d.deviceId === currentDeviceId)) {
                    cameraSelect.value = currentDeviceId;
                } else if (videoDevices.length > 0) {
                    cameraSelect.value = videoDevices[0].deviceId;
                }

            } else {
                cameraSelect.style.display = 'none'; // Hide if 0 or 1 camera
            }
        }
    } catch (err) {
        console.error('Error populating camera list:', err);
        if (cameraSelect) cameraSelect.style.display = 'none';
    }
}

if (cameraSelect) {
    cameraSelect.addEventListener('change', async () => {
        const selectedDeviceId = cameraSelect.value;
        if (!selectedDeviceId || !localStream) {
            console.warn('Camera selection change aborted. No device ID or localStream.');
            return;
        }

        console.log(`Attempting to switch to camera: ${selectedDeviceId}`);

        // Stop current video tracks from the old stream
        localStream.getVideoTracks().forEach(track => {
            console.log('Stopping old video track:', track.label, track.id);
            track.stop();
        });

        const newConstraints = {
            video: { deviceId: { exact: selectedDeviceId } },
            audio: localStream.getAudioTracks().length > 0 // Keep audio if it was present
        };
        
        try {
            const newStream = await navigator.mediaDevices.getUserMedia(newConstraints);
            console.log('Successfully acquired new stream for camera switch.');
            
            localVideo.srcObject = newStream;
            localStream = newStream; // Update global localStream
            localUserHasVideo = newStream.getVideoTracks().length > 0;
            updateMediaButtonStates();

            // Update stream for all connected peers
            for (const peerId in peers) {
                const call = peers[peerId];
                if (call && call.peerConnection) {
                    const videoSender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender && newStream.getVideoTracks().length > 0) {
                        try {
                            await videoSender.replaceTrack(newStream.getVideoTracks()[0]);
                            console.log(`Replaced video track for peer: ${peerId}`);
                        } catch (replaceErr) {
                            console.error(`Error replacing track for peer ${peerId}:`, replaceErr);
                        }
                    } else if (videoSender && newStream.getVideoTracks().length === 0) {
                        console.warn(`New stream has no video track for peer ${peerId}, removing sender track.`);
                        // call.peerConnection.removeTrack(videoSender); // Or handle by sending a 'video-off' signal
                    }
                }
            }
            await populateCameraList(); // Re-populate to update selection in dropdown
        } catch (err) {
            console.error('Error switching camera:', err);
            alert(`Failed to switch camera: ${err.message}. Attempting to restore media.`);
            // Attempt to re-initialize media to a stable state if switch fails
            await setupLocalMedia(); 
        }
    });
}

function displayAvatar(container, videoElementToHide, userName, isLocal = false) {
    // Remove existing avatar if any to prevent duplicates
    const existingAvatar = container.querySelector('.participant-avatar-img');
    if (existingAvatar) existingAvatar.remove();

    const avatarImg = document.createElement('img');
    avatarImg.src = '/default_avatar.svg'; // Use the newly created SVG avatar
    avatarImg.alt = userName ? `${userName} (no video)` : 'User (no video)';
    avatarImg.classList.add('participant-avatar-img');
    if (isLocal) {
        avatarImg.classList.add('local-avatar');
    }

    if (videoElementToHide) {
        videoElementToHide.style.display = 'none'; // Explicitly hide video, avatar will show
        // container.classList.add('audio-only-container'); // Optional: for styling container
        // Insert avatar before the video element if it's a direct child, or just append
        if (videoElementToHide.parentElement === container) {
            container.insertBefore(avatarImg, videoElementToHide);
        } else {
            // Fallback or specific logic if videoElement is not a direct child
            // For now, assume we want the avatar as a primary visual in the container
            const videoSibling = container.querySelector('video');
            if (videoSibling) {
                 container.insertBefore(avatarImg, videoSibling);
            } else {
                 container.appendChild(avatarImg);
            }
        }
    } else {
         container.appendChild(avatarImg);
    }
}

function setupPeerVideoContainer(peerId, displayName, initialHasVideo) {
    console.log(`[SetupPeerVideoContainer] Called for ${displayName} (${peerId}). InitialHasVideo: ${initialHasVideo}`);
    const videoContainer = document.createElement('div');
    videoContainer.classList.add('video-participant');
    videoContainer.setAttribute('data-peer-id', peerId); // Set peerId on container for easier lookup

    const video = document.createElement('video');
    video.setAttribute('data-peer-id', peerId);

    const nameTag = document.createElement('p');
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.classList.add('fullscreen-btn');
    fullscreenBtn.innerHTML = '🖼️';
    fullscreenBtn.title = 'Toggle Fullscreen';
    fullscreenBtn.addEventListener('click', () => {
        toggleFullscreen(video);
    });

    const currentUserData = currentRoomUsersState.find(user => user.id === peerId);
    const definitiveHasVideo = currentUserData ? currentUserData.hasVideo : initialHasVideo;
    const definitiveDisplayName = currentUserData ? currentUserData.name : displayName;

    nameTag.textContent = definitiveDisplayName || `User ${peerId.substring(0,5)}`;
    console.log(`[SetupPeerVideoContainer] For ${peerId}, definitiveHasVideo: ${definitiveHasVideo}, definitiveDisplayName: ${definitiveDisplayName}`);

    // Append all core elements. Video and fullscreenBtn might be hidden/shown based on definitiveHasVideo.
    videoContainer.append(video, fullscreenBtn, nameTag);

    if (definitiveHasVideo) {
        const existingAvatar = videoContainer.querySelector('.participant-avatar-img');
        if (existingAvatar) existingAvatar.remove();
        video.style.display = '';
        fullscreenBtn.style.display = ''; // Make button visible
        video.classList.remove('audio-only-video');
    } else {
        displayAvatar(videoContainer, video, definitiveDisplayName, false); // This hides video
        fullscreenBtn.style.display = 'none'; // Hide button if no video
        // video element is already in videoContainer, displayAvatar will hide it.
        // nameTag is already appended.
    }

    videoGrid.append(videoContainer);
    updateParticipantCount();
    console.log(`[SetupPeerVideoContainer] Finished appending container for ${definitiveDisplayName} (${peerId}) to videoGrid.`);
    return { videoElement: video, videoContainerElement: videoContainer };
}

// Emoji Picker Functionality
const spicyCuteEmojis = ['🍒', '🍑', '🌶️', '💋', '😘', '😉', '😈', '🔥', '💖', '💦', '🍭', '🍩', '🍾', '🥂', '🍓', '🍌', '🍆', '🍦', '🎀', '✨', '😏', '🤤', '💅', '💄', '😇', '🥵', '🤯', '🥳', '👯', '💃', '🕺', '👀', '👅', '👄', '🌹', '🍫', '🎁', '🎈', '🎉', '🎊', '💘', '💝', '💌', '💍', '💎', '👑', '🧸', '❤️‍🔥', '💯'];

function populateEmojiPanel() {
    if (!emojiPanel) return;
    emojiPanel.innerHTML = ''; // Clear existing emojis
    spicyCuteEmojis.forEach(emoji => {
        const emojiSpan = document.createElement('span');
        emojiSpan.classList.add('emoji-item');
        emojiSpan.textContent = emoji;
        emojiSpan.addEventListener('click', () => {
            chatInput.value += emoji;
            emojiPanel.style.display = 'none';
            chatInput.focus();
        });
        emojiPanel.appendChild(emojiSpan);
    });
}

if (emojiPickerBtn && emojiPanel && chatInput) {
    emojiPickerBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent click from immediately closing panel via document listener
        const isPanelVisible = emojiPanel.style.display === 'flex';
        emojiPanel.style.display = isPanelVisible ? 'none' : 'flex';
        if (!isPanelVisible && emojiPanel.children.length === 0) {
             // Populate only if not visible and empty, or always repopulate if emojis could change
            populateEmojiPanel();
        }
    });

    // Close emoji panel if clicked outside
    document.addEventListener('click', (event) => {
        if (emojiPanel.style.display === 'flex' && !emojiPanel.contains(event.target) && event.target !== emojiPickerBtn) {
            emojiPanel.style.display = 'none';
        }
    });
}

// Initial population of the panel (can be done on first click too)
// populateEmojiPanel(); // Or call it when button is first clicked as done above

// Socket.IO event handlers
socket.on('user-connected', (peerId, newDisplayName, newUserHasVideo) => {
    console.log('User connected:', peerId, newDisplayName);
    if (peerId === MY_PEER_ID) return; // Don't connect to self
    connectToNewUser(peerId, newDisplayName, localStream, newUserHasVideo);
});

function connectToNewUser(peerId, newDisplayName, localUserStream, newUserHasVideo) { // Renamed stream to localUserStream for clarity
    connectSound.play().catch(e => console.error("Error playing connect sound for new user:", e));
    console.log(`[ConnectToNewUser] Setting up container for ${newDisplayName} (${peerId}) with initialHasVideo: ${newUserHasVideo}`);
    const { videoElement, videoContainerElement } = setupPeerVideoContainer(peerId, newDisplayName, newUserHasVideo);

    // Add a short delay (800ms) before calling new users
    // This gives iOS/mobile devices time to initialize their media and PeerJS connection
    // before the host tries to establish a connection with them
    console.log(`[ConnectToNewUser] Waiting 800ms before calling ${newDisplayName} (${peerId}) to ensure their connection is ready...`);
    setTimeout(() => {
        console.log(`[ConnectToNewUser] Now calling user ${newDisplayName} (${peerId}) with local stream.`);
        if (localUserStream) {
            console.log(`[ConnectToNewUser] Unmuting all tracks in localStream before calling ${newDisplayName} (${peerId}).`);
            localUserStream.getTracks().forEach(track => {
                track.muted = false;
            });
        }
        const call = myPeer.call(peerId, localUserStream);

        if (!call) {
            console.error(`[ConnectToNewUser] Failed to initiate call to ${peerId}. Removing container.`);
            videoContainerElement.remove();
            updateParticipantCount();
            return;
        }

        call.on('stream', (remoteUserStream) => {
            console.log(`[ConnectToNewUser] Received stream from ${newDisplayName} (${peerId}). Stream ID: ${remoteUserStream.id}, Active: ${remoteUserStream.active}`);
            const videoTracks = remoteUserStream.getVideoTracks();
            const audioTracks = remoteUserStream.getAudioTracks();
            console.log(`[ConnectToNewUser] Stream from ${newDisplayName} (${peerId}) - Video Tracks: ${videoTracks.length}, Audio Tracks: ${audioTracks.length}`);

            videoTracks.forEach((track, i) => {
                console.log(`[ConnectToNewUser]   Video Track ${i} (${newDisplayName}): Label='${track.label}', Kind='${track.kind}', ReadyState='${track.readyState}', Muted='${track.muted}', Enabled='${track.enabled}'`);
            });
            audioTracks.forEach((track, i) => {
                console.log(`[ConnectToNewUser]   Audio Track ${i} (${newDisplayName}): Label='${track.label}', Kind='${track.kind}', ReadyState='${track.readyState}', Muted='${track.muted}', Enabled='${track.enabled}'`);
            });

            if (videoTracks.length === 0 && audioTracks.length === 0) {
                console.warn(`[ConnectToNewUser] Stream from ${newDisplayName} (${peerId}) has NO video and NO audio tracks.`);
            }

            videoElement.srcObject = remoteUserStream;
            videoElement.addEventListener('loadedmetadata', () => {
                videoElement.play().catch(e => console.error(`Error playing remote stream for ${newDisplayName}:`, e));
            });
            // Ensure UI updates correctly based on actual track presence
            // Add a small delay to ensure the video container is fully created and in the DOM
            setTimeout(() => {
                updateVideoContainerBasedOnStream(peerId, remoteUserStream, newDisplayName);
            }, 100);
            

        });
        call.on('close', () => {
            console.log(`[ConnectToNewUser] Call with ${newDisplayName} (${peerId}) closed. Removing video container.`);
            const containerToRemove = document.querySelector(`.video-participant[data-peer-id='${peerId}']`);
            if (containerToRemove) containerToRemove.remove();
            else console.warn(`[ConnectToNewUser] Could not find video container for closed call with ${peerId}`);
            delete peers[peerId];
            updateParticipantCount();
        });
        call.on('error', (err) => {
            console.error(`[ConnectToNewUser] PeerJS call error with ${newDisplayName} (${peerId}):`, err);
            const containerToRemove = document.querySelector(`.video-participant[data-peer-id='${peerId}']`);
            if (containerToRemove) containerToRemove.remove();
            else console.warn(`[ConnectToNewUser] Could not find video container for errored call with ${peerId}`);
            delete peers[peerId];
            updateParticipantCount();
        });
        peers[peerId] = call;
    }, 800); // 800ms delay
}

socket.on('display-client-log', (data) => {
    if (IS_HOST) {
        const { originalPeerId, logData } = data;
        // Reconstruct the message string if needed, or ensure logData.message is complete
        // The formatArgsForLog was applied on the client before sending, so logData.message should be a string.
        routeDebugMessage(logData.message, logData.type, originalPeerId);
    }
});

socket.on('user-disconnected', (peerId, oldDisplayName) => {
    disconnectSound.play().catch(e => console.error("Error playing disconnect sound:", e));
    console.log('User disconnected:', peerId, oldDisplayName);
    if (peers[peerId]) {
        peers[peerId].close(); // Close the PeerJS connection
        delete peers[peerId];
    }
    // Video element removal is handled by the 'close' event of the call
    const videoToRemove = videoGrid.querySelector(`video[data-peer-id="${peerId}"]`);
    if (videoToRemove && videoToRemove.parentElement) {
        videoToRemove.parentElement.remove();
    }
    updateParticipantCount();
});

socket.on('peer-media-status-changed', (data) => {
    console.log(`[MediaStatusChangedHandler] Received peer-media-status-changed:`, data);
    const { peerId, hasVideo } = data;
    console.log(`[MediaStatusChanged] Peer ${peerId} video status changed to: ${hasVideo}`);

    const videoElement = document.querySelector(`video[data-peer-id="${peerId}"]`);
    if (!videoElement) {
        console.warn(`[MediaStatusChanged] Video element for peer ${peerId} not found.`);
        return;
    }

    const userContainer = videoElement.closest('.video-participant');
    if (!userContainer) {
        console.warn(`[MediaStatusChanged] User container for peer ${peerId} not found.`);
        return;
    }

    // Update the 'participants' object if it's being used to store this state globally.
    // For now, direct DOM manipulation based on existing functions.
    if (typeof participants !== 'undefined' && participants[peerId]) {
        participants[peerId].hasVideo = hasVideo;
    }

    const fullscreenBtn = userContainer.querySelector('.fullscreen-btn');

    if (data.hasVideo) {
        videoElement.style.display = '';
        if (fullscreenBtn) fullscreenBtn.style.display = '';
        videoElement.classList.remove('audio-only-video');
        const avatarElement = userContainer.querySelector('.participant-avatar-img');
        if (avatarElement) avatarElement.remove();
    } else {
        const userData = currentRoomUsersState.find(user => user.id === peerId);
        const userName = userData ? userData.name : `User ${peerId.substring(0,5)}`;
        console.log(`[MediaStatusChanged] Peer ${peerId} (${userName}) has no video. Displaying avatar.`);
        displayAvatar(userContainer, videoElement, userName, false); // This hides videoElement
        if (fullscreenBtn) fullscreenBtn.style.display = 'none';
    }
});

// Chat functionality
function appendChatMessage(data) {
    console.log('[Chat] appendChatMessage called with data:', data);
    if (!data || !data.message || !data.name) {
        console.error('[Chat] Invalid data received for appendChatMessage:', data);
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    const senderName = data.isHost ? `<strong>${escapeHTML(data.name)} (Host)</strong>` : escapeHTML(data.name);

    messageElement.innerHTML = `${senderName}: ${escapeHTML(data.message)}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    console.log('[Chat] Chat message appended to UI.');
}

socket.on('chat-message', (data) => {
    console.log('[Chat] Received chat-message event from server:', data);
    appendChatMessage(data);
});

if (sendChatBtn && chatInput) {
    const sendMyChatMessage = () => {
        const message = chatInput.value.trim();
        console.log(`[Chat] Send button clicked. Message: "${message}"`);
        if (message) {
            console.log('[Chat] Message is not empty, emitting send-chat-message to server.');
            socket.emit('send-chat-message', { roomId: ROOM_ID, message: message });
            chatInput.value = '';
            console.log('[Chat] Chat input cleared.');
        } else {
            console.warn('[Chat] Message input is empty. Nothing sent.');
        }
    };

    sendChatBtn.addEventListener('click', sendMyChatMessage);

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            console.log('[Chat] Enter key pressed in chat input.');
            sendMyChatMessage();
        }
    });
}

// User list and participant count
function updateUserList(users) {
    currentRoomUsersState = users; // Update the global state with the latest user list
    console.log('[DEBUG] updateUserList called. Incoming users:', JSON.stringify(users.map(u => u.id)), 'Current selectedPeerIdForModeration:', selectedPeerIdForModeration);
    console.log('Updating user list:', users);

    // --- Sound notifications for host on user connect/disconnect ---
    if (IS_HOST) {
        const previousUserIds = new Set(currentUsersMap.keys());
        const newUserIds = new Set(users.map(u => u.id));

        if (audioContext && audioContext.state === 'suspended') { 
            audioContext.resume().catch(err => console.error("AudioContext resume failed during user list update:", err));
        }

        // Detect disconnections (user was in old list, not in new list, and is not the host themselves)
        previousUserIds.forEach(peerId => {
            if (!newUserIds.has(peerId) && peerId !== MY_PEER_ID) { 
                console.log(`Host detected disconnect: ${currentUsersMap.get(peerId)?.name || peerId}`);
                playSynthSound('disconnect');
            }
        });

        // Detect new connections (user is in new list, was not in old list, and is not the host themselves)
        newUserIds.forEach(peerId => {
            if (!previousUserIds.has(peerId) && peerId !== MY_PEER_ID) { 
                const newUser = users.find(u => u.id === peerId);
                console.log(`Host detected connect: ${newUser?.name || peerId}`);
                playSynthSound('connect');
            }
        });

        // Update the currentUsersMap *after* comparisons
        currentUsersMap.clear();
        users.forEach(user => {
            currentUsersMap.set(user.id, user);
        });
    }
    // --- End sound notifications ---
    hostPeerId = null; // Reset before checking to correctly identify current host
    if (userListElement) userListElement.innerHTML = ''; // Clear existing list
    let localUserInList = false;

    users.forEach(user => {
        if (user.isHost) {
            hostPeerId = user.id; // Update global hostPeerId
        }
        if (user.id === MY_PEER_ID) {
            localUserInList = true;
        }
        const li = document.createElement('li');
        li.textContent = `${user.name}${user.isHost ? ' (Host)' : ''}${user.id === MY_PEER_ID ? ' (You)' : ''}`;
        console.log(`[DEBUG] Creating LI for user: ${user.name}, peerId from user object: ${user.id}`);
        li.dataset.peerId = user.id;
        li.dataset.displayName = user.name;
        console.log(`[DEBUG] LI created. li.dataset.peerId: ${li.dataset.peerId}, li.dataset.displayName: ${li.dataset.displayName}`);
        li.classList.add('participant-item'); // Add class for querying selected item details

        if (user.isHost) { // Add class for styling host in user list
            li.classList.add('is-host-in-list'); 
        }

        if (IS_HOST && user.id !== MY_PEER_ID) { // If I am host, make other users clickable for host actions
            li.classList.add('host-selectable-user'); // Renamed for clarity
            li.addEventListener('click', () => {
                const kickButton = document.getElementById('kickUserBtn');
                const banButton = document.getElementById('banUserBtn');

                if (selectedPeerIdForModeration === li.dataset.peerId) { // Use li.dataset.peerId
                    // Deselect if clicking the same user again
                    selectedPeerIdForModeration = null;
                    console.log(`[DEBUG] User DESELECTED via click (was ${li.dataset.displayName}, ${li.dataset.peerId}). selectedPeerIdForModeration is now: ${selectedPeerIdForModeration}`); // Use li.dataset values
                    li.classList.remove('selected-user');
                    if (kickButton) kickButton.disabled = true;
                    if (banButton) banButton.disabled = true;
                    console.log("[DEBUG] Moderation buttons DISABLED.");
                } else {
                    // Remove selection from previously selected user
                    const currentlySelected = userListElement.querySelector('.selected-user');
                    if (currentlySelected) {
                        currentlySelected.classList.remove('selected-user');
                    }
                    // Select new user
                    console.log(`[DEBUG] Inside click listener. Value of li.dataset.peerId about to be assigned:`, li.dataset.peerId);
                    selectedPeerIdForModeration = li.dataset.peerId; // Use li.dataset.peerId
                    li.classList.add('selected-user');
                    console.log(`[DEBUG] User selected via click: ${li.dataset.displayName} (${li.dataset.peerId}). selectedPeerIdForModeration is now: ${selectedPeerIdForModeration}`); // Use li.dataset values
                    if (kickButton) kickButton.disabled = false;
                    if (banButton) banButton.disabled = false;
                    console.log("[DEBUG] Moderation buttons ENABLED.");
                }
            });
        }

        // If this user is the currently selected one for moderation, re-apply class
        if (user.id === selectedPeerIdForModeration) {
            li.classList.add('selected-user');
        } 
        // This part is tricky: if selectedPeerIdForModeration is set, but that peerId is NOT in the current 'users' array,
        // selectedPeerIdForModeration remains set, but no item gets the 'selected-user' class from this loop.
        // The button state is then determined by whether selectedPeerIdForModeration still has a value at the end of the function.

        if (userListElement) userListElement.appendChild(li);
    });

    // If local user was not in the initial list (e.g., host just created room and list is not yet updated with self for some reason),
    // or if the list came empty and this client is the host.
    if (!localUserInList && MY_PEER_ID) {
        const li = document.createElement('li');
        li.textContent = `${effectiveDisplayName}${IS_HOST ? ' (Host)' : ''} (You)`; // Use effectiveDisplayName for local user
        li.dataset.peerId = MY_PEER_ID;
        li.dataset.displayName = effectiveDisplayName; // Set displayName for local user
        if (IS_HOST) { // If this client is host, ensure hostPeerId is set
            hostPeerId = MY_PEER_ID;
        }
        // Ensure this manually added LI is also appended to the list if userListElement exists
        if (userListElement) userListElement.appendChild(li);
    } // Closes 'if (!localUserInList && MY_PEER_ID)'
    if (userCountElement) userCountElement.textContent = users.length;
    updateParticipantCount(); // Also update the video grid based count

    // Check if the previously selected user is still in the list. If not, selectedPeerIdForModeration might be stale.
    if (selectedPeerIdForModeration && !users.some(u => u.id === selectedPeerIdForModeration)) {
        console.log(`[DEBUG] selectedPeerIdForModeration (${selectedPeerIdForModeration}) is set, but user not found in current users array. This might lead to issues if not handled. Consider clearing selection.`);
        // Potentially: selectedPeerIdForModeration = null; // Uncomment to aggressively clear if selected user disappears
    }

    // After list is rebuilt, ensure button states reflect selectedPeerIdForModeration
    const kickButton = document.getElementById('kickUserBtn');
    const banButton = document.getElementById('banUserBtn');
    if (IS_HOST && kickButton && banButton) { // Ensure buttons exist
        if (selectedPeerIdForModeration) {
            kickButton.disabled = false;
            banButton.disabled = false;
            console.log("[DEBUG] Moderation buttons ENABLED after list update.");
        } else {
            kickButton.disabled = true;
            banButton.disabled = true;
            console.log("[DEBUG] Moderation buttons DISABLED after list update.");
        }
    }

    // Apply host styles to video containers after updating user list and identifying hostPeerId
    updateVideoContainerHostStyles();
}

function updateVideoContainerHostStyles() {
    const isClientHost = (hostPeerId === MY_PEER_ID);

    if (videoGrid) {
        if (hostPeerId) { // If a host exists in the room
            videoGrid.classList.add('host-prominent');
        } else {
            videoGrid.classList.remove('host-prominent');
        }
    }

    // If a host exists, try to move their video to the top of the grid for visual priority
    if (hostPeerId && videoGrid && videoGrid.classList.contains('host-prominent')) {
        const hostVideoElement = videoGrid.querySelector(`.video-participant[data-peer-id="${hostPeerId}"]`);
        if (hostVideoElement && videoGrid.firstChild !== hostVideoElement) {
            videoGrid.prepend(hostVideoElement);
            console.log(`[DEBUG] Prepended host video (${hostPeerId}) to videoGrid.`);
        }
    }

    const localVideoContainerElement = document.getElementById('localVideoOuterContainer');
    if (localVideoContainerElement) {
        if (isClientHost) {
            localVideoContainerElement.classList.add('host-video');
            localVideoContainerElement.classList.remove('host-video-display-large'); // Host doesn't see self as extra large
        } else {
            localVideoContainerElement.classList.remove('host-video');
            localVideoContainerElement.classList.remove('host-video-display-large'); // Non-host's own video is normal
        }
    }

    // For all remote participant video containers
    document.querySelectorAll('.video-participant').forEach(container => {
        const isThisContainerTheHostVideo = (hostPeerId && container.dataset.peerId === hostPeerId);

        if (isThisContainerTheHostVideo) {
            container.classList.add('host-video');
            if (!isClientHost) { // If current client is NOT the host, make host's video large for them
                container.classList.add('host-video-display-large');
            } else { // If current client IS the host, they see other videos (including a potential other host's video if logic changed) normally
                container.classList.remove('host-video-display-large');
            }
        } else { // This container is for a non-host participant, or no host is defined
            container.classList.remove('host-video');
            container.classList.remove('host-video-display-large');
        }
    });
}

socket.on('update-user-list', (users) => {
    updateUserList(users); // This will call updateVideoContainerHostStyles internally
});

function updateParticipantCount() {
    const participantCountElement = document.getElementById('participantCount');
    if (!participantCountElement) {
        // console.warn('#participantCount element not found.'); // Optional: keep for debugging
        return;
    }

    if (IS_HOST) { 
        participantCountElement.style.display = 'inline-block'; // Or 'block', 'flex' as appropriate

        // Count active video containers. Assumes each container represents one participant (local or remote).
        const localVideoContainerElement = document.getElementById('localVideoOuterContainer');
        const remoteVideoContainers = videoGrid.querySelectorAll('.video-participant:not(#localVideoOuterContainer)');
        
        let count = 0;
        if (localVideoContainerElement && localVideoContainerElement.querySelector('video')) count++; // Count local if video exists
        remoteVideoContainers.forEach(container => {
            if (container.querySelector('video')) count++; // Count remote if video exists
        });

        participantCountElement.textContent = `Users: ${count}`;
    } else {
        participantCountElement.style.display = 'none';
    }
}

// Media controls
if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => {
        if (!localStream) return;
        const audioTrack = localStream.getAudioT
        racks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleAudioBtn.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
        }
    });
}
if (toggleVideoBtn) {
    toggleVideoBtn.addEventListener('click', () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleVideoBtn.textContent = videoTrack.enabled ? 'Stop Video' : 'Start Video';
        }
    });
}
function updateMediaButtonStates() {
    if (!localStream) return;
    const audioEnabled = localStream.getAudioTracks()[0]?.enabled;
    const videoEnabled = localStream.getVideoTracks()[0]?.enabled;
    if (toggleAudioBtn) toggleAudioBtn.textContent = audioEnabled ? 'Mute Mic' : 'Unmute Mic';
    if (toggleVideoBtn) toggleVideoBtn.textContent = videoEnabled ? 'Stop Video' : 'Start Video';
}

function setupHostControlsListeners() {
    if (!IS_HOST) return; // Only for host

    const kickButton = document.getElementById('kickUserBtn');
    const banButton = document.getElementById('banUserBtn');
    const userListElementForModeration = document.getElementById('userList'); // For finding selected user's name
    console.log('[HostControls] Fetched userListElementForModeration:', userListElementForModeration);

    if (kickButton) {
        // Remove any existing listener to prevent duplicates if this function is called multiple times
        const newKickButton = kickButton.cloneNode(true);
        kickButton.parentNode.replaceChild(newKickButton, kickButton);
        console.log('[HostControls] Replaced old kickButton with new one to avoid duplicate listeners.');
        newKickButton.addEventListener('click', () => {
            console.log('[HostControls] Kick button clicked. selectedPeerIdForModeration:', selectedPeerIdForModeration, 'Is button disabled?', newKickButton.disabled);
            if (selectedPeerIdForModeration) {
                const selectedListItem = userListElementForModeration ? userListElementForModeration.querySelector(`.participant-item[data-peer-id="${selectedPeerIdForModeration}"]`) : null;
                console.log('[HostControls] Kick Action: Attempting to find selected list item:', selectedListItem);
                const selectedUserName = selectedListItem ? selectedListItem.dataset.displayName : 'the selected user';
                // Restore null check that was previously removed by tool
                if (!selectedListItem && userListElementForModeration) { 
                    // This case should ideally not happen if selectedPeerIdForModeration is valid and UI is consistent
                    console.warn('[HostControls] Kick Action: selectedListItem is null even though userListElementForModeration exists. Peer ID:', selectedPeerIdForModeration);
                }
                const confirmKick = confirm(`Are you sure you want to kick ${selectedUserName} (Peer ID: ${selectedPeerIdForModeration})?`);
                console.log(`[HostControls] Confirmation to kick ${selectedUserName}: ${confirmKick}`);
                if (confirmKick) {
                    console.log(`[HostControls] Emitting 'kick-user' to server for peerId: ${selectedPeerIdForModeration}`);
                    socket.emit('kick-user', selectedPeerIdForModeration);
                    console.log(`[DEBUG] Emitted 'kick-user' for peerId: ${selectedPeerIdForModeration}`);
                    if (selectedListItem) selectedListItem.classList.remove('selected-user');
                    selectedPeerIdForModeration = null;
                    newKickButton.disabled = true;
                    if (banButton) banButton.disabled = true; // Use the original banButton ref or re-fetch
                    console.log("[DEBUG] Moderation buttons DISABLED after kick.");
                }
            } else {
                alert('Please select a user to kick.');
            }
        });
    }

    if (banButton) {
        const newBanButton = banButton.cloneNode(true);
        banButton.parentNode.replaceChild(newBanButton, banButton);
        console.log('[HostControls] Replaced old banButton with new one to avoid duplicate listeners.');
        newBanButton.addEventListener('click', () => {
            console.log('[HostControls] Ban button clicked. selectedPeerIdForModeration:', selectedPeerIdForModeration, 'Is button disabled?', newBanButton.disabled);
            if (selectedPeerIdForModeration) {
                const selectedListItem = userListElementForModeration ? userListElementForModeration.querySelector(`.participant-item[data-peer-id="${selectedPeerIdForModeration}"]`) : null;
                console.log('[HostControls] Ban Action: Attempting to find selected list item:', selectedListItem);
                const selectedUserName = selectedListItem ? selectedListItem.dataset.displayName : 'the selected user';
                // Restore null check that was previously removed by tool
                if (!selectedListItem && userListElementForModeration) {
                    console.warn('[HostControls] Ban Action: selectedListItem is null even though userListElementForModeration exists. Peer ID:', selectedPeerIdForModeration);
                }
                const confirmBan = confirm(`Are you sure you want to BAN ${selectedUserName} (Peer ID: ${selectedPeerIdForModeration})? This will be an IP ban for this room.`);
                console.log(`[HostControls] Confirmation to ban ${selectedUserName}: ${confirmBan}`);
                if (confirmBan) {
                    console.log(`[HostControls] Emitting 'ban-user' to server for peerId: ${selectedPeerIdForModeration}`);
                    socket.emit('ban-user', selectedPeerIdForModeration);
                    if (selectedListItem) selectedListItem.classList.remove('selected-user');
                    selectedPeerIdForModeration = null; // User was banned, clear selection
                    if (IS_HOST) disableModerationButtons(); // Disable buttons as no one is selected
                    newBanButton.disabled = true;
                    const kickBtnRef = document.getElementById('kickUserBtn'); // Re-fetch kick button if needed
                    if (kickBtnRef) kickBtnRef.disabled = true;
                    console.log("[DEBUG] Moderation buttons DISABLED after ban.");
                }
            } else {
                alert('Please select a user to ban.');
            }
        });
    }
    // Initial state: buttons disabled as no user is selected by default
    const finalKickButton = document.getElementById('kickUserBtn');
    const finalBanButton = document.getElementById('banUserBtn');
    if (finalKickButton) finalKickButton.disabled = true;
    if (finalBanButton) finalBanButton.disabled = true;

    // Event listeners for payment info buttons
    if (savePaymentInfoBtn) {
        savePaymentInfoBtn.addEventListener('click', () => {
            console.log('[PaymentInfo] Save button clicked.');
            const paymentInfo = {
                cashapp: cashappIdInput.value.trim(),
                paypal: paypalLinkInput.value.trim(),
                venmo: venmoIdInput.value.trim(),
                crypto: cryptoAddressInput.value.trim(),
            };
            console.log('[PaymentInfo] Emitting "set-payment-info" with data:', paymentInfo);
            socket.emit('set-payment-info', ROOM_ID, paymentInfo);
            alert('Payment info saved and will be pinned in chat.');
            console.log('[PaymentInfo] "set-payment-info" emitted.');
        });
    }

    if (clearPaymentInfoBtn) {
        clearPaymentInfoBtn.addEventListener('click', () => {
            console.log('[PaymentInfo] Clear button clicked.');
            console.log('[PaymentInfo] Emitting "clear-payment-info" for ROOM_ID:', ROOM_ID);
            socket.emit('clear-payment-info', ROOM_ID);
            if (cashappIdInput) cashappIdInput.value = '';
            if (paypalLinkInput) paypalLinkInput.value = '';
            if (venmoIdInput) venmoIdInput.value = '';
            if (cryptoAddressInput) cryptoAddressInput.value = '';
            alert('Pinned payment info cleared.');
            console.log('[PaymentInfo] "clear-payment-info" emitted and fields cleared.');
        });
    }
}

// Host controls
socket.on('set-as-host', () => {
    IS_HOST = true;
    hostPeerId = MY_PEER_ID; // Explicitly set hostPeerId for the current client

    if (!audioContext && IS_HOST) { // Initialize AudioContext when user becomes host
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') {
                console.log('AudioContext is suspended, attempting to resume for host...');
                audioContext.resume().catch(err => console.error("AudioContext initial resume failed for host:", err));
            }
        } catch (e) {
            console.error("Web Audio API is not supported or AudioContext creation failed for host.", e);
        }
    }
    console.log(`[HostStatus] This client (${MY_PEER_ID}) is now the host for room ${ROOM_ID}.`);
    console.log('[HostStatus] Initializing host-specific UI components (debug console, controls).');

    updateBodyHostViewClasses();
    updateVideoContainerHostStyles();
    updateParticipantCount();

    if (hostControlsDiv) {
        hostControlsDiv.style.display = 'block';
    }

    initializePageDebugConsole(); // Initialize host debug UI

    const localVideoContainerElement = document.getElementById('localVideoOuterContainer');
    if (localVideoContainerElement) {
        localVideoContainerElement.classList.add('host-video');
    }
    if (videoGrid) {
        videoGrid.classList.add('host-prominent');
    }

    setupHostControlsListeners(); // Set up listeners for kick/ban buttons

    // Re-render user list to make them clickable for host actions
    socket.emit('request-user-list', ROOM_ID);

    // Request current payment info for the room to populate host fields if they are host
    // Server will send 'payment-info-updated' which will be handled below
    // This ensures if host reloads, their fields are pre-filled.
    console.log('[PaymentInfo] Host is set. Emitting "request-payment-info" for ROOM_ID:', ROOM_ID);
    socket.emit('request-payment-info', ROOM_ID); 
});

function displayPinnedPaymentInfo(paymentInfo) {
    console.log('[PaymentInfo] displayPinnedPaymentInfo called with data:', paymentInfo);
    if (!pinnedPaymentInfoDisplay) {
        console.warn('[PaymentInfo] pinnedPaymentInfoDisplay element not found. Cannot display payment info.');
        return;
    }

    if (paymentInfo && Object.keys(paymentInfo).length > 0 &&
        (paymentInfo.cashapp || paymentInfo.paypal || paymentInfo.venmo || paymentInfo.crypto)) {
        console.log('[PaymentInfo] Updating pinned payment info display.');
        let content = '<strong>Host Payment Info:</strong><ul style="list-style: none; padding-left: 0;">';
        if (paymentInfo.cashapp) {
            content += `<li>💲 <strong>CashApp:</strong> ${escapeHTML(paymentInfo.cashapp)}</li>`;
        }
        if (paymentInfo.paypal) {
            content += `<li>🅿️ <strong>PayPal:</strong> ${escapeHTML(paymentInfo.paypal)}</li>`;
        }
        if (paymentInfo.venmo) {
            content += `<li>💠 <strong>Venmo:</strong> ${escapeHTML(paymentInfo.venmo)}</li>`;
        }
        if (paymentInfo.crypto) {
            content += `<li>₿ <strong>Crypto:</strong> ${escapeHTML(paymentInfo.crypto)}</li>`;
        }
        content += '</ul>';
        pinnedPaymentInfoDisplay.innerHTML = content;
        pinnedPaymentInfoDisplay.style.display = 'block';
    } else {
        pinnedPaymentInfoDisplay.innerHTML = '<p><em>No payment information is currently pinned.</em></p>';
        pinnedPaymentInfoDisplay.style.display = 'block';
        console.log('[PaymentInfo] No payment info to display or all fields empty. Displayed "No payment information" message.');
    }

    // If the current user is the host, also populate their input fields
    if (IS_HOST) {
        console.log('[PaymentInfo] Host detected, attempting to populate input fields from displayed info:', paymentInfo);
        if (cashappIdInput) cashappIdInput.value = paymentInfo?.cashapp || '';
        if (paypalLinkInput) paypalLinkInput.value = paymentInfo?.paypal || '';
        if (venmoIdInput) venmoIdInput.value = paymentInfo?.venmo || '';
        if (cryptoAddressInput) cryptoAddressInput.value = paymentInfo?.crypto || '';
        console.log('[PaymentInfo] Host input fields populated.');
    }
}

socket.on('payment-info-updated', (paymentInfo) => {
    console.log('[PaymentInfo] Received "payment-info-updated" event from server with data:', paymentInfo);
    displayPinnedPaymentInfo(paymentInfo);
});

socket.on('you-were-kicked', (data) => {
    console.warn('[Moderation] Received you-were-kicked event:', data);
    alert(`You have been kicked from the room by the host. Reason: ${data.reason || 'No reason specified.'}`);
    window.location.href = '/'; // Redirect to homepage
});

socket.on('you-were-banned', (data) => {
    console.warn('[Moderation] Received you-were-banned event:', data);
    alert(`You have been BANNED from the room by the host. Reason: ${data.reason || 'No reason specified.'} This is an IP ban for this room.`);
    window.location.href = '/'; // Redirect to homepage
});

socket.on('moderation-error', (data) => {
    console.error('[Moderation] Received moderation-error from server:', data);
    if (IS_HOST) {
        alert(`Moderation Action Failed: ${data.message}`);
        // Optionally, add to host debug console
        routeDebugMessage(`[Host Action Error] ${data.action}: ${data.message}`, 'error');
    }
});

socket.on('moderation-success', (data) => {
    console.log('[Moderation] Received moderation-success from server:', data);
    if (IS_HOST) {
        alert(`Moderation Action Succeeded: ${data.message}`);
        // Optionally, add to host debug console
        routeDebugMessage(`[Host Action Success] ${data.action} on ${data.targetPeerId}: ${data.message}`, 'log');
        // After a successful kick/ban, the user list will update. 
        // We might want to clear selectedPeerIdForModeration and disable buttons here too,
        // but updateUserList should also handle button states based on selectedPeerIdForModeration.
        // For now, let's assume updateUserList will refresh the state correctly.
        // Deselect user and disable buttons as the action is complete
        const kickButton = document.getElementById('kickUserBtn');
        const banButton = document.getElementById('banUserBtn');
        if (selectedPeerIdForModeration === data.targetPeerId) {
            const selectedListItem = userListElement ? userListElement.querySelector(`.participant-item[data-peer-id="${selectedPeerIdForModeration}"]`) : null;
            if (selectedListItem) selectedListItem.classList.remove('selected-user');
            selectedPeerIdForModeration = null;
            if (kickButton) kickButton.disabled = true;
            if (banButton) banButton.disabled = true;
            console.log('[Moderation] Moderation buttons DISABLED after successful action via server feedback.');
        }
    }
});

socket.on('join-failed', (data) => {
    console.warn('[Connection] Received join-failed event:', data);
    alert(`Could not join room: ${data.message}`);
    window.location.href = '/'; // Redirect to homepage
});

// Helper function to escape HTML to prevent XSS - very basic, consider a library for robustness
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"\/]/g, function (s) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        }[s];
    });
}

// Call setupHostControlsListeners on initial load if IS_HOST is already true
// This depends on how IS_HOST is initialized. For now, relying on 'set-as-host'.

// Function to update video container UI based on stream content (video tracks)
function updateVideoContainerBasedOnStream(peerId, stream, displayName) {
    // Find the video container and elements
    const peerVideoContainer = document.getElementById(`video-container-${peerId}`);
    if (!peerVideoContainer) {
        console.warn(`[UpdateUI] No video container found for ${displayName} (${peerId})`);
        return;
    }
    
    const videoElement = peerVideoContainer.querySelector('video');
    const avatarElement = peerVideoContainer.querySelector('.avatar-container');
    const fullscreenBtn = peerVideoContainer.querySelector('.fullscreen-btn');
    
    // Check if the stream has any active video tracks
    // IMPORTANT: We ignore the 'muted' property since it's read-only and controlled by the browser
    // Instead, we only check if tracks are enabled and in 'live' readyState
    const hasLiveVideoTracks = stream && stream.getVideoTracks().some(track => 
        track.enabled && track.readyState === 'live'
    );
    
    console.log(`[UpdateUI] Updating for ${displayName} (${peerId}). Has live video tracks: ${hasLiveVideoTracks}`);
    
    // Update the UI based on whether there are live video tracks
    if (hasLiveVideoTracks) {
        // Show the video and hide the avatar
        videoElement.style.display = 'block';
        if (avatarElement) avatarElement.style.display = 'none';
        if (fullscreenBtn) fullscreenBtn.style.display = ''; // Show fullscreen button
        videoElement.classList.remove('audio-only-video');
    } else {
        // Hide the video and show the avatar
        videoElement.style.display = 'none';
        if (avatarElement) avatarElement.style.display = 'flex';
        // Use currentRoomUsersState to get potentially updated name for avatar
        const currentUserData = currentRoomUsersState.find(user => user.id === peerId);
        const nameForAvatar = currentUserData ? currentUserData.name : displayName;
        displayAvatar(peerVideoContainer, videoElement, nameForAvatar, false);
        if (fullscreenBtn) fullscreenBtn.style.display = 'none'; // Hide fullscreen button
        videoElement.classList.add('audio-only-video');
    }
}

// Listen for payment info updates from the server (this is a general listener for all clients)
// If IS_HOST is set true by server on page load for hosts, this would be a good place:
// document.addEventListener('DOMContentLoaded', () => {
//     if(IS_HOST) {
//         setupHostControlsListeners();
//     }
// });

if (changeCapacityBtn && newCapacityInput) {
    changeCapacityBtn.addEventListener('click', () => {
        const newCapacity = parseInt(newCapacityInput.value);
        if (newCapacity >= 2 && newCapacity <= 10) {
            socket.emit('change-room-capacity', newCapacity);
        } else {
            alert('Capacity must be between 2 and 10.');
        }
    });
}

socket.on('room-capacity-changed', (newCapacity, roomData) => {
    roomCapacityDisplay.textContent = newCapacity;
    if (newCapacityInput) newCapacityInput.value = newCapacity;
    // Optionally update other room details if needed from roomData
    alert(`Room capacity changed to ${newCapacity}.`);
});

if (kickUserBtn) {
    kickUserBtn.addEventListener('click', () => {
        if (selectedUserForHostAction && IS_HOST) {
            if (confirm(`Are you sure you want to kick user ${selectedUserForHostAction}?`)) {
                socket.emit('kick-user', selectedUserForHostAction);
                selectedUserForHostAction = null; // Reset selection
                kickUserBtn.disabled = true;
                banUserBtn.disabled = true;
                document.querySelectorAll('#userList li').forEach(el => el.classList.remove('selected-user'));
            }
        }
    });
}

if (banUserBtn) {
    banUserBtn.addEventListener('click', () => {
        if (selectedUserForHostAction && IS_HOST) {
            if (confirm(`Are you sure you want to BAN user ${selectedUserForHostAction}? This is IP based.`)) {
                socket.emit('ban-user', selectedUserForHostAction);
                selectedUserForHostAction = null; // Reset selection
                kickUserBtn.disabled = true;
                banUserBtn.disabled = true;
                document.querySelectorAll('#userList li').forEach(el => el.classList.remove('selected-user'));
            }
        }
    });
}

socket.on('kicked-from-room', (reason) => {
    alert(`You have been kicked from the room: ${reason}`);
    window.location.href = '/'; // Redirect to homepage
});

socket.on('banned-from-room', (reason) => {
    alert(`You have been BANNED from the room: ${reason}`);
    myPeer.destroy(); // Clean up PeerJS connection
    window.location.href = '/'; // Redirect to homepage
});

socket.on('error-message', (message) => {
    alert(`Error: ${message}`);
    if (message.includes('banned') || message.includes('full') || message.includes('does not exist')) {
        window.location.href = '/';
    }
});

// Graceful disconnect
window.addEventListener('beforeunload', () => {
    if (myPeer) {
        myPeer.destroy(); // This will trigger 'close' events for peers
    }
    socket.disconnect();
});

// Initialize PeerJS connection and media
initializePeer();

console.log(`Room script loaded for room: ${ROOM_ID}, Name: ${ROOM_NAME}`);

document.addEventListener('DOMContentLoaded', () => {
    // This ensures that if IS_HOST is already set (e.g. by server-side variable or very early event)
    // or if the user is NOT host, the participant count visibility is correctly set on page load.
    // The 'set-as-host' event will also call this for the user who becomes host.
    // Use IS_HOST as it's set by 'set-as-host' event.
    updateParticipantCount();
});
