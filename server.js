// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidV4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const rateLimit = require('express-rate-limit');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
app.set('trust proxy', 1); // Trust the first hop (Cloudflare)

// Rate Limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Limit each IP to 10000 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

// Rate limiter for socket.io events
const socketRateLimiter = new RateLimiterMemory({
    points: 600, // Number of points (increased from 60)
    duration: 5, // Per 5 seconds (increased from 1 second)
});

const server = http.createServer(app);
const io = socketIo(server);

// Session middleware setup
const sessionMiddleware = session({
    store: new FileStore({ path: './sessions', ttl: 86400, retries: 0 }),
    secret: 'a-very-secret-key-that-should-be-in-env-vars',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 86400000 } // 24 hours
});

app.use(sessionMiddleware);

// Share session with socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, () => {
        if (!socket.request.session.userId) {
            socket.request.session.userId = uuidV4();
            socket.request.session.save(); // Ensure userId is saved
        }
        next();
    });
});

const ADMIN_PASSWORD_FILE_PATH = path.join(__dirname, 'admin_password.txt');
let ADMIN_PASSWORD = '$2a$10$f.w.a.i9.e.s.t.i.n.g.p.a.s.s.w.o.r.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u'; // Default password hash for 'cherrybliss'

if (process.env.ADMIN_PASSWORD) {
    ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    console.log('Admin password loaded from environment variable.');
} else {
    try {
        if (fs.existsSync(ADMIN_PASSWORD_FILE_PATH)) {
            const passwordFromFile = fs.readFileSync(ADMIN_PASSWORD_FILE_PATH, 'utf8').trim();
            if (passwordFromFile) {
                ADMIN_PASSWORD = passwordFromFile;
                console.log('Admin password loaded from admin_password.txt');
            } else {
                console.log('admin_password.txt is empty, using default admin password.');
                // Optionally, write the default password to the file if it's empty and you want to ensure it exists
                // fs.writeFileSync(ADMIN_PASSWORD_FILE_PATH, ADMIN_PASSWORD, 'utf8');
            }
        } else {
            console.log('admin_password.txt not found, using default admin password. You can create this file in the project root to set a custom password.');
            // Optionally, create the file with the default password if it doesn't exist
            // fs.writeFileSync(ADMIN_PASSWORD_FILE_PATH, ADMIN_PASSWORD, 'utf8');
            // console.log('Created admin_password.txt with the default password.');
        }
    } catch (err) {
        console.error('Error reading or writing admin_password.txt:', err);
        console.log('Using default admin password due to error.');
    }
}
console.log(`Admin password is set. (Note: Actual password is not logged for security)`);

const PORT = process.env.PORT || 3001;
const HOST_RECONNECT_GRACE_PERIOD = 30000; // 30 seconds for host to reconnect
const authenticatedAdminIPs = new Set();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Explicitly set views directory
app.use(express.static(path.join(__dirname, 'public'))); // Explicitly set static files directory
app.use(express.urlencoded({ extended: true })); // To parse form data

let rooms = {}; // Store room data { roomId: { hostId: '', users: [], capacity: 2, name: '', picture: '', bannedIPs: Set() } }
let activeClientIPs = new Set(); // To track unique IPs for total active users count

// Multer setup for file uploads
const UPLOAD_PATH = path.join(__dirname, 'public', 'room_pictures');
if (!fs.existsSync(UPLOAD_PATH)){
    fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_PATH);
    },
    filename: function (req, file, cb) {
        // Sanitize filename and make it unique to prevent overwrites
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '').substring(0, 50); // Basic sanitization
        cb(null, uniqueSuffix + '-' + sanitizedOriginalName + extension);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: File upload only supports the following filetypes - ' + filetypes));
    }
});

// Function to broadcast room updates to the main page
function broadcastRoomUpdate(roomId) {
    if (rooms[roomId]) {
        const roomData = {
            id: roomId,
            name: rooms[roomId].name,
            userCount: rooms[roomId].users.length,
            capacity: rooms[roomId].capacity,
            picture: rooms[roomId].picture
        };
        io.emit('room-updated', roomData); // Emits to all clients, including index page
    }
}

function broadcastRoomDeletion(roomId) {
    io.emit('room-deleted-broadcast', roomId);
}

