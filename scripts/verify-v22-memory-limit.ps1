param([ValidateRange(10000,600000)][int] $TimeoutMs = 120000)

$ErrorActionPreference = 'Stop'

# Apply the Windows commit limit before the test runner starts any children.
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ViralCutMemoryJob {
    [StructLayout(LayoutKind.Sequential)]
    struct Basic {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Extended {
        public Basic BasicLimits;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    const int ExtendedLimits = 9;
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Extended limits, int size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    public static IntPtr Open(IntPtr process, ulong limit) {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var info = new Extended { JobMemory = new UIntPtr(limit) };
        info.BasicLimits.Flags = 0x200 | 0x2000; // Job memory, kill on close.
        if (SetInformationJobObject(job, ExtendedLimits, ref info, Marshal.SizeOf<Extended>())
            && AssignProcessToJobObject(job, process)) return job;
        int error = Marshal.GetLastWin32Error();
        CloseHandle(job);
        throw new Win32Exception(error);
    }
    public static ulong Peak(IntPtr job) {
        if (!QueryInformationJobObject(job, ExtendedLimits, out Extended info, Marshal.SizeOf<Extended>(), IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return info.PeakJobMemory.ToUInt64();
    }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$lease = Join-Path ([IO.Path]::GetTempPath()) ('viralcut-v22-memory-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $lease | Out-Null
$runner = Join-Path $lease 'runner.mjs'
$gate = Join-Path $lease 'run'
@'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const stop = Date.now() + 15000
while (!existsSync(process.argv[2])) {
  if (Date.now() >= stop) process.exit(1)
  await delay(40)
}
const result = spawnSync(process.execPath, ['scripts/verify-v22-studio.mjs'], { stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
'@ | Set-Content -LiteralPath $runner -Encoding utf8
$launch = @{
  FilePath = (Get-Command node).Source
  ArgumentList = @('"' + $runner + '"', '"' + $gate + '"')
  WorkingDirectory = $root
  WindowStyle = 'Hidden'
  PassThru = $true
  RedirectStandardOutput = (Join-Path $lease 'stdout')
  RedirectStandardError = (Join-Path $lease 'stderr')
}
$proc = Start-Process @launch
$job = [IntPtr]::Zero
try {
  $job = [ViralCutMemoryJob]::Open($proc.Handle, 8GB)
  New-Item -ItemType File -Path $gate | Out-Null
  $exited = $proc.WaitForExit($TimeoutMs)
  Get-Content -LiteralPath (Join-Path $lease 'stdout'),(Join-Path $lease 'stderr')
  "Job commit limit: 8192 MiB. Peak: $([math]::Round([ViralCutMemoryJob]::Peak($job) / 1MB, 1)) MiB."
  if (!$exited) { throw 'Memory-limited test timed out.' }
  exit $proc.ExitCode
} finally {
  if ($job -ne [IntPtr]::Zero) { [void][ViralCutMemoryJob]::CloseHandle($job) }
  if (!$proc.HasExited) { $proc.Kill(); $proc.WaitForExit() }
  foreach ($name in @('run','runner.mjs','stdout','stderr')) {
    Remove-Item -LiteralPath (Join-Path $lease $name) -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $lease -ErrorAction SilentlyContinue
}
