import bcrypt
# import getpass
import os

ADMIN_PASSWORD_FILE_PATH = os.path.join(os.path.dirname(__file__), 'admin_password.txt')
SALT_ROUNDS = 10

def set_new_admin_password():
    print('This script will securely set a new admin password.')
    
    try:
        password = input('Enter the new admin password: ')
        if not password:
            print('No password entered. Password not changed.')
            return

        password_confirm = input('Confirm the new admin password: ')
        if password != password_confirm:
            print('Passwords do not match. Password not changed.')
            return

        # Encode the password to bytes, as bcrypt expects bytes
        password_bytes = password.encode('utf-8')

        # Generate a salt and hash the password
        # gensalt(SALT_ROUNDS) creates a salt with the specified cost factor
        hashed_password_bytes = bcrypt.hashpw(password_bytes, bcrypt.gensalt(SALT_ROUNDS))
        
        # Decode the hashed password back to a string for storage
        hashed_password_str = hashed_password_bytes.decode('utf-8')

        # Save the hashed password to the file
        with open(ADMIN_PASSWORD_FILE_PATH, 'w', encoding='utf-8') as f:
            f.write(hashed_password_str)
        
        print(f'Admin password has been securely updated in {ADMIN_PASSWORD_FILE_PATH}.')
        print('Please restart the server for the change to take effect if it is running.')

    except Exception as e:
        print(f'An error occurred: {e}')

if __name__ == '__main__':
    set_new_admin_password()