function broadcastNewRoom(roomId) {
    if (rooms[roomId]) {
        const roomData = {
            id: roomId,
            name: rooms[roomId].name,
            userCount: rooms[roomId].users.length,
            capacity: rooms[roomId].capacity,
            picture: rooms[roomId].picture
        };
        io.emit('room-created-broadcast', roomData);
    }
}

function generateRandomRoomName(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'Room-'; // Prefix for default rooms
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/');
    });
});

app.get('/', (req, res) => {
    const activeRooms = Object.entries(rooms).map(([id, room]) => ({
        id,
        name: room.name,
        userCount: room.users.length,
        capacity: room.capacity,
        picture: room.picture
    }));
    res.render('index', {
        rooms: activeRooms,
        isAdmin: !!req.session.isAdmin
    });
});

app.post('/create-room', upload.single('roomPicture'), (req, res) => {
    const roomId = uuidV4();
    let roomName = req.body.roomName;
    if (!roomName || roomName.trim() === '') {
        roomName = generateRandomRoomName();
        console.log(`No room name provided, generated random name: ${roomName}`);
    }
    const roomCapacity = parseInt(req.body.roomCapacity) || 2;
    let roomPicture = '/default_room_icon.png'; // Default icon path
    if (req.file) {
        roomPicture = '/room_pictures/' + req.file.filename; // Path to serve the image from public folder
    }

    rooms[roomId] = {
        hostId: null, // Will store the userId of the host
        users: [], // Will store objects like { peerId, socketId, displayName, hasVideo, ip, userId }
        capacity: Math.min(Math.max(roomCapacity, 2), 10),
        name: roomName,
        picture: roomPicture,
        bannedIPs: new Set(),
        paymentInfo: {}, // Initialize paymentInfo for the room
        pendingHostReconnectUserId: null,
        hostReconnectTimer: null
    };
    console.log(`Room created: ${roomName} (ID: ${roomId}) with capacity ${rooms[roomId].capacity}`);
    broadcastNewRoom(roomId);
    const displayName = req.body.displayName || ''; // Read display name from form
    if (displayName) {
        req.session.displayName = displayName;
    }
    res.redirect(`/room/${roomId}`);
});

// Helper function for deleting a room and broadcasting
function deleteRoomInternal(roomId, reason) {
    if (rooms[roomId]) {
        console.log(`Deleting room ${roomId}. Reason: ${reason}`);
        const roomPicture = rooms[roomId].picture;
        // Only attempt to delete uploaded pictures, not default ones
        if (roomPicture && roomPicture !== '/default_room_icon.png' && roomPicture.startsWith('/room_pictures/')) {
            const actualFilePath = path.join(__dirname, 'public', roomPicture);
            if (fs.existsSync(actualFilePath)) {
                fs.unlink(actualFilePath, (err) => {
                    if (err) console.error(`Error deleting room picture ${actualFilePath}:`, err);
                    else console.log(`Deleted room picture ${actualFilePath}`);
                });
            } else {
                // console.warn(`Room picture ${actualFilePath} not found for deletion.`);
            }
        }

        // Clear any pending host reconnect timer for this room specifically
        if (rooms[roomId].hostReconnectTimer) {
            clearTimeout(rooms[roomId].hostReconnectTimer);
            rooms[roomId].hostReconnectTimer = null;
        }
        rooms[roomId].pendingHostReconnectUserId = null;

        delete rooms[roomId];
        broadcastRoomDeletion(roomId); // Notify clients room is gone
        console.log(`Room ${roomId} deleted and deletion broadcasted.`);
    }
}

// Helper function to check conditions and delete room if necessary
function checkAndHandleRoomDeletion(roomId, triggerEventDescription = "Unknown event") {
    if (!rooms[roomId]) {
        // console.log(`checkAndHandleRoomDeletion: Room ${roomId} already deleted. Trigger: ${triggerEventDescription}`);
        return;
    }

    const room = rooms[roomId];
    const isRoomEmpty = room.users.length === 0;

    // Condition 1: Room is empty
    if (isRoomEmpty) {
        deleteRoomInternal(roomId, `Room empty. Trigger: ${triggerEventDescription}`);
        return;
    }

    // Condition 2: No effective host (and not because a host is merely pending reconnection)
    // An "effective host" means room.hostId is set AND that host (by userId) is actually in room.users array.
    const currentHostUser = room.hostId ? room.users.find(user => user.userId === room.hostId) : null;
    if (!currentHostUser && !room.pendingHostReconnectUserId) {
        deleteRoomInternal(roomId, `No effective host. Trigger: ${triggerEventDescription}`);
        return;
    }
    // console.log(`checkAndHandleRoomDeletion: Room ${roomId} not deleted. Trigger: ${triggerEventDescription}. Empty: ${isRoomEmpty}, Host: ${room.hostId}, Pending Host: ${room.pendingHostReconnectUserId}, Users: ${room.users.length}`);
}

