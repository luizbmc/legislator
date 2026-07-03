import './webBridge.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.jsx'

function restoreRendererFocus(target, selectionSnapshot) {
  window.setTimeout(() => {
    try {
      window.focus()
      if (target?.isConnected && typeof target.focus === 'function') {
        target.focus({ preventScroll: true })
      }
      if (selectionSnapshot && document.contains(selectionSnapshot.container)) {
        const selection = window.getSelection?.()
        if (selection) {
          const range = document.createRange()
          const startOffset = Math.min(selectionSnapshot.startOffset, selectionSnapshot.container.length || selectionSnapshot.container.childNodes?.length || 0)
          const endOffset = Math.min(selectionSnapshot.endOffset, selectionSnapshot.container.length || selectionSnapshot.container.childNodes?.length || 0)
          range.setStart(selectionSnapshot.container, startOffset)
          range.setEnd(selectionSnapshot.container, Math.max(startOffset, endOffset))
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
      window.dispatchEvent(new CustomEvent('normando:focus-restored-after-dialog'))
    } catch {}
  }, 0)
}

function currentSelectionSnapshot() {
  try {
    const selection = window.getSelection?.()
    if (!selection?.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (!range?.startContainer || !document.contains(range.startContainer)) return null
    return {
      container: range.startContainer,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
    }
  } catch {
    return null
  }
}

function installRendererDialogFocusGuard() {
  if (window.__normandoDialogFocusGuardInstalled) return
  window.__normandoDialogFocusGuardInstalled = true

  const wrap = (name) => {
    const original = window[name]
    if (typeof original !== 'function') return
    window[name] = function guardedNativeDialog(...args) {
      const target = document.activeElement
      const selectionSnapshot = currentSelectionSnapshot()
      try {
        return original.apply(window, args)
      } finally {
        restoreRendererFocus(target, selectionSnapshot)
      }
    }
  }

  wrap('alert')
  wrap('confirm')
  wrap('prompt')

  window.legislator?.onRestoreRendererFocus?.(() => {
    restoreRendererFocus(document.activeElement, currentSelectionSnapshot())
  })
}

installRendererDialogFocusGuard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
