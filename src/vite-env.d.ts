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
  showDirectoryPicker?(options?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}

/**
 * lib.dom declares the FSA handle shape but omits the async-iteration
 * methods (they come from Web IDL iterators) — add `values()` so the
 * directory monitor can re-list a folder per poll.
 */
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>
}
