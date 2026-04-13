; ObraApp Arquitectura — Instalador personalizado
; Este archivo personaliza el instalador NSIS generado por electron-builder

!macro customHeader
  !system "echo Construyendo instalador ObraApp Arquitectura..."
!macroend

!macro customInit
  ; Verificar Windows 10 o superior
  ${If} ${AtLeastWin10}
    ; OK
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "ObraApp Arquitectura requiere Windows 10 o superior."
    Abort
  ${EndIf}
!macroend

!macro customInstall
  ; Crear acceso directo adicional en el escritorio con icono personalizado
!macroend

!macro customUnInstall
  ; Limpieza adicional si es necesario
!macroend
