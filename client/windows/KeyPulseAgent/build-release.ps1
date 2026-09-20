#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
# 与 README 保持一致：输出到 client\windows\release，而不是 KeyPulseAgent\release。
$Release = Join-Path (Split-Path -Parent $Root) "release"
$Dist = Join-Path $Root "dist"
$Build = Join-Path $Root "build"

Set-Location $Root

function Test-PythonExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [string[]]$PrefixArguments = @()
    )

    if ($Executable -like "*\Microsoft\WindowsApps\*") {
        return $false
    }

    if (Test-Path -LiteralPath $Executable) {
        $ExecutableFile = Get-Item -LiteralPath $Executable -ErrorAction SilentlyContinue
        if (-not $ExecutableFile -or $ExecutableFile.Length -eq 0) {
            return $false
        }
    }

    & $Executable @PrefixArguments -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" *> $null
    return $LASTEXITCODE -eq 0
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Step,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $PythonExecutable @PythonPrefixArguments @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Step 失败（退出码：$LASTEXITCODE）。"
    }
}

$PythonExecutable = $null
$PythonPrefixArguments = @()

# 优先使用 Windows Python Launcher，避免命中 WindowsApps 的 0 字节占位 python.exe。
$PyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($PyLauncher -and (Test-PythonExecutable -Executable $PyLauncher.Source -PrefixArguments @("-3"))) {
    $PythonExecutable = $PyLauncher.Source
    $PythonPrefixArguments = @("-3")
}

if (-not $PythonExecutable) {
    foreach ($CommandName in @("python.exe", "python3.exe")) {
        $PythonCommand = Get-Command $CommandName -ErrorAction SilentlyContinue
        if ($PythonCommand -and (Test-PythonExecutable -Executable $PythonCommand.Source)) {
            $PythonExecutable = $PythonCommand.Source
            break
        }
    }
}

if (-not $PythonExecutable) {
    throw "未找到可用的 Python 3.10+。请安装完整版 Python（包含 Tcl/Tk），不要使用 WindowsApps 占位程序。"
}

Write-Host "使用 Python：$PythonExecutable $($PythonPrefixArguments -join ' ')"

Invoke-Python -Step "检查 Tcl/Tk 运行库" -Arguments @(
    "-c",
    "import tkinter; tcl = tkinter.Tcl(); print('Tcl/Tk ' + tcl.eval('info patchlevel'))"
)
Invoke-Python -Step "升级 pip" -Arguments @("-m", "pip", "install", "--upgrade", "pip")
Invoke-Python -Step "安装项目依赖" -Arguments @("-m", "pip", "install", "-r", "requirements.txt")

if (Test-Path $Release) { Remove-Item $Release -Recurse -Force }
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }

Invoke-Python -Step "PyInstaller 打包" -Arguments @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--windowed",
    "--name", "KeyPulse",
    "--distpath", $Release,
    "--workpath", $Build,
    "--specpath", $Root,
    "--hidden-import", "hook",
    "--hidden-import", "keymap",
    "--hidden-import", "recorder",
    "--hidden-import", "storage",
    "--hidden-import", "upload",
    "main.py"
)

$ReleaseExecutable = Join-Path $Release "KeyPulse.exe"
if (-not (Test-Path -LiteralPath $ReleaseExecutable)) {
    throw "PyInstaller 未生成目标文件：$ReleaseExecutable"
}
$ReleaseFile = Get-Item -LiteralPath $ReleaseExecutable
if ($ReleaseFile.Length -eq 0) {
    throw "PyInstaller 生成了空文件：$ReleaseExecutable"
}

Write-Host ""
Write-Host "构建完成：$ReleaseExecutable"
Write-Host "可将 KeyPulse.exe 复制到任意目录运行，或固定到开始菜单。"
