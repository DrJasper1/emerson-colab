// public/script.js (for index.ejs)
const socket = io();
const roomList = document.getElementById('roomList');
const noRoomsMessage = document.getElementById('no-rooms-message');
const displayNameInput = document.getElementById('displayName');

function addDisplayNameToLink(link) {
    const name = displayNameInput ? displayNameInput.value.trim() : '';
    if (name) {
        try {
            const url = new URL(link.href, window.location.origin);
            url.searchParams.set('displayName', encodeURIComponent(name));
            link.href = url.pathname + url.search;
        } catch (e) {
            console.error('Error constructing URL for join link:', e);
            link.href += `?displayName=${encodeURIComponent(name)}`; // Fallback
        }
    }
}

// Attach display name to existing join links on page load
document.querySelectorAll('.join-button').forEach(button => {
    button.addEventListener('click', function() {
        addDisplayNameToLink(this);
    });
});

// Attach display name to create room form
const createRoomForm = document.querySelector('.create-room-section form');
if (createRoomForm) {
    createRoomForm.addEventListener('submit', function() {
        const name = displayNameInput.value.trim();
        if (name) {
            let hiddenInput = createRoomForm.querySelector('input[name="displayName"]');
            if (!hiddenInput) {
                hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'displayName';
                createRoomForm.appendChild(hiddenInput);
            }
            hiddenInput.value = name;
        }
    });
}

function createRoomElement(room) {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.id = `room-${room.id}`;

    const img = document.createElement('img');
    img.src = room.picture || '/default_room_icon.png';
    img.alt = 'Room Picture';
    img.className = 'room-icon';
    img.onerror = function() {
        if (!this.src.endsWith('/default_room_icon.png')) {
            this.src = '/default_room_icon.png';
            this.alt = 'Default Icon';
        }
        this.onerror = null; // Prevent future errors from looping
    };

    const roomInfoDiv = document.createElement('div');
    roomInfoDiv.className = 'room-info';

    const strong = document.createElement('strong');
    strong.textContent = room.name;

    const userCountSpan = document.createElement('span');
    userCountSpan.className = 'user-count';
    userCountSpan.textContent = room.userCount;

    const capacitySpan = document.createElement('span');
    capacitySpan.className = 'capacity';
    capacitySpan.textContent = room.capacity;

    roomInfoDiv.appendChild(strong);
    roomInfoDiv.appendChild(document.createTextNode(' ('));
    roomInfoDiv.appendChild(userCountSpan);
    roomInfoDiv.appendChild(document.createTextNode('/'));
    roomInfoDiv.appendChild(capacitySpan);
    roomInfoDiv.appendChild(document.createTextNode(' users)'));

    const joinLink = document.createElement('a');
    joinLink.href = `/room/${room.id}`;
    joinLink.className = 'join-button';
    joinLink.textContent = 'Join Room';
    joinLink.dataset.roomid = room.id;
    joinLink.addEventListener('click', function() {
        addDisplayNameToLink(this);
    });

    li.appendChild(img);
    li.appendChild(roomInfoDiv);
    li.appendChild(joinLink);

    // If the user is an admin, add the admin buttons to the new room element.
    if (document.getElementById('admin-logout-btn')) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-room-btn admin-action';
        deleteBtn.dataset.roomid = room.id;
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', handleDeleteRoom);
        li.appendChild(deleteBtn);

        const renameBtn = document.createElement('button');
        renameBtn.className = 'rename-room-btn admin-action';
        renameBtn.dataset.roomid = room.id;
        renameBtn.dataset.roomname = room.name;
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', handleRenameRoom);
        li.appendChild(renameBtn);
    }

    return li;
}

// Listen for new rooms being created
socket.on('room-created-broadcast', (room) => {
    if (noRoomsMessage && noRoomsMessage.style.display !== 'none') {
        noRoomsMessage.style.display = 'none';
    }
    const roomElement = createRoomElement(room);
    roomList.appendChild(roomElement);
});

// Listen for room updates (e.g., user count, capacity change)
socket.on('room-updated', (room) => {
    const roomElement = document.getElementById(`room-${room.id}`);
    if (roomElement) {
        roomElement.querySelector('.user-count').textContent = room.userCount;
        roomElement.querySelector('.capacity').textContent = room.capacity;
        roomElement.querySelector('.room-icon').src = room.picture || '/default_room_icon.png';
        const strongTag = roomElement.querySelector('.room-info strong');
        if (strongTag) strongTag.textContent = room.name;
        const renameBtn = roomElement.querySelector('.rename-room-btn');
        if (renameBtn) renameBtn.dataset.roomname = room.name;
    }
});

// Listen for rooms being deleted
socket.on('room-deleted-broadcast', (roomId) => {
    const roomElement = document.getElementById(`room-${roomId}`);
    if (roomElement) {
        roomElement.remove();
    }
    if (roomList && roomList.children.length === 0 && noRoomsMessage) {
        noRoomsMessage.style.display = 'block';
    }
});

console.log('Index page script loaded and secured.');

// --- Event Handlers for Admin Actions ---
function handleDeleteRoom() {
    const roomId = this.dataset.roomid;
    if (confirm(`Are you sure you want to delete this room?`)) {
        socket.emit('delete-room', roomId);
    }
}

function handleRenameRoom() {
    const roomId = this.dataset.roomid;
    const currentName = this.dataset.roomname;
    const newName = prompt('Enter new name for the room:', currentName);
    if (newName && newName.trim() !== '') {
        socket.emit('rename-room', { roomId, newName });
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // --- Admin Login/Logout ---
    const adminLoginBtn = document.getElementById('admin-login-btn');
    const adminPanel = document.getElementById('admin-panel');
    const adminPasswordInput = document.getElementById('admin-password');
    const submitAdminPasswordBtn = document.getElementById('submit-admin-password');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');

    if (adminLoginBtn) {
        adminLoginBtn.addEventListener('click', () => {
            if (adminPanel) {
                adminPanel.style.display = 'block';
            }
        });
    }

    if (submitAdminPasswordBtn) {
        submitAdminPasswordBtn.addEventListener('click', () => {
            const password = adminPasswordInput.value;
            socket.emit('verify-admin-password', password, (response) => {
                if (response.success) {
                    alert('Admin login successful!');
                    window.location.reload();
                } else {
                    alert('Admin login failed.');
                }
            });
        });
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/logout';
            document.body.appendChild(form);
            form.submit();
            if (adminPasswordInput) adminPasswordInput.value = '';
            if (adminErrorMsg) adminErrorMsg.style.display = 'none';
        });
    }
});
