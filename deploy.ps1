# Deploy Supabase Edge Functions for Project Pi
# Usage: ./deploy.ps1

$env:SUPABASE_ACCESS_TOKEN = Read-Host "Supabase access token"

supabase functions deploy fetch-fixtures   --project-ref (Get-Content supabase/config.toml | Select-String 'project_id' | ForEach-Object { $_ -replace '.*= "(.+)"','$1' })
supabase functions deploy analyze-matches  --project-ref (Get-Content supabase/config.toml | Select-String 'project_id' | ForEach-Object { $_ -replace '.*= "(.+)"','$1' })

Write-Host "Done. Set secrets with:"
Write-Host "  supabase secrets set RAPIDAPI_KEY=xxx ANTHROPIC_API_KEY=xxx TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx"
