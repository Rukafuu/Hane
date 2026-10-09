$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CredentialBridge {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount;
    public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("Advapi32.dll", SetLastError = true)] public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("Advapi32.dll", SetLastError = true)] public static extern void CredFree(IntPtr buffer);
}
'@

$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$type = 1 # CRED_TYPE_GENERIC
if ($request.operation -eq 'set') {
  $bytes = [Text.Encoding]::Unicode.GetBytes([string]$request.secret)
  $target = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni([string]$request.reference)
  $user = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni('local-agent-orchestrator')
  $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $credential = New-Object CredentialBridge+CREDENTIAL
    $credential.Type = $type; $credential.TargetName = $target; $credential.UserName = $user
    $credential.CredentialBlob = $blob; $credential.CredentialBlobSize = $bytes.Length; $credential.Persist = 2
    if (-not [CredentialBridge]::CredWrite([ref]$credential, 0)) { throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    @{ found = $true } | ConvertTo-Json -Compress
  } finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($target); [Runtime.InteropServices.Marshal]::FreeCoTaskMem($user); [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob) }
} elseif ($request.operation -eq 'get') {
  $pointer = [IntPtr]::Zero
  if (-not [CredentialBridge]::CredRead([string]$request.reference, $type, 0, [ref]$pointer)) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { @{ found = $false } | ConvertTo-Json -Compress; exit 0 }
    throw "CredRead failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  try { $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][CredentialBridge+CREDENTIAL]); @{ found = $true; secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2)) } | ConvertTo-Json -Compress } finally { [CredentialBridge]::CredFree($pointer) }
} elseif ($request.operation -eq 'delete') {
  $deleted = [CredentialBridge]::CredDelete([string]$request.reference, $type, 0)
  if (-not $deleted -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw "CredDelete failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  @{ found = $deleted } | ConvertTo-Json -Compress
} else { throw 'Unsupported operation.' }
