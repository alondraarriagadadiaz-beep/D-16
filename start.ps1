$secureKey = Read-Host "Define la clave compartida para registrar docentes y Biblioteca" -AsSecureString
$keyPointer = [IntPtr]::Zero

try {
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $env:STAFF_REGISTRATION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    $serverPath = Join-Path $PSScriptRoot "server.py"
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notlike "*\WindowsApps\python.exe") {
        & $pythonCommand.Source $serverPath
    } else {
        $pythonRoot = Join-Path $env:LOCALAPPDATA "Programs\Python"
        $pythonInstallations = Get-ChildItem -LiteralPath $pythonRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        $pythonPath = $null
        foreach ($installation in $pythonInstallations) {
            $candidate = Join-Path $installation.FullName "python.exe"
            if (Test-Path -LiteralPath $candidate) {
                $pythonPath = $candidate
                break
            }
        }
        if (-not $pythonPath) {
            throw "No se encontró Python 3. Instálalo desde python.org y vuelve a iniciar."
        }
        & $pythonPath $serverPath
    }
} finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    Remove-Item Env:STAFF_REGISTRATION_KEY -ErrorAction SilentlyContinue
}
