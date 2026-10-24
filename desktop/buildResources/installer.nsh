!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please save your notes and close WebObsidian before installing. The installer will not close it for you." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
