@echo off
setlocal

set ORIGEM=C:\Users\P_7997\Downloads\legislatorApp\server-data\legislator.db
set DESTINO=\\redecamara\dfsdata\Secedi\Links\legislatorDB
set LOG=%DESTINO%\backup.log

:: Cria a pasta de destino se não existir
if not exist "%DESTINO%" mkdir "%DESTINO%"

:: Nome do arquivo com data e hora: legislator_20260525_1430.db
for /f "tokens=1-5 delims=/-: " %%a in ("%date% %time%") do (
  set DIA=%%a
  set MES=%%b
  set ANO=%%c
  set HORA=%%d
  set MIN=%%e
)
set ARQUIVO=legislator_%ANO%%MES%%DIA%_%HORA%%MIN%.db

:: Copia o banco
copy /Y "%ORIGEM%" "%DESTINO%\%ARQUIVO%" >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERRO ao copiar para %DESTINO%\%ARQUIVO% >> "%LOG%"
  exit /b 1
)

:: Também mantém uma cópia "latest" para restauração rápida
copy /Y "%ORIGEM%" "%DESTINO%\legislator_latest.db" >nul 2>&1

echo [%date% %time%] OK - %ARQUIVO% >> "%LOG%"

:: Remove backups com mais de 7 dias
forfiles /p "%DESTINO%" /m "legislator_????????_????.db" /d -7 /c "cmd /c del @path" >nul 2>&1

endlocal