app.get('/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (rooms[roomId]) {
        if (req.query.displayName) { // If a name is passed in the URL, save it to the session
            req.session.displayName = req.query.displayName;
        }

        res.render('room', { 
            roomId: roomId, 
            roomName: rooms[roomId].name, 
            roomCapacity: rooms[roomId].capacity,
            displayName: req.session.displayName || '' // Pass displayName from session to template
        });
    } else {
        res.redirect('/');
    }
});

io.on('connection', (socket) => {
    // Middleware to rate limit events per socket
    socket.use((packet, next) => {
        const clientIp = socket.handshake.address;
        socketRateLimiter.consume(clientIp)
            .then(() => {
                next();
            })
            .catch(() => {
                console.log(`Socket rate limit exceeded for IP: ${clientIp}`);
                next(new Error('Too many events sent.'));
            });
    });
    const isAdmin = () => socket.request.session.isAdmin;
    const clientIp = socket.handshake.address;

    if (clientIp) {
        activeClientIPs.add(clientIp);
        io.emit('total-active-users-update', activeClientIPs.size);
        console.log(`User connected from IP: ${clientIp}. Total active users: ${activeClientIPs.size}`);
    }

    socket.on('verify-admin-password', (passwordAttempt, callback) => {
        try {
            const verifyPassword = (hashedPassword) => {
                if (bcrypt.compareSync(passwordAttempt, hashedPassword)) {
                    console.log(`Admin login successful from socket: ${socket.id}, IP: ${clientIp}`);
                    socket.request.session.isAdmin = true;
                    socket.request.session.save();
                    if (typeof callback === 'function') callback({ success: true });
                } else {
                    console.log(`Admin login failed from socket: ${socket.id}, IP: ${clientIp}`);
                    if (typeof callback === 'function') callback({ success: false });
                }
            };

            if (fs.existsSync(ADMIN_PASSWORD_FILE_PATH)) {
                const hashedPasswordFromFile = fs.readFileSync(ADMIN_PASSWORD_FILE_PATH, 'utf8').trim();
                verifyPassword(hashedPasswordFromFile);
            } else {
                verifyPassword(ADMIN_PASSWORD);
            }
        } catch (err) {
            console.error('Error during admin verification:', err);
            if (typeof callback === 'function') callback({ success: false });
        }
    });

    // --- Payment Info Handlers ---
    socket.on('set-payment-info', (roomId, paymentInfo) => {
        console.log(`[PaymentInfo] Received 'set-payment-info' for room ${roomId} from socket ${socket.id}. Data:`, paymentInfo);
        if (!rooms[roomId]) {
            console.error(`[PaymentInfo] Error: Room ${roomId} not found for 'set-payment-info'.`);
            return socket.emit('error-message', 'Room not found to set payment info.');
        }
        // Validate if the requester is the host
        if (rooms[roomId].hostId !== socket.request.session.userId) {
            console.warn(`[PaymentInfo] Warning: User ${socket.request.session.userId} (socket ${socket.id}) attempted to set payment info for room ${roomId} but is not host.`);
            return socket.emit('error-message', 'Only the host can set payment information.');
        }

        rooms[roomId].paymentInfo = paymentInfo;
        console.log(`[PaymentInfo] Stored payment info for room ${roomId}:`, rooms[roomId].paymentInfo);
        io.to(roomId).emit('payment-info-updated', rooms[roomId].paymentInfo);
        console.log(`[PaymentInfo] Broadcasted 'payment-info-updated' to room ${roomId}.`);
    });

    socket.on('clear-payment-info', (roomId) => {
        console.log(`[PaymentInfo] Received 'clear-payment-info' for room ${roomId} from socket ${socket.id}.`);
        if (!rooms[roomId]) {
            console.error(`[PaymentInfo] Error: Room ${roomId} not found for 'clear-payment-info'.`);
            return socket.emit('error-message', 'Room not found to clear payment info.');
        }
        // Validate if the requester is the host
        if (rooms[roomId].hostId !== socket.request.session.userId) {
            console.warn(`[PaymentInfo] Warning: User ${socket.request.session.userId} (socket ${socket.id}) attempted to clear payment info for room ${roomId} but is not host.`);
            return socket.emit('error-message', 'Only the host can clear payment information.');
        }

        rooms[roomId].paymentInfo = {};
        console.log(`[PaymentInfo] Cleared payment info for room ${roomId}.`);
        io.to(roomId).emit('payment-info-updated', rooms[roomId].paymentInfo);
        console.log(`[PaymentInfo] Broadcasted 'payment-info-updated' (cleared) to room ${roomId}.`);
    });

    socket.on('request-payment-info', (roomId) => {
        console.log(`[PaymentInfo] Received 'request-payment-info' for room ${roomId} from socket ${socket.id}.`);
        if (!rooms[roomId]) {
            console.error(`[PaymentInfo] Error: Room ${roomId} not found for 'request-payment-info'.`);
            return socket.emit('payment-info-updated', {}); // Send empty if room not found or no info
        }
        const paymentData = rooms[roomId].paymentInfo || {};
        socket.emit('payment-info-updated', paymentData);
        console.log(`[PaymentInfo] Sent current payment info for room ${roomId} to socket ${socket.id}. Data:`, paymentData);
    });
    // --- End of Payment Info Handlers ---

    socket.on('join-room', (roomId, peerId, userHasVideo) => {
        if (!rooms[roomId]) {
            return socket.emit('error-message', 'Room does not exist.');
        }
        if (rooms[roomId].bannedIPs.has(clientIp)) {
            console.warn(`[Moderation] Denied join for banned IP ${clientIp} to room ${roomId}.`);
            socket.emit('join-failed', { reason: 'banned', message: 'Your IP address has been banned from this room.' });
            socket.disconnect(true);
            return;
        }
        if (rooms[roomId].users.length >= rooms[roomId].capacity) {
            return socket.emit('error-message', 'Room is full.');
        }



        socket.join(roomId);
        const userSessionId = socket.request.session.userId; // Define userSessionId once here

                let actualDisplayName = socket.request.session.displayName;
        if (!actualDisplayName || actualDisplayName.trim() === '') {
            actualDisplayName = `User-${userSessionId.substring(0, 5)}`;
            socket.request.session.displayName = actualDisplayName; // Save generated name to session
            socket.request.session.save(); // Persist the session change
        }

        rooms[roomId].users.push({ id: peerId, socketId: socket.id, displayName: actualDisplayName, hasVideo: userHasVideo, ip: clientIp, userId: userSessionId });
        socket.peerId = peerId;
        socket.roomId = roomId;

        // Host assignment logic
        if (rooms[roomId].pendingHostReconnectUserId && rooms[roomId].pendingHostReconnectUserId === userSessionId) {
            // Original host reconnected within grace period
            clearTimeout(rooms[roomId].hostReconnectTimer);
            rooms[roomId].hostReconnectTimer = null;
            rooms[roomId].hostId = userSessionId;
            rooms[roomId].pendingHostReconnectUserId = null;
            socket.emit('set-as-host');
            console.log(`Host ${userSessionId} reconnected and reinstated in room ${roomId}`);
        } else if (!rooms[roomId].hostId && !rooms[roomId].pendingHostReconnectUserId) {
            // No current host and no host pending reconnection, make this user the host
            rooms[roomId].hostId = userSessionId;
            socket.emit('set-as-host');
            console.log(`User ${userSessionId} (peer: ${peerId}) became host of room ${roomId}`);
        }

        // If this user is the host, ensure they know
        if (rooms[roomId].hostId === userSessionId) {
            socket.emit('set-as-host');
        }

        socket.broadcast.to(roomId).emit('user-connected', peerId, actualDisplayName, userHasVideo);
        io.to(roomId).emit('update-user-list', rooms[roomId].users.map(u => ({id: u.id, name: u.displayName, hasVideo: u.hasVideo })));
        broadcastRoomUpdate(roomId);

        if (rooms[roomId].paymentInfo && Object.keys(rooms[roomId].paymentInfo).length > 0) {
            socket.emit('payment-info-updated', rooms[roomId].paymentInfo);
        }
        socket.on('offer', (payload) => {
            const targetSocketId = rooms[roomId]?.users.find(u => u.id === payload.targetPeerId)?.socketId;
            if (targetSocketId) {
                io.to(targetSocketId).emit('offer', { sdp: payload.sdp, senderPeerId: peerId });
            }
        });

        socket.on('answer', (payload) => {
            const targetSocketId = rooms[roomId]?.users.find(u => u.id === payload.targetPeerId)?.socketId;
            if (targetSocketId) {
                io.to(targetSocketId).emit('answer', { sdp: payload.sdp, senderPeerId: peerId });
            }
        });

        socket.on('ice-candidate', (payload) => {
            const targetSocketId = rooms[roomId]?.users.find(u => u.id === payload.targetPeerId)?.socketId;
            if (targetSocketId) {
                io.to(targetSocketId).emit('ice-candidate', { candidate: payload.candidate, senderPeerId: peerId });
            }
        });

        // For broadcasting room updates from room_script (e.g. after host changes capacity)
        socket.on('broadcast-room-update', (updatedRoomData) => {
             if (rooms[updatedRoomData.id]) {
                // Validate or merge if necessary, for now assume updatedRoomData is fine
                // This is mainly for capacity changes initiated by host to reflect on index
                broadcastRoomUpdate(updatedRoomData.id);
            }
        });

        // Handler for client-side logs to be forwarded to the host
        socket.on('forward-client-log', (data) => {
            const { roomId, peerId: clientPeerId, logData } = data;
            if (rooms[roomId] && rooms[roomId].hostId) {
                const hostPeerId = rooms[roomId].hostId;
                const hostUser = rooms[roomId].users.find(user => user.id === hostPeerId);

                if (hostUser && hostUser.socketId) {
                    io.to(hostUser.socketId).emit('display-client-log', {
                        originalPeerId: clientPeerId,
                        logData: logData
                    });
                } else {
                    // console.log(`Host socket not found for room ${roomId} to forward client log.`);
                }
            } else {
                // console.log(`Room or host not found for roomId ${roomId} to forward client log.`);
            }
        });

        socket.on('send-chat-message', ({ roomId, message }) => {
            console.log(`[Chat] Received 'send-chat-message' for room ${roomId} with message: "${message}"`);
            if (!rooms[roomId] || !socket.peerId) {
                console.error(`[Chat] Error: Room ${roomId} or sender peerId not found.`);
                return;
            }

            const sender = rooms[roomId].users.find(u => u.id === socket.peerId);
            if (!sender) {
                console.error(`[Chat] Error: Sender with peerId ${socket.peerId} not found in room ${roomId}.`);
                return;
            }

            const isHost = rooms[roomId].hostId === sender.userId;

            const chatData = {
                message: message,
                name: sender.displayName,
                peerId: sender.id,
                isHost: isHost
            };

            console.log(`[Chat] Broadcasting 'chat-message' to room ${roomId}. Data:`, chatData);
            io.to(roomId).emit('chat-message', chatData);
        });

        // --- Kick User Handler ---
        socket.on('kick-user', (peerIdToKick) => {
            console.log(`[Moderation] Received 'kick-user' request from host ${socket.peerId} for peer ${peerIdToKick} in room ${socket.roomId}`);
            const roomId = socket.roomId;
            const requesterPeerId = socket.peerId;

            if (!rooms[roomId]) {
                console.error(`[Moderation] Kick Error: Room ${roomId} not found.`);
                socket.emit('moderation-error', { action: 'kick', message: `Room ${roomId} not found.` });
                return;
            }

            if (rooms[roomId].hostId !== requesterPeerId) {
                console.warn(`[Moderation] Kick Warning: User ${requesterPeerId} attempted to kick ${peerIdToKick} but is not host in room ${roomId}.`);
                socket.emit('moderation-error', { action: 'kick', message: 'Only the host can kick users.' });
                return;
            }

            if (requesterPeerId === peerIdToKick) {
                console.warn(`[Moderation] Kick Warning: Host ${requesterPeerId} attempted to kick themselves.`);
                socket.emit('moderation-error', { action: 'kick', message: 'Host cannot kick themselves.' });
                return;
            }

            const targetUser = rooms[roomId].users.find(u => u.id === peerIdToKick);
            if (!targetUser || !targetUser.socketId) {
                console.error(`[Moderation] Kick Error: Target user ${peerIdToKick} or their socketId not found in room ${roomId}.`);
                socket.emit('moderation-error', { action: 'kick', message: `User ${peerIdToKick} not found in room.` });
                return;
            }

            const targetSocket = io.sockets.sockets.get(targetUser.socketId);
            if (targetSocket) {
                console.log(`[Moderation] Kicking user ${peerIdToKick} (socket ${targetUser.socketId}) from room ${roomId}.`);
                targetSocket.emit('you-were-kicked', { roomId: roomId, reason: 'Kicked by host.' });
                // The client-side 'you-were-kicked' handler should make the client leave/disconnect.
                // Server's 'disconnect' event for that user will handle cleanup.
                targetSocket.disconnect(true); // Force disconnect
                console.log(`[Moderation] User ${peerIdToKick} disconnected by host.`);
                socket.emit('moderation-success', { action: 'kick', targetPeerId: peerIdToKick, message: `User ${targetUser.displayName} has been kicked.` });
            } else {
                console.error(`[Moderation] Kick Error: Could not find socket instance for target user ${peerIdToKick} (socketId ${targetUser.socketId}).`);
                socket.emit('moderation-error', { action: 'kick', message: `Could not process kick for ${peerIdToKick}.` });
            }
        });

        // --- Ban User Handler ---
        socket.on('ban-user', (peerIdToBan) => {
            console.log(`[Moderation] Received 'ban-user' request from host ${socket.peerId} for peer ${peerIdToBan} in room ${socket.roomId}`);
            const roomId = socket.roomId;
            const requesterPeerId = socket.peerId;

            if (!rooms[roomId]) {
                console.error(`[Moderation] Ban Error: Room ${roomId} not found.`);
                socket.emit('moderation-error', { action: 'ban', message: `Room ${roomId} not found.` });
                return;
            }

            if (rooms[roomId].hostId !== requesterPeerId) {
                console.warn(`[Moderation] Ban Warning: User ${requesterPeerId} attempted to ban ${peerIdToBan} but is not host in room ${roomId}.`);
                socket.emit('moderation-error', { action: 'ban', message: 'Only the host can ban users.' });
                return;
            }

            if (requesterPeerId === peerIdToBan) {
                console.warn(`[Moderation] Ban Warning: Host ${requesterPeerId} attempted to ban themselves.`);
                socket.emit('moderation-error', { action: 'ban', message: 'Host cannot ban themselves.' });
                return;
            }

            const targetUser = rooms[roomId].users.find(u => u.id === peerIdToBan);
            if (!targetUser || !targetUser.socketId) {
                console.error(`[Moderation] Ban Error: Target user ${peerIdToBan} or their socketId not found in room ${roomId}.`);
                socket.emit('moderation-error', { action: 'ban', message: `User ${peerIdToBan} not found in room.` });
                return;
            }

            const targetSocket = io.sockets.sockets.get(targetUser.socketId);
            if (targetSocket) {
                const userIp = targetSocket.handshake.address; // Get IP address
                if (!userIp) {
                    console.error(`[Moderation] Ban Error: Could not retrieve IP for user ${peerIdToBan}.`);
                    socket.emit('moderation-error', { action: 'ban', message: `Could not retrieve IP for ${peerIdToBan}. Ban failed.` });
                    return;
                }

                if (!rooms[roomId].bannedIPs) {
                    rooms[roomId].bannedIPs = [];
                }
                if (!rooms[roomId].bannedIPs.includes(userIp)) {
                    rooms[roomId].bannedIPs.push(userIp);
                    console.log(`[Moderation] IP ${userIp} for user ${peerIdToBan} added to ban list for room ${roomId}.`);
                } else {
                    console.log(`[Moderation] IP ${userIp} for user ${peerIdToBan} already in ban list for room ${roomId}.`);
                }

                console.log(`[Moderation] Banning user ${peerIdToBan} (IP: ${userIp}, socket ${targetUser.socketId}) from room ${roomId}.`);
                targetSocket.emit('you-were-banned', { roomId: roomId, reason: 'Banned by host (IP ban).' });
                targetSocket.disconnect(true); // Force disconnect
                console.log(`[Moderation] User ${peerIdToBan} (IP: ${userIp}) disconnected and IP banned by host.`);
                socket.emit('moderation-success', { action: 'ban', targetPeerId: peerIdToBan, message: `User ${targetUser.displayName} (IP: ${userIp}) has been banned.` });
            } else {
                console.error(`[Moderation] Ban Error: Could not find socket instance for target user ${peerIdToBan} (socketId ${targetUser.socketId}).`);
                socket.emit('moderation-error', { action: 'ban', message: `Could not process ban for ${peerIdToBan}.` });
            }
        });
    }); // End of socket.on('join-room', ...)

    // This is the primary disconnect handler that includes room self-deletion logic
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        const peerId = socket.peerId;
        const clientIp = socket.handshake.address;
        const disconnectedUserSessionId = socket.request.session.userId;

        if (clientIp) {
            activeClientIPs.delete(clientIp);
            io.emit('total-active-users-update', activeClientIPs.size);
            console.log(`User disconnected from IP: ${clientIp}. Total active users: ${activeClientIPs.size}`);
        }

        if (rooms[roomId] && peerId) {
            const room = rooms[roomId]; // Get a reference to the room object
            const userIndex = rooms[roomId].users.findIndex(u => u.id === peerId);
            if (userIndex !== -1) {
                const removedUser = room.users.splice(userIndex, 1)[0]; // Get the removed user object
                console.log(`User ${removedUser.displayName} (userId: ${disconnectedUserSessionId}) disconnected from room ${roomId}`);

                io.to(roomId).emit('user-disconnected', peerId);
                io.to(roomId).emit('update-user-list', room.users.map(u => ({id: u.id, name: u.displayName, hasVideo: u.hasVideo })));
                broadcastRoomUpdate(roomId); // Update user count on index page

                // Determine if the disconnected user was the host
                // This check is before hostId might be nulled for grace period
                const wasHost = (room.hostId === disconnectedUserSessionId) || 
                                (room.pendingHostReconnectUserId === disconnectedUserSessionId && !room.hostId); // Covers case where host disconnected and is in grace period

                if (wasHost && room.users.length > 0) {
                    // Host disconnected, but other users remain. Start grace period.
                    console.log(`Host ${disconnectedUserSessionId} disconnected from room ${roomId}. Starting grace period.`);
                    room.pendingHostReconnectUserId = disconnectedUserSessionId; // Mark who is allowed to reconnect as host
                    room.hostId = null; // Vacate the host spot but reserve it for the pending user

                    if (room.hostReconnectTimer) clearTimeout(room.hostReconnectTimer); // Clear any existing timer
                    room.hostReconnectTimer = setTimeout(() => {
                        if (rooms[roomId] && room.pendingHostReconnectUserId === disconnectedUserSessionId) { // Check room still exists and pending host is the same
                            console.log(`Grace period expired for host ${disconnectedUserSessionId} in room ${roomId}.`);
                            room.pendingHostReconnectUserId = null; // Clear pending host status

                            if (room.users.length > 0) {
                                // Attempt to assign a new host if users remain
                                room.hostId = room.users[0].userId; // Assign to the first user in the list
                                const newHostSocket = io.sockets.sockets.get(room.users[0].socketId);
                                if (newHostSocket) newHostSocket.emit('set-as-host');
                                console.log(`New host ${room.hostId} (${room.users[0].displayName}) assigned in room ${roomId}.`);
                                io.to(roomId).emit('new-host-assigned', { hostId: room.hostId, hostDisplayName: room.users[0].displayName });
                            } else {
                                room.hostId = null; // Ensure hostId is null if no users left to be host
                            }
                            // After grace period logic (new host assigned or not), check for room deletion
                            checkAndHandleRoomDeletion(roomId, `Host grace period expired for ${disconnectedUserSessionId}`);
                        }
                    }, HOST_RECONNECT_GRACE_PERIOD);
                } else {
                    // This branch covers: 
                    // 1. Non-host disconnected.
                    // 2. Host disconnected and room became empty simultaneously.
                    // 3. Host disconnected, was already in grace period (pendingHostReconnectUserId matched), and now leaves again.
                    // In all these cases, we directly check if the room should be deleted based on current state.
                    checkAndHandleRoomDeletion(roomId, `User ${disconnectedUserSessionId} disconnected (direct check)`);
                }
            } else { // This 'else' corresponds to 'if (userIndex !== -1)'
                // console.log(`User ${peerId} (userId: ${disconnectedUserSessionId}) not found in room ${roomId} user list upon disconnect.`);
            }
        } else {
            // console.log(`Disconnect event for socket ${socket.id}, but no valid roomId or peerId found in socket state, or room already deleted.`);
        }
    }); // End of the primary socket.on('disconnect') handler

    socket.on('request-total-active-users', () => {
        // No need to check clientIp here for adding/removing, just for logging if desired
        // The activeClientIPs set is managed by global connect/disconnect events
        console.log(`Received 'request-total-active-users' from socket ${socket.id}. Sending current count: ${activeClientIPs.size}`);
        socket.emit('total-active-users-update', activeClientIPs.size);
    });

    socket.on('check-admin-status', (callback) => {
        const clientIp = socket.handshake.address; // Consistent IP retrieval
        if (clientIp && authenticatedAdminIPs.has(clientIp)) {
            console.log(`Admin status confirmed for IP: ${clientIp} (socket: ${socket.id})`);
            if (typeof callback === 'function') callback({ isAdmin: true });
        } else {
            console.log(`Admin status NOT confirmed for IP: ${clientIp} (socket: ${socket.id})`);
            if (typeof callback === 'function') callback({ isAdmin: false });
        }
    });

    socket.on('admin-logout', () => {
        const clientIp = socket.handshake.address; // Consistent IP retrieval
        if (authenticatedAdminIPs.has(clientIp)) {
            authenticatedAdminIPs.delete(clientIp);
            console.log(`Admin privileges revoked for IP: ${clientIp} via logout.`);
        } else {
            console.log(`Logout attempt from non-admin IP or IP not in list: ${clientIp}`);
        }
    });

    socket.on('user-media-status-update', (data) => {
        const { peerId, roomId, hasVideo } = data;

        // Validate: Check if the socket is associated with the peerId and roomId it claims.
        if (socket.peerId === peerId && socket.roomId === roomId && rooms[roomId] && rooms[roomId].users.some(u => u.id === peerId && u.socketId === socket.id)) {
            console.log(`[MediaStatusUpdate] User ${peerId} in room ${roomId} updated hasVideo to: ${hasVideo}`);
            
            const userInRoom = rooms[roomId].users.find(u => u.id === peerId);
            if (userInRoom) {
                userInRoom.hasVideo = hasVideo;
            }

            socket.broadcast.to(roomId).emit('peer-media-status-changed', { 
                peerId: peerId, 
                hasVideo: hasVideo 
            });

            if (rooms[roomId]) { // Check if room still exists
                 io.to(roomId).emit('update-user-list', rooms[roomId].users.map(u => ({id: u.id, name: u.displayName, hasVideo: u.hasVideo })));
            }

        } else {
            console.warn(`[MediaStatusUpdate] Unauthorized or invalid user-media-status-update. Socket PeerId: ${socket.peerId}, Socket RoomId: ${socket.roomId}. Payload:`, data);
        }
    });

    // General disconnect handler for all sockets, to manage activeClientIPs
    socket.on('disconnect', () => {
        // This is a more general disconnect handler that will catch all socket disconnections
        // including those not necessarily tied to a room's lifecycle (e.g., user on index page closes tab)
        if (clientIp) {
            // To accurately manage the count, we need to ensure this IP is truly gone.
            // A simple immediate removal might be too aggressive if the user has multiple tabs/connections.
            // However, for a basic count, immediate removal is simpler.
            // A more robust system might track socket.id per IP and only remove IP when all its sockets are gone.
            activeClientIPs.delete(clientIp); // This might be too simplistic if one IP has multiple sockets
                                           // For now, we assume one primary connection per IP for this count.
            io.emit('total-active-users-update', activeClientIPs.size);
            console.log(`Socket ${socket.id} (IP: ${clientIp}) disconnected. Total active users: ${activeClientIPs.size}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access locally at http://localhost:${PORT}`);
});
