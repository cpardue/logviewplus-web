/// <reference types="vite/client" />

/**
 * Minimal File System Access API typing that lib.dom does not cover
 * (`showOpenFilePicker` is Chromium-only and absent from the standard DOM lib).
 */
interface Window {
  showOpenFilePicker?(options?: {
    id?: string
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: { description?: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle[]>
}
