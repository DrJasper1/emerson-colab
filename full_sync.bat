@echo off
echo =================================================
echo  Full Sync with GitHub (Add, Commit, Pull, Push)
echo =================================================
echo.

REM Ensure we are in the script's directory (project root)
cd /D "%~dp0"

echo --- Step 1: Adding all changes to staging ---
git add .
echo All changes staged.
echo.

echo --- Step 2: Committing changes ---
REM You can change this commit message if you prefer something else
set COMMIT_MESSAGE="Automated commit and sync"
git commit -m %COMMIT_MESSAGE%
if errorlevel 1 (
    echo.
    echo NOTE: Commit may have failed if there were no changes to commit.
    echo This is usually okay. Continuing to pull...
) else (
    echo Changes committed with message: %COMMIT_MESSAGE%
)
echo.

echo --- Step 3: Pulling latest changes from origin/main ---
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

echo --- Step 4: Pushing your changes to origin/main ---
git push origin main
if errorlevel 1 (
    echo.
    echo ERROR: Failed to push to GitHub.
    echo This could be because you need to pull new changes first (if someone else pushed),
    echo or you have no new local commits to push (if the commit in step 2 failed due to no changes).
    echo Please check your Git status and try again.
    pause
    exit /b 1
)
echo.
echo Push successful or nothing to push.
echo.

echo =================================================
echo  Full sync complete!
echo =================================================
pause
