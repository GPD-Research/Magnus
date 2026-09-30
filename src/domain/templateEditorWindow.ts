export const TEMPLATE_EDITOR_VIEW = 'template-editor'
export const TEMPLATE_EDITOR_WINDOW_NAME = 'magnus-template-editor'

export function templateEditorUrl(base: Location = window.location): string {
  const search = new URLSearchParams()
  search.set('view', TEMPLATE_EDITOR_VIEW)
  return `${base.pathname}?${search.toString()}`
}

/** Opens the template editor in its own maximised window; returns null when the popup was blocked. */
export function openTemplateEditorWindow(): Window | null {
  const features = `popup,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`
  const editor = window.open(templateEditorUrl(), TEMPLATE_EDITOR_WINDOW_NAME, features)
  editor?.focus()
  return editor
}
