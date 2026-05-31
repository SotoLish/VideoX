$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME = "C:\Users\1\Android"
$env:PATH = "$env:JAVA_HOME\bin;C:\Users\1\Android\cmdline-tools\latest\bin;" + $env:PATH

$sdkmanager = "C:\Users\1\Android\cmdline-tools\latest\bin\sdkmanager.bat"

if (Test-Path $sdkmanager) {
    Write-Host "sdkmanager found, version:" -ForegroundColor Green
    & $sdkmanager --version
} else {
    Write-Host "sdkmanager.bat not found at: $sdkmanager" -ForegroundColor Red
}
