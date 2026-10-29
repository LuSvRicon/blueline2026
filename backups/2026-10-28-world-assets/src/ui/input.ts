/** Form fields own their keyboard input; driving buttons keep the driving keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.tagName !== "INPUT") return false;
  return !["button", "checkbox", "radio", "submit"].includes((target as HTMLInputElement).type);
}

export function launchMenuOpen(): boolean {
  const intro = document.getElementById("intro");
  return Boolean(intro && intro.style.display !== "none");
}
