# Discord Bot for Wormhole QWvm5J

This bot controls the startup of a Node.js application and a Cloudflare tunnel, then posts the generated public URL to a Discord channel.

## Setup

1.  **Python Installation**:
    Ensure you have Python 3.8 or newer installed.

2.  **Create a Virtual Environment (Recommended)**:
    Open a terminal or command prompt in the `discord_bot` directory (`C:\Users\AM\CascadeProjects\Wormhole QWvm5J\discord_bot`):
    ```bash
    python -m venv venv
    ```
    Activate the virtual environment:
    *   On Windows:
        ```bash
        .\venv\Scripts\activate
        ```
    *   On macOS/Linux:
        ```bash
        source venv/bin/activate
        ```

3.  **Install Dependencies**:
    With the virtual environment activated, install the required Python packages:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Bot Token**:
    The bot token is stored in the `.env` file. It should already be populated with the token you provided:
    ```
    DISCORD_BOT_TOKEN=YOUR_ACTUAL_BOT_TOKEN
    ```
    Ensure this file exists and contains the correct token.

5.  **Application Paths**:
    The bot script (`bot.py`) uses the following paths. Ensure they are correct for your system:
    *   Node.js application directory: `e:\𓄀\wildcherry\Wormhole eE7XL0`
    *   Node.js executable: `C:\Program Files\nodejs\node.exe`
    *   `cloudflared.exe` is expected to be in the Node.js application directory.
    If these paths are different, you'll need to update them at the top of `bot.py`.

## Running the Bot

1.  Ensure your Discord bot has been invited to your server and has the necessary permissions (at least `Send Messages` and `Read Message History` in the channels where it will operate).
    Bot Invite Link (if needed): `https://discord.com/oauth2/authorize?client_id=1383231296343380140`

2.  Activate your virtual environment if it's not already active.

3.  Run the bot from the `discord_bot` directory:
    ```bash
    python bot.py
    ```

4.  Once the bot is running and connected, you'll see a message like "Bot is ready and logged in as YourBotName#1234" in the console.

## Usage

In any text channel the bot has access to, type:
```
!s
```
The bot will then:
1.  Attempt to start your Node.js application.
2.  Attempt to start the Cloudflare tunnel.
3.  Monitor the Cloudflare logs for the public URL.
4.  Post the URL back to the channel or an error message if it fails.

## Stopping the Services

The Node.js application and Cloudflare tunnel are started as detached background processes. This means they will continue running even if the bot is stopped. You will need to manually stop these processes if required:
*   You can use Task Manager on Windows to find and end the `node.exe` and `cloudflared.exe` processes.
*   Alternatively, you can identify them by checking which processes are using `localhost:3001` (for Node) or related to Cloudflare.

Future improvements could include a `!stop` command in the bot to manage these processes.
