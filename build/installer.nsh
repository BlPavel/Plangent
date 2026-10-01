; Picked up by electron-builder (nsis.include defaults to build/installer.nsh).
;
; An update started from the app (electron-updater passes --updated) runs this assisted installer
; with its UI, so the developer sees install progress after the app window closes. Everything but
; that progress page is skipped: the install mode and directory stay as they were, and the new
; version starts right away instead of waiting on the finish page.

!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

; The stock finish page (assistedInstaller.nsh) plus an automatic launch for updates.
!macro customFinishPage
  Function plangentStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function plangentFinishPre
    ${if} ${isUpdated}
      HideWindow
      Call plangentStartApp
      ; Skipping the last page ends the installer.
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE plangentFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "plangentStartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
