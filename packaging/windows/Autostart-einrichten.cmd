@echo off
rem Richtet AnMaCha Cast als Autostart bei der Anmeldung ein (24/7-Automation nach Neustart).
rem Aufgabenname bleibt bewusst "AirDeck" (bestehende Einrichtung soll weiterhin per
rem "schtasks /Delete /TN AirDeck" entfernbar sein, siehe docs/REBRANDING_ANMACHA_CAST.md Phase 6).
rem Entfernen: schtasks /Delete /TN "AirDeck" /F
schtasks /Create /TN "AirDeck" /SC ONLOGON /RL LIMITED /F /TR "\"%~dp0AirDeck.exe\" --minimized"
if %errorlevel%==0 (echo Autostart eingerichtet.) else (echo Autostart konnte nicht eingerichtet werden.)
pause
