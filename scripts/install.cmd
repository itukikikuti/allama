@ECHO OFF
SETLOCAL
PUSHD "%~dp0\.."

CALL corepack prepare pnpm@10.34.5 --activate
IF ERRORLEVEL 1 GOTO error
CALL corepack pnpm install --frozen-lockfile
IF ERRORLEVEL 1 GOTO error
CALL corepack pnpm build
IF ERRORLEVEL 1 GOTO error

PUSHD apps\cli
CALL npm link
IF ERRORLEVEL 1 GOTO error
POPD

IF EXIST "%APPDATA%\npm\allama.ps1" DEL "%APPDATA%\npm\allama.ps1"
ECHO Allama installed. Run: allama doctor
POPD
EXIT /B 0

:error
ECHO Allama installation failed.
POPD
EXIT /B 1
