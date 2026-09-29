Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
electron = root & "\desktop\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  MsgBox "Please run setup-desktop.cmd first.", 48, "BT-Agent"
Else
  shell.CurrentDirectory = root
  shell.Run Chr(34) & electron & Chr(34) & " " & Chr(34) & root & "\desktop" & Chr(34), 1, False
End If
