@echo off
REM This script prepares your project for an initial push to GitHub and attempts to push it.

set GITHUB_REPO_URL=https://github.com/DrJasper1/Anon-Chat.git

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Git is not installed or not found in PATH.
    echo Please install Git from https://git-scm.com/ and ensure it's added to your PATH.
    pause
    exit /b 1
)

REM Check if inside a Git repository, if not, initialize it.
if not exist .git (
    echo Initializing new Git repository and setting branch to main...
    git init -b main
    if %errorlevel% neq 0 (
        echo Failed to initialize Git repository.
        pause
        exit /b 1
    )
) else (
    echo Git repository already exists.
    echo Ensuring local branch is named 'main'...
    git branch -M main
)

echo Adding all files to Git (respecting .gitignore)...
git add .
if %errorlevel% neq 0 (
    echo Failed to add files to Git.
    pause
    exit /b 1
)

echo Committing files with message "Prepare Wormhole project for DrJasper1/Anon-Chat"...
git commit -m "Prepare Wormhole project for DrJasper1/Anon-Chat"
if %errorlevel% neq 0 (
    echo Failed to commit files. This might be because there are no new changes to commit.
) else (
    echo Files committed successfully.
)

echo.
echo Attempting to add remote origin: %GITHUB_REPO_URL%
REM Check if remote 'origin' already exists
git remote get-url origin >nul 2>&1
if %errorlevel% equ 0 (
    echo Remote 'origin' already exists. Setting URL to %GITHUB_REPO_URL%...
    git remote set-url origin %GITHUB_REPO_URL%
) else (
    echo Adding new remote 'origin' with URL %GITHUB_REPO_URL%...
    git remote add origin %GITHUB_REPO_URL%
)

if %errorlevel% neq 0 (
    echo Failed to set up remote 'origin'. Please check the URL and your Git configuration.
    pause
    exit /b 1
)

echo Attempting to push to GitHub (origin main)...
echo Forcing credential prompt for GitHub...
git config --local credential.helper ""
echo You will be prompted for your GitHub username and Personal Access Token.
git push --force -u origin main

if %errorlevel% neq 0 (
    echo Failed to push to GitHub. Please check your credentials, internet connection, and repository permissions.
    echo If push was blocked by GitHub secret scanning, ensure the committed files do not contain PATs.
) else (
    echo Successfully pushed to GitHub!
)

echo.
echo Re-enabling default Git credential helper for this repository...
git config --local credential.helper manager-core

echo.
echo Script finished.
pause
