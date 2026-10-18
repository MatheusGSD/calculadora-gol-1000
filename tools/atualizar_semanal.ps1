# Coleta semanal da lista de jogadores: baixa da Transfermarkt, faz o commit e sobe para o GitHub.
# Roda pelo Agendador de Tarefas do Windows (tarefa "Gol 1000 - atualizar jogadores", segundas às 9h), porque a
# Transfermarkt bloqueia os servidores do GitHub Actions. O registro de cada rodada fica em tools/atualizar_semanal.log.
#
# Uso à mão:  powershell -ExecutionPolicy Bypass -File tools\atualizar_semanal.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$git = 'C:\Program Files\Git\cmd\git.exe'
$python = 'C:\Python314\python.exe'
Start-Transcript -Path (Join-Path $PSScriptRoot 'atualizar_semanal.log') -Append | Out-Null
try {
    Set-Location $repo
    & $git pull --quiet
    if ($LASTEXITCODE) { throw 'git pull falhou' }
    & $python -I tools/build_jogadores.py
    if ($LASTEXITCODE) { throw 'a coleta falhou (veja acima)' }
    & $git add -A data/jogadores data/jogadores.json
    & $git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Output 'nada novo'; return }
    & $git commit --quiet -m "Jogadores atualizados em $(Get-Date -Format 'dd/MM/yyyy')"
    & $git push --quiet
    if ($LASTEXITCODE) { throw 'git push falhou' }
    Write-Output 'atualizado e enviado'
} finally {
    Stop-Transcript | Out-Null
}
