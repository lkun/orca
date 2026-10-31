param([string]$RuntimePath = (Join-Path $PSScriptRoot "runtime.ps1"))

$ErrorActionPreference = "Stop"

function Assert-TestEqual($Actual, $Expected, [string]$Label) {
    if ($Actual -ne $Expected) { throw "$Label expected '$Expected', received '$Actual'" }
}

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;

public static class OCCDesktopWin32 {
    public static readonly List<string> Calls = new List<string>();
    public static bool AllowActivation;
    public static IntPtr Foreground;
    public static IntPtr Pending;
    public static int FocusReads;
    public static int WindowX;

    public static void Reset(bool allow) {
        Calls.Clear();
        AllowActivation = allow;
        Foreground = new IntPtr(202);
        Pending = IntPtr.Zero;
        FocusReads = 0;
        WindowX = 100;
    }
    public static bool ShowWindow(IntPtr hwnd, int command) {
        Calls.Add("restore");
        return true;
    }
    public static bool SetForegroundWindow(IntPtr hwnd) {
        Calls.Add("activate");
        Pending = hwnd;
        return AllowActivation;
    }
    public static IntPtr GetForegroundWindow() {
        FocusReads++;
        if (AllowActivation && FocusReads >= 2) {
            Foreground = Pending;
            WindowX = 500;
        }
        return Foreground;
    }
    public static bool SetCursorPos(int x, int y) {
        Calls.Add("move:" + x + "," + y);
        return true;
    }
    public static void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra) {
        Calls.Add("mouse");
    }
    public static void SendModifiedClick(byte[] modifiers, uint down, uint up) {
        Calls.Add("modified");
    }
}
"@

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($RuntimePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$functions = @(
    "Test-OCCWindowFocused", "Wait-OCCWindowFocused", "Assert-OCCKeyboardFocus",
    "Assert-OCCPointerFocus", "Restore-OCCWindow", "Restore-OCCPointerWindow", "Assert-OCCWindowTarget",
    "Get-OCCRequiredNumber", "Get-OCCPositiveInteger", "Get-OCCPositiveNumber",
    "Get-OCCScreenPoint", "Get-OCCElementScreenPoint", "Get-OCCModifierVirtualKey",
    "Get-OCCClickModifierVirtualKeys", "Send-OCCMouseClick", "Send-OCCDrag", "Invoke-OCCOperation"
)
foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    if ($definition.Name -in $functions) { . ([scriptblock]::Create($definition.Extent.Text)) }
}

$MouseEvents = @{ LeftDown = 2; LeftUp = 4; RightDown = 8; RightUp = 16; MiddleDown = 32; MiddleUp = 64; Wheel = 2048; HorizontalWheel = 4096 }
function Find-OCCProcess { [pscustomobject]@{ MainWindowHandle = 101 } }
function Get-OCCRootElement { $null }
function Get-OCCWindowFrame { @{ x = [OCCDesktopWin32]::WindowX; y = 200 } }
function Find-OCCElement($RootElement, $Record) { $Record }
function Invoke-OCCPrimaryAction($Element) { $null -ne $Element }
function New-OCCSnapshot { [pscustomobject]@{} }

foreach ($case in @(
    @{ tool = "click"; x = 5; y = 6 },
    @{ tool = "click"; x = 5; y = 6; modifiers = "ctrl" },
    @{ tool = "scroll"; x = 5; y = 6; direction = "down"; pages = 1 },
    @{ tool = "drag"; from_x = 5; from_y = 6; to_x = 25; to_y = 26 }
)) {
    foreach ($activates in @($false, $true)) {
        [OCCDesktopWin32]::Reset($activates)
        $operation = [pscustomobject]@{ app = "Fixture"; noScreenshot = $true; restoreWindow = $false }
        foreach ($key in $case.Keys) { $operation | Add-Member -NotePropertyName $key -NotePropertyValue $case[$key] }
        $denied = $false
        try {
            $result = Invoke-OCCOperation $operation
        } catch {
            if ($_.Exception.Message -notlike "window_not_focused:*") { throw }
            $denied = $true
        }
        $inputCalls = @([OCCDesktopWin32]::Calls | Where-Object { $_ -like "move:*" -or $_ -in @("mouse", "modified") })
        if ($activates) {
            Assert-TestEqual $denied $false "$($case.tool) successful activation"
            Assert-TestEqual $result.ok $true "$($case.tool) result"
            if ($inputCalls.Count -eq 0) { throw "$($case.tool) did not send pointer input after activation" }
            if ([OCCDesktopWin32]::FocusReads -lt 2) { throw "$($case.tool) did not wait for activation" }
            Assert-TestEqual $inputCalls[0] "move:505,206" "$($case.tool) geometry after delayed activation"
        } else {
            Assert-TestEqual $denied $true "$($case.tool) denied activation"
            Assert-TestEqual $inputCalls.Count 0 "$($case.tool) denied activation sends no pointer or modifier input"
        }
    }
}

[OCCDesktopWin32]::Reset($false)
$result = Invoke-OCCOperation ([pscustomobject]@{ tool = "click"; app = "Fixture"; element = [pscustomobject]@{ index = 1 } })
Assert-TestEqual $result.action.path "accessibility" "pattern click path"
Assert-TestEqual ([OCCDesktopWin32]::Calls.Count) 0 "pattern click bypasses activation and global input"
Write-Output "windows-pointer-tests-ok"
