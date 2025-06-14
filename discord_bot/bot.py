import discord
from discord.ext import commands
import os
import subprocess
import asyncio
import re
from dotenv import load_dotenv

# --- Configuration ---
# Load environment variables from .env file
load_dotenv()
DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')

# Paths (Update these if your setup is different)
NODE_APP_DIR = r"C:\Users\AM\CascadeProjects\Wormhole QWvm5J"
NODE_EXE_PATH = r"C:\Program Files\nodejs\node.exe"
# CLOUDFLARED_EXE_NAME = "cloudflared.exe"  # Path specified directly below
CLOUDFLARE_LOG_FILENAME = "cloudflare_output.log"

# Construct full paths
CLOUDFLARED_EXE_PATH = r"C:\Users\AM\CascadeProjects\Wormhole QWvm5J\cloudflared.exe" # Full path to cloudflared.exe
CLOUDFLARE_LOG_PATH = os.path.join(NODE_APP_DIR, CLOUDFLARE_LOG_FILENAME)

# Bot setup
intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.messages = True

bot = commands.Bot(command_prefix='!', intents=intents)

# Subprocess creation flags for Windows (run detached and without a window)
# DETACHED_PROCESS = 0x00000008
# CREATE_NO_WINDOW = 0x08000000
SUBPROCESS_FLAGS = 0x00000008 | 0x08000000

@bot.event
async def on_ready():
    print(f'Bot is ready and logged in as {bot.user}')

@bot.command(name='s')
async def start_services(ctx):
    await ctx.send(f"Attempting to start services and fetch Cloudflare link... Please wait.")

    # 1. Ensure cloudflared executable exists
    if not os.path.exists(CLOUDFLARED_EXE_PATH):
        await ctx.send(f"Error: Cloudflared executable not found at `{CLOUDFLARED_EXE_PATH}`. Please check the path.")
        return

    # 2. Ensure Node.js executable exists
    if not os.path.exists(NODE_EXE_PATH):
        await ctx.send(f"Error: Node.js executable not found at `{NODE_EXE_PATH}`. Please check the path.")
        return
        
    # 3. Ensure Node app directory exists
    if not os.path.isdir(NODE_APP_DIR):
        await ctx.send(f"Error: Node app directory not found at `{NODE_APP_DIR}`. Please check the path.")
        return

    # 4. Delete old Cloudflare log file if it exists, to ensure fresh output
    try:
        if os.path.exists(CLOUDFLARE_LOG_PATH):
            os.remove(CLOUDFLARE_LOG_PATH)
    except OSError as e:
        await ctx.send(f"Warning: Could not delete old log file `{CLOUDFLARE_LOG_PATH}`: {e}. Continuing...")

    # 5. Start Node.js application
    try:
        print(f"Starting Node.js app: {NODE_EXE_PATH} server.js in {NODE_APP_DIR}")
        subprocess.Popen([NODE_EXE_PATH, "server.js"], cwd=NODE_APP_DIR, creationflags=SUBPROCESS_FLAGS)
        await ctx.send("Node.js application started in the background.")
    except Exception as e:
        await ctx.send(f"Error starting Node.js application: {e}")
        return

    # Wait for Node.js app to initialize
    await asyncio.sleep(5) # Adjust as needed

    # 6. Start Cloudflare Tunnel
    try:
        print(f"Starting Cloudflare tunnel: {CLOUDFLARED_EXE_PATH} with log file {CLOUDFLARE_LOG_PATH}")
        subprocess.Popen(
            [CLOUDFLARED_EXE_PATH, "tunnel", "--url", "http://localhost:3001", "--logfile", CLOUDFLARE_LOG_PATH, "--no-autoupdate"],
            cwd=NODE_APP_DIR,
            creationflags=SUBPROCESS_FLAGS
        )
        await ctx.send("Cloudflare tunnel process started in the background. Waiting for URL...")
    except Exception as e:
        await ctx.send(f"Error starting Cloudflare tunnel: {e}")
        return

    # 7. Poll log file for the Cloudflare URL
    url_found = False
    # Try for up to 60 seconds to find the URL
    for _ in range(30): # 30 attempts * 2 seconds sleep = 60 seconds timeout
        await asyncio.sleep(2)
        try:
            if os.path.exists(CLOUDFLARE_LOG_PATH):
                with open(CLOUDFLARE_LOG_PATH, 'r', encoding='utf-8') as log_file:
                    log_content = log_file.read()
                # Regex to find Cloudflare URL (e.g., https://something.trycloudflare.com)
                match = re.search(r"(https://[a-zA-Z0-9-]+.trycloudflare.com)", log_content)
                if match:
                    url = match.group(1)
                    await ctx.send(f"Success! Your application should be accessible at: {url}")
                    print(f"Found URL: {url}")
                    url_found = True
                    break
        except Exception as e:
            print(f"Error reading or parsing log file: {e}")
            # Continue trying
    
    if not url_found:
        await ctx.send("Failed to retrieve Cloudflare URL after 60 seconds. The tunnel might still be starting, or there could be an issue. Check the log file manually: `" + CLOUDFLARE_LOG_PATH + "`")
        print("Failed to find Cloudflare URL in log file after timeout.")

if __name__ == '__main__':
    if DISCORD_BOT_TOKEN:
        bot.run(DISCORD_BOT_TOKEN)
    else:
        print("Error: DISCORD_BOT_TOKEN not found in .env file. Please create .env and add your bot token.")
