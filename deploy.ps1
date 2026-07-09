# Deploy script para el VPS (Windows). Corre: git pull -> generate+migrate+build backend ->
# restart backend -> build frontend -> restart frontend.
#
# Garantia: si algo falla despues de frenar el backend (prisma generate, migrate deploy
# o el build), el finally SIEMPRE vuelve a levantarlo con lo ultimo que haya en dist/
# (la build vieja si la nueva no se completo). El backend nunca queda caido al terminar
# el script, gane o pierda el deploy.

Set-Location $PSScriptRoot

function Invoke-Step($description, $scriptBlock) {
    Write-Host "==> $description"
    & $scriptBlock
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo en: $description (exit code $LASTEXITCODE)"
    }
}

Invoke-Step "git pull" { git pull origin main }
Invoke-Step "instalando dependencias (raiz, workspaces)" { npm install }

# En Windows, prisma generate falla con EPERM si el backend esta corriendo,
# porque pm2 tiene cargada en memoria la DLL del query engine. Hay que
# frenarlo antes de regenerar y prenderlo de nuevo despues del build.
$backendStopped = $false
$backendStepsOk = $false
try {
    Write-Host "==> backend: stop (pm2) para liberar el query engine de Prisma"
    pm2 stop netservice-api
    $backendStopped = $true
    Start-Sleep -Seconds 2

    Set-Location "$PSScriptRoot\apps\backend"
    Invoke-Step "backend: prisma generate" { npx prisma generate }
    Invoke-Step "backend: prisma migrate deploy" { npx prisma migrate deploy }
    Invoke-Step "backend: build" { npm run build }
    $backendStepsOk = $true
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if ($backendStopped) {
        Write-Host "==> backend: restart (pm2) - siempre, para no dejar el servicio caido"
        pm2 restart netservice-api
    }
}

if (-not $backendStepsOk) {
    Write-Host "Deploy del backend incompleto. El servicio esta arriba de nuevo con la ultima build buena, pero revisa el error de arriba antes de reintentar." -ForegroundColor Yellow
    Set-Location $PSScriptRoot
    exit 1
}

Set-Location "$PSScriptRoot\apps\frontend"
try {
    Invoke-Step "frontend: build" { npm run build }
    Invoke-Step "frontend: restart (pm2)" { pm2 restart netservice-frontend }
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Deploy del frontend incompleto (el backend si quedo actualizado y corriendo)." -ForegroundColor Yellow
    Set-Location $PSScriptRoot
    exit 1
}

Set-Location $PSScriptRoot
Write-Host "==> listo"
pm2 status
