$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
Set-Location "C:\Users\adria\Downloads\tiro-curto-do-dino-main\tiro-curto-do-dino-main"
Write-Host "Iniciando servidor de desenvolvimento..."
Write-Host "Acesse: http://localhost:8080"
npm run dev
