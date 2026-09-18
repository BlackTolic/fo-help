; NSIS 自定义安装/卸载钩子 — 大漠 dm.dll 自动注册/反注册
;
; 触发时机(electron-builder 默认 NSIS 模板已定义 customInstall/customUninstall):
;   customInstall:   安装结束后(用户点"完成"之前)
;   customUninstall: 卸载开始时
;
; regsvr32 调用要点:
;   - dm.dll 必须在 $INSTDIR\resources\dll\dm.dll(extraResources 抽出位置)
;   - regsvr32 /s = 静默注册(无弹窗)
;   - 失败也不致命(NSIS 仍然走完,用户可以在 app UI 里手动点"注册大漠"按钮重试)
;
; 权限:NSIS 安装程序默认已是管理员(NSIS 模板 requestExecutionLevel=admin)

!macro customInstall
  ${IfNot} ${Silent}
    ; 用户可见安装:把过程写到 NSIS 日志详情,失败/成功都留痕
    DetailPrint "注册大漠插件 (regsvr32 /s $INSTDIR\resources\dll\dm.dll)..."
  ${EndIf}
  ; nsExec::ExecToLog:把 stdout/stderr 都写到 NSIS 日志(可在 /log 模式查看)
  ; regsvr32 /s 即使成功也无 stdout;失败返回非 0 退出码
  nsExec::ExecToLog 'regsvr32 /s "$INSTDIR\resources\dll\dm.dll"'
  Pop $0  ;; 退出码
  ${IfNot} ${Silent}
    ${If} $0 == 0
      DetailPrint "大漠注册成功"
    ${Else}
      DetailPrint "大漠自动注册失败 (exit=$0),可在 app 内手动重试"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUninstall
  ${IfNot} ${Silent}
    DetailPrint "反注册大漠插件..."
  ${EndIf}
  ; /u 反注册;忽略返回值(文件可能已被用户手动删除)
  nsExec::ExecToLog 'regsvr32 /u /s "$INSTDIR\resources\dll\dm.dll"'
  Pop $0
  ${IfNot} ${Silent}
    ${If} $0 == 0
      DetailPrint "大漠反注册成功"
    ${Else}
      DetailPrint "大漠反注册失败 (exit=$0),可能已被用户手动清理"
    ${EndIf}
  ${EndIf}
!macroend