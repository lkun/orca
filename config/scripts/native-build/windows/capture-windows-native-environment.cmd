@echo off
chcp 65001 >nul
call "%OCC_WINDOWS_VSDEVCMD%" -no_logo -arch=%OCC_WINDOWS_NATIVE_ARCH% -host_arch=%OCC_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo OCC_WINDOWS_NATIVE_ENVIRONMENT
set
