; S Browser — оформление установщика (NSIS Modern UI)
; Файл в UTF-8 с BOM: иначе NSIS прочитает кириллицу в кодировке Windows-1252.

!macro customHeader
  ; Тёмный фон и светлый текст на страницах приветствия/завершения и в шапке
  !define MUI_BGCOLOR "0B0D14"
  !define MUI_TEXTCOLOR "E9ECF5"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
  !define MUI_INSTFILESPAGE_COLORS "E9ECF5 0B0D14"
  !ifndef BUILD_UNINSTALLER
    !define MUI_FINISHPAGE_TITLE "S Browser установлен"
    !define MUI_FINISHPAGE_TEXT "Всё готово!$\r$\n$\r$\nПри первом запуске откроются настройки — укажите адрес, порт и, если нужно, логин и пароль вашего прокси.$\r$\n$\r$\nБраузер выходит в интернет только через прокси: если он недоступен, страницы не загрузятся."
    !define MUI_FINISHPAGE_RUN_TEXT "Запустить S Browser"
  !else
    !define MUI_WELCOMEPAGE_TITLE "Удаление S Browser"
    !define MUI_WELCOMEPAGE_TEXT "Мастер удалит S Browser с этого компьютера.$\r$\n$\r$\nВаши настройки прокси, закладки и загрузки останутся в папке %APPDATA%\SBrowser — удалите её вручную, если они больше не нужны.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в S Browser"
  !define MUI_WELCOMEPAGE_TEXT "Мастер установит S Browser — приватный браузер, который выходит в интернет только через ваш прокси.$\r$\n$\r$\n•  Изоляция от данных компьютера$\r$\n•  Защита от утечек IP, DNS и WebRTC$\r$\n•  Часовой пояс и язык под регион прокси$\r$\n•  Автоперевод, закладки, загрузки$\r$\n$\r$\nЕсли S Browser уже установлен, он будет обновлён, а ваши настройки и закладки сохранятся.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !insertmacro MUI_PAGE_WELCOME
!macroend
