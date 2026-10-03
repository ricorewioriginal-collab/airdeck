@echo off
rem Richtet AnMaCha Cast als Autostart bei der Anmeldung ein (24/7-Automation nach Neustart).
rem Entfernen: schtasks /Delete /TN "AnMaChaCast" /F
schtasks /Create /TN "AnMaChaCast" /SC ONLOGON /RL LIMITED /F /TR "\"%~dp0AnMaChaCast.exe\" --minimized"
if %errorlevel%==0 (echo Autostart eingerichtet.) else (echo Autostart konnte nicht eingerichtet werden.)
pause
