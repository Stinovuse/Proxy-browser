; S Browser — оформление установщика (NSIS Modern UI)
; Файл в UTF-8 с BOM: иначе NSIS прочитает кириллицу в кодировке Windows-1252.
; Настройки внешнего вида задаются прямо перед первой страницей — тогда они
; применяются и к шапке, и ко всем страницам (customHeader подключается позже).

; Переопределить значение, даже если сборщик уже задал своё
!macro SB_SET NAME VALUE
  !ifdef ${NAME}
    !undef ${NAME}
  !endif
  !define ${NAME} "${VALUE}"
!macroend

!macro SB_THEME
  !insertmacro SB_SET MUI_BGCOLOR "0B0D14"
  !insertmacro SB_SET MUI_TEXTCOLOR "E9ECF5"
  !insertmacro SB_SET MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!macroend

!macro customWelcomePage
  !insertmacro SB_THEME
  ; финальная страница (её вставит сборщик позже — значения уже будут заданы)
  !insertmacro SB_SET MUI_FINISHPAGE_TITLE "S Browser установлен"
  !insertmacro SB_SET MUI_FINISHPAGE_TEXT "Всё готово!$\r$\n$\r$\nПри первом запуске откроются настройки: укажите адрес и порт вашего прокси."
  !insertmacro SB_SET MUI_FINISHPAGE_RUN_TEXT "Запустить S Browser"

  !define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в S Browser"
  !define MUI_WELCOMEPAGE_TEXT "Мастер установит S Browser — приватный браузер, который выходит в интернет только через ваш прокси.$\r$\n$\r$\n•  Изоляция от данных компьютера$\r$\n•  Защита от утечек IP, DNS и WebRTC$\r$\n•  Часовой пояс и язык под регион прокси$\r$\n•  Автоперевод, закладки, загрузки$\r$\n$\r$\nЕсли S Browser уже установлен, он будет обновлён, а ваши настройки и закладки сохранятся.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !insertmacro SB_THEME
  !define MUI_WELCOMEPAGE_TITLE "Удаление S Browser"
  !define MUI_WELCOMEPAGE_TEXT "Мастер удалит S Browser с этого компьютера.$\r$\n$\r$\nВаши настройки прокси, закладки и загрузки останутся в папке %APPDATA%\SBrowser — удалите её вручную, если они больше не нужны.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; Финальная страница: как в шаблоне electron-builder (запуск через $launchLink от имени
; пользователя), плюс светлая подпись у галочки «Запустить» на тёмном фоне
!macro customFinishPage
  Function SBStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function SBFinishShow
    ; у «темизированной» галочки Windows игнорирует цвет текста — снимаем тему с этого элемента
    System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
    SetCtlColors $mui.FinishPage.Run "E9ECF5" "0B0D14"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "SBStartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SBFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend
