@echo off
rem Pushes Jungle Kart to GitHub. Windows will ask for your GitHub password
rem ONCE in its own popup (Git Credential Manager) - never paste it in chat.
cd /d "%~dp0"
echo.
echo  Step 1/2  Create the empty repo (once only):
echo            https://github.com/new   - name it exactly: jungle-kart - then click Create repository.
echo  Step 2/2  This window now pushes. Type your GitHub password in the Windows popup if asked.
echo.
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/Usamakhan56486A/jungle-kart.git
git push -u origin main
if errorlevel 1 (
  echo.
  echo  Push failed. If the repo already exists with other content, run:
  echo    git push -u origin main --force   (only if you are sure^)
)
echo.
echo  Done? Next: https://dashboard.render.com  -  New  -  Blueprint Instance  -  pick jungle-kart.
echo  render.yaml does the rest (free plan, Node 20).
pause
