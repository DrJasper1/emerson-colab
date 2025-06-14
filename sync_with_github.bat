@echo off
echo =================================================
echo  Syncing with GitHub (Pull then Push)
echo =================================================
echo.

REM Ensure we are in the script's directory (project root)
cd /D "%~dp0"

echo --- Step 1: Pulling latest changes from origin/main ---
git pull origin main
if errorlevel 1 (
    echo.
    echo ERROR: Failed to pull from GitHub.
    echo This could be due to network issues, or merge conflicts that need manual resolution.
    echo Please resolve any issues and try again.
    pause
    exit /b 1
)
echo.
echo Pull successful or already up-to-date.
echo.

echo --- Step 2: Pushing your committed changes to origin/main ---
git push origin main
if errorlevel 1 (
    echo.
    echo ERROR: Failed to push to GitHub.
    echo This could be because you need to pull new changes first (if someone else pushed),
    echo or you have no new local commits to push.
    echo Please check your Git status and try again.
    pause
    exit /b 1
)
echo.
echo Push successful or nothing to push.
echo.

echo =================================================
echo  Sync complete!
echo =================================================
pause
