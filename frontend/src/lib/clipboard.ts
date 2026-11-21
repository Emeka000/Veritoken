import { useState, useCallback, useRef, useEffect } from "react";

function fallbackCopy(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);

  let succeeded = false;
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (previousRange) {
        selection.addRange(previousRange);
      }
    }
  }

  return succeeded;
}

export function useClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      let succeeded = false;

      try {
        await navigator.clipboard.writeText(text);
        succeeded = true;
      } catch {
        succeeded = fallbackCopy(text);
      }

      if (!succeeded) {
        return false;
      }

      setCopied(true);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
      return true;
    },
    [resetDelay],
  );

  return { copied, copy };
}