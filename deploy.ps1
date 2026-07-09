# Deploy script para el VPS (Windows). Corre: git pull -> generate+migrate+build backend ->
# restart backend -> build frontend -> restart frontend.
# Se corta en el primer error, asi nunca reinicia un servicio con un build roto.

Set-Location $PSScriptRoot

function Invoke-Step($description, $scriptBlock) {
    Write-Host "==> $description"
    & $scriptBlock
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR en: $description (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

Invoke-Step "git pull" { git pull origin main }

Invoke-Step "instalando dependencias (raiz, workspaces)" { npm install }

# En Windows, prisma generate falla con EPERM si el backend esta corriendo,
# porque pm2 tiene cargada en memoria la DLL del query engine. Hay que
# frenarlo antes de regenerar y prenderlo de nuevo despues del build.
Write-Host "==> backend: stop (pm2) para liberar el query engine de Prisma"
pm2 stop netservice-api
Start-Sleep -Seconds 2

Set-Location "$PSScriptRoot\apps\backend"
Invoke-Step "backend: prisma generate" { npx prisma generate }
Invoke-Step "backend: prisma migrate deploy" { npx prisma migrate deploy }
Invoke-Step "backend: build" { npm run build }
Invoke-Step "backend: start/restart (pm2)" { pm2 restart netservice-api }

Set-Location "$PSScriptRoot\apps\frontend"
Invoke-Step "frontend: build" { npm run build }
Invoke-Step "frontend: restart (pm2)" { pm2 restart netservice-frontend }

Set-Location $PSScriptRoot
Write-Host "==> listo"
pm2 status
