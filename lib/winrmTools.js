// Each tool's PowerShell script always ends in ConvertTo-Json so the
// result is structured, reliable data rather than scraped table text.
// List-returning scripts wrap their pipeline in @(...) before
// ConvertTo-Json - PowerShell's ConvertTo-Json otherwise silently
// collapses a single-item array to a bare object instead of a one-element
// array, which would make the frontend's rendering inconsistent depending
// on how many rows happened to come back.
//
// `columns` drives the generic table renderer on the frontend: [key,
// label] pairs, in display order. A tool with `columns: null` has its own
// dedicated renderer in the frontend instead (currently windowsUpdate,
// whose data is a handful of fields rather than a flat list of rows).
// Event Viewer isn't in this map - unlike these others, it needs to run a
// different query depending on which log the person picks in the UI
// (System, Security, an app-specific log, etc.), which doesn't fit this
// map's one-fixed-script-per-tool shape. It has its own dedicated routes
// instead - see /:id/eventlogs and /:id/eventlogs/:logName below.
const TOOLS = {
  processes: {
    title: 'Running Processes',
    columns: [['Name', 'Process'], ['Id', 'PID'], ['CPU', 'CPU (s)'], ['MemoryMB', 'Memory (MB)']],
    powershell: `
      @(Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Name, Id,
        @{N='CPU';E={[math]::Round($_.CPU,1)}},
        @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}}) | ConvertTo-Json -Compress
    `,
  },
  services: {
    title: 'Running Services',
    columns: [['DisplayName', 'Service'], ['Status', 'Status'], ['StartType', 'Startup']],
    powershell: `
      @(Get-Service | Select-Object Name, DisplayName, Status, StartType | Sort-Object Status, Name) | ConvertTo-Json -Compress
    `,
  },
  diskUsage: {
    title: 'Disk Usage',
    columns: [['DriveLetter', 'Drive'], ['FileSystemLabel', 'Label'], ['SizeGB', 'Size (GB)'], ['FreeGB', 'Free (GB)'], ['PercentFree', '% Free']],
    powershell: `
      @(Get-Volume | Where-Object { $_.DriveLetter } | Select-Object DriveLetter, FileSystemLabel,
        @{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}},
        @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,1)}},
        @{N='PercentFree';E={ if ($_.Size -gt 0) { [math]::Round(($_.SizeRemaining/$_.Size)*100,1) } else { 0 } }}) | ConvertTo-Json -Compress
    `,
  },
  installedSoftware: {
    title: 'Installed Software',
    columns: [['Name', 'Name'], ['Version', 'Version'], ['Publisher', 'Publisher'], ['InstallDate', 'Installed']],
    powershell: `
      $paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      )
      @(Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } |
        Select-Object @{N='Name';E={$_.DisplayName}}, @{N='Version';E={$_.DisplayVersion}},
          @{N='Publisher';E={$_.Publisher}}, @{N='InstallDate';E={$_.InstallDate}} |
        Sort-Object Name) | ConvertTo-Json -Compress
    `,
  },
  networkConfig: {
    title: 'Network Configuration',
    columns: [['adapter', 'Adapter'], ['ipv4', 'IPv4'], ['ipv6', 'IPv6'], ['gateway', 'Gateway'], ['dns', 'DNS']],
    powershell: `
      @(Get-NetIPConfiguration | ForEach-Object {
        [PSCustomObject]@{
          adapter = $_.InterfaceAlias
          ipv4 = ($_.IPv4Address.IPAddress -join ', ')
          ipv6 = ($_.IPv6Address.IPAddress -join ', ')
          gateway = ($_.IPv4DefaultGateway.NextHop -join ', ')
          dns = ($_.DNSServer.ServerAddresses -join ', ')
        }
      }) | ConvertTo-Json -Compress
    `,
  },
  windowsUpdate: {
    title: 'Windows Update Status',
    columns: null,
    powershell: `
      $lastUpdate = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
      $pendingReboot = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
      [PSCustomObject]@{
        lastHotfixId = $lastUpdate.HotFixID
        lastHotfixDate = if ($lastUpdate.InstalledOn) { $lastUpdate.InstalledOn.ToString('yyyy-MM-dd') } else { $null }
        pendingReboot = $pendingReboot
      } | ConvertTo-Json -Compress
    `,
  },
  localUsers: {
    title: 'Local User Accounts',
    columns: [['Name', 'Username'], ['Enabled', 'Enabled'], ['LastLogon', 'Last Logon']],
    powershell: `
      @(Get-LocalUser | Select-Object Name, Enabled,
        @{N='LastLogon';E={ if ($_.LastLogon) { $_.LastLogon.ToString('yyyy-MM-dd HH:mm') } else { 'Never' } }}) | ConvertTo-Json -Compress
    `,
  },
};

// Shared by pendingUpdates and checkForUpdates below - identical query,
// differing only in IUpdateSearcher.Online. false searches using
// whatever the Windows Update Agent already knows from its last normal
// check (fast, no live network contact from the target); true forces a
// fresh live query against Windows Update/WSUS right now (genuinely
// slow - a live scan commonly takes anywhere from several seconds to a
// couple of minutes).
function updateSearchPowerShell(online) {
  return `
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $${online ? 'true' : 'false'}
    $result = $searcher.Search("IsInstalled=0 and IsHidden=0")
    @($result.Updates | ForEach-Object {
      [PSCustomObject]@{
        title = $_.Title
        kb = ($_.KBArticleIDs -join ', ')
        severity = if ($_.MsrcSeverity) { $_.MsrcSeverity } else { '-' }
        sizeMB = [math]::Round($_.MaxDownloadSize / 1MB, 1)
      }
    }) | ConvertTo-Json -Compress
  `;
}

TOOLS.pendingUpdates = {
  title: 'Pending Updates',
  columns: [['title', 'Update'], ['kb', 'KB'], ['severity', 'Severity'], ['sizeMB', 'Size (MB)']],
  powershell: updateSearchPowerShell(false),
};

TOOLS.checkForUpdates = {
  title: 'Check for Updates',
  columns: [['title', 'Update'], ['kb', 'KB'], ['severity', 'Severity'], ['sizeMB', 'Size (MB)']],
  powershell: updateSearchPowerShell(true),
  // A live online search is genuinely slow - well past the 20s default
  // that's plenty for every other tool here, all of which only ever read
  // already-local state (services, processes, the registry, etc.)
  // instead of contacting an external update source.
  timeoutMs: 120000,
};

module.exports = { TOOLS };
