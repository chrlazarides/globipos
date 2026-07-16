# ============================================================
#  GlobiPOS Migration Export Script
#  Exports EVERY table from a SQL Server database to CSV files
#  (UTF-8, with headers, Greek characters preserved) and zips
#  them into one file you can upload to GlobiPOS.
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== GlobiPOS - SQL Server Data Export ===" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Ask for connection details --------------------------
$server = Read-Host "SQL Server instance (press Enter for 'localhost', or type e.g. .\SQLEXPRESS)"
if ([string]::IsNullOrWhiteSpace($server)) { $server = "localhost" }

$connBase = "Server=$server;Integrated Security=True;TrustServerCertificate=True;"

# Try Windows login first; fall back to SQL login if it fails
try {
    $test = New-Object System.Data.SqlClient.SqlConnection ($connBase + "Database=master;")
    $test.Open(); $test.Close()
} catch {
    Write-Host "Windows login failed - trying SQL Server login..." -ForegroundColor Yellow
    $user = Read-Host "SQL username (e.g. sa)"
    $pass = Read-Host "SQL password" -AsSecureString
    $passPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
    $connBase = "Server=$server;User ID=$user;Password=$passPlain;TrustServerCertificate=True;"
    $test = New-Object System.Data.SqlClient.SqlConnection ($connBase + "Database=master;")
    $test.Open(); $test.Close()
}
Write-Host "Connected to $server" -ForegroundColor Green

# ---- 2. Pick the database -----------------------------------
$conn = New-Object System.Data.SqlClient.SqlConnection ($connBase + "Database=master;")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name"
$reader = $cmd.ExecuteReader()
$dbs = @()
while ($reader.Read()) { $dbs += $reader.GetString(0) }
$reader.Close(); $conn.Close()

Write-Host ""
Write-Host "Databases found:" -ForegroundColor Cyan
for ($i = 0; $i -lt $dbs.Count; $i++) { Write-Host ("  [{0}] {1}" -f ($i + 1), $dbs[$i]) }
Write-Host ""
$choice = Read-Host "Type the NUMBER of the database to export"
$database = $dbs[[int]$choice - 1]
Write-Host "Selected: $database" -ForegroundColor Green

# ---- 3. Export every table to CSV ---------------------------
$stamp   = Get-Date -Format "yyyyMMdd_HHmm"
$outDir  = Join-Path $env:USERPROFILE "Desktop\GlobiPOS_Export_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$conn = New-Object System.Data.SqlClient.SqlConnection ($connBase + "Database=$database;")
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT s.name AS SchemaName, t.name AS TableName
FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
ORDER BY s.name, t.name
"@
$reader = $cmd.ExecuteReader()
$tables = @()
while ($reader.Read()) { $tables += ,@($reader.GetString(0), $reader.GetString(1)) }
$reader.Close()

Write-Host ""
Write-Host ("Exporting {0} tables..." -f $tables.Count) -ForegroundColor Cyan

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$exported = 0

foreach ($t in $tables) {
    $schema = $t[0]; $table = $t[1]
    $fileName = if ($schema -eq "dbo") { "$table.csv" } else { "$schema.$table.csv" }
    $filePath = Join-Path $outDir $fileName
    try {
        $dataCmd = $conn.CreateCommand()
        $dataCmd.CommandText = "SELECT * FROM [$schema].[$table]"
        $dataCmd.CommandTimeout = 300
        $da = New-Object System.Data.SqlClient.SqlDataAdapter $dataCmd
        $dt = New-Object System.Data.DataTable
        [void]$da.Fill($dt)

        if ($dt.Rows.Count -eq 0) {
            Write-Host ("  - {0} (empty, skipped)" -f $fileName) -ForegroundColor DarkGray
            continue
        }

        $sw = New-Object System.IO.StreamWriter($filePath, $false, $utf8Bom)
        $cols = $dt.Columns | ForEach-Object { $_.ColumnName }
        $sw.WriteLine( ($cols | ForEach-Object { '"' + ($_ -replace '"','""') + '"' }) -join "," )
        foreach ($row in $dt.Rows) {
            $vals = foreach ($c in $cols) {
                $v = $row[$c]
                if ($v -is [DBNull]) { "" }
                elseif ($v -is [datetime]) { '"' + $v.ToString("yyyy-MM-dd HH:mm:ss") + '"' }
                elseif ($v -is [byte[]]) { "" }   # skip binary blobs
                else { '"' + ($v.ToString() -replace '"','""') + '"' }
            }
            $sw.WriteLine($vals -join ",")
        }
        $sw.Close()
        $exported++
        Write-Host ("  + {0} ({1} rows)" -f $fileName, $dt.Rows.Count) -ForegroundColor Green
    } catch {
        Write-Host ("  ! {0} FAILED: {1}" -f $fileName, $_.Exception.Message) -ForegroundColor Red
    }
}
$conn.Close()

# ---- 4. Zip everything --------------------------------------
$zipPath = Join-Path $env:USERPROFILE "Desktop\GlobiPOS_Export_$stamp.zip"
Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ("DONE - {0} tables exported" -f $exported) -ForegroundColor Green
Write-Host ""
Write-Host "Your file is on the Desktop:" -ForegroundColor Cyan
Write-Host ("  {0}" -f $zipPath) -ForegroundColor Yellow
Write-Host ""
Write-Host "Upload this zip (or the CSV files inside it) to GlobiPOS chat or the Import Data page."
Write-Host ""
Read-Host "Press Enter to close"
