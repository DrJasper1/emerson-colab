document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Connects to the server, assuming Socket.IO client is loaded

    const activeUsersCountElement = document.getElementById('total-active-users-count');

    if (activeUsersCountElement) {
        socket.on('total-active-users-update', (count) => {
            activeUsersCountElement.textContent = count;
        });
    } else {
        console.warn('Element with ID "total-active-users-count" not found on the page.');
    }

    // Request initial count when the page loads and socket connects
    socket.on('connect', () => {
        console.log('Connected to server, requesting total active users count for index page.');
        socket.emit('request-total-active-users');
    });
});
