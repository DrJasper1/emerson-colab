const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ADMIN_PASSWORD_FILE_PATH = path.join(__dirname, 'admin_password.txt');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('This script will securely set a new admin password.');
rl.question('Enter the new admin password: ', (password) => {
    if (!password) {
        console.log('No password entered. Password not changed.');
        rl.close();
        return;
    }

    // Hash the password
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    // Save the hashed password to the file
    fs.writeFile(ADMIN_PASSWORD_FILE_PATH, hashedPassword, 'utf8', (err) => {
        if (err) {
            console.error('Failed to write new password hash:', err);
        } else {
            console.log('Admin password has been securely updated.');
            console.log('Please restart the server for the change to take effect if it is running.');
        }
        rl.close();
    });
});
